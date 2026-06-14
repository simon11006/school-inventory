const STORE_KEY = "school_inventory_mvp_v1";
const THEME_KEY = "school_inventory_theme";
const SYNC_CONFIG_KEY = "school_inventory_sync_config_v1";
const SETUP_KEY = "school_inventory_setup_v1";
const FIELD_TEST_KEY = "school_inventory_field_test_v1";
const FEEDBACK_KEY = "school_inventory_feedback_v1";
const RELEASE_CHECK_KEY = "school_inventory_release_check_v1";
const ADMIN_PIN_KEY = "school_inventory_admin_pin";
const SELECTED_TEACHER_KEY = "school_inventory_selected_teacher";
const SESSION_CONNECTED_KEY = "schoolinven_session_connected";
const DEFAULT_ADMIN_PIN = "1234";
const GLOBAL_ADMIN_VALUE = "__global_admin__";
const KOREA_TIME_ZONE = "Asia/Seoul";
const LOCAL_SCOPE_ID = "local";
const APPS_SCRIPT_URL_PREFIX = "https://script.google.com/macros/s/";
const APPS_SCRIPT_URL_SUFFIX = "/exec";

// 사용 통계 수집 — 학교명 + 앱 버전만 만든이 시트로 전송 (하루 1회)
// 비워두면 전송하지 않음. 셋업 방법은 docs/usage-tracker-setup.md 참고
const USAGE_REGISTRY_URL = "https://script.google.com/macros/s/AKfycbzhCIFB1aBgZcaxXJEHDPeqamRPl6Fnit9wGuvknS7HAdgqG31zkW7bEg0ClWeqoXe_mQ/exec";
const APP_VERSION = "1.0.0";
const USAGE_PING_KEY = "school_inventory_usage_ping_v1";
const USAGE_PING_INTERVAL_MS = 24 * 60 * 60 * 1000;

const seedData = {
  schoolName: "",
  teachers: [],
  locations: [],
  categoriesByLocation: {},
  items: [],
  purchaseRequests: [],
  reservations: [],
  logs: [],
};

let syncConfig = loadSyncConfig();
let justConnectedViaLink = false;
applySyncFromUrl();
maybeResetForRootVisit();
let state = loadState();
if (!state.schoolName?.trim() && syncConfig.schoolName?.trim()) {
  state.schoolName = syncConfig.schoolName;
}
let currentView = "dashboard";
let selectedReservationId = null;
let selectedItemId = null;
let adminMode = false;
let adminScope = null;
let darkMode = InventoryStorage.readText(THEME_KEY) === "dark";
let recordsViewState = { date: "", type: "all" };
let itemsSortState = { key: "", dir: "asc" }; // 물품 관리 표 정렬
let reservationListTab = "all"; // 예약 목록 탭: all | reserved | checkout
let setupState = loadSetupState();
let fieldTestState = loadFieldTestState();
let feedbackState = loadFeedbackState();
let releaseCheckState = loadReleaseCheckState();
let pendingImport = null;
let autoSyncTimer = null;
// Firebase auth 상태 확인 전까지 로그인 유도 UI를 숨겨 새로고침 시 깜빡임 방지
let firebaseAuthPending = !!window.fb;
let autoSyncInFlight = false;
let pollingTimer = null;
let pollingInFlight = false;
const POLL_INTERVAL_MS = 10000;

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  applyTheme();
  bindElements();
  bindEvents();
  restoreAdminSession(); // 새로고침 후에도 같은 세션 동안 관리자 권한 유지
  const viewParam = new URL(location.href).searchParams.get("view");
  const validViews = ["dashboard", "items", "purchaseRequests", "reservations", "import", "records"];
  if (viewParam && validViews.includes(viewParam)) currentView = viewParam;
  render();
  runStartupSync().then(finalizeSetupAfterLink).catch(e => console.warn("Setup finalize error:", e));
  if (new URL(location.href).searchParams.get("openLogin") === "1") {
    // 파라미터 제거 — 이후 새로고침/리로드 시 로그인 모달이 다시 뜨지 않도록
    const cleanUrl = new URL(location.href);
    cleanUrl.searchParams.delete("openLogin");
    history.replaceState({}, "", cleanUrl.toString());
    // 이미 로그인된 상태(세션 복원 예정)면 로그인 모달을 띄우지 않음
    if (!window.fb || !window.fb.auth?.currentUser) {
      setTimeout(() => {
        if (!adminMode && !window.fb?.auth?.currentUser) window.account?.openLogin?.();
      }, 300);
    }
  }
  // 자동 마법사 팝업 제거 — 새 계정 시스템 도입으로 "학교 계정" 버튼으로 유도
  startPolling();
  sendUsagePing();
  document.addEventListener("visibilitychange", handleVisibilityChange);
});

function bindElements() {
  els.schoolName = document.querySelector("#schoolName");
  els.teacherSelect = document.querySelector("#teacherSelect");
  els.statusGrid = document.querySelector("#statusGrid");
  els.searchInput = document.querySelector("#searchInput");
  els.categoryFilter = document.querySelector("#categoryFilter");
  els.locationFilter = document.querySelector("#locationFilter");
  els.mainView = document.querySelector("#mainView");
  els.workPanel = document.querySelector("#workPanel");
  els.panelDrawerBackdrop = document.querySelector("#panelDrawerBackdrop");
  els.panelDrawerContent = document.querySelector("#panelDrawerContent");
  els.heroTitle = document.querySelector("#heroTitle");
  els.heroSub = document.querySelector("#heroSub");
  els.todayLabel = document.querySelector("#todayLabel");
  els.syncStatusLabel = document.querySelector("#syncStatusLabel");
  els.toastRoot = document.querySelector("#toastRoot");
  els.themeToggleBtn = document.querySelector("#themeToggleBtn");
  els.themeIcon = document.querySelector("#themeIcon");
  els.reservationNavLabel = document.querySelector("#reservationNavLabel");
  els.sideMenuLabel = document.querySelector("#sideMenuLabel");
  els.mobileTabBar = document.querySelector("#mobileTabBar");
  els.mobileSheetBackdrop = document.querySelector("#mobileSheetBackdrop");
  els.mobileMoreSheet = document.querySelector("#mobileMoreSheet");
  els.mobileLocationFilter = document.querySelector("#mobileLocationFilter");
  els.toolbarLocationFilter = document.querySelector("#toolbarLocationFilter");
}

function bindEvents() {
  window.addEventListener("popstate", (e) => {
    const view = e.state?.view ?? "dashboard";
    switchView(view, { pushHistory: false });
    selectedReservationId = null;
    selectedItemId = null;
    render();
  });

  // 로고 클릭 → 첫화면(대시보드)으로 이동
  document.querySelector(".brand-logo-title")?.addEventListener("click", () => {
    if (window._superAdminMode) {
      // 총괄관리자 모드: 첫 번째 관리자 패널(가입 학교)로 이동
      document.querySelector("[data-sadmin-tab='schools']")?.click();
    } else {
      switchView("dashboard");
      selectedReservationId = null;
      selectedItemId = null;
      render();
    }
  });

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      switchView(button.dataset.view);
      selectedReservationId = null;
      selectedItemId = null;
      render();
    });
  });

  els.teacherSelect.addEventListener("change", () => {
    saveSelectedTeacher(els.teacherSelect.value);
    renderAdminVisibility(); // 교사 선택에 따라 실별 관리자 로그인 버튼 표시 여부 갱신
    renderMainView();
    renderWorkPanel();
  });
  els.searchInput.addEventListener("input", renderMainView);
  els.categoryFilter?.addEventListener("change", renderMainView);
  els.locationFilter.addEventListener("change", () => {
    if (selectedItemId) {
      const item = getItem(selectedItemId);
      if (item && els.locationFilter.value && item.location !== els.locationFilter.value) selectedItemId = null;
    }
    // 물품실 변경 시 화면 전체를 다시 그려 탭·라벨·권한 표시까지 갱신
    // (실별 관리자가 비담당 물품실을 고르면 교사 화면으로 전환)
    render();
  });
  document.querySelector("#newReservationBtn").addEventListener("click", openReservationModal);
  document.querySelector("#newItemBtn").addEventListener("click", () => openItemModal());
  document.querySelector("#schoolSettingsBtn")?.addEventListener("click", openSchoolSettingsModal);
  // setupGuideLink / handoverGuideLink 는 <a href="...html">로 가이드를 새 탭에서 엶 (기본 동작 사용)
  document.querySelector("#adminModeBtn").addEventListener("click", toggleAdminMode);
  document.querySelector("#roomAdminBtn")?.addEventListener("click", toggleAdminMode);
  els.themeToggleBtn.addEventListener("click", toggleTheme);
  document.querySelector("#helpBtn").addEventListener("click", openHelpModal);
  document.querySelector("#copySupportEmailBtn")?.addEventListener("click", copySupportEmail);
  bindMobileEvents();
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 540px)").matches;
}

async function sendUsagePing() {
  if (!USAGE_REGISTRY_URL) return;
  const schoolName = (state.schoolName || "").trim();
  if (!schoolName) return;

  const lastPing = Number(InventoryStorage.readText(USAGE_PING_KEY) || 0);
  if (Date.now() - lastPing < USAGE_PING_INTERVAL_MS) return;

  try {
    await fetch(USAGE_REGISTRY_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ schoolName, version: APP_VERSION }),
    });
    InventoryStorage.writeText(USAGE_PING_KEY, String(Date.now()));
  } catch (error) {
    // fire-and-forget — 실패해도 앱 동작에 영향 없음
  }
}

function bindMobileEvents() {
  if (!els.mobileTabBar) return;

  els.mobileTabBar.querySelectorAll(".mob-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const action = tab.dataset.mobAction;
      if (action === "more") {
        openMoreSheet();
        return;
      }
      const view = tab.dataset.view;
      if (!view) return;
      closeMobileSheet();
      closeMoreSheet();
      switchView(view);
      selectedReservationId = null;
      selectedItemId = null;
      render();
    });
  });

  els.mobileMoreSheet?.querySelectorAll(".mob-more-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.mobAction;
      const view = btn.dataset.view;
      closeMoreSheet();
      if (view) {
        closeMobileSheet();
        switchView(view);
        selectedReservationId = null;
        selectedItemId = null;
        render();
        return;
      }
      if (action === "help") openHelpModal();
      else if (action === "adminMode") toggleAdminMode();
      else if (action === "schoolSettings") openSchoolSettingsModal();
      else if (action === "account") window.account?.openLogin?.();
    });
  });

  els.mobileSheetBackdrop?.addEventListener("click", () => {
    closeMobileSheet();
    closeMoreSheet();
  });

  // 패널 드로어 닫기
  document.querySelector("#panelDrawerClose")?.addEventListener("click", closePanelDrawer);
  els.panelDrawerBackdrop?.addEventListener("click", (e) => {
    if (e.target === els.panelDrawerBackdrop) closePanelDrawer();
  });

  els.mobileLocationFilter?.addEventListener("change", () => {
    if (els.locationFilter && els.locationFilter.value !== els.mobileLocationFilter.value) {
      els.locationFilter.value = els.mobileLocationFilter.value;
      els.locationFilter.dispatchEvent(new Event("change"));
    }
  });

  // 툴바(예약 화면)의 물품실 선택 → 상단(사이드바) 물품실 선택과 연동
  els.toolbarLocationFilter?.addEventListener("change", () => {
    if (els.locationFilter && els.locationFilter.value !== els.toolbarLocationFilter.value) {
      els.locationFilter.value = els.toolbarLocationFilter.value;
      els.locationFilter.dispatchEvent(new Event("change"));
    }
  });
}

/* ── 데스크톱 우측 패널 드로어 ── */
function openDesktopPanelDrawer() {
  const backdrop = els.panelDrawerBackdrop;
  const content = els.panelDrawerContent;
  if (!backdrop || !content) return;
  // workPanel에 렌더된 노드를 이벤트 리스너 그대로 드로어로 이동
  content.innerHTML = "";
  while (els.workPanel.firstChild) content.appendChild(els.workPanel.firstChild);
  backdrop.hidden = false;
  document.body.style.overflow = "hidden";
}

function closePanelDrawer() {
  const backdrop = els.panelDrawerBackdrop;
  const content = els.panelDrawerContent;
  if (backdrop) backdrop.hidden = true;
  if (content) content.innerHTML = "";
  document.body.style.overflow = "";
  selectedItemId = null;
  selectedReservationId = null;
  renderWorkPanel();
}

function openMobileSheet() {
  if (!isMobileViewport() || !els.workPanel) return;
  els.workPanel.classList.add("is-open");
  showSheetBackdrop();
}

function closeMobileSheet() {
  if (!els.workPanel) return;
  const wasOpen = els.workPanel.classList.contains("is-open");
  els.workPanel.classList.remove("is-open");
  if (wasOpen && isMobileViewport()) {
    selectedItemId = null;
    selectedReservationId = null;
    if (typeof renderWorkPanel === "function") renderWorkPanel();
  }
  hideSheetBackdropIfIdle();
}

function openMoreSheet() {
  els.mobileMoreSheet?.classList.add("is-open");
  showSheetBackdrop();
}

function closeMoreSheet() {
  els.mobileMoreSheet?.classList.remove("is-open");
  hideSheetBackdropIfIdle();
}

function showSheetBackdrop() {
  els.mobileSheetBackdrop?.classList.add("is-visible");
}

function hideSheetBackdropIfIdle() {
  const sheetOpen = els.workPanel?.classList.contains("is-open");
  const moreOpen = els.mobileMoreSheet?.classList.contains("is-open");
  if (!sheetOpen && !moreOpen) {
    els.mobileSheetBackdrop?.classList.remove("is-visible");
  }
}

function syncMobileTabActive() {
  if (!els.mobileTabBar) return;
  els.mobileTabBar.querySelectorAll(".mob-tab[data-view]").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.view === currentView);
  });
}

function attachTableScrollAffordance() {
  if (!els.mainView) return;
  els.mainView.querySelectorAll(".table-wrap").forEach((wrap) => {
    const update = () => {
      const atEnd = wrap.scrollLeft + wrap.clientWidth >= wrap.scrollWidth - 1;
      const noScroll = wrap.scrollWidth <= wrap.clientWidth + 1;
      wrap.classList.toggle("is-scrolled-end", atEnd || noScroll);
    };
    wrap.addEventListener("scroll", update, { passive: true });
    update();
  });
}

function syncMobileLocationFilter() {
  syncLocationMirror(els.mobileLocationFilter);
  syncLocationMirror(els.toolbarLocationFilter);
}

// 보조 물품실 선택(모바일/툴바)을 상단(사이드바) 물품실 선택과 동일하게 맞춘다.
function syncLocationMirror(target) {
  if (!target || !els.locationFilter) return;
  if (target.innerHTML !== els.locationFilter.innerHTML) {
    target.innerHTML = els.locationFilter.innerHTML;
  }
  // 툴바 미러는 '전체' 대신 '물품실 선택'을 안내 문구로 보여준다. (사이드바는 그대로 '전체')
  if (target === els.toolbarLocationFilter) {
    const emptyOption = target.querySelector('option[value=""]');
    if (emptyOption) emptyOption.textContent = "물품실 선택";
  }
  if (target.value !== els.locationFilter.value) {
    target.value = els.locationFilter.value;
  }
  target.disabled = els.locationFilter.disabled;
}

function copySupportEmail() {
  const email = "endeavor1006@naver.com";
  navigator.clipboard.writeText(email).then(() => {
    toast("문의 메일 주소를 복사했습니다.", "success");
  }).catch(() => {
    const temp = document.createElement("input");
    temp.value = email;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand("copy");
    temp.remove();
    toast("문의 메일 주소를 복사했습니다.", "success");
  });
}

function openHelpModal() {
  const modal = openModal({
    title: "사용법 안내",
    submitText: "확인했어요",
    body: `
      <div class="help-body">
        <div class="help-setup-notice">
          <strong>처음 사용하는 학교라면</strong> ① 상단 <b>학교 관리자 로그인 → 가입</b>으로 학교를 등록하고 총괄관리자 <b>승인</b>을 받습니다. ② 승인 후 <b>학교 관리자 로그인</b>으로 로그인해 구글 스프레드시트를 연결하면 <b>교사 초대 주소</b>가 발급됩니다. ③ 교사들에게 초대 주소를 공유하면 바로 사용할 수 있습니다.
        </div>
        <div class="help-intro">
          <ul class="help-intro-list">
            <li>교구이음은 학교마다 각 학교 관리자가 만든 저장소를 연결해 사용합니다.</li>
            <li>선생님이 보는 물품 정보와 예약 내용은 우리 학교 저장소 기준입니다.</li>
            <li>다른 학교 데이터가 함께 보이거나 섞이지 않도록 운영됩니다.</li>
            <li>우리 학교 관리자가 공유한 교사 초대 링크로 접속해야 우리 학교 정보가 연결됩니다.</li>
          </ul>
        </div>

        <div class="help-role-tabs" role="tablist" aria-label="사용 대상별 안내">
          <button class="help-role-tab is-active" data-help-tab="layout" type="button">화면 구성</button>
          <button class="help-role-tab" data-help-tab="teacher" type="button">일반 교사용</button>
          <button class="help-role-tab" data-help-tab="roomAdmin" type="button">실별 담당자용</button>
          <button class="help-role-tab" data-help-tab="globalAdmin" type="button">학교 관리자용</button>
        </div>

        <div class="help-panel is-active" data-help-panel="layout">
          <div class="help-group">
            <h3>화면 구성 한눈에 보기</h3>
            <section>
              <h4>① 상단 바 (헤더)</h4>
              <p>왼쪽에 학교명과 로고, 오른쪽에 다크모드 아이콘, <strong>사용법</strong>, <strong>사용 교사</strong> 선택이 있습니다. 교사 이름을 선택하면 <strong>실별 관리자 로그인</strong> 버튼이 나타납니다. <strong>학교 관리자 로그인</strong>은 학교 계정으로 로그인하는 버튼이며, 로그인 후에는 <strong>학교 계정 ✓</strong>으로 바뀌고 <strong>학교 관리자 모드 켜짐 | 종료</strong> 버튼과 함께 <strong>학교 설정</strong>, 그리고 전체 관리자에게는 <strong>처음 설정 가이드·인수인계 가이드</strong>가 추가로 나타납니다.</p>
            </section>
            <section>
              <h4>② 왼쪽 사이드바</h4>
              <p>맨 위 <strong>물품실 선택</strong> 드롭다운으로 어느 물품실을 볼지 고릅니다. 그 아래는 화면 메뉴입니다 — <em>물품 사용 예약</em>, <em>내 예약·반납</em>이 기본이고, 관리자 모드에서는 <em>물품 관리</em>, <em>구입 요청</em>, <em>일괄 등록</em>, <em>사용 기록</em>이 더 보입니다.</p>
            </section>
            <section>
              <h4>③ 가운데 본문</h4>
              <p>위쪽에 안내 영역과 상태 카드, 그 아래 검색창과 <strong>+ 새 예약</strong> 버튼이 있습니다. 그 아래에 사이드바에서 선택한 메뉴 화면이 표시됩니다.</p>
            </section>
            <section>
              <h4>④ 오른쪽 작업 패널</h4>
              <p>본문 목록에서 물품이나 예약을 한 줄 클릭하면 오른쪽 작업 패널에 상세 정보와 처리 버튼이 나타납니다. 예약 취소·반납·분출 같은 실제 작업은 모두 이 패널에서 합니다.</p>
            </section>
            <section>
              <h4>⑤ 자동 동기화 표시</h4>
              <p>사이드바 아래 <strong>정보 업데이트</strong> 카드에 마지막 동기화 시각이 표시됩니다. 자동 동기화가 켜져 있으면 10초마다 다른 PC의 변경이 자동으로 들어옵니다.</p>
            </section>
          </div>
        </div>

        <div class="help-panel" data-help-panel="teacher" hidden>
          <div class="help-group">
            <h3>일반 교사용</h3>
            <section>
              <h4>1. 학교 전용 링크로 접속하기</h4>
              <p>학교 관리자가 학교 메신저로 공유한 <strong>교사 초대 링크</strong>를 클릭해 접속합니다. 일반 웹앱 주소(<code>item-school.netlify.app</code>)로만 열면 우리 학교 데이터가 자동으로 연결되지 않습니다. 처음 한 번만 초대 링크로 접속하면 이후엔 즐겨찾기에 등록해 그대로 사용해도 됩니다.</p>
            </section>
            <section>
              <h4>2. 본인 이름과 물품실 선택</h4>
              <p>상단 <strong>사용 교사</strong>에서 본인 이름을 고릅니다(이 이름이 예약자로 기록됩니다). 왼쪽 위 <strong>물품실 선택</strong>에서 사용할 물품이 있는 실(체육실·과학실 등)을 고릅니다. 본인 이름이 목록에 없으면 학교 관리자에게 추가 요청하세요.</p>
            </section>
            <section>
              <h4>3. 물품 검색하기</h4>
              <p>왼쪽 메뉴에서 <strong>물품 사용 예약</strong>을 누르면 선택한 물품실의 물품 목록이 나타납니다. 위쪽 <strong>검색</strong> 칸에 물품명 일부를 적으면 즉시 걸러집니다. 각 물품 줄에는 현재 <strong>사용 가능 수량</strong>이 표시되어 바로 예약 가능 여부를 확인할 수 있습니다.</p>
            </section>
            <section>
              <h4>4. 예약하기</h4>
              <p>물품 줄의 <strong>예약하기</strong> 버튼을 누르거나, 오른쪽 위 <strong>+ 새 예약</strong>을 누릅니다. 예약 모달에서 다음을 입력합니다.</p>
              <p>· <strong>수량</strong> — 사용할 개수 (재고 이상은 불가)<br/>
              · <strong>사용 시작일 / 반납 예정일</strong> — 사용 기간<br/>
              · <strong>비고</strong> — 사용 목적·단원명 등 자유 메모<br/>
              · <strong>직접 가져감</strong> — 담당자 분출 처리 전에 본인이 가져갈 경우 체크</p>
              <p>저장하면 예약 상태가 <strong>예약됨</strong>으로 등록되고, 담당자가 분출 처리하면 <strong>분출됨</strong>으로 바뀝니다.</p>
            </section>
            <section>
              <h4>5. 내 예약 상태 확인하기</h4>
              <p>왼쪽 메뉴 <strong>내 예약·반납</strong>에서 본인 예약을 봅니다. 위쪽 카드에 <em>예약됨</em>, <em>분출됨</em>, <em>회수 완료</em> 건수가 요약됩니다.</p>
              <p>· <strong>예약됨</strong> — 등록만 된 상태. 아직 물품을 가져가기 전.<br/>
              · <strong>분출됨</strong> — 담당자가 물품을 내준 상태. 사용 중이며 반납이 필요합니다.<br/>
              · <strong>회수 완료</strong> — 반납이 끝나 처리가 종료됨.</p>
            </section>
            <section>
              <h4>6. 예약 취소·반납 신청</h4>
              <p>내 예약 목록에서 한 줄을 클릭하면 오른쪽 작업 패널에 처리 버튼이 나옵니다. 아직 분출 전이면 <strong>예약 취소</strong>가, 분출 후라면 <strong>반납 요청</strong>이 가능합니다. 실제 회수와 손망 확인은 담당자가 마무리합니다.</p>
            </section>
            <section>
              <h4>7. 없는 물품은 구입 요청</h4>
              <p>찾는 물품이 목록에 없으면 같은 화면 위쪽의 <strong>구입 요청하기</strong>를 누릅니다. 요청 모달에서 물품명·희망 수량·희망 물품실·카테고리·요청 이유를 입력합니다. 이유에 <strong>수업 단원명이나 활용 방법</strong>까지 적어두면 관리자가 검토하기 쉬워집니다.</p>
            </section>
          </div>
        </div>

        <div class="help-panel" data-help-panel="roomAdmin" hidden>
          <div class="help-group">
            <h3>실별 담당자용</h3>
            <section>
              <h4>1. 실별 관리자 로그인</h4>
              <p>상단 <strong>사용 교사</strong>에서 본인 이름을 고르면 <strong>실별 관리자 로그인</strong> 버튼이 나타납니다. 클릭 후 본인 <strong>담당자 PIN</strong>을 입력하면 담당자 모드로 진입합니다. 로그인하면 본인이 배정된 물품실만 편집할 수 있습니다(다른 실은 조회만 가능).</p>
            </section>
            <section>
              <h4>2. 들어온 예약 처리하기</h4>
              <p>로그인하면 <strong>예약·반납 목록</strong>이 자동으로 열립니다. 본인 실 예약 한 줄을 클릭하면 오른쪽 작업 패널에 처리 버튼이 나타납니다.</p>
              <p>· <strong>분출 처리</strong> — 교사에게 실제로 물품을 내줄 때. 상태가 <em>분출됨</em>으로 바뀝니다.<br/>
              · <strong>반납 처리</strong> — 교사가 사용을 끝내고 돌려줄 때. 상태가 <em>회수 완료</em>가 됩니다.<br/>
              · <strong>손망 처리</strong> — 분실·파손·폐기가 있을 때. 손망 수량을 입력하면 총수량에서 영구 차감되고 이력에 기록됩니다.<br/>
              · <strong>예약 삭제</strong> — 잘못 받은 예약을 취소할 때.</p>
              <p>처리 결과는 모두 <strong>사용 기록</strong>에 남아 추적할 수 있습니다.</p>
            </section>
            <section>
              <h4>3. 새 물품 등록하기</h4>
              <p>왼쪽 메뉴 <strong>물품 관리</strong> → 오른쪽 위 <strong>물품 추가</strong> 버튼을 누릅니다. 모달에서 물품명·카테고리·단위(개·세트 등)·총 수량·관리 번호·구입일·구입 금액 등을 입력합니다.</p>
              <p>카테고리 칸은 본인 실에 등록된 카테고리만 드롭다운에 보이며, 처음 보는 카테고리를 직접 입력하면 그 실의 카테고리 목록에 자동 추가됩니다.</p>
            </section>
            <section>
              <h4>4. 기존 물품 수정·상태 변경</h4>
              <p>물품 관리 화면에서 한 줄을 클릭하면 오른쪽 패널에 상세가 나옵니다. <strong>수정</strong> 버튼으로 정보를 고치고, <strong>상태 변경</strong>으로 사용 중지·폐기 등을 처리합니다. 같은 패널에서 그 물품의 사용 기록과 예약 이력도 함께 볼 수 있습니다.</p>
            </section>
            <section>
              <h4>5. 카테고리 관리하기</h4>
              <p>오른쪽 위 <strong>학교 설정</strong>을 누르면 본인 실의 <strong>카테고리</strong> 섹션과 <strong>본인 담당자 PIN 변경</strong> 섹션이 보입니다. 카테고리 추가·이름 변경·삭제 후 <strong>저장</strong>을 누르세요.</p>
              <p>그 카테고리를 쓰는 물품이 1개라도 있으면 삭제가 차단됩니다. 먼저 해당 물품을 다른 카테고리로 옮긴 뒤 삭제하세요.</p>
            </section>
            <section>
              <h4>6. 구입 요청 검토</h4>
              <p>왼쪽 메뉴 <strong>구입 요청</strong>에서 본인 실로 들어온 요청을 봅니다. 항목을 선택해 상태를 일괄 변경(<em>검토 중</em>, <em>구입 진행</em>, <em>완료</em>, <em>반려</em>)하거나 삭제할 수 있습니다. 실제로 구입한 물품은 <strong>물품 관리</strong>에서 새 물품으로 등록하면 교사가 예약할 수 있게 됩니다.</p>
            </section>
            <section>
              <h4>7. 사용 기록 확인</h4>
              <p>왼쪽 메뉴 <strong>사용 기록</strong>에서 본인 실의 처리 내역(분출·반납·손망·취소)을 날짜·종류별로 필터링해 볼 수 있습니다. 분실 사고 추적이나 학기 말 정리에 활용하세요.</p>
            </section>
            <section>
              <h4>8. 담당자 PIN 변경</h4>
              <p>학교 설정 모달의 <strong>본인 담당자 PIN 변경</strong> 섹션에서 현재 PIN과 새 PIN을 입력합니다. 4자리 이상이며, 새 PIN과 확인이 일치해야 저장됩니다. 인계 시 또는 분기마다 한 번씩 변경하길 권장합니다.</p>
            </section>
          </div>
        </div>

        <div class="help-panel" data-help-panel="globalAdmin" hidden>
          <div class="help-group">
            <h3>학교 관리자용</h3>
            <section>
              <h4>1. 처음 한 번: 가입 → 승인 → 구글 스프레드시트 연결</h4>
              <p>상단 <strong>학교 관리자 로그인 → 가입</strong>에서 나이스로 학교를 검색(없으면 직접 입력)하고 아이디·비밀번호·연락 이메일을 등록합니다. 총괄관리자 <strong>승인</strong> 후 다시 <strong>학교 관리자 로그인</strong>으로 로그인하면 연결 설정 화면이 열립니다. 여기서 <strong>처음 설정 가이드</strong>대로 구글 스프레드시트를 만들어 접속 링크를 입력하면 연결이 끝나고 <strong>교사 초대 주소</strong>가 발급됩니다. 처음 한 번만 하면 됩니다.</p>
            </section>
            <section>
              <h4>2. 학교 관리자 로그인</h4>
              <p>상단 <strong>학교 관리자 로그인</strong>을 클릭해 아이디와 비밀번호를 입력합니다. 로그인하면 자동으로 <strong>학교 관리자 모드</strong>로 진입하며 버튼이 <strong>학교 계정 ✓</strong>으로 바뀝니다. 로그아웃은 상단 <strong>학교 관리자 모드 켜짐 | 종료</strong>의 <strong>종료</strong> 버튼을 누르면 됩니다.</p>
            </section>
            <section>
              <h4>3. 학교 기본 설정</h4>
              <p>상단 <strong>학교 설정</strong>에서 다음을 관리합니다.</p>
              <p>· <strong>학교명</strong> — 헤더에 표시되는 이름<br/>
              · <strong>교사 목록</strong> — 사용 교사 드롭다운에 나오는 이름들<br/>
              · <strong>물품실</strong> — 실 이름·담당자 지정·담당자 PIN 설정. 새 실 추가 후 담당자를 지정하고 PIN을 발급하세요.<br/>
              · <strong>카테고리</strong> — 실별로 카테고리를 관리합니다. 실별 담당자에게 직접 등록을 맡길 수도 있습니다.</p>
            </section>
            <section>
              <h4>4. 엑셀로 물품 일괄 등록</h4>
              <p>왼쪽 메뉴 <strong>일괄 등록</strong>에서 <strong>엑셀 양식 받기</strong>로 양식을 내려받아 작성합니다. 필수 칸은 <em>물품명</em>, <em>보관 장소</em>(학교 설정의 물품실 이름과 정확히 일치해야 함), <em>총 수량</em> 세 가지입니다. 작성한 파일을 화면에 끌어다 놓으면 미리보기와 오류 행이 표시되고, 이상이 없으면 <strong>미리보기대로 등록</strong>으로 한 번에 등록됩니다.</p>
            </section>
            <section>
              <h4>5. 교사 초대 주소 공유</h4>
              <p>학교 계정 연결이 끝나면 <strong>교사 초대 주소</strong>(<code>.../?s=짧은코드</code>)가 발급됩니다. 상단 <strong>학교 계정 ✓</strong>을 클릭하면 <strong>주소 복사</strong> 버튼으로 언제든 복사할 수 있습니다. 이 주소를 학교 메신저로 교사들에게 공유하세요.</p>
              <p>주소를 받은 교사는 해당 링크로 한 번만 접속하면 이후엔 즐겨찾기로 사용할 수 있습니다.</p>
            </section>
            <section>
              <h4>6. 자동 동기화 모드 설정</h4>
              <p>학교 설정의 <strong>저장소 연결 → 고급</strong>에서 <strong>자동 동기화</strong>를 <strong>저장 후 원격에 자동 올리기</strong>로 두면 변경이 일어날 때마다 즉시 스프레드시트에 저장되고, 10초마다 다른 PC의 변경을 자동으로 가져옵니다. 운영 중에는 이 모드를 권장합니다.</p>
            </section>
            <section>
              <h4>7. 담당자 인수인계</h4>
              <p>담당 교사가 바뀔 때는 상단 <strong>관리자 도구 → 인수인계 가이드</strong>를 열어 단계별로 따라 하세요. 데이터·교사 접속주소를 그대로 살린 채 새 담당자(또는 학교 공용 계정)에게 넘기는 방법을 안내합니다.</p>
              <p>인계 직전 백업이 필요하면 <strong>일괄 등록</strong> 탭의 <strong>현재 물품 내보내기</strong>로 CSV 백업을 받을 수 있습니다.</p>
            </section>
          </div>
        </div>
        <p class="help-foot">일반 교사는 예약과 요청 중심으로, 실별 담당자는 분출·반납·물품 관리 중심으로, 학교 관리자는 전체 설정과 운영을 담당합니다.</p>
        <section style="margin-top:18px">
          <h4>수집 정보 안내</h4>
          <p>사용 학교명만 수집됩니다. 개별 학교의 물품·개인정보는 수집되지 않습니다.</p>
        </section>
      </div>
    `,
    onSubmit: () => true,
  });

  modal.querySelectorAll("[data-help-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.helpTab;
      modal.querySelectorAll("[data-help-tab]").forEach((tab) => {
        tab.classList.toggle("is-active", tab === button);
      });
      modal.querySelectorAll("[data-help-panel]").forEach((panel) => {
        const isTarget = panel.dataset.helpPanel === target;
        panel.hidden = !isTarget;
        panel.classList.toggle("is-active", isTarget);
      });
    });
  });
}

function loadState() {
  const saved = InventoryStorage.readText(scopedStorageKey(STORE_KEY));
  if (!saved) return migrateState(InventoryStorage.clone(seedData));
  try {
    return migrateState(JSON.parse(saved));
  } catch {
    return migrateState(InventoryStorage.clone(seedData));
  }
}

function scopedStorageKey(baseKey) {
  const scopeId = getSchoolScopeId();
  return scopeId === LOCAL_SCOPE_ID ? baseKey : `${baseKey}_${scopeId}`;
}

function getSchoolScopeId(config = syncConfig) {
  if (!config || config.provider !== "appsScript" || !config.endpoint || !config.apiKey) return LOCAL_SCOPE_ID;
  return `school_${hashString(`${config.endpoint}|${config.apiKey}`)}`;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function migrateState(data) {
  const locationMap = {
    체육창고: "체육실",
    "과학실 준비실": "과학실",
  };

  data.teachers = data.teachers || [];
  data.locations = [...new Set((data.locations || []).map((location) => locationMap[location] || location))];
  // 예약 날짜 정규화: 스프레드시트가 날짜 칸을 Date로 바꿔 "2026-06-13T15:00:00.000Z"
  // 같은 ISO 시각으로 돌려주면 표시뿐 아니라 startDate<=today() 같은 비교도 어긋난다.
  // 항상 YYYY-MM-DD 문자열로 맞춰 둔다.
  data.reservations = (data.reservations || []).map((reservation) => ({
    ...reservation,
    startDate: normalizeDateValue(reservation.startDate),
    endDate: normalizeDateValue(reservation.endDate),
  }));
  data.logs = data.logs || [];
  // 삭제 기록(툼스톤): 어떤 기기에서 무엇을 지웠는지 추적해 서버 병합 시 부활을 막는다.
  data.deletions = Array.isArray(data.deletions) ? data.deletions : [];
  data.purchaseRequests = (data.purchaseRequests || []).map((request) => ({
    id: request.id || createId("purchase"),
    itemName: request.itemName || request.name || "",
    category: request.category || "",
    quantity: Number(request.quantity || 1),
    location: request.location || "",
    requester: request.requester || "",
    note: request.note || "",
    referenceUrl: request.referenceUrl || "",
    type: request.type || "신규 구입",
    relatedItemId: request.relatedItemId || "",
    status: request.status || "요청됨",
    createdAt: request.createdAt || new Date().toISOString(),
    updatedAt: request.updatedAt || "",
  }));
  data.items = (data.items || []).map((item) => {
    const normalized = normalizeItemAcquisitions({
      ...item,
      location: locationMap[item.location] || item.location,
    }, data.logs);
    // 손망이 total에서 차감되지 않았던 기존 데이터 보정
    if (!normalized.__damageInTotal__) {
      const legacy = (normalized.damaged || 0) + (normalized.lost || 0) + (normalized.disposed || 0);
      normalized.total = Math.max(0, (normalized.total || 0) - legacy);
      normalized.__damageInTotal__ = true;
    }
    return normalized;
  });

  data.meta = {
    createdAt: data.meta?.createdAt || new Date().toISOString(),
    updatedAt: data.meta?.updatedAt || new Date().toISOString(),
    deviceId: data.meta?.deviceId || getDeviceId(),
  };
  data.adminPin = data.adminPin || getStoredAdminPin() || DEFAULT_ADMIN_PIN;
  data.locationManagers = data.locationManagers && typeof data.locationManagers === "object" ? data.locationManagers : {};
  data.locationManagers = Object.fromEntries(
    Object.entries(data.locationManagers)
      .map(([location, manager]) => [locationMap[location] || location, {
        teacher: manager?.teacher || "",
        pin: manager?.pin || "",
      }])
      .filter(([location]) => data.locations.includes(location)),
  );
  const legacyCategories = Array.isArray(data.categories) ? data.categories : [];
  const sanitizedLegacy = [...new Set(legacyCategories.map((category) => String(category || "").trim()).filter(Boolean))];

  let categoriesByLocation = data.categoriesByLocation;
  if (!categoriesByLocation || typeof categoriesByLocation !== "object" || Array.isArray(categoriesByLocation)) {
    categoriesByLocation = {};
  }

  // Apps Script에서 옛 단일 categories만 있던 경우 호환 마커
  delete categoriesByLocation.__legacy__;

  data.locations.forEach((loc) => {
    if (!Array.isArray(categoriesByLocation[loc])) categoriesByLocation[loc] = [];
  });

  const hasNewModel = Object.values(categoriesByLocation).some((arr) => Array.isArray(arr) && arr.length > 0);
  if (!hasNewModel) {
    data.items.forEach((item) => {
      const loc = locationMap[item.location] || item.location;
      const cat = String(item.category || "").trim();
      if (loc && cat && Array.isArray(categoriesByLocation[loc]) && !categoriesByLocation[loc].includes(cat)) {
        categoriesByLocation[loc].push(cat);
      }
    });
  }

  Object.keys(categoriesByLocation).forEach((loc) => {
    const arr = categoriesByLocation[loc];
    if (!Array.isArray(arr)) {
      categoriesByLocation[loc] = [];
      return;
    }
    categoriesByLocation[loc] = [...new Set(arr.map((c) => String(c || "").trim()).filter(Boolean))];
  });

  Object.keys(categoriesByLocation).forEach((loc) => {
    if (!data.locations.includes(loc)) delete categoriesByLocation[loc];
  });

  data.categoriesByLocation = categoriesByLocation;
  delete data.categories;
  void sanitizedLegacy;

  return data;
}

function normalizeItemAcquisitions(item, logs = []) {
  let acquisitions = Array.isArray(item.acquisitions) ? item.acquisitions : [];
  if (typeof item.acquisitions === "string" && item.acquisitions.trim()) {
    try {
      acquisitions = JSON.parse(item.acquisitions);
    } catch {
      acquisitions = [];
    }
  }
  acquisitions = acquisitions
    .map((entry) => ({
      id: entry.id || createId("acq"),
      quantity: Number(entry.quantity || 0),
      purchasedAt: entry.purchasedAt || "",
      price: Number(entry.price || 0),
      note: entry.note || "",
      createdAt: entry.createdAt || "",
    }))
    .filter((entry) => entry.quantity > 0);

  if (!acquisitions.length) acquisitions = inferItemAcquisitionsFromLogs(item, logs);
  return { ...item, acquisitions };
}

function inferItemAcquisitionsFromLogs(item, logs = []) {
  const itemLogs = logs.filter((log) => log.itemId === item.id);
  const mergeEntries = itemLogs
    .map((log) => {
      const match = String(log.message || "").match(/수량을\s*(\d+)\s*→\s*(\d+)/);
      if (!match) return null;
      const before = Number(match[1]);
      const after = Number(match[2]);
      const quantity = after - before;
      return quantity > 0 ? {
        id: createId("acq"),
        quantity,
        purchasedAt: formatDateFromIso(log.createdAt),
        price: 0,
        note: "통합 등록",
        createdAt: log.createdAt || "",
      } : null;
    })
    .filter(Boolean);
  const mergedQuantity = mergeEntries.reduce((sum, entry) => sum + entry.quantity, 0);
  const baseQuantity = Math.max(0, Number(item.total || 0) - mergedQuantity);
  const baseEntry = baseQuantity > 0 ? [{
    id: createId("acq"),
    quantity: baseQuantity,
    purchasedAt: item.purchasedAt || "",
    price: Number(item.price || 0),
    note: "최초 등록",
    createdAt: itemLogs.find((log) => ["물품 등록", "일괄 등록"].includes(log.type))?.createdAt || "",
  }] : [];
  return [...baseEntry, ...mergeEntries];
}

function formatDateFromIso(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return formatDateInTimeZone(date);
}

function getDeviceId() {
  const key = scopedStorageKey("school_inventory_device_id");
  let id = InventoryStorage.readText(key);
  if (!id) {
    id = createId("device");
    InventoryStorage.writeText(key, id);
  }
  return id;
}

function loadSyncConfig() {
  const fallback = {
    provider: "local",
    endpoint: "",
    apiKey: "",
    autoSync: "manual",
    lastCheckedAt: "",
    lastSyncedAt: "",
    lastRemoteSavedAt: "",
    schoolCode: "",  // 짧은 주소(?s=) 로 연결된 학교 코드 (heartbeat 용)
  };
  const cfg = { ...fallback, ...InventoryStorage.readJson(SYNC_CONFIG_KEY, {}) };
  // (구버전 호환) 교사·실별 담당자도 변경분을 스프레드시트에 올려야 동기화가 된다.
  // 과거 읽기 전용(pullOnStart)으로 저장된 연결을 쓰기 모드(pushAfterSave)로 승격한다.
  // 서버가 역할(role)에 따라 안전하게 병합하므로 교사가 관리자 데이터를 덮어쓰지 않는다.
  if (cfg.provider === "appsScript" && cfg.autoSync === "pullOnStart") {
    cfg.autoSync = "pushAfterSave";
  }
  return cfg;
}

function saveSyncConfig() {
  InventoryStorage.writeJson(SYNC_CONFIG_KEY, syncConfig);
}

function markSyncChecked(remoteSavedAt = "") {
  syncConfig.lastCheckedAt = new Date().toISOString();
  if (remoteSavedAt) syncConfig.lastRemoteSavedAt = remoteSavedAt;
  saveSyncConfig();
  // 짧은 주소로 연결된 학교의 활용 추적 (account-ui.js 가 로드된 경우에만)
  if (syncConfig.schoolCode && window.account?.heartbeat) {
    window.account.heartbeat(syncConfig.schoolCode);
  }
  renderTodayLabel();
}

// account-ui.js(모듈)가 ?s=코드 해석 후 호출하는 연결 적용 진입점
function applyConnectionFromAccount(conn, options = {}) {
  if (!conn || !conn.apiKey) return false;
  let endpoint = conn.webAppUrl || "";
  if (!endpoint && conn.deploymentId) {
    endpoint = APPS_SCRIPT_URL_PREFIX + conn.deploymentId + APPS_SCRIPT_URL_SUFFIX;
  }
  if (!endpoint) return false;
  syncConfig.provider = "appsScript";
  syncConfig.endpoint = endpoint;
  syncConfig.apiKey   = conn.apiKey;
  if (conn.shortCode) syncConfig.schoolCode = conn.shortCode;
  if (conn.schoolName) syncConfig.schoolName = conn.schoolName;
  // 학교 관리자·실별 담당자·교사 모두 변경분을 스프레드시트로 올려야 한다(쓰기 모드).
  // 예전에는 교사용(?s=)을 읽기 전용(pullOnStart)으로 두어 교사가 만든 예약·구입요청이
  // 원격에 올라가지 않아 관리자에게 보이지 않았다. 서버(Apps Script)가 역할(role)에 따라
  // 안전하게 병합하므로 교사 푸시가 관리자 데이터를 덮어쓰지 않는다.
  // role 은 저장 시점의 adminMode 로 판단한다(관리자/실별담당자=admin, 일반 교사=teacher).
  syncConfig.autoSync = "pushAfterSave";
  saveSyncConfig();
  justConnectedViaLink = true;
  sessionStorage.setItem(SESSION_CONNECTED_KEY, "1");
  return true;
}
window.applyConnectionFromAccount = applyConnectionFromAccount;
// Firebase auth 상태 확인 완료 — 로그인 가드 해제 후 재렌더
window.setFirebaseAuthReady = function() {
  if (!firebaseAuthPending) return;
  firebaseAuthPending = false;
  render();
};
// account-ui.js 가 현재 연결된 schoolCode 를 읽을 수 있게 노출
window.getSchoolCode = () => syncConfig.schoolCode;
// 학교가 Firebase에서 삭제됐을 때 로컬 연결 초기화 (account-ui.js 에서 호출)
window.clearSchoolConnection = function() {
  syncConfig = {
    ...syncConfig,
    provider: "local", endpoint: "", apiKey: "",
    schoolCode: "", schoolName: "", autoSync: "manual",
  };
  saveSyncConfig();
  state.schoolName = "";
  saveState();
  sessionStorage.removeItem(SESSION_CONNECTED_KEY);
};
// 학교 계정 로그인 시 schoolName 이 비어 있으면 Firebase 값으로 자동 세팅
window.setFirebaseSchoolName = function(name) {
  if (!state.schoolName?.trim() && name?.trim()) {
    state.schoolName = name.trim();
    saveState();
    render();
  }
};

// ── 관리자 권한 세션 유지 (sessionStorage: 새로고침 유지, 창 닫으면 해제) ──
const ADMIN_SESSION_KEY = "schoolinven_admin_session";
function persistAdminSession() {
  try { sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({ adminMode, adminScope })); } catch {}
}
function clearAdminSession() {
  try { sessionStorage.removeItem(ADMIN_SESSION_KEY); } catch {}
}
function restoreAdminSession() {
  try {
    const raw = sessionStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved && saved.adminMode && saved.adminScope?.type) {
      adminMode = true;
      adminScope = saved.adminScope;
      document.body.classList.add("is-admin");
      // 세션 복원으로 관리자 모드 재진입 시에도 총괄 대시보드 버튼 숨김
      if (saved.adminScope.type === "global") {
      }
    }
  } catch {}
}

// 학교 계정 로그인 성공 시 account-ui.js 에서 호출 → PIN 없이 전체 관리자 모드 진입
window.enterSchoolAdminMode = function () {
  // 총괄 대시보드는 서비스 운영자 전용 — 경로에 관계없이 항상 숨김
  if (adminMode && isGlobalAdmin()) { persistAdminSession(); return; } // 이미 전체관리자
  adminMode  = true;
  adminScope = { type: "global", locations: [], teacher: GLOBAL_ADMIN_VALUE };
  document.body.classList.add("is-admin");
  if (els.teacherSelect && els.teacherSelect.value !== GLOBAL_ADMIN_VALUE) {
    els.teacherSelect.value = GLOBAL_ADMIN_VALUE;
  }
  persistAdminSession();
  render();
};

// 로그아웃 시 account-ui.js 에서 호출 → 관리자 권한 완전 해제
window.exitSchoolAdminMode = function () {
  adminMode = false;
  adminScope = null;
  clearAdminSession();
  document.body.classList.remove("is-admin");
};

function extractDeploymentId(endpoint) {
  if (!endpoint) return "";
  if (endpoint.startsWith(APPS_SCRIPT_URL_PREFIX) && endpoint.endsWith(APPS_SCRIPT_URL_SUFFIX)) {
    return endpoint.slice(APPS_SCRIPT_URL_PREFIX.length, endpoint.length - APPS_SCRIPT_URL_SUFFIX.length);
  }
  return "";
}

function applySyncFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const deploymentId = params.get("d");
    let gsUrl = params.get("u") || params.get("gs_url");
    if (!gsUrl && deploymentId) {
      gsUrl = APPS_SCRIPT_URL_PREFIX + deploymentId + APPS_SCRIPT_URL_SUFFIX;
    }
    const gsKey = params.get("k") || params.get("gs_key");
    if (!gsUrl || !gsKey) return;
    syncConfig.provider = "appsScript";
    syncConfig.endpoint = gsUrl;
    syncConfig.apiKey = gsKey;
    if (syncConfig.autoSync === "manual") syncConfig.autoSync = "pushAfterSave";
    saveSyncConfig();
    justConnectedViaLink = true;
    sessionStorage.setItem(SESSION_CONNECTED_KEY, "1");
  } catch (e) {
    // URL 파싱 실패 시 무시
  }
}

// 루트 URL에 연결 파라미터가 없고 이번 세션에 ?s= 또는 ?d=&k= 로 연결한 적도 없으면
// syncConfig를 메모리에서만 초기화 → localStorage 데이터는 보존하되 화면은 깨끗하게
function maybeResetForRootVisit() {
  const params = new URLSearchParams(location.search);
  const hasConnectionParams = params.has("s") || params.has("d") || params.has("u") || params.has("k");
  if (hasConnectionParams) return;
  if (sessionStorage.getItem(SESSION_CONNECTED_KEY)) return;
  syncConfig = {
    ...syncConfig,
    provider: "local",
    endpoint: "",
    apiKey: "",
    schoolCode: "",
    schoolName: "",
    autoSync: "manual",
  };
}

function generateTeacherInviteLink() {
  if (!syncConfig.endpoint || !syncConfig.apiKey) return "";
  const base = window.location.origin + window.location.pathname;
  const params = new URLSearchParams();
  const deploymentId = extractDeploymentId(syncConfig.endpoint);
  if (deploymentId) {
    params.set("d", deploymentId);
  } else {
    params.set("u", syncConfig.endpoint);
  }
  params.set("k", syncConfig.apiKey);
  return base + "?" + params.toString();
}

function loadSetupState() {
  const fallback = {
    driveName: "",
    spreadsheetName: "inventory-data",
    ownerName: "",
    ownerEmail: "",
    notes: "",
    awaitingLinkConnect: false,
    steps: {
      driveCreated: false,
      spreadsheetCreated: false,
      scriptCreated: false,
      webAppDeployed: false,
      connected: false,
      firstBackup: false,
    },
  };
  const saved = InventoryStorage.readJson(scopedStorageKey(SETUP_KEY), {});
  return {
    ...fallback,
    ...saved,
    steps: { ...fallback.steps, ...(saved.steps || {}) },
  };
}

function saveSetupState() {
  InventoryStorage.writeJson(scopedStorageKey(SETUP_KEY), setupState);
}

function loadFieldTestState() {
  const fallback = {
    testerName: "",
    testDate: today(),
    teacherCount: "",
    deviceNote: "",
    notes: "",
    steps: {
      openApp: false,
      setTeacher: false,
      importExcel: false,
      reserveItem: false,
      checkoutItem: false,
      returnItem: false,
      damageFlow: false,
      syncDiagnose: false,
      secondDevicePull: false,
      exportReport: false,
    },
  };
  const saved = InventoryStorage.readJson(scopedStorageKey(FIELD_TEST_KEY), {});
  return {
    ...fallback,
    ...saved,
    steps: { ...fallback.steps, ...(saved.steps || {}) },
  };
}

function saveFieldTestState() {
  InventoryStorage.writeJson(scopedStorageKey(FIELD_TEST_KEY), fieldTestState);
}

function loadFeedbackState() {
  const fallback = {
    items: [
      {
        id: createId("feedback"),
        title: "현장 테스트 후 첫 피드백을 입력하세요",
        source: "시범 운영",
        priority: "보통",
        status: "검토 중",
        note: "교사 사용 중 헷갈린 지점이나 추가 요청을 이곳에 기록합니다.",
        createdAt: new Date().toISOString(),
      },
    ],
  };
  const saved = InventoryStorage.readJson(scopedStorageKey(FEEDBACK_KEY), {});
  return {
    ...fallback,
    ...saved,
    items: saved.items?.length ? saved.items : fallback.items,
  };
}

function saveFeedbackState() {
  InventoryStorage.writeJson(scopedStorageKey(FEEDBACK_KEY), feedbackState);
}

function loadReleaseCheckState() {
  const fallback = {
    checkedBy: "",
    checkedAt: today(),
    notes: "",
    steps: {
      offlineOpen: false,
      vendorIncluded: false,
      excelImport: false,
      adminPinChanged: false,
      appsScriptCopied: false,
      syncDiagnoseOk: false,
      backupExported: false,
      fieldReportExported: false,
      feedbackReviewed: false,
      demoDocsReady: false,
    },
  };
  const saved = InventoryStorage.readJson(scopedStorageKey(RELEASE_CHECK_KEY), {});
  return {
    ...fallback,
    ...saved,
    steps: { ...fallback.steps, ...(saved.steps || {}) },
  };
}

function saveReleaseCheckState() {
  InventoryStorage.writeJson(scopedStorageKey(RELEASE_CHECK_KEY), releaseCheckState);
}

function getAdminPin() {
  const storedPin = getStoredAdminPin();
  if (state?.adminPin && state.adminPin !== DEFAULT_ADMIN_PIN) return state.adminPin;
  return storedPin || state?.adminPin || DEFAULT_ADMIN_PIN;
}

function getStoredAdminPin() {
  return InventoryStorage.readText(scopedStorageKey(ADMIN_PIN_KEY))
    || InventoryStorage.readText(ADMIN_PIN_KEY)
    || getAdminPinFromStoredState(scopedStorageKey(STORE_KEY))
    || getAdminPinFromStoredState(STORE_KEY)
    || "";
}

function getAdminPinFromStoredState(key) {
  const saved = InventoryStorage.readJson(key, {});
  return saved.adminPin || "";
}

function setAdminPin(pin) {
  state.adminPin = pin;
  InventoryStorage.writeText(scopedStorageKey(ADMIN_PIN_KEY), pin);
  if (getSchoolScopeId() === LOCAL_SCOPE_ID) InventoryStorage.writeText(ADMIN_PIN_KEY, pin);
}

function saveState({ touch = true } = {}) {
  if (touch) {
    state.meta = {
      ...(state.meta || {}),
      updatedAt: new Date().toISOString(),
      deviceId: getDeviceId(),
    };
  }
  InventoryStorage.writeJson(scopedStorageKey(STORE_KEY), state);
  if (touch) {
    scheduleAutoPush();
    if (syncConfig.schoolCode) window.account?.heartbeat?.(syncConfig.schoolCode);
  }
}

// 삭제를 다른 기기에도 전파하기 위한 툼스톤 기록.
// 서버 병합은 원격 단독 항목을 보존하므로, 삭제는 이 기록이 있어야 실제로 전파된다.
// (예약 취소·반납은 '삭제'가 아니라 상태 변경이므로 여기 대상이 아니다.)
function recordDeletion(coll, id) {
  if (!id) return;
  if (!Array.isArray(state.deletions)) state.deletions = [];
  state.deletions.push({ coll, id: String(id), at: new Date().toISOString() });
  if (state.deletions.length > 1000) state.deletions = state.deletions.slice(-1000);
}

function render() {
  const hasSchoolName = Boolean((state.schoolName || "").trim());
  els.schoolName.textContent = hasSchoolName ? state.schoolName : "학교명을 설정해주세요";
  els.schoolName.classList.toggle("needs-setup", !hasSchoolName);
  // 물품실 선택값을 먼저 확정해야 displayAsAdmin()이 정확히 계산된다.
  renderTeacherSelect();
  renderLocationFilter();
  // 교사 화면으로 표시되는 상황(로그아웃 또는 실별 관리자가 비담당 물품실 선택)에서
  // 관리자 전용 뷰에 있으면 대시보드로 보정 (히어로 갱신 전에)
  if (!displayAsAdmin() && ["records", "import", "items"].includes(currentView)) currentView = "dashboard";
  renderTodayLabel();
  renderHero();
  renderStatusGrid();
  renderThemeButton();
  renderAdminVisibility();
  renderModeLabels();
  renderNavigation();
  renderMainView();
  renderWorkPanel();
}

function renderModeLabels() {
  const asAdmin = displayAsAdmin();
  if (els.reservationNavLabel) {
    els.reservationNavLabel.textContent = asAdmin ? "예약·분출 목록" : "내 예약·반납";
  }
  const mobLabel = document.querySelector("#mobReservationTabLabel");
  if (mobLabel) mobLabel.textContent = asAdmin ? "예약 목록" : "내 예약";
}

function applyTheme() {
  document.body.classList.toggle("dark-mode", darkMode);
}

function toggleTheme() {
  darkMode = !darkMode;
  InventoryStorage.writeText(THEME_KEY, darkMode ? "dark" : "light");
  applyTheme();
  renderThemeButton();
  toast(darkMode ? "다크모드를 켰어요" : "라이트모드로 바꿨어요", "success");
}

function renderThemeButton() {
  if (!els.themeToggleBtn) return;
  const label = darkMode ? "라이트모드로 전환" : "다크모드로 전환";
  els.themeToggleBtn.setAttribute("aria-label", label);
  els.themeToggleBtn.setAttribute("title", darkMode ? "라이트모드" : "다크모드");
  if (els.themeIcon) els.themeIcon.textContent = darkMode ? "☀" : "◐";
}

function renderTodayLabel() {
  if (!els.todayLabel) return;
  const fmt = new Intl.DateTimeFormat("ko-KR", {
    timeZone: KOREA_TIME_ZONE,
    month: "long",
    day: "numeric",
    weekday: "short",
  });
  els.todayLabel.textContent = fmt.format(new Date());
  if (!els.syncStatusLabel) return;
  const checkedAt = syncConfig.lastCheckedAt || syncConfig.lastSyncedAt;
  if (!checkedAt) {
    els.syncStatusLabel.textContent = "기록 없음";
    return;
  }
  const syncFmt = new Intl.DateTimeFormat("ko-KR", {
    timeZone: KOREA_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  els.syncStatusLabel.textContent = syncFmt.format(new Date(checkedAt));
}

function renderHero() {
  if (!els.heroTitle) return;
  if (window._superAdminMode) return; // 총괄관리자 대시보드 — hero 유지
  if (!canUseRemoteSync()) {
    if (firebaseAuthPending) {
      els.heroTitle.textContent = "";
      els.heroSub.innerHTML = "";
      return;
    }
    // 미연결 상태 — 학교 계정 시스템으로 유도
    els.heroTitle.textContent = "학교 계정으로 시작하세요";
    els.heroSub.classList.remove("hero-sub-notice");
    els.heroSub.innerHTML = `<button class="primary compact" id="heroAccountBtn" type="button">학교 계정 로그인 · 가입</button>`;
    els.heroSub.querySelector("#heroAccountBtn").addEventListener("click", () => window.account?.openLogin?.());
    return;
  }
  if (!state.schoolName?.trim()) {
    els.heroTitle.textContent = "학교 설정을 먼저 완료해주세요";
    els.heroSub.classList.remove("hero-sub-notice");
    if (isGlobalAdmin()) {
      // 이미 학교 계정 로그인(자동 관리자) 상태 → 바로 학교 설정 열기 (PIN 불필요)
      els.heroSub.innerHTML = `<button class="primary compact" id="heroSetupBtn" type="button">학교 설정 입력하기</button>`;
      els.heroSub.querySelector("#heroSetupBtn").addEventListener("click", openSchoolSettingsModal);
    } else {
      // 로그아웃 상태 → 학교 계정 로그인으로 유도 (로그인하면 자동으로 관리자 모드)
      els.heroSub.innerHTML = `
        <button class="primary compact" id="heroLoginBtn" type="button">학교 계정으로 로그인</button>
        <button class="ghost compact" id="heroPinBtn" type="button" style="margin-left:8px;">관리자 PIN으로 들어가기</button>`;
      els.heroSub.querySelector("#heroLoginBtn").addEventListener("click", () => window.account?.openLogin?.());
      els.heroSub.querySelector("#heroPinBtn").addEventListener("click", toggleAdminMode);
    }
    return;
  }

  const heroByView = {
    dashboard: {
      title: "사용할 물품을 바로 찾아 예약하세요",
      sub: "왼쪽에서 물품실을 고르고, 검색한 뒤 + 새 예약을 누르면 됩니다.",
    },
    items: {
      title: "관리자가 물품 목록을 점검하는 화면입니다",
      sub: "물품 정보를 수정하거나 손망·분실 상태를 직접 관리할 수 있어요.",
    },
    purchaseRequests: {
      title: "교사들의 구입 요청을 확인하세요",
      sub: "목록에 없는 물품을 모아 보고 구입 여부를 정리합니다.",
    },
    reservations: {
      title: displayAsAdmin() ? "전체 예약과 반납 흐름을 확인하세요" : "내 예약을 확인하고 반납을 기록하세요",
      sub: displayAsAdmin() ? "모든 교사의 예약됨 → 분출됨 → 회수 완료 흐름을 확인합니다." : "내 예약의 예약됨 → 분출됨 → 회수 완료 흐름을 확인합니다.",
    },
    import: {
      title: "기존 엑셀 자료를 한 번에 가져오기",
      sub: "CSV로 저장한 뒤 그대로 올리면 정리해 드려요.",
    },
    records: {
      title: "오늘까지 남은 모든 발자국",
      sub: "누가 언제 무엇을 했는지 시간순으로 살펴보세요.",
    },
  };
  const data = heroByView[currentView] || heroByView.dashboard;
  els.heroTitle.textContent = data.title;
  els.heroSub.classList.remove("hero-sub-notice");
  const zone = els.locationFilter && els.locationFilter.value;
  if (zone && currentView === "dashboard") {
    els.heroSub.textContent = `${zone} 물품을 검색하고 예약하세요.`;
  } else {
    els.heroSub.textContent = data.sub;
  }

  // 뷰별 히어로 아이콘 업데이트
  const heroIconEl = document.querySelector("#heroBigIcon");
  if (heroIconEl) {
    const HERO_ICONS = {
      dashboard:        `<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4M8 14l3 3 5-5"/></svg>`,
      items:            `<svg viewBox="0 0 24 24"><path d="M3 7l9-4 9 4-9 4-9-4Z"/><path d="M3 7v10l9 4 9-4V7"/></svg>`,
      reservations:     `<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4V3Z"/></svg>`,
      purchaseRequests: `<svg viewBox="0 0 24 24"><path d="M3 4h2l2.5 12h11L21 8H6"/><circle cx="9" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/></svg>`,
      import:           `<svg viewBox="0 0 24 24"><path d="M12 16V4M8 8l4-4 4 4"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>`,
      records:          `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
    };
    heroIconEl.innerHTML = HERO_ICONS[currentView] || HERO_ICONS.dashboard;
  }

  // 히어로 CTA 버튼 표시/숨김
  const heroCta = document.querySelector(".hero-cta");
  if (heroCta) heroCta.hidden = currentView !== "dashboard";
}

function setHeroLoading(active) {
  const hero = document.querySelector(".hero");
  if (!hero) return;
  hero.classList.toggle("is-loading", active);
}

function toast(message, tone = "") {
  if (!els.toastRoot) return;
  const node = document.createElement("div");
  node.className = `toast${tone ? " is-" + tone : ""}`;
  node.textContent = message;
  els.toastRoot.appendChild(node);
  setTimeout(() => {
    node.style.opacity = "0";
    node.style.transition = "opacity .25s ease";
  }, 2200);
  setTimeout(() => node.remove(), 2600);
}

async function toggleAdminMode() {
  if (adminMode) {
    // Firebase 연결 학교: 종료 = 로그아웃까지 함께 처리
    if (syncConfig.schoolCode) {
      window.account?.schoolAdminLogout?.();
      return;
    }
    adminMode = false;
    adminScope = null;
    clearAdminSession();
    if (["records", "items", "import"].includes(currentView)) switchView("dashboard");
    selectedItemId = null;
    selectedReservationId = null;
    document.body.classList.remove("is-admin");
    render();
    toast("관리자 모드가 종료되었어요", "warn");
    return;
  }

  const scope = await requestAdminScope();
  if (!scope) return;
  adminMode = true;
  adminScope = scope;
  // 실별 담당자(location) 모드는 세션에 저장해 새로고침 후에도 유지.
  // 글로벌 PIN 진입은 저장하지 않음(공용 PC 보안).
  if (scope.type === "location") persistAdminSession();
  switchView("reservations");
  selectedItemId = null;
  selectedReservationId = null;
  const defaultLocation = getAccessibleLocations()[0] || "";
  if (defaultLocation && !canManageLocation(els.locationFilter.value)) els.locationFilter.value = defaultLocation;
  document.body.classList.add("is-admin");
  render();
  toast(scope.type === "global" ? "학교 관리자 모드를 켰어요" : `${scope.locations.join(", ")} 담당자 모드를 켰어요`, "success");
  if (syncConfig.schoolCode) window.account?.heartbeat?.(syncConfig.schoolCode);
}

function renderAdminVisibility() {
  const isFirebase = !!(syncConfig.schoolCode);
  const selectedTeacher = els.teacherSelect?.value || "";
  const hasTeacherSelected = selectedTeacher && selectedTeacher !== GLOBAL_ADMIN_VALUE;

  const adminButton = document.querySelector("#adminModeBtn");
  const roomAdminBtn = document.querySelector("#roomAdminBtn");

  if (adminMode) {
    // 관리자 모드 켜짐 — 종료 버튼 표시 (항상)
    adminButton.classList.add("admin-mode-on");
    adminButton.setAttribute("aria-pressed", "true");
    adminButton.innerHTML = `<span class="admin-dot" aria-hidden="true"></span><span>${escapeHtml(getAdminModeLabel())}</span><strong>종료</strong>`;
    adminButton.hidden = false;
    if (roomAdminBtn) roomAdminBtn.hidden = true;
  } else if (isFirebase) {
    // Firebase 연결 학교: 학교 관리자는 계정 로그인 → 일반 "관리자 모드" 버튼 숨김
    // 교사 이름 선택 시 "실별 관리자 로그인" 버튼만 표시
    adminButton.classList.remove("admin-mode-on");
    adminButton.setAttribute("aria-pressed", "false");
    adminButton.hidden = true;
    if (roomAdminBtn) {
      roomAdminBtn.hidden = !hasTeacherSelected;
    }
  } else {
    // 독립 모드(비Firebase): 기존 "관리자 모드" 버튼 표시
    adminButton.classList.remove("admin-mode-on");
    adminButton.setAttribute("aria-pressed", "false");
    adminButton.innerHTML = `<span class="key-dot" aria-hidden="true"></span>관리자 모드`;
    adminButton.hidden = false;
    if (roomAdminBtn) roomAdminBtn.hidden = true;
  }

  document.querySelectorAll(".admin-only").forEach((element) => {
    element.hidden = !displayAsAdmin();
  });
  document.querySelectorAll(".global-admin-only").forEach((element) => {
    element.hidden = !isGlobalAdmin();
  });
  // 총괄 대시보드는 서비스 운영자 전용 — 어떤 관리자 모드에서도 학교 사용자에게는 숨김
  // 처음 설정 가이드: 스프레드시트 연결 완료 후에는 불필요 → 숨김
  const setupGuideLink = document.querySelector("#setupGuideLink");
  if (setupGuideLink) setupGuideLink.hidden = !isGlobalAdmin() || canUseRemoteSync();
  const newReservationBtn = document.querySelector("#newReservationBtn");
  if (newReservationBtn) newReservationBtn.disabled = shouldBlockUnconnectedTeacher();

  const mobAdminBtn = document.querySelector('.mob-more-item[data-mob-action="adminMode"]');
  if (mobAdminBtn) mobAdminBtn.textContent = adminMode ? "관리자 모드 종료" : "관리자 모드";
}

async function requestAdminScope() {
  const selected = els.teacherSelect.value;
  if (!selected) {
    alert("먼저 이름 선택에서 본인 이름을 선택하세요.");
    return null;
  }

  // Firebase 연결 학교: 학교 관리자(전체) 로그인은 계정 버튼으로만 가능
  if (syncConfig.schoolCode && selected === GLOBAL_ADMIN_VALUE) {
    alert("학교 관리자 로그인은 '학교 계정' 버튼을 이용하세요.");
    return null;
  }

  const rawPin = prompt(selected === GLOBAL_ADMIN_VALUE ? "학교 관리자 PIN을 입력하세요." : "담당자 PIN을 입력하세요.");
  if (rawPin === null) return null;
  const pin = String(rawPin).trim();

  if (selected === GLOBAL_ADMIN_VALUE) {
    const storedPin = String(getAdminPin() || "");
    if (pin === storedPin) return { type: "global", locations: [...state.locations] };
    const localFileRecoveryScope = requestLocalFileAdminRecovery(pin);
    if (localFileRecoveryScope) return localFileRecoveryScope;
    if (canUseRemoteSync()) {
      toast("PIN을 확인하는 중입니다…");
    }
    const remoteScope = await requestGlobalAdminScopeFromRemote(pin);
    if (remoteScope) return remoteScope;
    const diag = `입력 ${pin.length}자, 저장 ${storedPin.length}자`;
    alert(`PIN이 일치하지 않습니다. (${diag})\n\n자판이 한글/대문자로 바뀌어 있지 않은지 확인해 주세요.\nPIN을 잊으셨다면 연동된 Google Spreadsheet의 setting 탭에서 확인할 수 있습니다.`);
    return null;
  }

  const locations = Object.entries(state.locationManagers || {})
    .filter(([, manager]) => manager?.teacher === selected && manager?.pin && manager.pin === pin)
    .map(([location]) => location)
    .filter((location) => state.locations.includes(location));
  if (locations.length) return { type: "location", teacher: selected, locations };
  // 실별 담당자(비전체관리자)는 로컬 PIN만으로 즉시 판정 — 느린 원격 조회 없이 바로 오류 안내
  alert("PIN이 일치하지 않거나 이 교사에게 배정된 물품실이 없습니다.\n\nPIN을 잊으셨다면 전체 관리자에게 PIN 초기화를 요청하세요.");
  return null;
}

function requestLocalFileAdminRecovery(pin) {
  if (!canUseInitialAdminRecovery()) return null;
  if (!pin || pin.length < 4) return null;
  const shouldRecover = confirm(
    "학교 전용 링크를 만들기 전 초기 설정 상태입니다.\n\n"
    + "지금 입력한 PIN을 이 브라우저의 전체 관리자 PIN으로 설정하고 관리자 모드로 들어갈까요?",
  );
  if (!shouldRecover) return null;
  setAdminPin(pin);
  saveState();
  return { type: "global", locations: [...state.locations] };
}

function canUseInitialAdminRecovery() {
  if (window.location.protocol === "file:") return true;
  return !canUseRemoteSync() && !state.schoolName?.trim();
}

async function requestGlobalAdminScopeFromRemote(pin) {
  if (!canUseRemoteSync()) return null;
  try {
    const result = await requestSpreadsheet("load", {});
    const remoteState = result.data ? migrateState(result.data) : null;
    if (!remoteState || remoteState.adminPin !== pin) return null;
    state = remoteState;
    saveState({ touch: false });
    syncConfig.lastSyncedAt = new Date().toISOString();
    syncConfig.lastCheckedAt = syncConfig.lastSyncedAt;
    syncConfig.lastRemoteSavedAt = result.remoteSavedAt || remoteState.meta?.updatedAt || syncConfig.lastRemoteSavedAt || "";
    saveSyncConfig();
    toast("스프레드시트의 관리자 정보를 불러왔습니다.", "success");
    return { type: "global", locations: [...state.locations] };
  } catch (error) {
    console.error("관리자 PIN 원격 확인 실패:", error);
    toast(`원격 PIN 확인 중 오류: ${error.message || "네트워크"}`, "error");
    return null;
  }
}

function getAdminModeLabel() {
  if (!adminMode) return "관리자 모드";
  if (isGlobalAdmin()) return "학교 관리자 모드 켜짐";
  return `${adminScope.locations.join(", ")} 담당자 모드 켜짐`;
}

function isValidTeacherSelection(value = els.teacherSelect.value) {
  return Boolean(value && value !== GLOBAL_ADMIN_VALUE);
}

function renderTeacherSelect() {
  const current = els.teacherSelect.value;
  const selectedTeacherKey = scopedStorageKey(SELECTED_TEACHER_KEY);
  const saved = InventoryStorage.readText(selectedTeacherKey) || "";
  const validValues = [...state.teachers, GLOBAL_ADMIN_VALUE];
  const nextValue = validValues.includes(current)
    ? current
    : validValues.includes(saved)
      ? saved
      : "";
  // Firebase 계정 연결 학교는 관리자 로그인이 계정으로 이루어지므로 드롭다운에 노출 불필요
  const showAdminOption = !syncConfig.schoolCode;
  els.teacherSelect.innerHTML = [
    `<option value="">이름 선택</option>`,
    ...(showAdminOption ? [`<option value="${GLOBAL_ADMIN_VALUE}">학교 관리자</option>`] : []),
    ...state.teachers.map((teacher) => `<option value="${escapeHtml(teacher)}">${escapeHtml(teacher)}</option>`),
  ]
    .join("");
  els.teacherSelect.value = nextValue;
  if (!nextValue && saved) InventoryStorage.remove(selectedTeacherKey);
}

function saveSelectedTeacher(teacher) {
  const selectedTeacherKey = scopedStorageKey(SELECTED_TEACHER_KEY);
  if (teacher) {
    InventoryStorage.writeText(selectedTeacherKey, teacher);
  } else {
    InventoryStorage.remove(selectedTeacherKey);
  }
}

function renderLocationFilter() {
  const current = els.locationFilter.value;
  const isRoomAdmin = adminMode && !isGlobalAdmin();
  // 실별 관리자도 다른 물품실을 둘러보고 빌릴 수 있도록 전체 물품실 목록을 제공한다.
  const locations = isRoomAdmin ? [...state.locations] : getAccessibleLocations();
  els.locationFilter.innerHTML = [
    ...(isRoomAdmin ? [] : [`<option value="">전체</option>`]),
    ...locations.map((location) => `<option value="${escapeHtml(location)}">${escapeHtml(location)}</option>`),
  ].join("");
  if (isRoomAdmin) {
    // 기존 선택 유지, 없으면 본인이 담당하는 물품실을 기본값으로
    const fallback = getAccessibleLocations()[0] || locations[0] || "";
    els.locationFilter.value = current && locations.includes(current) ? current : fallback;
    els.locationFilter.disabled = false;
  } else {
    // 현재 선택값이 더 이상 없는 물품실(삭제됨)이면 '전체'(빈 값)로 보정한다.
    // (그대로 두면 select 에 일치하는 옵션이 없어 빈 칸으로 보인다.)
    els.locationFilter.value = current && locations.includes(current) ? current : "";
    els.locationFilter.disabled = false;
  }
  syncMobileLocationFilter();
}

function renderStatusGrid() {
  if (window._superAdminMode) return;
  const location = els.locationFilter.value;
  // 대시보드(물품 사용 예약)는 빌리는 화면이므로 관리자도 교사용 카드/범위로 본다.
  // 실별 관리자가 비담당 물품실을 보는 경우에도 교사용으로 표시한다.
  const inBorrowView = currentView === "dashboard";
  const showAdminCards = displayAsAdmin() && !inBorrowView;
  const itemsInLocation = new Set(
    state.items.filter((item) => (inBorrowView || isItemInAdminScope(item)) && (!location || item.location === location)).map((item) => item.id)
  );
  const reservationsInLocation = state.reservations.filter((res) => itemsInLocation.has(res.itemId));
  const availableItems = [...itemsInLocation].filter((id) => getAvailableCount(id) > 0).length;

  let cells;
  if (showAdminCards) {
    const todayReservations = reservationsInLocation.filter((res) => res.startDate <= today() && res.endDate >= today());
    const waitingCheckout = reservationsInLocation.filter((res) => res.status === "예약됨").length;
    const waitingReturn = reservationsInLocation.filter((res) => res.status === "분출됨").length;
    const damageCount = state.logs.filter((log) => log.type === "손망 처리" && (!location || itemsInLocation.has(log.itemId))).length;
    const openPurchaseRequests = (state.purchaseRequests || [])
      .filter((request) => !["구입 완료", "보류"].includes(request.status) && canManagePurchaseRequest(request) && (!location || request.location === location)).length;

    cells = [
      ["오늘 예약", todayReservations.length, "reservation", "오늘 사용 예정", "reservations"],
      ["분출 대기", waitingCheckout, "checkout", "내보낼 차례", "reservations"],
      ["회수 대기", waitingReturn, "return", "돌아올 차례", "reservations"],
      ["손망 기록", damageCount, "damage", "수리·분실·폐기", "records-damage"],
      ["구입 요청", openPurchaseRequests, "purchase", "검토 필요", "purchaseRequests"],
      ["대여 가능", availableItems, "available", "품목 종류", "dashboard"],
    ];
  } else {
    const teacher = els.teacherSelect.value;
    const myReservations = teacher
      ? reservationsInLocation.filter((res) => res.teacher === teacher)
      : [];
    const myPending = myReservations.filter((res) => res.status === "예약됨").length;
    const myCheckedOut = myReservations.filter((res) => res.status === "분출됨").length;

    const dueSoonDate = new Date();
    dueSoonDate.setDate(dueSoonDate.getDate() + 3);
    const dueSoonStr = formatDateInTimeZone(dueSoonDate);
    const myDueSoon = myReservations.filter(
      (res) => res.status === "분출됨" && res.endDate && res.endDate <= dueSoonStr,
    ).length;

    cells = [
      ["대여 가능", availableItems, "available", "지금 빌릴 수 있어요", "dashboard"],
      ["내 예약", myPending, "reservation", "분출 전인 내 예약", "reservations"],
      ["내가 빌린 것", myCheckedOut, "checkout", "현재 사용 중", "reservations"],
      ["곧 반납", myDueSoon, "return", "3일 안에 반납 예정", "reservations"],
    ];
  }

  const STAT_ICONS = {
    available:   `<svg viewBox="0 0 24 24"><path d="M3 7l9-4 9 4-9 4-9-4Z"/><path d="M3 7v10l9 4 9-4V7"/></svg>`,
    reservation: `<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>`,
    checkout:    `<svg viewBox="0 0 24 24"><path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>`,
    return:      `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
    damage:      `<svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>`,
    purchase:    `<svg viewBox="0 0 24 24"><path d="M3 4h2l2.5 12h11L21 8H6"/><circle cx="9" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/></svg>`,
  };
  const STAT_ICO_CLASS = {
    available: "c-sage", reservation: "c-sky", checkout: "c-amber",
    return: "c-rose", damage: "c-rose", purchase: "c-amber",
  };

  els.statusGrid.innerHTML = cells
    .map(
      ([label, value, tone, sub, action]) => `
        <button class="status-cell ${getStatusCardAction(action) ? "is-clickable" : ""}" data-tone="${tone}" data-status-action="${action}" type="button">
          <span class="stat-ico ${STAT_ICO_CLASS[tone] || "c-slate"}">${STAT_ICONS[tone] || ""}</span>
          <div class="stat-body">
            <b class="stat-label">${escapeHtml(label)}</b>
            <div class="stat-num">${value}</div>
            <div class="stat-sub">${escapeHtml(sub)}</div>
          </div>
        </button>
      `,
    )
    .join("");

  els.statusGrid.querySelectorAll("[data-status-action]").forEach((button) => {
    const action = getStatusCardAction(button.dataset.statusAction);
    if (!action) {
      button.disabled = true;
      return;
    }
    button.addEventListener("click", () => {
      handleStatusCardAction(action);
    });
  });
}

function getStatusCardAction(action) {
  if (action === "dashboard") return action;
  if (action === "reservations") return action;
  if (action === "records-damage" && adminMode) return action;
  if (action === "purchaseRequests" && adminMode) return action;
  return null;
}

function switchView(nextView, { pushHistory = true } = {}) {
  if (nextView && nextView !== currentView && els.searchInput) els.searchInput.value = "";
  currentView = nextView || currentView;
  if (pushHistory && nextView) {
    const url = new URL(location.href);
    if (nextView === "dashboard") {
      url.searchParams.delete("view");
    } else {
      url.searchParams.set("view", nextView);
    }
    history.pushState({ view: nextView }, "", url);
  }
}

function handleStatusCardAction(action) {
  selectedItemId = null;
  selectedReservationId = null;

  if (action === "dashboard") {
    switchView("dashboard");
  } else if (action === "reservations") {
    switchView("reservations");
  } else if (action === "records-damage") {
    switchView("records");
    recordsViewState = { date: "", type: "damage" };
  } else if (action === "purchaseRequests") {
    switchView("purchaseRequests");
  }

  if (action !== "records-damage" && currentView !== "records") {
    recordsViewState = { date: "", type: "all" };
  }

  render();
}

function renderNavigation() {
  const asAdmin = displayAsAdmin();
  if (!asAdmin && ["records", "import", "items"].includes(currentView)) currentView = "dashboard";
  if (els.sideMenuLabel) els.sideMenuLabel.textContent = asAdmin ? "관리자용 메뉴" : "교사용 메뉴";
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === currentView);
  });
  const newReservationBtn = document.querySelector("#newReservationBtn");
  const newItemBtn = document.querySelector("#newItemBtn");
  if (newReservationBtn) newReservationBtn.hidden = currentView !== "dashboard";
  if (newItemBtn) newItemBtn.hidden = true; // 표 헤더 안으로 이동했으므로 툴바에서는 항상 숨김

  // 일괄 등록·사용 기록 화면에서는 상단 검색 툴바가 필요 없으므로 숨김
  const toolbar = document.querySelector(".toolbar");
  if (toolbar) toolbar.hidden = ["import", "records"].includes(currentView);

  // 검색 placeholder 뷰별 변경
  if (els.searchInput) {
    const placeholders = {
      dashboard:        "예약할 물품명을 검색하세요",
      items:            "물품명 · 카테고리 · 관리번호 검색",
      reservations:     displayAsAdmin() ? "예약자 · 물품명 검색" : "물품명 검색",
      purchaseRequests: "요청 물품명 검색",
      records:          "기록 검색",
      import:           "물품명 검색",
    };
    els.searchInput.placeholder = placeholders[currentView] || "검색";
  }

  // 카테고리 필터: 물품 관리 탭 + 예약(대시보드) 탭에서 표시
  if (els.categoryFilter) {
    const showCatFilter = currentView === "items" || currentView === "dashboard";
    els.categoryFilter.hidden = !showCatFilter;
    // 툴바 물품실 선택도 같은 화면에서 함께 표시(상단 선택과 연동)
    if (els.toolbarLocationFilter) {
      els.toolbarLocationFilter.hidden = !showCatFilter;
      syncLocationMirror(els.toolbarLocationFilter);
    }
    if (showCatFilter) {
      const location = els.locationFilter?.value || "";
      const inBorrowView = currentView === "dashboard";
      const cats = [...new Set(
        state.items
          .filter((i) => (inBorrowView || isItemInAdminScope(i)) && (!location || i.location === location))
          .map((i) => i.category)
          .filter(Boolean)
      )].sort((a, b) => a.localeCompare(b, "ko"));
      const prev = els.categoryFilter.value;
      els.categoryFilter.innerHTML = `<option value="">카테고리 전체</option>` +
        cats.map((c) => `<option value="${escapeHtml(c)}" ${c === prev ? "selected" : ""}>${escapeHtml(c)}</option>`).join("");
      if (cats.includes(prev)) els.categoryFilter.value = prev;
    } else {
      els.categoryFilter.value = "";
    }
  }

  syncMobileTabActive();
}

function renderMainView() {
  if (window._superAdminMode) return; // 총괄관리자 대시보드 — mainView 유지
  if (shouldBlockUnconnectedTeacher()) renderConnectionRequiredView();
  else if (currentView === "dashboard") renderDashboard();
  else if (currentView === "items") renderItemsTable();
  else if (currentView === "purchaseRequests") renderPurchaseRequestsView();
  else if (currentView === "reservations") renderReservationsTable(getReservationRowsForCurrentMode());
  else if (currentView === "import") renderImportView();
  else if (currentView === "records") renderRecordsView();
  attachTableScrollAffordance();
}

function shouldBlockUnconnectedTeacher() {
  if (firebaseAuthPending) return false;
  return !adminMode && !canUseRemoteSync();
}

function renderConnectionRequiredView() {
  els.mainView.className = "main-view is-conn-required";
  els.mainView.innerHTML = `
    <div class="conn-req">
      <div class="conn-req-head">
        <div class="conn-req-head-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>
        </div>
        <h3>학교 데이터에 아직 연결되지 않았어요</h3>
        <p>아래 안내에 따라 학교 계정에 연결하면 물품 예약을 시작할 수 있어요.</p>
      </div>
      <div class="conn-req-cards">
        <div class="conn-req-card">
          <div class="conn-req-icon" aria-hidden="true">📋</div>
          <strong>학교 담당자라면</strong>
          <p>학교 계정으로 로그인하거나 가입 신청하세요. 승인 후 교사용 접속 링크를 발급받을 수 있습니다.</p>
          <button class="primary" id="connReqAccountBtn" type="button">학교 계정 로그인 · 가입</button>
        </div>
        <div class="conn-req-card">
          <div class="conn-req-icon" aria-hidden="true">👩‍🏫</div>
          <strong>교사라면</strong>
          <p>담당자가 공유한 짧은 주소나 QR코드로 접속하세요. 링크를 열면 학교 데이터가 자동으로 연결됩니다.</p>
        </div>
      </div>
    </div>
  `;
  document.querySelector("#connReqAccountBtn")?.addEventListener("click", () => window.account?.openLogin?.());
}

function getReservationRowsForCurrentMode() {
  // 관리자처럼 표시될 때만 전체 예약을, 그 외(교사·비담당 물품실)에는 내 예약만 보여준다.
  if (displayAsAdmin()) return state.reservations.filter((reservation) => isReservationInAdminScope(reservation));
  const teacher = els.teacherSelect.value;
  return state.reservations.filter((reservation) => reservation.teacher === teacher);
}

function renderDashboard() {
  renderBorrowStartView();
}


function renderBorrowStartView() {
  const rows = getFilteredItems();
  if (!rows.length) {
    const keyword = els.searchInput.value.trim();
    els.mainView.innerHTML = `
      <div class="empty-state">
        <h4>예약할 수 있는 물품이 없습니다</h4>
        <p>물품실 선택이나 검색어를 확인해 주세요.</p>
        ${!adminMode ? `<button class="primary" id="openPurchaseRequestBtn" type="button">구입 요청하기</button>` : ""}
      </div>
    `;
    document.querySelector("#openPurchaseRequestBtn")?.addEventListener("click", () => openPurchaseRequestModal({ itemName: keyword }));
    return;
  }

  els.mainView.classList.add("is-card-list");
  els.mainView.innerHTML = `
    <div class="borrow-list-head">
      <h3>사용 예약할 물품 선택</h3>
      <span class="borrow-list-meta">같은 물품도 <b>규격</b>을 보고 고르세요 · 사용 가능한 수량 확인</span>
    </div>
    <div class="borrow-cards">
      ${rows
        .map((item) => {
          const avail = getAvailableCount(item.id);
          const unavail = avail <= 0 || ["파손","분실","폐기","비활성"].includes(item.status);
          const codeMeta = renderItemCode(item);
          return `
            <div class="borrow-card${selectedItemId === item.id ? " is-selected" : ""}${unavail ? " is-unavail" : ""}" data-borrow-item-id="${item.id}">
              <div class="bc-name">
                <span class="card-name">${escapeHtml(item.name)}</span>
                ${codeMeta ? `<div class="card-meta">${codeMeta}</div>` : ""}
              </div>
              <div class="bc-spec">${item.spec ? `<span class="card-spec"><b>규격</b> ${escapeHtml(item.spec)}</span>` : ""}</div>
              <div class="bc-cat">${item.category ? `<span class="card-cat">${escapeHtml(item.category)}</span>` : ""}</div>
              <div class="bc-loc"><span class="card-loc">${escapeHtml(item.location)}</span></div>
              <div class="bc-actions">
                <div class="card-avail"><span class="avail-n">${avail}</span><span class="avail-u"> / ${item.total} ${escapeHtml(item.unit || "개")}</span></div>
                ${statusBadge(item.status)}
                <button class="row-action" data-reserve-item-id="${item.id}" type="button"${unavail ? " disabled" : ""}>예약하기</button>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;

  els.mainView.querySelectorAll("[data-borrow-item-id]").forEach((row) => {
    row.addEventListener("click", () => {
      selectedItemId = row.dataset.borrowItemId;
      selectedReservationId = null;
      renderBorrowStartView();
      renderWorkPanel();
      scrollWorkPanelIntoView();
    });
  });
  els.mainView.querySelectorAll("[data-reserve-item-id]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      selectedItemId = button.dataset.reserveItemId;
      selectedReservationId = null;
      renderWorkPanel();
      openReservationModal(button.dataset.reserveItemId);
    });
  });
}

function renderItemsTable() {
  const rows = getFilteredItems();
  if (!rows.length) {
    els.mainView.innerHTML = `
      <div class="view-head items-view-head">
        <h3>물품 목록</h3>
        <span class="view-meta">0건</span>
        ${adminMode ? `<div class="items-head-actions"><button class="ghost compact" id="newItemBtnInTable" type="button">+ 물품 추가</button></div>` : ""}
      </div>
      <div class="empty-state">
        <div class="empty-state-illust">📦</div>
        <h4>조건에 맞는 물품이 없어요</h4>
        <p>검색어나 구역 필터를 바꿔보세요.</p>
      </div>`;
    els.mainView.querySelector("#newItemBtnInTable")?.addEventListener("click", () => openItemModal());
    return;
  }

  // 정렬 적용
  const { key: sortKey, dir: sortDir } = itemsSortState;
  const sortedRows = sortKey ? [...rows].sort((a, b) => {
    const va = sortKey === "name" ? (a.name || "") : sortKey === "category" ? (a.category || "") : (a.status || "");
    const vb = sortKey === "name" ? (b.name || "") : sortKey === "category" ? (b.category || "") : (b.status || "");
    const cmp = va.localeCompare(vb, "ko");
    return sortDir === "asc" ? cmp : -cmp;
  }) : rows;

  function sortIcon(key) {
    if (sortKey !== key) return `<span class="th-sort-icon" aria-hidden="true">↕</span>`;
    return `<span class="th-sort-icon active" aria-hidden="true">${sortDir === "asc" ? "↑" : "↓"}</span>`;
  }

  els.mainView.innerHTML = `
    <div class="view-head items-view-head">
      <h3>물품 목록</h3>
      <span class="view-meta">총 ${rows.length}건</span>
      ${adminMode ? `
        <div class="items-head-actions">
          <button class="ghost compact" id="newItemBtnInTable" type="button">+ 물품 추가</button>
          <button class="ghost compact danger" id="bulkDeleteItemsBtn" type="button" disabled>선택 삭제</button>
        </div>` : ""}
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            ${adminMode ? `<th><input type="checkbox" id="itemSelectAll" aria-label="전체 선택" /></th>` : ""}
            <th>보관 장소</th>
            <th class="th-sortable" data-sort="name">물품명 ${sortIcon("name")}</th>
            <th>규격</th>
            <th class="th-sortable" data-sort="category">카테고리 ${sortIcon("category")}</th>
            <th>사용 가능</th>
            <th>예약/분출</th>
            <th class="th-sortable" data-sort="status">상태 ${sortIcon("status")}</th>
            <th>비고</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${sortedRows
            .map(
              (item) => `
              <tr class="${selectedItemId === item.id ? "is-selected" : ""}" data-item-row-id="${item.id}">
                ${adminMode ? `<td><input type="checkbox" class="item-select-chk" data-item-id="${item.id}" aria-label="${escapeHtml(item.name)} 선택" /></td>` : ""}
                <td>${escapeHtml(item.location)}</td>
                <td>
                  <strong>${escapeHtml(item.name)}</strong>${renderItemCode(item) ? `<br /><span class="helper">${renderItemCode(item)}</span>` : ""}
                </td>
                <td>${escapeHtml(item.spec || "-")}</td>
                <td>${escapeHtml(item.category || "-")}</td>
                <td>
                  ${getAvailableCount(item.id)} / ${item.total} ${escapeHtml(item.unit || "개")}
                  ${renderUnavailableReason(item)}
                </td>
                <td>${getReservedCount(item.id)} 예약 · ${getCheckedOutCount(item.id)} 분출</td>
                <td>${statusBadge(item.status)}</td>
                <td>${escapeHtml(item.note || "-")}</td>
                <td><button class="row-action" data-item-id="${item.id}" type="button">선택</button></td>
              </tr>
            `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;

  // 체크박스 상태에 따라 선택 삭제 버튼 활성화
  const bulkDeleteBtn = els.mainView.querySelector("#bulkDeleteItemsBtn");
  function updateBulkDeleteBtn() {
    if (!bulkDeleteBtn) return;
    const checked = els.mainView.querySelectorAll(".item-select-chk:checked").length;
    bulkDeleteBtn.disabled = checked === 0;
    bulkDeleteBtn.textContent = checked > 0 ? `선택 삭제 (${checked}건)` : "선택 삭제";
  }

  // 전체 선택 체크박스
  els.mainView.querySelector("#itemSelectAll")?.addEventListener("change", (e) => {
    els.mainView.querySelectorAll(".item-select-chk").forEach((chk) => { chk.checked = e.target.checked; });
    updateBulkDeleteBtn();
  });

  // 개별 체크박스
  els.mainView.querySelectorAll(".item-select-chk").forEach((chk) => {
    chk.addEventListener("change", updateBulkDeleteBtn);
    // 체크박스 클릭이 행 클릭으로 전파되지 않도록
    chk.addEventListener("click", (e) => e.stopPropagation());
  });

  // 물품 추가 버튼 (표 헤더 내 버튼)
  els.mainView.querySelector("#newItemBtnInTable")?.addEventListener("click", () => openItemModal());

  // 정렬 헤더 클릭
  els.mainView.querySelectorAll(".th-sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (itemsSortState.key === key) {
        itemsSortState.dir = itemsSortState.dir === "asc" ? "desc" : "asc";
      } else {
        itemsSortState = { key, dir: "asc" };
      }
      renderItemsTable();
    });
  });

  // 선택 삭제 버튼
  bulkDeleteBtn?.addEventListener("click", () => {
    const ids = [...els.mainView.querySelectorAll(".item-select-chk:checked")].map((c) => c.dataset.itemId);
    if (!ids.length) return;
    const names = ids.map((id) => state.items.find((i) => i.id === id)?.name).filter(Boolean);
    const hasReservation = ids.some((id) => state.reservations.some((r) => r.itemId === id));
    const msg = [
      `선택한 물품 ${ids.length}건을 삭제할까요?`,
      names.slice(0, 5).map((n) => `  · ${n}`).join("\n"),
      names.length > 5 ? `  · 외 ${names.length - 5}건` : "",
      "",
      hasReservation ? "⚠️ 예약·반납 기록이 있는 물품도 포함되어 있습니다. 함께 삭제됩니다." : "",
      "삭제한 물품은 되돌릴 수 없습니다.",
    ].filter((l) => l !== "").join("\n");
    if (!confirm(msg)) return;
    const idSet = new Set(ids);
    ids.forEach((id) => recordDeletion("items", id));
    state.items = state.items.filter((i) => !idSet.has(i.id));
    state.reservations = state.reservations.filter((r) => !idSet.has(r.itemId));
    addLog("물품 삭제", `물품 ${ids.length}건을 일괄 삭제했습니다: ${names.slice(0, 5).join(", ")}${names.length > 5 ? " 외" : ""}`, "관리자");
    saveState();
    selectedItemId = null;
    render();
    toast(`물품 ${ids.length}건을 삭제했습니다.`, "warn");
  });

  els.mainView.querySelectorAll("[data-item-row-id]").forEach((row) => {
    row.addEventListener("click", () => {
      selectedItemId = row.dataset.itemRowId;
      selectedReservationId = null;
      renderItemsTable();
      renderWorkPanel();
      scrollWorkPanelIntoView();
    });
  });
  // .row-action 으로 한정 — 체크박스(.item-select-chk)도 data-item-id 를 갖고 있어
  // 그냥 [data-item-id] 로 잡으면 체크박스 클릭이 표 재렌더를 일으켜 개별 체크가 풀린다.
  els.mainView.querySelectorAll(".row-action[data-item-id]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      selectedItemId = button.dataset.itemId;
      selectedReservationId = null;
      renderItemsTable();
      renderWorkPanel();
      scrollWorkPanelIntoView();
    });
  });
}

const RESERVATION_TABS = [
  ["all", "전체"],
  ["reserved", "예약 목록"],
  ["checkout", "분출 목록"],
];

// 탭별 표시 대상 추리기. '전체'는 예약됨 → 분출됨 → 기타 순으로 정렬한다.
function filterReservationsByTab(rows, tab) {
  if (tab === "reserved") return rows.filter((res) => getReservationDisplayStatus(res) === "예약됨");
  if (tab === "checkout") return rows.filter((res) => getReservationDisplayStatus(res) === "분출됨");
  const rank = (res) => {
    const status = getReservationDisplayStatus(res);
    if (status === "예약됨") return 0;
    if (status === "분출됨") return 1;
    return 2;
  };
  return [...rows].sort((a, b) => rank(a) - rank(b));
}

function renderReservationTabs(filteredRows) {
  const reservedCount = filteredRows.filter((res) => getReservationDisplayStatus(res) === "예약됨").length;
  const checkoutCount = filteredRows.filter((res) => getReservationDisplayStatus(res) === "분출됨").length;
  const countFor = (key) => key === "reserved" ? reservedCount : key === "checkout" ? checkoutCount : filteredRows.length;
  return `
    <div class="reservation-tabs" role="tablist">
      ${RESERVATION_TABS.map(([key, label]) => `
        <button class="reservation-tab ${reservationListTab === key ? "is-active" : ""}" data-reservation-tab="${key}" type="button" role="tab" aria-selected="${reservationListTab === key}">
          ${label}<span class="reservation-tab-count">${countFor(key)}</span>
        </button>
      `).join("")}
    </div>`;
}

function bindReservationTabs() {
  els.mainView.querySelectorAll("[data-reservation-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.reservationTab;
      if (reservationListTab === tab) return;
      reservationListTab = tab;
      renderMainView();
    });
  });
}

function renderReservationsTable(rows, title = "예약 목록") {
  const filteredRows = getFilteredReservations(rows);
  const visibleRows = filterReservationsByTab(filteredRows, reservationListTab);
  const headHtml = `
    <div class="view-head">
      <h3>${escapeHtml(title)}</h3>
      <span class="view-meta">총 ${visibleRows.length}건</span>
    </div>
    ${renderReservationTabs(filteredRows)}`;

  if (!visibleRows.length) {
    els.mainView.innerHTML = headHtml + `
      <div class="empty-state">
        <div class="empty-state-illust">🌿</div>
        <h4>해당하는 예약이 없어요</h4>
        <p>다른 탭을 확인하거나 검색어를 지워보세요.</p>
      </div>`;
    bindReservationTabs();
    return;
  }

  els.mainView.innerHTML = headHtml + `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>물품실</th>
            <th>물품</th>
            <th>규격</th>
            <th>교사</th>
            <th>수량</th>
            <th>사용일</th>
            <th>상태</th>
            <th>비고</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${visibleRows
            .map((res) => {
              const item = getItem(res.itemId);
              return `
                <tr>
                  <td class="cell-nowrap">${escapeHtml(item?.location || "-")}</td>
                  <td class="cell-item">
                    <strong>${escapeHtml(item?.name || "삭제된 물품")}</strong>
                  </td>
                  <td class="cell-nowrap">${escapeHtml(item?.spec || "-")}</td>
                  <td class="cell-nowrap">${escapeHtml(res.teacher)}</td>
                  <td class="cell-nowrap">${res.quantity} ${escapeHtml(item?.unit || "개")}</td>
                  <td class="cell-nowrap">${escapeHtml(toDisplayDate(res.startDate))} ~ ${escapeHtml(toDisplayDate(res.endDate))}</td>
                  <td class="cell-nowrap">${statusBadge(getReservationDisplayStatus(res))}${res.selfCheckout ? ` <span class="badge gray">직접</span>` : ""}</td>
                  <td>${escapeHtml(res.note || "")}</td>
                  <td><button class="row-action" data-reservation-id="${res.id}" type="button">${escapeHtml(getReservationActionLabel(res))}</button></td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;

  bindReservationTabs();

  els.mainView.querySelectorAll("[data-reservation-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedReservationId = button.dataset.reservationId;
      selectedItemId = null;
      renderWorkPanel();
      scrollWorkPanelIntoView();
    });
  });
}

// 신규/추가 구입 구분 배지
function purchaseTypeBadge(type) {
  const isAdd = type === "추가 구입";
  const label = isAdd ? "추가" : "신규";
  return `<span class="purchase-type-badge ${isAdd ? "is-add" : "is-new"}">${label}</span> `;
}

// 참고 사이트 링크 (있을 때만)
function purchaseRefLink(url) {
  if (!url) return "";
  const safe = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  return `<br /><a class="purchase-ref-link" href="${escapeHtml(safe)}" target="_blank" rel="noopener">🔗 참고 사이트</a>`;
}

// 교사용 구입 요청 화면 — 내가 보낸 요청 목록 + 새 요청 + 대기중 요청 취소
function renderTeacherPurchaseRequestsView() {
  const teacher = els.teacherSelect.value;
  const headHtml = `
    <div class="view-head">
      <h3>구입 요청</h3>
      <span class="view-meta">목록에 없는 물품을 관리자에게 요청할 수 있어요</span>
      <button class="primary" id="newPurchaseRequestBtn" type="button" style="margin-left:auto;">+ 새 구입 요청</button>
    </div>`;

  if (!isValidTeacherSelection()) {
    els.mainView.innerHTML = headHtml + `
      <div class="empty-state">
        <h4>먼저 본인 이름을 선택하세요</h4>
        <p>오른쪽 위 “사용 교사”에서 이름을 고르면 내 구입 요청을 보고, 새 요청을 보낼 수 있어요.</p>
      </div>`;
    document.querySelector("#newPurchaseRequestBtn")?.addEventListener("click", () => openPurchaseRequestModal());
    return;
  }

  const myRequests = (state.purchaseRequests || [])
    .filter((request) => request.requester === teacher)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  if (!myRequests.length) {
    els.mainView.innerHTML = headHtml + `
      <div class="empty-state">
        <div class="empty-state-illust">🛒</div>
        <h4>아직 보낸 구입 요청이 없어요</h4>
        <p>찾는 물품이 목록에 없다면 “+ 새 구입 요청”으로 관리자에게 요청해 보세요.</p>
      </div>`;
  } else {
    els.mainView.innerHTML = headHtml + `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>요청 물품</th>
              <th>희망 수량</th>
              <th>희망 물품실</th>
              <th>상태</th>
              <th>요청일</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${myRequests.map((request) => `
              <tr>
                <td>
                  ${purchaseTypeBadge(request.type)}<strong>${escapeHtml(request.itemName || "-")}</strong><br />
                  <span class="helper">${escapeHtml(request.category || "카테고리 없음")} · ${escapeHtml(request.note || "요청 이유 없음")}</span>
                  ${purchaseRefLink(request.referenceUrl)}
                </td>
                <td>${Number(request.quantity || 1)}</td>
                <td>${escapeHtml(request.location || "-")}</td>
                <td>${statusBadge(request.status || "요청됨")}</td>
                <td>${request.createdAt ? formatDateInTimeZone(new Date(request.createdAt)) : "-"}</td>
                <td>${request.status === "요청됨"
                  ? `<button class="ghost compact danger" data-cancel-purchase-id="${escapeHtml(request.id)}" type="button">요청 취소</button>`
                  : ""}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>`;
  }

  document.querySelector("#newPurchaseRequestBtn")?.addEventListener("click", () => openPurchaseRequestModal());
  els.mainView.querySelectorAll("[data-cancel-purchase-id]").forEach((button) => {
    button.addEventListener("click", () => cancelOwnPurchaseRequest(button.dataset.cancelPurchaseId));
  });
}

// 교사가 아직 검토 전(요청됨)인 자신의 요청을 직접 취소
function cancelOwnPurchaseRequest(requestId) {
  const teacher = els.teacherSelect.value;
  const request = (state.purchaseRequests || []).find((row) => row.id === requestId);
  if (!request || request.requester !== teacher || request.status !== "요청됨") return;
  if (!confirm(`“${request.itemName}” 구입 요청을 취소할까요?`)) return;
  recordDeletion("purchaseRequests", requestId);
  state.purchaseRequests = (state.purchaseRequests || []).filter((row) => row.id !== requestId);
  addLog("구입 요청 취소", `${teacher} 교사가 ${request.itemName} 구입 요청을 취소했습니다.`, teacher);
  saveState();
  render();
  toast("구입 요청을 취소했습니다.", "warn");
}

function renderPurchaseRequestsView() {
  if (!adminMode) {
    renderTeacherPurchaseRequestsView();
    return;
  }

  const rows = getFilteredPurchaseRequests();
  if (!rows.length) {
    els.mainView.innerHTML = `
      <div class="view-head">
        <h3>구입 요청</h3>
        <span class="view-meta">0건</span>
      </div>
      <div class="empty-state">
        <h4>조건에 맞는 구입 요청이 없습니다</h4>
        <p>교사가 목록에서 찾지 못한 물품을 요청하면 이곳에 모입니다.</p>
      </div>`;
    return;
  }

  els.mainView.innerHTML = `
    <div class="view-head">
      <h3>구입 요청</h3>
      <span class="view-meta">총 ${rows.length}건</span>
    </div>
    <div class="bulk-action-bar">
      <span>선택 항목</span>
      <select id="purchaseBulkStatus">
        ${getPurchaseRequestStatuses().map((status) => `<option>${status}</option>`).join("")}
      </select>
      <button class="ghost compact" id="purchaseBulkApplyBtn" type="button">일괄 처리</button>
      <button class="danger compact" id="purchaseBulkDeleteBtn" type="button">선택 삭제</button>
    </div>
    <div class="table-wrap purchase-request-wrap">
      <table class="purchase-request-table">
        <colgroup>
          <col class="purchase-col-select" />
          <col class="purchase-col-item" />
          <col class="purchase-col-requester" />
          <col class="purchase-col-quantity" />
          <col class="purchase-col-location" />
          <col class="purchase-col-status" />
          <col class="purchase-col-date" />
          <col class="purchase-col-action" />
        </colgroup>
        <thead>
          <tr>
            <th><input type="checkbox" id="purchaseSelectAll" aria-label="구입 요청 전체 선택" /></th>
            <th>요청 물품</th>
            <th>요청자</th>
            <th>희망 수량</th>
            <th>희망 물품실</th>
            <th>상태</th>
            <th>요청일</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((request) => `
            <tr>
              <td>
                <input type="checkbox" data-purchase-select-id="${escapeHtml(request.id)}" aria-label="${escapeHtml(request.itemName || "요청 물품")} 선택" />
              </td>
              <td>
                ${purchaseTypeBadge(request.type)}<strong>${escapeHtml(request.itemName || "-")}</strong><br />
                <span class="helper">${escapeHtml(request.category || "카테고리 없음")} · ${escapeHtml(request.note || "요청 이유 없음")}</span>
                ${purchaseRefLink(request.referenceUrl)}
              </td>
              <td>${escapeHtml(request.requester || "-")}</td>
              <td>${Number(request.quantity || 1)}</td>
              <td>${escapeHtml(request.location || "-")}</td>
              <td>${statusBadge(request.status || "요청됨")}</td>
              <td>${request.createdAt ? formatDateInTimeZone(new Date(request.createdAt)) : "-"}</td>
              <td><button class="row-action" data-purchase-request-id="${escapeHtml(request.id)}" type="button">검토</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  els.mainView.querySelectorAll("[data-purchase-request-id]").forEach((button) => {
    button.addEventListener("click", () => openPurchaseRequestReviewModal(button.dataset.purchaseRequestId));
  });
  document.querySelector("#purchaseSelectAll")?.addEventListener("change", (event) => {
    els.mainView.querySelectorAll("[data-purchase-select-id]").forEach((checkbox) => {
      checkbox.checked = event.target.checked;
    });
  });
  document.querySelector("#purchaseBulkApplyBtn")?.addEventListener("click", () => {
    const selectedIds = [...els.mainView.querySelectorAll("[data-purchase-select-id]:checked")].map((checkbox) => checkbox.dataset.purchaseSelectId);
    if (!selectedIds.length) {
      toast("일괄 처리할 구입 요청을 선택하세요.", "warn");
      return;
    }
    const status = document.querySelector("#purchaseBulkStatus").value;
    setPurchaseRequestStatuses(selectedIds, status);
    renderPurchaseRequestsView();
    toast(`선택한 ${selectedIds.length}건을 ${status}(으)로 변경했습니다.`, "success");
  });
  document.querySelector("#purchaseBulkDeleteBtn")?.addEventListener("click", () => {
    const selectedIds = [...els.mainView.querySelectorAll("[data-purchase-select-id]:checked")].map((checkbox) => checkbox.dataset.purchaseSelectId);
    if (!selectedIds.length) {
      toast("삭제할 구입 요청을 선택하세요.", "warn");
      return;
    }
    if (!confirm(`선택한 구입 요청 ${selectedIds.length}건을 삭제할까요?\n삭제한 요청은 되돌릴 수 없습니다.`)) return;
    deletePurchaseRequests(selectedIds);
    renderPurchaseRequestsView();
    toast(`구입 요청 ${selectedIds.length}건을 삭제했습니다.`, "warn");
  });
}

function renderImportView() {
  if (!adminMode) {
    currentView = "dashboard";
    render();
    return;
  }

  els.mainView.innerHTML = `
    <div class="view-head">
      <h3>기존 물품 일괄 등록</h3>
      <span class="view-meta">Excel 불러오기</span>
    </div>
    <div class="import-zone">
      <div class="import-box">
        <p class="helper">엑셀 파일을 그대로 올리면 등록 전에 미리보기와 오류 행을 확인할 수 있습니다. 보관 장소는 학교 설정에 등록된 물품실 이름과 정확히 같아야 합니다.</p>
        <div class="split-actions">
          <button class="ghost" id="downloadTemplateBtn" type="button">엑셀 양식 받기</button>
          <button class="ghost" id="downloadTemplateCsvBtn" type="button">CSV 양식 받기</button>
          <button class="ghost" id="exportItemsBtn" type="button">현재 물품 내보내기</button>
          <button class="ghost" id="exportLogsBtn" type="button">기록 내보내기</button>
        </div>
        <div class="import-drop" id="inventoryImportDropZone">
          <label class="field">
            <span>엑셀 또는 CSV 파일 선택</span>
            <input id="inventoryImportInput" type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" />
          </label>
          <p class="helper">또는 엑셀·CSV 파일을 이 영역에 끌어다 놓아도 됩니다.</p>
          <p class="helper">필수 컬럼 — 물품명, 보관 장소, 총 수량. 등록되지 않은 물품실은 자동 생성하지 않고 오류로 표시합니다.</p>
        </div>
      </div>
      <div class="import-preview-zone" id="importResult"></div>
    </div>
  `;

  document.querySelector("#downloadTemplateBtn").addEventListener("click", downloadTemplate);
  document.querySelector("#downloadTemplateCsvBtn").addEventListener("click", downloadTemplateCsv);
  document.querySelector("#exportItemsBtn").addEventListener("click", exportItems);
  document.querySelector("#exportLogsBtn").addEventListener("click", exportLogs);
  const importInput = document.querySelector("#inventoryImportInput");
  const importDropZone = document.querySelector("#inventoryImportDropZone");
  importInput.addEventListener("change", importInventoryFile);
  setupImportDropZone(importDropZone, importInput);
}

function renderRecordsView(filterDate = recordsViewState.date, filterType = recordsViewState.type) {
  recordsViewState = { date: filterDate, type: filterType };
  const logs = [...state.logs]
    .reverse()
    .filter((log) => isLogInAdminScope(log) && (!filterDate || log.createdAt.startsWith(filterDate)) && matchesRecordFilter(log, filterType));
  const filterLabel = getRecordFilterOptions().find((option) => option.key === filterType)?.label || "전체";

  els.mainView.innerHTML = `
    <div class="view-head">
      <h3>사용 기록</h3>
      <div class="records-filter">
        <div class="record-filter-tabs" aria-label="사용 기록 분류">
          ${getRecordFilterOptions().map((option) => `
            <button class="record-filter-tab ${filterType === option.key ? "is-active" : ""}" data-record-filter="${option.key}" type="button">
              ${escapeHtml(option.label)}
            </button>
          `).join("")}
        </div>
        <label class="field inline">
          <span>날짜</span>
          <input type="date" id="recordsDateInput" value="${escapeHtml(filterDate)}" max="${today()}" />
        </label>
        ${filterDate ? `<button class="ghost small" id="recordsClearBtn" type="button">전체 보기</button>` : ""}
        <span class="view-meta">${filterDate ? `${escapeHtml(filterDate)} · ` : ""}${escapeHtml(filterLabel)} · ${logs.length}건</span>
      </div>
    </div>
    ${logs.length
      ? `<div class="table-wrap">
           <table>
             <thead>
               <tr>
                 <th>일시</th>
                 <th>구분</th>
                 <th>내용</th>
                 <th>담당</th>
               </tr>
             </thead>
             <tbody>
               ${logs.map((log) => `
                 <tr>
                   <td style="white-space:nowrap">${formatDateTime(log.createdAt)}</td>
                   <td>${statusBadge(log.type)}</td>
                   <td>${escapeHtml(log.message)}</td>
                   <td>${escapeHtml(log.actor || "-")}</td>
                 </tr>
               `).join("")}
             </tbody>
           </table>
         </div>`
      : `<div class="empty-state">
           <div class="empty-state-illust">✍️</div>
           <h4>${filterDate ? "해당 날짜의 기록이 없어요" : "아직 기록이 없어요"}</h4>
           <p>${filterDate ? "다른 날짜를 선택하거나 전체 보기를 눌러보세요." : "예약·분출·회수 작업을 시작하면 이곳에 장부가 쌓여요."}</p>
         </div>`}
  `;

  document.querySelectorAll("[data-record-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      renderRecordsView(filterDate, button.dataset.recordFilter || "all");
    });
  });
  document.querySelector("#recordsDateInput").addEventListener("change", (e) => {
    renderRecordsView(e.target.value, filterType);
  });
  document.querySelector("#recordsClearBtn")?.addEventListener("click", () => {
    renderRecordsView("", filterType);
  });
}

function renderWorkPanel() {
  try {
    if (shouldBlockUnconnectedTeacher()) {
      els.workPanel.innerHTML = `
        <div class="panel-card">
          <p class="panel-title">연결 대기 중</p>
          <p class="helper">관리자가 보내준 학교 전용 링크로 다시 접속해주세요.</p>
        </div>
      `;
      return;
    }
    if (!displayAsAdmin()) {
      if (selectedReservationId) {
        const reservation = state.reservations.find((res) => res.id === selectedReservationId);
        if (reservation) return renderReservationPanel(reservation);
      }
      if (currentView === "reservations") return renderMyReservationPanel();
      return renderBorrowingStatusPanel();
    }

    if (selectedReservationId) {
      const reservation = state.reservations.find((res) => res.id === selectedReservationId);
      if (reservation) return renderReservationPanel(reservation);
    }

    if (selectedItemId) {
      const item = getItem(selectedItemId);
      if (item) return renderItemPanel(item);
    }

    renderAdminGuidePanel();
  } finally {
    // 드로어가 열려있으면 갱신된 내용 동기화
    if (!isMobileViewport() && els.panelDrawerBackdrop && !els.panelDrawerBackdrop.hidden) {
      openDesktopPanelDrawer();
    }
  }
}

function renderAdminGuidePanel() {
  const panelGuide = {
    dashboard: {
      title: "물품 사용 예약",
      text: "왼쪽 목록에서 물품을 선택하면 예약 현황을 확인하고 바로 예약할 수 있어요.",
      points: ["사용 가능 수량 확인", "오늘 예약과 앞으로 예약 확인", "선택한 물품 예약 생성"],
    },
    items: {
      title: "물품 관리",
      text: "물품을 선택하면 오른쪽에서 상세 정보와 관리 작업이 열립니다.",
      points: ["물품 정보 수정", "파손·분실·폐기 등록", "예약·분출 현황 확인"],
    },
    purchaseRequests: {
      title: "구입 요청",
      text: "교사들이 요청한 물품을 확인하고 구입 완료 여부를 체크합니다.",
      points: ["미구입 요청 우선 확인", "요청 이유 검토", "구입 완료 체크"],
    },
    reservations: {
      title: "예약·분출 목록",
      text: "왼쪽 목록에서 예약을 선택하면 분출·반납·손망 처리를 할 수 있어요.",
      points: ["예약 분출 처리", "반납 수량 기록", "파손·분실 사유 기록"],
    },
    records: {
      title: "사용 기록",
      text: "모든 작업 기록을 시간순으로 확인하는 관리자용 장부입니다.",
      points: ["기록 분류별 조회", "날짜별 기록 확인", "누가 어떤 작업을 했는지 확인"],
    },
    import: {
      title: "일괄 등록",
      text: "엑셀 또는 CSV 파일로 물품을 한꺼번에 등록할 수 있어요.",
      points: ["엑셀 양식 내려받기", "파일 미리보기와 오류 확인", "현재 물품·기록 백업"],
    },
  };
  const guide = panelGuide[currentView] || {
    title: "작업 패널",
    text: "왼쪽 목록에서 항목을 선택하면 이곳에서 처리할 수 있어요.",
    points: ["상세 정보 확인", "필요한 작업 실행", "처리 결과 기록"],
  };
  els.workPanel.innerHTML = `
    <div class="panel-card admin-guide-panel">
      <div class="admin-guide-head">
        <div class="panel-empty-illust" aria-hidden="true">
        <svg viewBox="0 0 80 80" width="80" height="80">
          <rect x="14" y="18" width="52" height="48" rx="8" fill="#FBF4E2" stroke="#E4D9BF" stroke-width="1.4"></rect>
          <path d="M24 32 H56 M24 42 H50 M24 52 H44" stroke="#C9B98E" stroke-width="1.6" stroke-linecap="round"></path>
          <circle cx="60" cy="20" r="6" fill="#5B8A6F"></circle>
        </svg>
        </div>
        <div>
          <p class="panel-title">${escapeHtml(guide.title)}</p>
          <p class="panel-empty-text">${escapeHtml(guide.text)}</p>
        </div>
      </div>
      <ul class="panel-guide-list">
        ${guide.points.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}
      </ul>
    </div>
  `;
}

function renderBorrowingStatusPanel() {
  const item = getItem(selectedItemId);
  if (!item) {
    els.workPanel.innerHTML = `
      <div class="panel-card item-status-panel">
        <div>
          <p class="panel-title">물품을 선택하세요</p>
          <p class="helper">왼쪽 목록에서 물품을 누르면 현재 이용 현황을 확인할 수 있습니다.</p>
        </div>
        <section class="item-status-section">
          <div class="item-status-section-head">
            <h4>선택하면 보이는 내용</h4>
          </div>
          <p class="item-status-empty">사용 가능 수량, 현재 분출 중인 사람, 오늘 예약, 앞으로 예약을 한 번에 볼 수 있습니다.</p>
        </section>
        <section class="item-status-section">
          <div class="item-status-section-head">
            <h4>예약 방법</h4>
          </div>
          <p class="item-status-empty">물품 행을 확인한 뒤 <strong>예약하기</strong>를 누르거나, 오른쪽의 <strong>이 물품 예약</strong> 버튼을 누르세요.</p>
        </section>
      </div>
    `;
    return;
  }

  const checkedOut = state.reservations
    .filter((reservation) => reservation.itemId === item.id && getReservationDisplayStatus(reservation) === "분출됨")
    .sort((a, b) => String(a.endDate || "").localeCompare(String(b.endDate || "")));
  const todayPlanned = state.reservations
    .filter((reservation) => reservation.itemId === item.id && getReservationDisplayStatus(reservation) === "예약됨" && reservation.startDate <= today() && reservation.endDate >= today())
    .sort((a, b) => String(a.endDate || "").localeCompare(String(b.endDate || "")));
  const upcoming = state.reservations
    .filter((reservation) => reservation.itemId === item.id && getReservationDisplayStatus(reservation) === "예약됨" && reservation.startDate > today())
    .sort((a, b) => String(a.endDate || "").localeCompare(String(b.endDate || "")));

  els.workPanel.innerHTML = `
    <div class="panel-card item-status-panel">
      <div class="item-status-head">
        <div>
          <p class="panel-title">${escapeHtml(item.name)}</p>
      <p class="helper">${escapeHtml(item.location)} · ${renderItemMeta(item)}</p>
        </div>
        ${statusBadge(item.status)}
      </div>
      <div class="item-status-metrics">
        <div>
          <span>사용 가능</span>
          <strong>${getAvailableCount(item.id)} / ${item.total}</strong>
          <small>${escapeHtml(item.unit || "개")}</small>
        </div>
        <div>
          <span>사용 불가</span>
          <strong>${(item.damaged || 0) + (item.lost || 0) + (item.disposed || 0)}</strong>
          <small>파손 ${item.damaged || 0} · 분실 ${item.lost || 0}<br />폐기 ${item.disposed || 0}</small>
        </div>
      </div>
      ${renderBorrowingStatusSection("분출 중", checkedOut, "현재 이 물품을 빌려간 사람이 없습니다.")}
      ${renderBorrowingStatusSection("오늘 예약", todayPlanned, "오늘 사용 예정인 예약이 없습니다.")}
      ${renderBorrowingStatusSection("앞으로 예약", upcoming, "앞으로 잡힌 예약이 없습니다.")}
      <button class="primary" id="panelReserveBtn" type="button">이 물품 예약</button>
    </div>
  `;
  document.querySelector("#panelReserveBtn").addEventListener("click", () => openReservationModal(item.id));
}

function renderBorrowingStatusSection(title, reservations, emptyText) {
  return `
    <section class="item-status-section">
      <div class="item-status-section-head">
        <h4>${escapeHtml(title)}</h4>
        <span>${reservations.length}건</span>
      </div>
      ${
        reservations.length
          ? `<div class="item-hold-list">
              ${reservations.slice(0, 8).map(renderBorrowingStatusRow).join("")}
             </div>
             ${reservations.length > 8 ? `<p class="helper">그 외 ${reservations.length - 8}건은 예약·반납 화면에서 확인할 수 있습니다.</p>` : ""}`
          : `<p class="item-status-empty">${escapeHtml(emptyText)}</p>`
      }
    </section>
  `;
}

function renderBorrowingStatusRow(reservation) {
  const item = getItem(reservation.itemId);
  const unit = escapeHtml(item?.unit || "개");
  const dateLabel = getReservationDisplayStatus(reservation) === "분출됨" ? "대여 기간" : "사용 예정";
  return `
    <div class="item-hold-row">
      <div>
        <strong>${escapeHtml(item?.name || "삭제된 물품")}</strong>
        <p class="helper">${escapeHtml(reservation.teacher || "-")} · ${reservation.quantity} ${unit}</p>
      </div>
      <div class="item-hold-meta">
        <span>${dateLabel}: ${escapeHtml(formatDateOnly(reservation.startDate))} ~ ${escapeHtml(formatDateOnly(reservation.endDate))}</span>
      </div>
    </div>
  `;
}

function renderMyReservationPanel() {
  const rows = getReservationRowsForCurrentMode();
  const activeRows = rows.filter((reservation) => ["예약됨", "분출됨"].includes(getReservationDisplayStatus(reservation)));
  const reservedCount = rows.filter((reservation) => getReservationDisplayStatus(reservation) === "예약됨").length;
  const checkedOutCount = rows.filter((reservation) => getReservationDisplayStatus(reservation) === "분출됨").length;
  const completedCount = rows.filter((reservation) => reservation.status === "회수 완료").length;

  els.workPanel.innerHTML = `
    <div class="panel-card item-status-panel">
      <div>
        <p class="panel-title">내 예약·반납</p>
        <p class="helper">왼쪽 목록에서 예약을 선택하면 취소나 반납 처리를 할 수 있습니다.</p>
      </div>
      <div class="item-status-metrics reservation-metrics">
        <div>
          <span>예약됨</span>
          <strong>${reservedCount}</strong>
          <small>사용 전</small>
        </div>
        <div>
          <span>분출됨</span>
          <strong>${checkedOutCount}</strong>
          <small>반납 필요</small>
        </div>
        <div>
          <span>회수 완료</span>
          <strong>${completedCount}</strong>
          <small>처리 끝</small>
        </div>
      </div>
      ${renderMyReservationSection(activeRows)}
    </div>
  `;
}

function renderMyReservationSection(reservations) {
  return `
    <section class="item-status-section">
      <div class="item-status-section-head">
        <h4>진행 중인 예약</h4>
        <span>${reservations.length}건</span>
      </div>
      ${
        reservations.length
          ? `<div class="item-hold-list">${reservations.slice(0, 5).map(renderMyReservationRow).join("")}</div>`
          : `<p class="item-status-empty">현재 취소하거나 반납할 예약이 없습니다.</p>`
      }
    </section>
  `;
}

function renderMyReservationRow(reservation) {
  const item = getItem(reservation.itemId);
  const dateLabel = getReservationDisplayStatus(reservation) === "분출됨" ? "대여 기간" : "사용 예정";
  return `
    <div class="item-hold-row">
      <div>
        <strong>${escapeHtml(item?.name || "삭제된 물품")}</strong>
        <p class="helper">${statusBadge(getReservationDisplayStatus(reservation))} · ${reservation.quantity} ${escapeHtml(item?.unit || "개")}</p>
      </div>
      <div class="item-hold-meta">
        <span>${dateLabel}: ${escapeHtml(formatDateOnly(reservation.startDate))} ~ ${escapeHtml(formatDateOnly(reservation.endDate))}</span>
      </div>
    </div>
  `;
}

function renderReservationPanel(reservation) {
  const item = getItem(reservation.itemId);
  const displayStatus = getReservationDisplayStatus(reservation);
  els.workPanel.innerHTML = `
    <div class="panel-card">
      <p class="panel-title">${escapeHtml(item?.name || "삭제된 물품")}</p>
      <p class="helper">${escapeHtml(reservation.teacher)} · ${reservation.quantity} ${escapeHtml(item?.unit || "개")} · ${statusBadge(displayStatus)}</p>
      <ul class="quiet-list">
        <li>사용일 — ${escapeHtml(formatDateOnly(reservation.startDate))} ~ ${escapeHtml(formatDateOnly(reservation.endDate))}</li>
        <li>보관 장소 — ${escapeHtml(item?.location || "-")}</li>
        ${reservation.selfCheckout ? `<li>분출 방식 — <span class="badge orange">직접 가져감</span></li>` : ""}
        <li>비고 — ${escapeHtml(reservation.note || "-")}</li>
      </ul>
    </div>
    ${reservation.selfCheckout && displayStatus === "분출됨" ? `
      <div class="self-checkout-notice">
        <span class="notice-icon" aria-hidden="true">ℹ️</span>
        교사가 직접 가져간 물품입니다. 관리자 분출 처리가 필요 없습니다.
      </div>` : ""}
    <div class="panel-section stack">
      ${
        displayStatus === "예약됨"
          ? `${adminMode ? `<button class="success" id="checkoutBtn" type="button">분출 처리</button>` : ""}
             <button class="ghost" id="cancelReservationBtn" type="button">예약 취소</button>`
          : ""
      }
      ${
        displayStatus === "분출됨"
          ? `<button class="primary" id="returnBtn" type="button">반납 처리</button>`
          : ""
      }
    </div>
  `;

  const checkoutBtn = document.querySelector("#checkoutBtn");
  if (checkoutBtn) checkoutBtn.addEventListener("click", () => checkoutReservation(reservation.id));

  const cancelBtn = document.querySelector("#cancelReservationBtn");
  if (cancelBtn) cancelBtn.addEventListener("click", () => cancelReservation(reservation.id));

  const returnBtn = document.querySelector("#returnBtn");
  if (returnBtn) returnBtn.addEventListener("click", () => openReturnModal(reservation.id));

}

function renderItemPanel(item) {
  const isManageView = currentView === "items";
  const avail = getAvailableCount(item.id);
  const unit = escapeHtml(item.unit || "개");

  els.workPanel.innerHTML = `
    <div class="panel-card item-detail-card">
      <!-- 헤더: 이름 + 상태 -->
      <div class="item-detail-header">
        <div>
          <p class="item-detail-name">${escapeHtml(item.name)}</p>
          ${item.spec ? `<span class="item-detail-spec">규격 ${escapeHtml(item.spec)}</span>` : ""}
        </div>
        ${statusBadge(item.status)}
      </div>

      <!-- 수량 요약 -->
      <div class="item-detail-metrics">
        <div class="item-metric">
          <span class="item-metric-label">사용 가능</span>
          <strong class="item-metric-value">${avail} <small>${unit}</small></strong>
        </div>
        <div class="item-metric">
          <span class="item-metric-label">총 수량</span>
          <strong class="item-metric-value">${item.total} <small>${unit}</small></strong>
        </div>
        <div class="item-metric">
          <span class="item-metric-label">파손·분실·폐기</span>
          <strong class="item-metric-value">${(item.damaged||0)+(item.lost||0)+(item.disposed||0)} <small>${unit}</small></strong>
        </div>
      </div>

      <!-- 상세 정보 그리드 -->
      <dl class="item-detail-grid">
        <dt>보관 장소</dt><dd>${escapeHtml(item.location || "-")}</dd>
        <dt>카테고리</dt><dd>${escapeHtml(item.category || "-")}</dd>
        <dt>관리 번호</dt><dd>${escapeHtml(item.code || "-")}</dd>
        <dt>소모품 여부</dt><dd>${item.consumable ? "소모품" : "비품"}</dd>
        <dt>구입일</dt><dd>${escapeHtml(item.purchasedAt || "-")}</dd>
        <dt>구입 금액</dt><dd>${item.price ? Number(item.price).toLocaleString() + "원" : "-"}</dd>
        ${item.note ? `<dt>비고</dt><dd class="item-detail-note">${escapeHtml(item.note)}</dd>` : ""}
      </dl>
    </div>

    ${isManageView
      ? `<!-- 관리 버튼 (등록 물품 정보 위) -->
         <div class="panel-section">
           <div class="item-action-row">
             <button class="panel-action panel-action-edit" id="editItemBtn" type="button">물품 수정</button>
             <button class="panel-action panel-action-damage" id="manualDamageBtn" type="button">손망·분실 등록</button>
             <button class="panel-action panel-action-delete" id="deleteItemBtn" type="button">물품 삭제</button>
           </div>
         </div>
         ${renderItemAcquisitionSummary(item)}
         ${renderItemLogs(item)}`
      : `<!-- 예약 탭: 예약 현황만 + 예약 버튼 (등록 기록 없음) -->
         ${adminMode ? renderItemReservationSummary(item) : ""}
         <div class="panel-section">
           <button class="primary" id="reserveItemBtn" type="button" style="width:100%;">이 물품 예약</button>
         </div>`
    }
  `;

  document.querySelector("#reserveItemBtn")?.addEventListener("click", () => openReservationModal(item.id));
  document.querySelector("#editItemBtn")?.addEventListener("click", () => openItemModal(item));
  document.querySelector("#manualDamageBtn")?.addEventListener("click", () => openDamageModal(null, item.id));
  document.querySelector("#deleteItemBtn")?.addEventListener("click", () => deleteItem(item.id));
}

function scrollWorkPanelIntoView() {
  if (!els.workPanel) return;
  if (isMobileViewport()) {
    openMobileSheet();
    requestAnimationFrame(() => { els.workPanel.scrollTop = 0; });
    return;
  }
  // 데스크톱: 오른쪽 작업 패널이 항상 보이므로(sticky) 패널 내부만 맨 위로 올린다.
  requestAnimationFrame(() => { els.workPanel.scrollTop = 0; });
}

function renderItemReservationSummary(item) {
  const activeReservations = state.reservations
    .filter((reservation) => reservation.itemId === item.id && ["예약됨", "분출됨"].includes(reservation.status))
    .sort((a, b) => {
      const statusOrder = { "분출됨": 0, "예약됨": 1 };
      return (statusOrder[a.status] ?? 2) - (statusOrder[b.status] ?? 2)
        || String(a.endDate || "").localeCompare(String(b.endDate || ""));
    });

  if (!activeReservations.length) {
    return `
      <div class="panel-card">
        <p class="panel-title">예약·분출 현황</p>
        <p class="helper">현재 예약 또는 분출 중인 수량이 없습니다.</p>
      </div>
    `;
  }

  return `
    <div class="panel-card">
      <p class="panel-title">예약·분출 현황</p>
      <div class="item-hold-list">
        ${activeReservations.map((reservation) => renderItemHoldRow(reservation, item)).join("")}
      </div>
    </div>
  `;
}

function renderItemAcquisitionSummary(item) {
  const acquisitions = normalizeItemAcquisitions(item, state.logs).acquisitions;
  if (!acquisitions.length) {
    return `
      <div class="panel-card">
        <p class="panel-title">등록 물품 정보</p>
        <p class="helper">등록 묶음 정보가 아직 없습니다.</p>
      </div>
    `;
  }

  const rows = acquisitions.map((entry, index) => {
    const quantity = Number(entry.quantity || 0);
    const unitPrice = Number(entry.price || 0);
    const dateLabel = entry.purchasedAt ? escapeHtml(entry.purchasedAt) : `${index + 1}차 등록`;
    const quantityLabel = `${quantity}${escapeHtml(item.unit || "개")}`;
    const unitPriceLabel = unitPrice ? `${formatNumber(unitPrice)}원` : "단가 미입력";
    return `
      <div class="acquisition-row">
        <strong>${dateLabel}</strong>
        <div class="acquisition-meta">
          <span>${quantityLabel}</span>
          <span>${unitPriceLabel}</span>
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="panel-card">
      <p class="panel-title">등록 물품 정보</p>
      <div class="acquisition-list">${rows}</div>
    </div>
  `;
}

function renderItemLogs(item) {
  const logs = state.logs
    .filter((l) => l.itemId === item.id)
    .slice()
    .reverse()
    .slice(0, 20);

  if (!logs.length) return "";

  const rows = logs.map((l) => `
    <div class="item-log-row">
      <span class="item-log-type">${escapeHtml(l.type)}</span>
      <span class="item-log-msg">${escapeHtml(l.message)}</span>
      <span class="item-log-date">${formatDateTime(l.createdAt)}</span>
    </div>
  `).join("");

  return `
    <div class="panel-card">
      <p class="panel-title">등록 기록</p>
      <div class="item-log-list">${rows}</div>
    </div>
  `;
}

function renderItemHoldRow(reservation, item) {
  const unit = escapeHtml(item.unit || "개");
  const statusText = reservation.status === "분출됨" ? "분출 중" : "예약 중";
  const dateText = `${escapeHtml(formatDateOnly(reservation.startDate))} ~ ${escapeHtml(formatDateOnly(reservation.endDate))}`;
  const checkoutText = reservation.status === "분출됨"
    ? `<span>분출: ${reservation.checkedOutAt ? formatDateTime(reservation.checkedOutAt) : reservation.selfCheckout ? "직접 가져감" : "-"}</span>`
    : `<span>사용 예정: ${dateText}</span>`;
  const periodText = reservation.status === "분출됨" ? `대여 기간: ${dateText}` : "";

  return `
    <div class="item-hold-row">
      <div>
        <strong>${escapeHtml(reservation.teacher || "-")}</strong>
        ${periodText ? `<p class="helper">${periodText}</p>` : ""}
      </div>
      <div class="item-hold-meta">
        ${statusBadge(statusText)}
        <span>${reservation.quantity} ${unit}</span>
        ${checkoutText}
      </div>
    </div>
  `;
}

function openSetupWizardModal() {
  const connected = canUseRemoteSync() && Boolean(syncConfig.lastSyncedAt);
  const copyUrl = "https://docs.google.com/spreadsheets/d/1q0fny_Xczq6Anbk1VUgk_k2NR7bm1OktCqqMPXh4YKA/copy";

  const modal = openModal({
    title: "처음 설정 마법사",
    submitText: "닫기",
    body: `
      <div class="wizard-summary">
        <p class="helper">아래 1~4를 위에서 아래로 따라 하세요. 4번 링크를 클릭하면 연결이 자동으로 완료됩니다.</p>
      </div>

      <ol class="setup-wizard-steps">
        <li class="setup-wizard-step">
          <strong>1. 학교용 시트 사본 만들기</strong>
          <p class="helper">학교 공용 Google 계정으로 로그인한 뒤 아래 버튼을 눌러 "사본 만들기"를 클릭합니다.</p>
          <a class="ghost compact" href="${copyUrl}" target="_blank" rel="noopener">학교용 시트 만들기</a>
        </li>
        <li class="setup-wizard-step">
          <strong>2. 시트에서 "처음 설정" 실행 + 권한 승인</strong>
          <p class="helper">사본 시트 상단 <code>교구이음 → ① 처음 설정 / 연결 키 발급</code> 실행. "확인되지 않은 앱" 경고가 나오면 <strong>고급 → (스크립트 이름)(으)로 이동(안전하지 않음)</strong> → 허용.</p>
        </li>
        <li class="setup-wizard-step">
          <strong>3. 웹앱으로 배포</strong>
          <p class="helper">시트의 <code>확장 → Apps Script → 배포 → 새 배포</code> 클릭 후:</p>
          <p class="helper">① 왼쪽 위 톱니바퀴(⚙️) → <strong>웹 앱</strong> 선택<br>② 새 설명: <code>v1</code> 입력<br>③ 다음 사용자 인증 정보로 실행: <strong>나(본인 계정)</strong><br>④ 액세스 권한이 있는 사용자: <strong>모든 사용자</strong><br>⑤ <strong>배포</strong> 클릭 → 웹 앱 URL(<code>/exec</code>로 끝나는 주소)을 복사해 메모장에 저장</p>
          <p class="helper" style="color:var(--warn,#b45309);">⚠️ 이 URL은 4단계에서 붙여넣어야 하므로 반드시 저장해두세요.</p>
        </li>
        <li class="setup-wizard-step">
          <strong>4. "우리 학교 접속 링크" 클릭</strong>
          <p class="helper">시트 메뉴 <code>교구이음 → ④ 우리 학교 접속 링크</code> 실행 → URL 입력창에 3단계에서 복사한 주소 붙여넣기 → <strong>▶ 우리 학교 앱 열기</strong> 클릭.</p>
          <p class="helper">앱이 열리면 연결이 자동으로 완료됩니다. 이후 <strong>학교 설정</strong>에서 학교명·교사·물품실을 입력하고 저장하면 스프레드시트에 바로 올라갑니다.</p>
        </li>
      </ol>

      <div class="settings-block">
        <div class="settings-block-head">
          <div>
            <h3>연결 상태</h3>
            <p class="helper">${connected ? "이미 연결되어 있습니다. 4번을 다시 할 필요는 없습니다." : "아직 연결 전입니다. 4번 링크를 클릭하면 자동으로 완료됩니다."}</p>
          </div>
          <span class="badge ${connected ? "green" : "gray"}">${connected ? "연결됨" : "연결 전"}</span>
        </div>
        <a class="ghost compact guide-link" href="./처음설정가이드.html" target="_blank" rel="noopener">자세히 보기</a>
      </div>
    `,
    onSubmit: () => true,
  });

  // 4번 단계를 안내했으므로 "링크 연결 대기" 상태로 표시 → 링크로 돌아오면 완료 화면이 뜬다
  if (!connected) {
    setupState.awaitingLinkConnect = true;
    saveSetupState();
  }
}

function openSetupCompleteModal() {
  const inviteLink = generateTeacherInviteLink();
  const modal = openModal({
    title: "설정 완료 🎉",
    submitText: "닫기",
    body: `
      <div class="settings-block first">
        <div class="settings-block-head">
          <div>
            <h3>연결이 끝났습니다</h3>
            <p class="helper">학교 정보가 스프레드시트에 올라갔고, 저장할 때마다 자동으로 동기화됩니다.</p>
          </div>
          <span class="badge green">연결됨</span>
        </div>
      </div>

      <div class="settings-block">
        <div class="settings-block-head">
          <div>
            <h3>1) 관리자 PIN을 꼭 바꾸세요</h3>
            <p class="helper">초기 PIN <code>1234</code>는 누구나 알 수 있습니다. 학교 설정에서 운영용 PIN으로 변경하세요.</p>
          </div>
          <button class="ghost compact" id="completeOpenSettingsBtn" type="button">학교 설정 열기</button>
        </div>
      </div>

      <div class="settings-block">
        <div class="settings-block-head">
          <div>
            <h3>2) 교사들에게 이 링크를 공유하세요</h3>
            <p class="helper">방금 클릭한 링크가 그대로 교사 초대 링크입니다. 학교 내부 메신저로만 공유하세요.</p>
          </div>
        </div>
        <div class="invite-link-area">
          <input type="text" id="completeInviteInput" readonly class="invite-link-input" value="${escapeHtml(inviteLink)}" />
          <button class="primary compact" id="completeCopyInviteBtn" type="button">링크 복사</button>
        </div>
      </div>
    `,
    onSubmit: () => true,
  });

  modal.querySelector("#completeOpenSettingsBtn").addEventListener("click", () => {
    modal.remove();
    openSchoolSettingsModal();
  });
  modal.querySelector("#completeCopyInviteBtn").addEventListener("click", () => {
    const input = modal.querySelector("#completeInviteInput");
    if (!input.value) {
      toast("연결 정보가 없습니다.", "warn");
      return;
    }
    navigator.clipboard.writeText(input.value).then(() => {
      toast("교사 초대 링크를 복사했습니다.", "success");
    }).catch(() => {
      input.select();
      document.execCommand("copy");
      toast("링크를 복사했습니다.", "success");
    });
  });
}

function openFieldTestModal() {
  if (!adminMode) return;

  const testItems = [
    ["openApp", "교사용 PC에서 index.html 실행", "인터넷 연결 없이 화면이 열리고 엑셀 업로드 라이브러리 오류가 없는지 확인합니다."],
    ["setTeacher", "교사 선택과 물품실 선택", "사용 교사를 바꿔 보고 체육실/과학실 등 물품실 필터가 작동하는지 확인합니다."],
    ["importExcel", "엑셀 일괄 등록", "엑셀 양식을 받아 2~3개 물품을 넣고 미리보기 후 등록합니다."],
    ["reserveItem", "예약 생성", "일반 교사 흐름으로 물품 1건을 예약합니다."],
    ["checkoutItem", "분출 처리", "관리자 모드에서 예약 건을 분출 처리합니다."],
    ["returnItem", "반납 처리", "분출된 물품을 정상 반납 처리합니다."],
    ["damageFlow", "손망 처리", "파손/분실 수량과 사유 입력이 기록에 남는지 확인합니다."],
    ["syncDiagnose", "연결 진단", "Apps Script 연결 진단에서 시트와 헤더가 정상인지 확인합니다."],
    ["secondDevicePull", "다른 PC에서 가져오기", "다른 브라우저나 PC에서 같은 데이터가 불러와지는지 확인합니다."],
    ["exportReport", "기록 내보내기", "물품 목록, 관리 기록, 테스트 리포트를 내려받습니다."],
  ];
  const doneCount = testItems.filter(([key]) => fieldTestState.steps[key]).length;

  const modal = openModal({
    title: "실제 학교 테스트",
    submitText: "저장",
    body: `
      <div class="wizard-summary">
        <div>
          <p class="helper">현장 테스트 진행률</p>
          <strong>${doneCount}/${testItems.length} 완료</strong>
        </div>
        <div class="wizard-progress" aria-hidden="true">
          <span style="width:${Math.round((doneCount / testItems.length) * 100)}%"></span>
        </div>
      </div>

      <div class="settings-block first">
        <div class="settings-block-head">
          <div>
            <h3>테스트 정보</h3>
            <p class="helper">실제 사용 환경을 나중에 비교할 수 있도록 남깁니다.</p>
          </div>
          <button class="ghost compact" id="downloadFieldReportBtn" type="button">테스트 리포트 내보내기</button>
        </div>
        <div class="field-grid">
          <label class="field">
            <span>테스트 날짜</span>
            <input name="testDate" type="date" value="${escapeHtml(fieldTestState.testDate || today())}" />
          </label>
          <label class="field">
            <span>테스터</span>
            <input name="testerName" type="text" value="${escapeHtml(fieldTestState.testerName || "")}" placeholder="예: 정보 담당 교사" />
          </label>
          <label class="field">
            <span>참여 교사 수</span>
            <input name="teacherCount" type="number" min="0" value="${escapeHtml(fieldTestState.teacherCount || "")}" />
          </label>
          <label class="field">
            <span>기기/브라우저</span>
            <input name="deviceNote" type="text" value="${escapeHtml(fieldTestState.deviceNote || "")}" placeholder="예: Windows 노트북, Chrome" />
          </label>
        </div>
      </div>

      <div class="settings-block">
        <div class="settings-block-head">
          <div>
            <h3>테스트 체크리스트</h3>
            <p class="helper">교사 예약부터 관리자 회수, 동기화까지 한 바퀴 돌립니다.</p>
          </div>
        </div>
        <div class="wizard-steps">
          ${testItems
            .map(
              ([key, title, description], index) => `
                <label class="wizard-step">
                  <input type="checkbox" name="fieldTestStep" value="${key}" ${fieldTestState.steps[key] ? "checked" : ""} />
                  <span class="wizard-step-index">${index + 1}</span>
                  <span>
                    <strong>${title}</strong>
                    <small>${description}</small>
                  </span>
                </label>
              `,
            )
            .join("")}
        </div>
      </div>

      <div class="settings-block">
        <div class="settings-block-head">
          <div>
            <h3>피드백 메모</h3>
            <p class="helper">막힌 지점, 헷갈린 문구, 추가 요청을 그대로 적습니다.</p>
          </div>
        </div>
        <label class="field full">
          <span>메모</span>
          <textarea name="fieldTestNotes" placeholder="예: 예약 버튼은 잘 보였지만 반납 처리 위치를 한 번 헤맴">${escapeHtml(fieldTestState.notes || "")}</textarea>
        </label>
      </div>
    `,
    onSubmit: (formData) => {
      saveFieldTestFromForm(formData, testItems);
      addLog("현장 테스트", `현장 테스트 상태를 저장했습니다. 완료 ${formData.getAll("fieldTestStep").length}/${testItems.length}건.`, "관리자");
      saveState();
      render();
      toast("현장 테스트 상태를 저장했습니다.", "success");
      return true;
    },
  });

  modal.querySelector("#downloadFieldReportBtn").addEventListener("click", () => {
    const form = modal.querySelector("#modalForm");
    downloadFieldTestReport(new FormData(form), testItems);
  });
}

function saveFieldTestFromForm(formData, testItems) {
  const checkedSteps = new Set(formData.getAll("fieldTestStep"));
  fieldTestState = {
    testerName: formData.get("testerName").trim(),
    testDate: formData.get("testDate") || today(),
    teacherCount: formData.get("teacherCount"),
    deviceNote: formData.get("deviceNote").trim(),
    notes: formData.get("fieldTestNotes").trim(),
    steps: Object.fromEntries(testItems.map(([key]) => [key, checkedSteps.has(key)])),
  };
  saveFieldTestState();
}

function openFeedbackModal() {
  if (!adminMode) return;

  const feedbackRows = feedbackState.items
    .map(
      (item) => `
        <div class="feedback-row" data-feedback-id="${escapeHtml(item.id)}">
          <div class="field-grid">
            <label class="field full">
              <span>요청/문제</span>
              <input name="feedbackTitle" type="text" value="${escapeHtml(item.title)}" required />
            </label>
            <label class="field">
              <span>출처</span>
              <input name="feedbackSource" type="text" value="${escapeHtml(item.source || "")}" placeholder="예: 체육 전담, 3학년 담임" />
            </label>
            <label class="field">
              <span>우선순위</span>
              <select name="feedbackPriority">
                ${["높음", "보통", "낮음"].map((priority) => `<option ${item.priority === priority ? "selected" : ""}>${priority}</option>`).join("")}
              </select>
            </label>
            <label class="field">
              <span>처리상태</span>
              <select name="feedbackStatus">
                ${["검토 중", "반영 예정", "반영 완료", "보류"].map((status) => `<option ${item.status === status ? "selected" : ""}>${status}</option>`).join("")}
              </select>
            </label>
            <button class="danger compact remove-feedback-btn" type="button">삭제</button>
            <label class="field full">
              <span>메모</span>
              <textarea name="feedbackNote">${escapeHtml(item.note || "")}</textarea>
            </label>
          </div>
        </div>
      `,
    )
    .join("");

  const modal = openModal({
    title: "시범 운영 피드백",
    submitText: "저장",
    body: `
      <div class="settings-block first">
        <div class="settings-block-head">
          <div>
            <h3>피드백 목록</h3>
            <p class="helper">실제 사용 중 나온 요청을 우선순위와 상태로 관리합니다.</p>
          </div>
          <div class="sync-actions">
            <button class="ghost compact" id="addFeedbackBtn" type="button">항목 추가</button>
            <button class="ghost compact" id="downloadFeedbackBtn" type="button">피드백 내보내기</button>
          </div>
        </div>
        <div class="feedback-list" id="feedbackList">
          ${feedbackRows}
        </div>
      </div>
    `,
    onSubmit: () => {
      feedbackState.items = readFeedbackRows();
      saveFeedbackState();
      addLog("피드백", `시범 운영 피드백 ${feedbackState.items.length}건을 저장했습니다.`, "관리자");
      saveState();
      render();
      toast("피드백을 저장했습니다.", "success");
      return true;
    },
  });

  const feedbackList = modal.querySelector("#feedbackList");
  modal.querySelector("#addFeedbackBtn").addEventListener("click", () => {
    const row = document.createElement("div");
    row.className = "feedback-row";
    row.dataset.feedbackId = createId("feedback");
    row.innerHTML = `
      <div class="field-grid">
        <label class="field full">
          <span>요청/문제</span>
          <input name="feedbackTitle" type="text" placeholder="예: 반납 처리 버튼 위치를 더 잘 보이게" required />
        </label>
        <label class="field">
          <span>출처</span>
          <input name="feedbackSource" type="text" placeholder="예: 과학 전담" />
        </label>
        <label class="field">
          <span>우선순위</span>
          <select name="feedbackPriority"><option>높음</option><option selected>보통</option><option>낮음</option></select>
        </label>
        <label class="field">
          <span>처리상태</span>
          <select name="feedbackStatus"><option selected>검토 중</option><option>반영 예정</option><option>반영 완료</option><option>보류</option></select>
        </label>
        <button class="danger compact remove-feedback-btn" type="button">삭제</button>
        <label class="field full">
          <span>메모</span>
          <textarea name="feedbackNote"></textarea>
        </label>
      </div>
    `;
    feedbackList.appendChild(row);
    row.querySelector("input").focus();
  });
  modal.querySelector("#downloadFeedbackBtn").addEventListener("click", () => {
    downloadFeedbackReport(readFeedbackRows());
  });
  feedbackList.addEventListener("click", (event) => {
    const button = event.target.closest(".remove-feedback-btn");
    if (!button) return;
    button.closest(".feedback-row").remove();
  });
}

function readFeedbackRows() {
  return [...document.querySelectorAll("#feedbackList .feedback-row")]
    .map((row) => ({
      id: row.dataset.feedbackId || createId("feedback"),
      title: row.querySelector('[name="feedbackTitle"]').value.trim(),
      source: row.querySelector('[name="feedbackSource"]').value.trim(),
      priority: row.querySelector('[name="feedbackPriority"]').value,
      status: row.querySelector('[name="feedbackStatus"]').value,
      note: row.querySelector('[name="feedbackNote"]').value.trim(),
      createdAt: feedbackState.items.find((item) => item.id === row.dataset.feedbackId)?.createdAt || new Date().toISOString(),
    }))
    .filter((item) => item.title);
}

function openReleaseCheckModal() {
  if (!adminMode) return;

  const releaseItems = [
    ["offlineOpen", "오프라인 실행 확인", "인터넷 없이 index.html을 열어 주요 화면이 보이는지 확인합니다."],
    ["vendorIncluded", "vendor 폴더 포함", "vendor/xlsx.full.min.js가 배포 폴더에 포함되어 있는지 확인합니다."],
    ["excelImport", "엑셀 업로드 확인", "엑셀 양식을 내려받고 다시 올려 미리보기와 등록을 확인합니다."],
    ["adminPinChanged", "관리자 PIN 변경 확인", "학교 설정에서 초기 PIN 1234를 학교 운영용 PIN으로 변경합니다."],
    ["appsScriptCopied", "마스터 시트 사본 확인", "처음 설정 가이드의 학교용 시트 사본 만들기 흐름이 최신인지 확인합니다."],
    ["syncDiagnoseOk", "연결 진단 정상", "시트 탭과 헤더가 모두 정상으로 보이는지 확인합니다."],
    ["backupExported", "초기 백업 내보내기", "물품 목록과 관리 기록을 1회 내보냅니다."],
    ["fieldReportExported", "현장 테스트 리포트 확보", "현장 테스트 결과 Markdown 파일을 내려받습니다."],
    ["feedbackReviewed", "피드백 우선순위 검토", "높음 항목 중 발표 전 반드시 반영할 것이 남았는지 확인합니다."],
    ["demoDocsReady", "운영 문서 확인", "README.md와 처음설정가이드.html을 최신 흐름에 맞게 확인합니다."],
  ];
  const doneCount = releaseItems.filter(([key]) => releaseCheckState.steps[key]).length;

  const modal = openModal({
    title: "발표·배포용 최종 점검",
    submitText: "저장",
    body: `
      <div class="wizard-summary">
        <div>
          <p class="helper">최종 점검 진행률</p>
          <strong>${doneCount}/${releaseItems.length} 완료</strong>
        </div>
        <div class="wizard-progress" aria-hidden="true">
          <span style="width:${Math.round((doneCount / releaseItems.length) * 100)}%"></span>
        </div>
      </div>

      <div class="settings-block first">
        <div class="settings-block-head">
          <div>
            <h3>점검 정보</h3>
            <p class="helper">발표와 배포 직전에 남기는 최종 확인 기록입니다.</p>
          </div>
          <button class="ghost compact" id="downloadReleaseCheckBtn" type="button">최종 점검표 내보내기</button>
        </div>
        <div class="field-grid">
          <label class="field">
            <span>점검일</span>
            <input name="releaseCheckedAt" type="date" value="${escapeHtml(releaseCheckState.checkedAt || today())}" />
          </label>
          <label class="field">
            <span>점검자</span>
            <input name="releaseCheckedBy" type="text" value="${escapeHtml(releaseCheckState.checkedBy || "")}" placeholder="예: 발표 담당" />
          </label>
        </div>
      </div>

      <div class="settings-block">
        <div class="settings-block-head">
          <div>
            <h3>최종 체크리스트</h3>
            <p class="helper">배포 폴더, 엑셀 업로드, 동기화, 발표 자료를 한 번에 확인합니다.</p>
          </div>
        </div>
        <div class="wizard-steps">
          ${releaseItems.map(([key, title, description], index) => `
            <label class="wizard-step">
              <input type="checkbox" name="releaseStep" value="${key}" ${releaseCheckState.steps[key] ? "checked" : ""} />
              <span class="wizard-step-index">${index + 1}</span>
              <span>
                <strong>${title}</strong>
                <small>${description}</small>
              </span>
            </label>
          `).join("")}
        </div>
      </div>

      <div class="settings-block">
        <label class="field full">
          <span>최종 메모</span>
          <textarea name="releaseNotes" placeholder="예: 발표용 노트북에서 오프라인 실행 확인 완료">${escapeHtml(releaseCheckState.notes || "")}</textarea>
        </label>
      </div>
    `,
    onSubmit: (formData) => {
      saveReleaseCheckFromForm(formData, releaseItems);
      addLog("최종 점검", `발표·배포 최종 점검을 저장했습니다. 완료 ${formData.getAll("releaseStep").length}/${releaseItems.length}건.`, "관리자");
      saveState();
      render();
      toast("최종 점검 상태를 저장했습니다.", "success");
      return true;
    },
  });

  modal.querySelector("#downloadReleaseCheckBtn").addEventListener("click", () => {
    downloadReleaseChecklist(new FormData(modal.querySelector("#modalForm")), releaseItems);
  });
}

function saveReleaseCheckFromForm(formData, releaseItems) {
  const checkedSteps = new Set(formData.getAll("releaseStep"));
  releaseCheckState = {
    checkedBy: formData.get("releaseCheckedBy").trim(),
    checkedAt: formData.get("releaseCheckedAt") || today(),
    notes: formData.get("releaseNotes").trim(),
    steps: Object.fromEntries(releaseItems.map(([key]) => [key, checkedSteps.has(key)])),
  };
  saveReleaseCheckState();
}

function openSchoolSettingsModal() {
  if (!adminMode) return;
  const isGlobal = isGlobalAdmin();
  const isFirebaseConnected = !!(syncConfig.schoolCode);
  const shortCodeUrl = isFirebaseConnected ? `${location.origin}/?s=${syncConfig.schoolCode}` : "";
  const myLocations = isGlobal ? [] : (adminScope?.locations || []).filter((loc) => state.locations.includes(loc));
  const myTeacher = adminScope?.teacher || "";
  const initialCategoryLocation = isGlobal
    ? (state.locations[0] || "")
    : (myLocations[0] || "");
  const pendingCategoriesByLocation = JSON.parse(JSON.stringify(state.categoriesByLocation || {}));
  const pendingDeletedCategoryByLocation = {};

  const managerOptions = (selected = "") => [
    `<option value="">담당자 없음</option>`,
    ...state.teachers.map((teacher) => `<option value="${escapeHtml(teacher)}" ${teacher === selected ? "selected" : ""}>${escapeHtml(teacher)}</option>`),
  ].join("");

  const teacherRows = state.teachers
    .map(
      (teacher) => `
        <div class="teacher-row" data-old-teacher="${escapeHtml(teacher)}">
          <input name="teacherName" type="text" value="${escapeHtml(teacher)}" required />
          <button class="ghost compact remove-teacher-btn" type="button">삭제</button>
        </div>
      `,
    )
    .join("");

  const locationRows = state.locations
    .map(
      (location) => {
        const manager = state.locationManagers?.[location] || {};
        return `
        <div class="location-row" data-old-location="${escapeHtml(location)}">
          <input name="locationName" type="text" value="${escapeHtml(location)}" required />
          <select name="locationManager" title="이 물품실을 관리할 담당자">
            ${managerOptions(manager.teacher || "")}
          </select>
          <input name="locationManagerPin" type="password" inputmode="numeric" value="${escapeHtml(manager.pin || "")}" placeholder="담당자 PIN" title="이 물품실 담당자가 관리자 모드에 들어갈 때 쓰는 PIN" />
          <div class="location-row-actions">
            <button class="ghost compact reset-pin-btn" type="button">PIN 초기화</button>
            <button class="ghost compact danger remove-location-btn" type="button">물품실 삭제</button>
          </div>
        </div>
      `;
      },
    )
    .join("");

  const globalSectionsHtml = `
      <div class="settings-block first">
        <div class="settings-block-head">
          <div>
            <h3>학교명</h3>
            <p class="helper">상단 제목에 표시되는 학교명입니다. 예: 늘봄초등학교, 새빛중학교</p>
          </div>
        </div>
        <div class="field-grid">
          <label class="field full">
            <input name="schoolName" type="text" value="${escapeHtml(state.schoolName || "")}" required />
          </label>
        </div>
      </div>

      <div class="settings-block">
        <div class="settings-block-head">
          <div>
            <h3>교사 목록</h3>
            <p class="helper">예약 화면의 사용 교사 선택에 표시되는 이름입니다.</p>
          </div>
          <button class="ghost compact" id="addTeacherBtn" type="button">교사 추가</button>
        </div>
        <div class="teacher-list" id="teacherList">
          ${teacherRows}
        </div>
        <p class="helper">기존 예약에 남아 있는 교사는 바로 삭제할 수 없습니다. 이름 수정은 기존 예약에도 함께 반영됩니다.</p>
      </div>

      <div class="settings-block">
        <div class="settings-block-head">
          <div>
            <h3>물품실</h3>
            <p class="helper">체육실, 과학실처럼 학교에서 실제로 관리하는 공간입니다. 각 물품실 담당자와 담당자 PIN을 지정할 수 있습니다.</p>
          </div>
          <button class="ghost compact" id="addLocationBtn" type="button">물품실 추가</button>
        </div>
        <div class="location-list" id="locationList">
          ${locationRows}
        </div>
        <p class="helper">담당자는 자신의 물품실 물품, 예약, 기록만 관리합니다. 물품실을 삭제하면 해당 물품실의 물품과 연결된 예약도 함께 삭제할 수 있습니다.</p>
      </div>
  `;

  const categorySectionHtml = isGlobal
    ? `
      <div class="settings-block">
        <div class="settings-block-head">
          <div>
            <h3>카테고리</h3>
            <p class="helper">실별로 카테고리를 따로 관리합니다. 위에서 실을 고르면 그 실의 카테고리만 보입니다. 카테고리는 실별 담당자가 추후에 직접 설정합니다.</p>
          </div>
          <button class="ghost compact" id="addCategoryBtn" type="button">카테고리 추가</button>
        </div>
        <label class="field">
          <span>실 선택</span>
          <select id="categoryLocationSelect">
            ${state.locations.map((loc) => `<option value="${escapeHtml(loc)}" ${loc === initialCategoryLocation ? "selected" : ""}>${escapeHtml(loc)}</option>`).join("")}
          </select>
        </label>
        <p class="category-list-label">선택한 실의 카테고리 목록</p>
        <div class="category-list" id="categoryList" data-current-location="${escapeHtml(initialCategoryLocation)}"></div>
        <p class="helper">물품 등록 화면에서 직접 입력한 새 카테고리도 그 실의 카테고리로 자동 추가됩니다.</p>
      </div>
    `
    : myLocations.length
      ? `
      <div class="settings-block">
        <div class="settings-block-head">
          <div>
            <h3>${escapeHtml(myLocations.join(", "))} 카테고리</h3>
            <p class="helper">본인 담당 물품실의 카테고리를 관리합니다.</p>
          </div>
          <button class="ghost compact" id="addCategoryBtn" type="button">카테고리 추가</button>
        </div>
        ${myLocations.length > 1 ? `
        <label class="field">
          <span>실 선택</span>
          <select id="categoryLocationSelect">
            ${myLocations.map((loc) => `<option value="${escapeHtml(loc)}" ${loc === initialCategoryLocation ? "selected" : ""}>${escapeHtml(loc)}</option>`).join("")}
          </select>
        </label>
        ` : `
        <p class="helper"><strong>${escapeHtml(initialCategoryLocation)}</strong> (내 실)</p>
        `}
        <p class="category-list-label">선택한 실의 카테고리 목록</p>
        <div class="category-list" id="categoryList" data-current-location="${escapeHtml(initialCategoryLocation)}"></div>
        <p class="helper">물품 등록 화면에서 직접 입력한 새 카테고리도 자동으로 추가됩니다.</p>
      </div>
    `
      : "";

  // Firebase(학교 계정) 모드: 계정 정보·비밀번호 등 '계정' 관련 설정은 '학교 계정' 모달로 이동.
  // 학교 설정은 학교 운영(학교명·교사·물품실·카테고리)만 담당한다.
  const adminPinSectionHtml = isFirebaseConnected ? "" : `
      <div class="settings-block">
        <div class="settings-block-head">
          <div>
            <h3>관리자 PIN</h3>
            <p class="helper">학교 운영용 PIN으로 바꾸면 이 브라우저의 관리자 진입과 분출 확인에 바로 적용됩니다.</p>
          </div>
          ${getAdminPin() === DEFAULT_ADMIN_PIN ? `<span class="badge orange">초기 PIN 사용 중</span>` : `<span class="badge green">변경됨</span>`}
        </div>
        <div class="field-grid pin-grid">
          <label class="field">
            <span>현재 PIN</span>
            <input name="currentAdminPin" type="password" inputmode="numeric" autocomplete="current-password" />
          </label>
          <label class="field">
            <span>새 PIN</span>
            <input name="nextAdminPin" type="password" inputmode="numeric" autocomplete="new-password" minlength="4" placeholder="4자리 이상" />
          </label>
          <label class="field">
            <span>새 PIN 확인</span>
            <input name="confirmAdminPin" type="password" inputmode="numeric" autocomplete="new-password" minlength="4" />
          </label>
        </div>
        <p class="helper">빈칸으로 두면 PIN은 변경하지 않습니다. PIN을 잊으면 연동된 Google Spreadsheet의 setting 탭에서 확인할 수 있습니다.</p>
      </div>
  `;

  const selfPinSectionHtml = `
      <div class="settings-block">
        <div class="settings-block-head">
          <div>
            <h3>내 담당자 PIN 변경</h3>
            <p class="helper">본인 담당자 PIN만 변경합니다. 빈칸으로 두면 변경하지 않습니다.</p>
          </div>
        </div>
        <div class="field-grid pin-grid">
          <label class="field">
            <span>현재 담당자 PIN</span>
            <input name="currentSelfPin" type="password" inputmode="numeric" autocomplete="current-password" />
          </label>
          <label class="field">
            <span>새 담당자 PIN</span>
            <input name="nextSelfPin" type="password" inputmode="numeric" autocomplete="new-password" minlength="4" placeholder="4자리 이상" />
          </label>
          <label class="field">
            <span>새 PIN 확인</span>
            <input name="confirmSelfPin" type="password" inputmode="numeric" autocomplete="new-password" minlength="4" />
          </label>
        </div>
      </div>
  `;

  const syncInputsHtml = `
        <div class="field-grid">
          <label class="field">
            <span>저장 방식</span>
            <select name="syncProvider" id="syncProvider">
              <option value="local" ${syncConfig.provider === "local" ? "selected" : ""}>이 브라우저에만 저장</option>
              <option value="appsScript" ${syncConfig.provider === "appsScript" ? "selected" : ""}>Google Spreadsheet 연동 준비</option>
            </select>
          </label>
          <label class="field">
            <span>연결 키</span>
            <input name="syncApiKey" id="syncApiKey" type="password" value="${escapeHtml(syncConfig.apiKey || "")}" placeholder="Apps Script에 설정한 API_KEY" />
          </label>
          <label class="field full">
            <span>자동 동기화</span>
            <select name="syncAutoMode" id="syncAutoMode">
              <option value="manual" ${syncConfig.autoSync === "manual" ? "selected" : ""}>수동으로만 실행</option>
              <option value="pullOnStart" ${syncConfig.autoSync === "pullOnStart" ? "selected" : ""}>앱 시작 시 원격 데이터 확인</option>
              <option value="pushAfterSave" ${syncConfig.autoSync === "pushAfterSave" ? "selected" : ""}>저장 후 원격에 자동 올리기</option>
            </select>
          </label>
          <label class="field full">
            <span>Apps Script 웹앱 URL</span>
            <input name="syncEndpoint" id="syncEndpoint" type="url" value="${escapeHtml(syncConfig.endpoint || "")}" placeholder="https://script.google.com/macros/s/.../exec" />
          </label>
        </div>
        <div class="sync-actions">
          <button class="ghost" id="diagnoseSyncBtn" type="button" title="웹앱 URL, 연결 키, 스프레드시트의 시트와 제목 상태를 확인합니다.">연결 진단</button>
          <button class="ghost" id="pushSyncBtn" type="button" title="이 브라우저에 있는 현재 데이터를 Google Spreadsheet로 저장합니다.">현재 데이터 올리기</button>
          <button class="ghost" id="pullSyncBtn" type="button" title="Google Spreadsheet에 저장된 데이터를 이 브라우저로 불러옵니다.">스프레드시트에서 가져오기</button>
        </div>
        <ul class="sync-help-list">
          <li><strong>연결 진단</strong>: URL, 연결 키, 스프레드시트 시트와 제목 행이 정상인지 확인합니다.</li>
          <li><strong>현재 데이터 올리기</strong>: 지금 이 화면의 데이터를 스프레드시트에 저장합니다.</li>
          <li><strong>스프레드시트에서 가져오기</strong>: 스프레드시트 데이터를 이 화면으로 불러옵니다.</li>
        </ul>
        <div class="helper" id="syncStatusText">처음 설정 가이드에서 학교용 시트 사본을 만든 뒤, 사본에 포함된 Apps Script를 웹앱으로 배포하면 됩니다.</div>
  `;

  // Firebase(학교 계정) 연결 모드에서는 저장소 연결 설정을 노출하지 않는다.
  // 연결은 학교 계정 시스템이 자동 관리하므로 수동 편집 UI가 불필요.
  const syncConnectionBlock = isFirebaseConnected ? "" : `
      <div class="settings-block">
        <div class="settings-block-head">
          <div>
            <h3>저장소 연결</h3>
            <p class="helper">지금은 로컬 저장을 기본으로 쓰고, Google Apps Script 주소를 넣으면 수동 동기화를 시험할 수 있습니다.</p>
          </div>
          ${syncConfig.lastSyncedAt ? `<span class="badge green">마지막 동기화 ${formatDateTime(syncConfig.lastSyncedAt)}</span>` : `<span class="badge gray">동기화 전</span>`}
        </div>
        ${syncInputsHtml}
      </div>
  `;

  const inviteLinkBlock = isFirebaseConnected ? `
      <div class="settings-block">
        <div class="settings-block-head">
          <div>
            <h3>교사 초대 링크</h3>
            <p class="helper">이 링크를 교사들에게 공유하면 자동으로 우리 학교로 연결됩니다. 학교 내부 메신저로만 공유하세요.</p>
          </div>
        </div>
        <div class="invite-link-area">
          <input type="text" id="inviteLinkInput" readonly class="invite-link-input" value="${escapeHtml(shortCodeUrl)}" />
          <button class="primary compact" id="copyInviteLinkBtn" type="button">링크 복사</button>
          <button class="ghost compact" id="showInviteQrBtn" type="button">QR 보기</button>
        </div>
        <div class="invite-qr-area" id="inviteQrArea" hidden>
          <img id="inviteQrImage" alt="교사용 접속 링크 QR코드" />
          <p class="helper">QR이 보이지 않으면 링크 복사 버튼으로 교사들에게 공유하세요.</p>
        </div>
        <p class="helper" id="inviteLinkHelp">교사들은 이 링크를 즐겨찾기해 두면 편리합니다.</p>
      </div>
  ` : `
      <div class="settings-block">
        <div class="settings-block-head">
          <div>
            <h3>교사 초대 링크</h3>
            <p class="helper">아래 링크를 교사들에게 공유하면 별도 설정 없이 바로 사용할 수 있습니다. 연결 키와 URL이 링크에 포함되어 있으므로 학교 내부 메신저로만 공유하세요.</p>
          </div>
        </div>
        <div class="invite-link-area">
          <input type="text" id="inviteLinkInput" readonly class="invite-link-input" placeholder="저장소 연결을 먼저 설정하세요" />
          <button class="primary compact" id="copyInviteLinkBtn" type="button">링크 복사</button>
          <button class="ghost compact" id="showInviteQrBtn" type="button">QR 보기</button>
        </div>
        <div class="invite-qr-area" id="inviteQrArea" hidden>
          <img id="inviteQrImage" alt="교사용 접속 링크 QR코드" />
          <p class="helper">QR이 보이지 않으면 링크 복사 버튼으로 교사들에게 공유하세요.</p>
        </div>
        <p class="helper" id="inviteLinkHelp">교사들은 이 링크를 매번 사용해 접속하면 됩니다. 즐겨찾기해 두면 편리합니다.</p>
      </div>
  `;

  const syncSectionHtml = syncConnectionBlock + inviteLinkBlock + `
      <div class="settings-block">
        <div class="settings-block-head">
          <div>
            <h3>교구이음 처음 설정 가이드</h3>
            <p class="helper">스프레드시트 사본 만들기부터 교사 초대 링크 발급까지 처음 설정 전 과정을 단계별로 안내합니다.</p>
          </div>
          <a class="ghost compact guide-link" href="./처음설정가이드.html" target="_blank" rel="noopener">가이드 열기</a>
        </div>
      </div>
  `;

  const usagePingSectionHtml = USAGE_REGISTRY_URL ? `
      <div class="settings-block">
        <div class="settings-block-head">
          <div>
            <h3>수집 정보 안내</h3>
            <p class="helper">사용 학교명만 수집됩니다. 개별 학교의 물품·개인정보는 수집되지 않습니다.</p>
          </div>
        </div>
      </div>
  ` : "";

  const bodyHtml = isGlobal
    ? globalSectionsHtml + categorySectionHtml + adminPinSectionHtml + syncSectionHtml + usagePingSectionHtml
    : categorySectionHtml + selfPinSectionHtml;

  const modal = openModal({
    title: isGlobal ? "학교 설정" : "내 실 설정",
    submitText: "저장",
    body: bodyHtml,
    onSubmit: (formData) => {
      // 카테고리 입력값을 현재 보고 있는 실에 반영
      flushPendingCategories(formData);

      if (isGlobal) {
        return submitGlobalSettings(formData);
      }
      return submitLocationAdminSettings(formData);
    },
  });

  function flushPendingCategories(formData) {
    const list = modal.querySelector("#categoryList");
    if (!list) return;
    const loc = list.dataset.currentLocation;
    if (!loc) return;
    const rows = [...list.querySelectorAll(".category-row")];
    const previousNames = (state.categoriesByLocation?.[loc] || []).slice();
    const seen = [];
    const renamePairs = [];
    for (const row of rows) {
      const next = row.querySelector("input").value.trim();
      const oldName = row.dataset.oldCategory || "";
      if (next && !seen.includes(next)) {
        seen.push(next);
        if (oldName && oldName !== next) renamePairs.push([oldName, next]);
      }
    }
    pendingCategoriesByLocation[loc] = seen;
    // 삭제된 카테고리 추적: 이전 이름 중에서 (현재 폼에 그대로 남아 있지도, 이름변경된 결과로 들어가지도 않은 것)
    const stillPresent = new Set(rows.map((r) => r.dataset.oldCategory || "").filter(Boolean));
    const removedHere = previousNames.filter((name) => !stillPresent.has(name));
    pendingDeletedCategoryByLocation[loc] = removedHere;
    pendingDeletedCategoryByLocation[loc + "::renames"] = renamePairs;
  }

  function submitGlobalSettings(formData) {
    const schoolName = formData.get("schoolName").trim();
    if (!schoolName) {
      alert("학교명을 입력하세요.");
      return false;
    }

    const locationRows = [...document.querySelectorAll("#locationList .location-row")];
    const teacherRows = [...document.querySelectorAll("#teacherList .teacher-row")];
    const nextLocations = [];
    const nextTeachers = [];
    const nextLocationManagers = {};
    const renameMap = new Map();
    const teacherRenameMap = new Map();
    const removedLocations = [];
    const removedTeachers = [];

    for (const row of teacherRows) {
      const oldTeacher = row.dataset.oldTeacher || "";
      const nextTeacher = row.querySelector("input").value.trim();
      if (!nextTeacher) {
        alert("교사 이름을 비워둘 수 없습니다.");
        return false;
      }
      if (nextTeachers.includes(nextTeacher)) {
        alert(`교사 이름이 중복되었습니다: ${nextTeacher}`);
        return false;
      }
      nextTeachers.push(nextTeacher);
      if (oldTeacher && oldTeacher !== nextTeacher) teacherRenameMap.set(oldTeacher, nextTeacher);
    }

    for (const oldTeacher of state.teachers) {
      const stillExists = teacherRows.some((row) => row.dataset.oldTeacher === oldTeacher);
      if (!stillExists) removedTeachers.push(oldTeacher);
    }

    const blockedTeacherDelete = removedTeachers.find((teacher) => state.reservations.some((reservation) => reservation.teacher === teacher));
    if (blockedTeacherDelete) {
      alert(`${blockedTeacherDelete} 교사의 예약 기록이 있어 삭제할 수 없습니다. 이름 수정은 가능합니다.`);
      return false;
    }

    for (const row of locationRows) {
      const oldLocation = row.dataset.oldLocation || "";
      const nextLocation = row.querySelector("input").value.trim();
      const managerTeacher = row.querySelector('[name="locationManager"]').value;
      const normalizedManagerTeacher = teacherRenameMap.get(managerTeacher) || managerTeacher;
      const managerPin = row.querySelector('[name="locationManagerPin"]').value.trim();
      if (!nextLocation) {
        alert("물품실 이름을 비워둘 수 없습니다.");
        return false;
      }
      if (nextLocations.includes(nextLocation)) {
        alert(`물품실 이름이 중복되었습니다: ${nextLocation}`);
        return false;
      }
      nextLocations.push(nextLocation);
      if (oldLocation && oldLocation !== nextLocation) renameMap.set(oldLocation, nextLocation);
      if ((normalizedManagerTeacher && !managerPin) || (!normalizedManagerTeacher && managerPin)) {
        alert(`${nextLocation}의 담당자와 담당자 PIN을 함께 입력하세요.`);
        return false;
      }
      if (normalizedManagerTeacher && !nextTeachers.includes(normalizedManagerTeacher)) {
        alert(`${nextLocation} 담당자가 교사 목록에 없습니다.`);
        return false;
      }
      if (normalizedManagerTeacher && managerPin.length < 4) {
        alert(`${nextLocation} 담당자 PIN은 4자리 이상으로 입력하세요.`);
        return false;
      }
      if (normalizedManagerTeacher) nextLocationManagers[nextLocation] = { teacher: normalizedManagerTeacher, pin: managerPin };
    }

    for (const oldLocation of state.locations) {
      const stillExists = locationRows.some((row) => row.dataset.oldLocation === oldLocation);
      if (!stillExists) removedLocations.push(oldLocation);
    }

    const removedLocationItems = state.items.filter((item) => removedLocations.includes(item.location));
    const removedItemIds = new Set(removedLocationItems.map((item) => item.id));
    const removedLocationReservations = state.reservations.filter((reservation) => removedItemIds.has(reservation.itemId));
    if (removedLocationItems.length) {
      const message = [
        `삭제할 물품실: ${removedLocations.join(", ")}`,
        "",
        `이 물품실에 등록된 물품 ${removedLocationItems.length}종이 함께 삭제됩니다.`,
        removedLocationReservations.length ? `연결된 예약·반납 기록 ${removedLocationReservations.length}건도 함께 삭제됩니다.` : "",
        "",
        "그래도 물품실과 해당 물품을 모두 삭제할까요?",
      ].filter(Boolean).join("\n");
      if (!confirm(message)) return false;
    }

    // 카테고리 삭제 검증: 삭제된 카테고리를 사용 중인 물품이 있으면 차단
    const blockedDelete = findCategoryDeletionConflict(pendingDeletedCategoryByLocation, renameMap);
    if (blockedDelete) {
      alert(`'${blockedDelete.category}' 카테고리(${blockedDelete.location})를 쓰는 물품이 ${blockedDelete.count}개 있어 삭제할 수 없습니다. 먼저 다른 카테고리로 바꾸거나 물품을 삭제하세요.`);
      return false;
    }

    // 관리자 PIN 변경은 로컬 모드에서만 노출된다. 학교 계정(Firebase) 모드에서는
    // 비밀번호 변경 섹션이 대신 표시되며 별도 버튼으로 처리한다(아래 changeSchoolPwBtn).
    let shouldChangePin = false;
    if (formData.has("currentAdminPin")) {
      const currentAdminPin = (formData.get("currentAdminPin") || "").trim();
      const nextAdminPin = (formData.get("nextAdminPin") || "").trim();
      const confirmAdminPin = (formData.get("confirmAdminPin") || "").trim();
      shouldChangePin = currentAdminPin || nextAdminPin || confirmAdminPin;
      if (shouldChangePin) {
        if (currentAdminPin !== getAdminPin()) {
          alert("현재 관리자 PIN이 일치하지 않습니다.");
          return false;
        }
        if (nextAdminPin.length < 4) {
          alert("새 PIN은 4자리 이상으로 입력하세요.");
          return false;
        }
        if (nextAdminPin !== confirmAdminPin) {
          alert("새 PIN 확인이 일치하지 않습니다.");
          return false;
        }
        setAdminPin(nextAdminPin);
      }
    }

    state.schoolName = schoolName;
    removedItemIds.forEach((id) => recordDeletion("items", id));
    // 카테고리 이름 변경 propagate: pendingDeletedCategoryByLocation의 키는 옛(현재) 실 이름 기준
    state.items = state.items
      .filter((item) => !removedLocations.includes(item.location))
      .map((item) => {
        const renamePairs = pendingDeletedCategoryByLocation[item.location + "::renames"] || [];
        let newCat = item.category;
        for (const [oldCat, replacementCat] of renamePairs) {
          if (item.category === oldCat) { newCat = replacementCat; break; }
        }
        const newLoc = renameMap.get(item.location) || item.location;
        return { ...item, location: newLoc, category: newCat };
      });
    state.reservations = state.reservations.map((reservation) => ({
      ...reservation,
      teacher: teacherRenameMap.get(reservation.teacher) || reservation.teacher,
    })).filter((reservation) => !removedItemIds.has(reservation.itemId));
    state.locations = nextLocations;
    state.teachers = nextTeachers;
    state.locationManagers = nextLocationManagers;

    // categoriesByLocation 갱신: 키 rename + remove + 카테고리 리스트 적용
    const nextCategoriesByLocation = {};
    Object.entries(pendingCategoriesByLocation).forEach(([loc, list]) => {
      const newLoc = renameMap.get(loc) || loc;
      if (!nextLocations.includes(newLoc)) return;
      nextCategoriesByLocation[newLoc] = (list || []).slice();
    });
    nextLocations.forEach((loc) => {
      if (!Array.isArray(nextCategoriesByLocation[loc])) nextCategoriesByLocation[loc] = [];
    });
    state.categoriesByLocation = nextCategoriesByLocation;

    // 저장소 연결 입력은 로컬 모드에서만 노출된다. Firebase 연결 모드에서는
    // 폼에 해당 필드가 없으므로 syncConfig를 건드리지 않는다(연결은 계정이 관리).
    if (formData.has("syncProvider")) {
      const syncProvider = formData.get("syncProvider") || "local";
      const syncEndpoint = (formData.get("syncEndpoint") || "").trim();
      const syncApiKey = (formData.get("syncApiKey") || "").trim();

      if (syncProvider === "appsScript" && syncEndpoint) {
        if (!syncEndpoint.includes("/macros/s/") || !syncEndpoint.endsWith("/exec")) {
          alert("Apps Script 웹앱 URL 형식이 올바르지 않습니다.\nhttps://script.google.com/macros/s/.../exec 형태인지 확인하세요.\n(라이브러리 URL이나 편집기 주소는 사용할 수 없습니다)");
          return false;
        }
      }

      syncConfig = {
        ...syncConfig,
        provider: syncProvider,
        endpoint: syncEndpoint,
        apiKey: syncApiKey,
        autoSync: formData.get("syncAutoMode") || "manual",
      };
    }

    restartPolling();
    addLog("학교 설정", `학교 설정을 변경했습니다. 학교명: ${schoolName}`, "관리자");
    if (removedLocationItems.length) {
      addLog(
        "물품실 삭제",
        `${removedLocations.join(", ")} 삭제: 물품 ${removedLocationItems.length}건, 예약·반납 ${removedLocationReservations.length}건을 함께 삭제했습니다.`,
        "관리자",
      );
    }
    if (shouldChangePin) addLog("보안 설정", "관리자 PIN을 변경했습니다.", "관리자");
    saveState();
    saveSyncConfig();
    selectedItemId = null;
    selectedReservationId = null;
    render();
    toast("학교 설정이 변경되었습니다.", "success");
    return true;
  }

  function submitLocationAdminSettings(formData) {
    // 본인 실 카테고리 + 본인 PIN만 처리
    if (!myLocations.length) {
      alert("배정된 물품실이 없습니다.");
      return false;
    }

    // 카테고리 삭제 검증 (본인 실에 한함)
    const blockedDelete = findCategoryDeletionConflict(
      Object.fromEntries(Object.entries(pendingDeletedCategoryByLocation).filter(([key]) => myLocations.includes(key) || myLocations.includes(key.replace("::renames", "")))),
      new Map(),
    );
    if (blockedDelete) {
      alert(`'${blockedDelete.category}' 카테고리(${blockedDelete.location})를 쓰는 물품이 ${blockedDelete.count}개 있어 삭제할 수 없습니다. 먼저 다른 카테고리로 바꾸거나 물품을 삭제하세요.`);
      return false;
    }

    // 본인 PIN 변경 처리
    const currentSelfPin = (formData.get("currentSelfPin") || "").trim();
    const nextSelfPin = (formData.get("nextSelfPin") || "").trim();
    const confirmSelfPin = (formData.get("confirmSelfPin") || "").trim();
    const shouldChangeSelfPin = currentSelfPin || nextSelfPin || confirmSelfPin;
    if (shouldChangeSelfPin) {
      const sampleManager = state.locationManagers[myLocations[0]];
      if (!sampleManager || sampleManager.pin !== currentSelfPin) {
        alert("현재 담당자 PIN이 일치하지 않습니다.");
        return false;
      }
      if (nextSelfPin.length < 4) {
        alert("새 담당자 PIN은 4자리 이상으로 입력하세요.");
        return false;
      }
      if (nextSelfPin !== confirmSelfPin) {
        alert("새 PIN 확인이 일치하지 않습니다.");
        return false;
      }
      myLocations.forEach((loc) => {
        if (state.locationManagers[loc]) state.locationManagers[loc].pin = nextSelfPin;
      });
    }

    // 본인 실의 카테고리 이름 변경 propagate
    state.items = state.items.map((item) => {
      if (!myLocations.includes(item.location)) return item;
      const renamePairs = pendingDeletedCategoryByLocation[item.location + "::renames"] || [];
      for (const [oldCat, replacementCat] of renamePairs) {
        if (item.category === oldCat) return { ...item, category: replacementCat };
      }
      return item;
    });

    // 본인 실의 categoriesByLocation 갱신
    const next = { ...(state.categoriesByLocation || {}) };
    myLocations.forEach((loc) => {
      next[loc] = (pendingCategoriesByLocation[loc] || []).slice();
    });
    state.categoriesByLocation = next;

    if (shouldChangeSelfPin) addLog("보안 설정", `${adminScope?.teacher || "담당자"}의 담당자 PIN을 변경했습니다.`, adminScope?.teacher || "담당자");
    addLog("카테고리 설정", `${myLocations.join(", ")} 카테고리를 갱신했습니다.`, adminScope?.teacher || "담당자");
    saveState();
    selectedItemId = null;
    selectedReservationId = null;
    render();
    toast("설정이 저장되었습니다.", "success");
    return true;
  }

  function findCategoryDeletionConflict(deletedMap, renameMap) {
    for (const key of Object.keys(deletedMap)) {
      if (key.endsWith("::renames")) continue;
      const loc = key;
      const removedHere = deletedMap[loc] || [];
      const newLoc = renameMap.get(loc) || loc;
      for (const cat of removedHere) {
        const usingItems = state.items.filter((item) => item.location === loc && item.category === cat);
        if (usingItems.length) {
          return { location: newLoc, category: cat, count: usingItems.length };
        }
      }
    }
    return null;
  }

  const locationList = modal.querySelector("#locationList");
  const teacherList = modal.querySelector("#teacherList");
  const categoryList = modal.querySelector("#categoryList");
  const categoryLocationSelect = modal.querySelector("#categoryLocationSelect");

  function renderCategoryListForLocation(loc) {
    if (!categoryList) return;
    categoryList.dataset.currentLocation = loc;
    const list = pendingCategoriesByLocation[loc] || [];
    categoryList.innerHTML = list.map((category) => `
      <div class="category-row" data-old-category="${escapeHtml(category)}">
        <input name="categoryName" type="text" value="${escapeHtml(category)}" required />
        <button class="ghost compact remove-category-btn" type="button">삭제</button>
      </div>
    `).join("");
  }

  if (categoryList) {
    renderCategoryListForLocation(initialCategoryLocation);
  }

  if (categoryLocationSelect) {
    categoryLocationSelect.addEventListener("change", () => {
      // 현재 폼 입력을 pending에 반영한 뒤 새 실로 전환
      flushPendingCategories();
      renderCategoryListForLocation(categoryLocationSelect.value);
    });
  }

  if (categoryList) {
    const addCategoryBtn = modal.querySelector("#addCategoryBtn");
    if (addCategoryBtn) {
      addCategoryBtn.addEventListener("click", () => {
        const row = document.createElement("div");
        row.className = "category-row";
        row.dataset.oldCategory = "";
        row.innerHTML = `
          <input name="categoryName" type="text" placeholder="새 카테고리" required />
          <button class="ghost compact remove-category-btn" type="button">삭제</button>
        `;
        categoryList.appendChild(row);
        row.querySelector("input").focus();
      });
    }
    categoryList.addEventListener("click", (event) => {
      const button = event.target.closest(".remove-category-btn");
      if (!button) return;
      button.closest(".category-row").remove();
    });
  }

  if (!isGlobal) {
    return; // 실별 담당자 시점에서는 아래 글로벌 전용 핸들러는 등록하지 않음
  }

  function getCurrentTeachersFromForm() {
    return [...teacherList.querySelectorAll(".teacher-row input")].map((inp) => inp.value.trim()).filter(Boolean);
  }

  function rebuildManagerDropdowns() {
    const teachers = getCurrentTeachersFromForm();
    locationList.querySelectorAll('[name="locationManager"]').forEach((select) => {
      const val = select.value;
      select.innerHTML = [
        `<option value="">담당자 없음</option>`,
        ...teachers.map((t) => `<option value="${escapeHtml(t)}" ${t === val ? "selected" : ""}>${escapeHtml(t)}</option>`),
      ].join("");
    });
  }

  function getCurrentLocationsFromForm() {
    const seen = [];
    locationList.querySelectorAll('input[name="locationName"]').forEach((inp) => {
      const v = inp.value.trim();
      if (v && !seen.includes(v)) seen.push(v);
    });
    return seen;
  }

  // 물품실 입력을 카테고리 '실 선택' 드롭다운에 실시간 반영 (저장 전에도 보이도록)
  function rebuildCategoryLocationOptions() {
    if (!categoryLocationSelect) return;
    const locs = getCurrentLocationsFromForm();
    const prev = categoryLocationSelect.value;
    categoryLocationSelect.innerHTML = locs
      .map((loc) => `<option value="${escapeHtml(loc)}">${escapeHtml(loc)}</option>`)
      .join("");
    if (locs.includes(prev)) {
      categoryLocationSelect.value = prev;
    } else {
      // 선택했던 실이 사라짐(이름 변경·삭제) → 첫 실로 전환하고 카테고리 목록 갱신
      const next = locs[0] || "";
      categoryLocationSelect.value = next;
      renderCategoryListForLocation(next);
    }
  }

  modal.querySelector("#addTeacherBtn").addEventListener("click", () => {
    const row = document.createElement("div");
    row.className = "teacher-row";
    row.dataset.oldTeacher = "";
    row.innerHTML = `
      <input name="teacherName" type="text" placeholder="새 교사 이름" required />
      <button class="ghost compact remove-teacher-btn" type="button">삭제</button>
    `;
    teacherList.appendChild(row);
    row.querySelector("input").focus();
  });

  teacherList.addEventListener("input", (event) => {
    if (event.target.name === "teacherName") rebuildManagerDropdowns();
  });

  teacherList.addEventListener("click", (event) => {
    const button = event.target.closest(".remove-teacher-btn");
    if (!button) return;
    const rows = [...teacherList.querySelectorAll(".teacher-row")];
    if (rows.length <= 1) {
      alert("교사는 최소 1명 이상 필요합니다.");
      return;
    }
    button.closest(".teacher-row").remove();
    rebuildManagerDropdowns();
  });

  modal.querySelector("#addLocationBtn").addEventListener("click", () => {
    const teachers = getCurrentTeachersFromForm();
    const dynamicOptions = [
      `<option value="">담당자 없음</option>`,
      ...teachers.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`),
    ].join("");
    const row = document.createElement("div");
    row.className = "location-row";
    row.dataset.oldLocation = "";
    row.innerHTML = `
      <input name="locationName" type="text" placeholder="새 물품실 이름" required />
      <select name="locationManager" title="이 물품실을 관리할 담당자">
        ${dynamicOptions}
      </select>
      <input name="locationManagerPin" type="password" inputmode="numeric" placeholder="담당자 PIN" title="이 물품실 담당자가 관리자 모드에 들어갈 때 쓰는 PIN" />
      <div class="location-row-actions">
        <button class="ghost compact reset-pin-btn" type="button">PIN 초기화</button>
        <button class="ghost compact danger remove-location-btn" type="button">물품실 삭제</button>
      </div>
    `;
    locationList.appendChild(row);
    row.querySelector("input").focus();
  });

  locationList.addEventListener("input", (event) => {
    if (event.target.name === "locationName") rebuildCategoryLocationOptions();
  });

  locationList.addEventListener("click", (event) => {
    if (event.target.closest(".reset-pin-btn")) {
      const row = event.target.closest(".location-row");
      const pinInput = row.querySelector('[name="locationManagerPin"]');
      pinInput.value = "";
      pinInput.focus();
      return;
    }
    const button = event.target.closest(".remove-location-btn");
    if (!button) return;
    const rows = [...locationList.querySelectorAll(".location-row")];
    if (rows.length <= 1) {
      alert("물품실은 최소 1개 이상 필요합니다.");
      return;
    }
    button.closest(".location-row").remove();
    rebuildCategoryLocationOptions();
  });

  // 학교 계정 비밀번호 변경 (Firebase 연결 모드에서만 표시)
  const changeSchoolPwBtn = modal.querySelector("#changeSchoolPwBtn");
  if (changeSchoolPwBtn) {
    const statusEl = modal.querySelector("#changeSchoolPwStatus");
    const setStatus = (msg, ok) => {
      statusEl.textContent = msg;
      statusEl.style.color = ok ? "var(--accent, #5B8A6F)" : "var(--danger, #c0392b)";
    };
    const doChange = async () => {
      const cur = modal.querySelector("#curSchoolPw").value;
      const next = modal.querySelector("#newSchoolPw").value;
      const confirmPw = modal.querySelector("#newSchoolPwConfirm").value;
      if (!cur || !next || !confirmPw) return setStatus("모든 칸을 입력하세요.", false);
      if (next.length < 6) return setStatus("새 비밀번호는 6자 이상이어야 합니다.", false);
      if (next !== confirmPw) return setStatus("새 비밀번호 확인이 일치하지 않습니다.", false);
      if (next === cur) return setStatus("기존 비밀번호와 다른 비밀번호를 입력하세요.", false);
      changeSchoolPwBtn.disabled = true;
      changeSchoolPwBtn.textContent = "변경 중…";
      const result = await window.account?.changeSchoolPassword?.(cur, next);
      changeSchoolPwBtn.disabled = false;
      changeSchoolPwBtn.textContent = "비밀번호 변경";
      if (result?.ok) {
        modal.querySelector("#curSchoolPw").value = "";
        modal.querySelector("#newSchoolPw").value = "";
        modal.querySelector("#newSchoolPwConfirm").value = "";
        setStatus("비밀번호가 변경되었습니다.", true);
      } else {
        setStatus(result?.message || "변경에 실패했습니다.", false);
      }
    };
    changeSchoolPwBtn.addEventListener("click", doChange);
    modal.querySelector("#newSchoolPwConfirm").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); doChange(); }
    });
  }

  // ── 계정 정보 (이메일·담당자·보안질문) 로드 + 저장 ──
  const saveAcctBtn = modal.querySelector("#saveAcctInfoBtn");
  if (saveAcctBtn) {
    const info = window.account?.getAccountInfo?.();
    if (info) {
      modal.querySelector("#acctEmail").value = info.email || "";
      modal.querySelector("#acctContactName").value = info.contactName || "";
      modal.querySelector("#acctContactRole").value = info.contactRole || "";
      modal.querySelector("#acctSecQ").value = info.securityQuestion || "";
      modal.querySelector("#acctSecA").value = info.securityAnswer || "";
    }
    const acctStatus = modal.querySelector("#saveAcctInfoStatus");
    const setAcctStatus = (msg, ok) => {
      acctStatus.textContent = msg;
      acctStatus.style.color = ok ? "var(--accent, #5B8A6F)" : "var(--danger, #c0392b)";
    };
    saveAcctBtn.addEventListener("click", async () => {
      const fields = {
        email: modal.querySelector("#acctEmail").value,
        contactName: modal.querySelector("#acctContactName").value,
        contactRole: modal.querySelector("#acctContactRole").value,
        securityQuestion: modal.querySelector("#acctSecQ").value,
        securityAnswer: modal.querySelector("#acctSecA").value,
      };
      saveAcctBtn.disabled = true;
      saveAcctBtn.textContent = "저장 중…";
      try {
        await window.account?.saveAccountInfo?.(fields);
        setAcctStatus("계정 정보를 저장했습니다.", true);
      } catch (e) {
        setAcctStatus(e?.message || "저장에 실패했습니다.", false);
      } finally {
        saveAcctBtn.disabled = false;
        saveAcctBtn.textContent = "계정 정보 저장";
      }
    });
  }

  modal.querySelector("#diagnoseSyncBtn")?.addEventListener("click", () => runSyncAction(modal, "diagnose"));
  modal.querySelector("#pushSyncBtn")?.addEventListener("click", () => runSyncAction(modal, "save"));
  modal.querySelector("#pullSyncBtn")?.addEventListener("click", () => runSyncAction(modal, "load"));

  modal.querySelector("#showAdvSyncBtn")?.addEventListener("click", (e) => {
    const area = modal.querySelector("#advSyncArea");
    const isOpen = area.style.display !== "none";
    area.style.display = isOpen ? "none" : "block";
    e.currentTarget.textContent = isOpen ? "고급: 연결 정보 직접 수정 ▾" : "고급: 연결 정보 직접 수정 ▴";
  });

  const inviteLinkInput = modal.querySelector("#inviteLinkInput");
  const copyInviteLinkBtn = modal.querySelector("#copyInviteLinkBtn");
  const showInviteQrBtn = modal.querySelector("#showInviteQrBtn");
  const inviteQrArea = modal.querySelector("#inviteQrArea");
  const inviteQrImage = modal.querySelector("#inviteQrImage");
  const inviteLinkHelp = modal.querySelector("#inviteLinkHelp");

  if (isFirebaseConnected) {
    // Firebase 모드: 초대 링크가 이미 input에 세팅돼 있으므로 QR만 초기화
    inviteQrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(shortCodeUrl)}`;
  } else {
    function refreshInviteLink() {
      const endpoint = modal.querySelector("#syncEndpoint").value.trim();
      const apiKey = modal.querySelector("#syncApiKey").value.trim();
      const isValidEndpoint = !endpoint || (endpoint.includes("/macros/s/") && endpoint.endsWith("/exec"));

      if (endpoint && apiKey && isValidEndpoint) {
        const base = window.location.origin + window.location.pathname;
        const params = new URLSearchParams();
        const deploymentId = extractDeploymentId(endpoint);
        if (deploymentId) {
          params.set("d", deploymentId);
        } else {
          params.set("u", endpoint);
        }
        params.set("k", apiKey);
        inviteLinkInput.value = base + "?" + params.toString();
        copyInviteLinkBtn.disabled = false;
        showInviteQrBtn.disabled = false;
        inviteQrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(inviteLinkInput.value)}`;
      } else {
        inviteLinkInput.value = "";
        inviteLinkInput.placeholder = (endpoint && !isValidEndpoint) ? "올바른 웹앱 URL 형식이 아닙니다" : "위의 저장소 연결에서 웹앱 URL과 연결 키를 먼저 입력하세요";
        copyInviteLinkBtn.disabled = true;
        showInviteQrBtn.disabled = true;
        inviteQrArea.hidden = true;
        inviteQrImage.removeAttribute("src");
      }
    }

    refreshInviteLink();
    modal.querySelector("#syncEndpoint").addEventListener("input", refreshInviteLink);
    modal.querySelector("#syncApiKey").addEventListener("input", refreshInviteLink);
  }

  showInviteQrBtn.addEventListener("click", () => {
    if (!inviteLinkInput.value) {
      toast("저장소 연결을 먼저 설정하세요.", "warn");
      return;
    }
    inviteQrArea.hidden = !inviteQrArea.hidden;
  });

  copyInviteLinkBtn.addEventListener("click", () => {
    const link = inviteLinkInput.value;
    if (!link) {
      toast("저장소 연결을 먼저 설정하세요.", "warn");
      return;
    }
    navigator.clipboard.writeText(link).then(() => {
      toast("교사 초대 링크를 클립보드에 복사했습니다.", "success");
      inviteLinkHelp.textContent = "✅ 복사 완료! 카카오톡 등 학교 내부 메신저로 교사들에게 공유하세요.";
    }).catch(() => {
      inviteLinkInput.select();
      document.execCommand("copy");
      toast("링크를 복사했습니다. 붙여넣기로 공유하세요.", "success");
    });
  });
}

function readSyncConfigFromModal(modal) {
  syncConfig = {
    ...syncConfig,
    provider: modal.querySelector("#syncProvider").value,
    endpoint: modal.querySelector("#syncEndpoint").value.trim(),
    apiKey: modal.querySelector("#syncApiKey").value.trim(),
    autoSync: modal.querySelector("#syncAutoMode").value,
  };
  saveSyncConfig();
}

async function runSyncAction(modal, action) {
  readSyncConfigFromModal(modal);
  const statusEl = modal.querySelector("#syncStatusText");

  if (syncConfig.provider !== "appsScript") {
    statusEl.textContent = "저장 방식을 Google Spreadsheet 연동 준비로 바꾼 뒤 다시 시도하세요.";
    return;
  }
  if (!syncConfig.endpoint || !syncConfig.apiKey) {
    statusEl.textContent = "Apps Script 웹앱 URL과 연결 키를 모두 입력하세요.";
    return;
  }
  if (!syncConfig.endpoint.includes("/macros/s/") || !syncConfig.endpoint.endsWith("/exec")) {
    statusEl.textContent = "웹앱 URL 형식이 올바르지 않습니다. (.../exec로 끝나야 합니다)";
    return;
  }
  const labels = { ping: "연결 확인 중", diagnose: "연결 상태 진단 중", save: "현재 데이터 올리는 중", load: "스프레드시트 데이터 가져오는 중" };
  statusEl.innerHTML = `<span class="sync-status-loading"><span class="sync-spinner"></span>${escapeHtml(labels[action])}...</span>`;

  try {
    if (action === "save") await ensureCanPush(statusEl);
    if (action === "load") await ensureCanPull(statusEl);

    const result = await requestSpreadsheet(
      action,
      action === "save" ? { data: state, role: adminMode ? "admin" : "teacher", deletions: state.deletions || [], clientUpdatedAt: state.meta?.updatedAt || "" } : {},
    );

    if (action === "load") {
      applyRemoteState(result, syncConfig.lastRemoteSavedAt || "");
      setHeroLoading(false);
    } else if (action === "save") {
      syncConfig.lastSyncedAt = new Date().toISOString();
      syncConfig.lastCheckedAt = syncConfig.lastSyncedAt;
      syncConfig.lastRemoteSavedAt = result.savedAt || syncConfig.lastRemoteSavedAt || "";
      saveSyncConfig();
    } else {
      markSyncChecked(result.savedAt || result.remoteSavedAt || "");
    }

    const messages = {
      ping: "연결 확인이 끝났습니다.",
      diagnose: "연결 진단이 끝났습니다.",
      save: "현재 데이터를 스프레드시트로 올렸습니다.",
      load: "스프레드시트 데이터를 가져왔습니다.",
    };
    statusEl.innerHTML = action === "diagnose" || action === "ping"
      ? renderSyncDiagnostics(result, messages[action])
      : escapeHtml(messages[action]);
    toast(messages[action], "success");
  } catch (error) {
    statusEl.textContent = `동기화 실패: ${error.message}`;
    toast("동기화에 실패했습니다.", "error");
  }
}

async function requestSpreadsheet(action, payload) {
  const response = await fetch(syncConfig.endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      action,
      apiKey: syncConfig.apiKey,
      ...payload,
    }),
  });
  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error("응답을 JSON으로 읽을 수 없습니다.");
  }
  if (!response.ok || !result.ok) {
    throw new Error(result.error || `HTTP ${response.status}`);
  }
  return result;
}

async function ensureCanPush(statusEl) {
  const remote = await requestSpreadsheet("diagnose", {});
  const remoteSavedAt = remote.savedAt || "";
  markSyncChecked(remoteSavedAt);

  if (isAfter(remoteSavedAt, syncConfig.lastSyncedAt) && isAfter(remoteSavedAt, state.meta?.updatedAt)) {
    const message = "스프레드시트에 이 브라우저보다 새로운 데이터가 있습니다. 먼저 가져오기를 실행하세요.";
    statusEl.textContent = message;
    throw new Error(message);
  }

  if (isAfter(remoteSavedAt, syncConfig.lastSyncedAt) && !confirm("마지막 동기화 이후 스프레드시트도 변경되었습니다. 현재 브라우저 데이터로 덮어쓸까요?")) {
    throw new Error("원격 변경 보호로 올리기를 취소했습니다.");
  }
}

async function ensureCanPull(statusEl) {
  const remote = await requestSpreadsheet("diagnose", {});
  const remoteSavedAt = remote.savedAt || "";
  markSyncChecked(remoteSavedAt);

  if (isAfter(state.meta?.updatedAt, syncConfig.lastSyncedAt) && !confirm("이 브라우저에 아직 올리지 않은 변경이 있습니다. 스프레드시트 데이터로 바꿀까요?")) {
    throw new Error("로컬 변경 보호로 가져오기를 취소했습니다.");
  }

  if (!remoteSavedAt && !confirm("스프레드시트에 저장된 시각이 없습니다. 빈 저장소일 수 있습니다. 그래도 가져올까요?")) {
    throw new Error("빈 저장소 보호로 가져오기를 취소했습니다.");
  }

  statusEl.textContent = "스프레드시트 데이터를 가져오는 중...";
}

function applyRemoteState(result, fallbackRemoteSavedAt = "") {
  if (!result.data) throw new Error("스프레드시트에서 가져올 데이터가 없습니다.");
  state = migrateState(result.data);
  saveState({ touch: false });
  syncConfig.lastSyncedAt = new Date().toISOString();
  syncConfig.lastCheckedAt = syncConfig.lastSyncedAt;
  syncConfig.lastRemoteSavedAt = result.remoteSavedAt || result.data.meta?.updatedAt || fallbackRemoteSavedAt || "";
  saveSyncConfig();
  render();
}

function isAfter(left, right) {
  if (!left) return false;
  if (!right) return true;
  return new Date(left).getTime() > new Date(right).getTime();
}

function canUseRemoteSync() {
  return syncConfig.provider === "appsScript" && Boolean(syncConfig.endpoint && syncConfig.apiKey);
}

function scheduleAutoPush() {
  if (!canUseRemoteSync() || syncConfig.autoSync !== "pushAfterSave") return;
  clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(autoPushState, 1200);
}

async function autoPushState() {
  if (autoSyncInFlight || !canUseRemoteSync() || syncConfig.autoSync !== "pushAfterSave") return;
  autoSyncInFlight = true;
  try {
    // 서버가 role(admin/teacher)에 따라 id 기준으로 안전하게 병합한다.
    // → 원격이 더 새롭더라도 내 변경분이 남의 것을 덮어쓰지 않으므로 그대로 올린다.
    //   (예전엔 여기서 '원격이 더 새로움'을 만나면 멈춰서 영영 동기화가 막혔다.)
    const result = await requestSpreadsheet("save", {
      data: state,
      role: adminMode ? "admin" : "teacher",
      deletions: state.deletions || [],
      clientUpdatedAt: state.meta?.updatedAt || "",
    });
    syncConfig.lastSyncedAt = new Date().toISOString();
    syncConfig.lastCheckedAt = syncConfig.lastSyncedAt;
    syncConfig.lastRemoteSavedAt = result.savedAt || syncConfig.lastRemoteSavedAt || "";
    saveSyncConfig();
  } catch (error) {
    // 네트워크 오류 등은 다음 변경/폴링 때 다시 시도된다(토스트 폭주 방지를 위해 조용히).
  } finally {
    autoSyncInFlight = false;
  }
}

async function runStartupSync() {
  if (!canUseRemoteSync()) return;
  // 학교명만으로는 판단하지 않는다. ?s= 링크 연결 직후 syncConfig.schoolName이
  // state.schoolName으로 복사되므로(line 41-43), 학교명 유무로 빈 상태를 판단하면
  // 교사용 첫 접속에서 전체 로드를 건너뛰어 교사·물품이 0개로 보인다.
  // 로컬에 실제 데이터(교사·물품·예약·구입요청)가 하나도 없으면 무조건 전체 로드한다.
  // (과거 diagnose로 lastSyncedAt만 찍히고 데이터는 비어 있는 경우도 포함)
  const hasLocalContent = Boolean(
    state.teachers?.length || state.items?.length
    || state.reservations?.length || state.purchaseRequests?.length,
  );
  const isEmptyLocal = !hasLocalContent;
  if (syncConfig.autoSync !== "pullOnStart" && syncConfig.autoSync !== "pushAfterSave") return;

  try {
    if (isEmptyLocal) {
      setHeroLoading(true);
      if (els.heroTitle) els.heroTitle.textContent = "데이터를 불러오고 있어요...";
      if (els.heroSub) els.heroSub.textContent = "스프레드시트에 연결 중입니다. 잠시만 기다려주세요.";
      
      const result = await requestSpreadsheet("load", {});
      applyRemoteState(result);
      setHeroLoading(false);
      toast("초기 데이터를 성공적으로 불러왔습니다.", "success");
      return;
    }

    const remote = await requestSpreadsheet("diagnose", {});
    const remoteSavedAt = remote.savedAt || "";
    const previousRemoteSavedAt = syncConfig.lastRemoteSavedAt;
    markSyncChecked(remoteSavedAt);
    const hasRemoteChanges = remoteSavedAt && remoteSavedAt !== previousRemoteSavedAt;

    if (!hasRemoteChanges) return;

    if (isAfter(state.meta?.updatedAt, syncConfig.lastSyncedAt)) {
      toast("로컬 변경이 있어 시작 동기화를 건너뛰었습니다.", "warn");
      return;
    }

    const result = await requestSpreadsheet("load", {});
    applyRemoteState(result, remoteSavedAt);
    toast("스프레드시트의 최신 데이터를 불러왔습니다.", "success");
  } catch (error) {
    toast(`시작 동기화 실패: ${error.message}`, "error");
    setHeroLoading(false);
    if (isEmptyLocal) render();
  }
}

async function finalizeSetupAfterLink() {
  if (!justConnectedViaLink) return;
  if (!canUseRemoteSync()) return;
  justConnectedViaLink = false;

  await pushLocalToRemoteIfEmpty();

  // 관리자가 마법사에서 링크 단계까지 진행한 상태라면 완료 화면을 띄운다
  if (setupState.awaitingLinkConnect && adminMode) {
    setupState.awaitingLinkConnect = false;
    saveSetupState();
    openSetupCompleteModal();
  }
}

// 로컬에 학교 데이터가 있는데 원격 스프레드시트가 비어 있으면(한 번도 안 올림) 즉시 업로드한다.
// 관리자가 만든 교사·물품이 원격에 올라가야 교사용 ?s= 화면에서 보인다.
// 원격에 이미 저장된 데이터가 있으면(savedAt 존재) 충돌 보호를 위해 덮어쓰지 않는다.
async function pushLocalToRemoteIfEmpty() {
  if (!canUseRemoteSync()) return;
  const hasLocalData = Boolean(
    state.schoolName?.trim() || state.teachers?.length || state.items?.length,
  );
  if (!hasLocalData) return;
  try {
    const remote = await requestSpreadsheet("diagnose", {});
    const remoteSavedAt = remote.savedAt || "";
    markSyncChecked(remoteSavedAt);
    if (remoteSavedAt) return; // 원격에 이미 데이터 있음 → 보호
    const result = await requestSpreadsheet("save", {
      data: state,
      role: adminMode ? "admin" : "teacher",
      deletions: state.deletions || [],
      clientUpdatedAt: state.meta?.updatedAt || "",
    });
    syncConfig.lastSyncedAt = new Date().toISOString();
    syncConfig.lastCheckedAt = syncConfig.lastSyncedAt;
    syncConfig.lastRemoteSavedAt = result.savedAt || "";
    saveSyncConfig();
    toast("학교 데이터를 스프레드시트에 올렸습니다. 이제 교사용 주소에서도 보입니다.", "success");
  } catch (error) {
    // 진단/저장 실패 시 조용히 통과 (다음 기회에 재시도)
  }
}

// 학교 관리자(인증된 소유자) 로그인이 확인되면 호출.
// 관리자는 항상 쓰기 모드(pushAfterSave)여야 하며, 이전에 pullOnStart로 잘못 설정돼
// 데이터가 원격에 안 올라간 상태도 여기서 자동 복구한다.
window.ensureOwnerWriteMode = async function () {
  if (!canUseRemoteSync()) return;
  if (syncConfig.autoSync !== "pushAfterSave") {
    syncConfig.autoSync = "pushAfterSave";
    saveSyncConfig();
    startPolling();
  }
  await pushLocalToRemoteIfEmpty();
};

function isPollingEnabled() {
  return canUseRemoteSync() && (syncConfig.autoSync === "pushAfterSave" || syncConfig.autoSync === "pullOnStart");
}

function startPolling() {
  stopPolling();
  if (!isPollingEnabled()) return;
  if (document.hidden) return;
  pollingTimer = setInterval(pullRemoteState, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

function restartPolling() {
  startPolling();
}

function handleVisibilityChange() {
  if (document.hidden) {
    stopPolling();
    return;
  }
  if (!isPollingEnabled()) return;
  pullRemoteState();
  startPolling();
}

async function pullRemoteState() {
  if (pollingInFlight || autoSyncInFlight) return;
  if (!canUseRemoteSync()) return;
  if (document.hidden) return;
  pollingInFlight = true;
  try {
    const remote = await requestSpreadsheet("diagnose", {});
    const remoteSavedAt = remote.savedAt || "";
    const previousRemoteSavedAt = syncConfig.lastRemoteSavedAt;
    markSyncChecked(remoteSavedAt);
    if (!remoteSavedAt) return;
    if (remoteSavedAt === previousRemoteSavedAt) return;
    if (isAfter(state.meta?.updatedAt, syncConfig.lastSyncedAt)) return;

    const result = await requestSpreadsheet("load", {});
    applyRemoteState(result, remoteSavedAt);
  } catch (error) {
    // 네트워크 오류 등은 토스트 폭주 방지를 위해 조용히 무시
  } finally {
    pollingInFlight = false;
  }
}

function renderSyncDiagnostics(result, title) {
  const sheets = result.sheets || {};
  const sheetRows = Object.entries(sheets)
    .map(([sheetName, info]) => `
      <tr>
        <td>${escapeHtml(sheetName)}</td>
        <td>${info.exists ? statusBadge("사용 가능") : statusBadge("비활성")}</td>
        <td>${Number(info.rows || 0)}</td>
        <td>${info.headersOk ? statusBadge("정상") : statusBadge("확인 필요")}</td>
      </tr>
    `)
    .join("");

  return `
    <div class="sync-diagnostics">
      <strong>${escapeHtml(title)}</strong>
      <dl>
        <div><dt>스크립트 버전</dt><dd>${escapeHtml(result.scriptVersion || "-")}</dd></div>
        <div><dt>스프레드시트</dt><dd>${escapeHtml(result.spreadsheetName || result.spreadsheetId || "-")}</dd></div>
        <div><dt>저장된 학교명</dt><dd>${escapeHtml(result.schoolName || "-")}</dd></div>
        <div><dt>마지막 저장</dt><dd>${result.savedAt ? formatDateTime(result.savedAt) : "-"}</dd></div>
        <div><dt>이 브라우저 변경</dt><dd>${state.meta?.updatedAt ? formatDateTime(state.meta.updatedAt) : "-"}</dd></div>
        <div><dt>자동 동기화</dt><dd>${escapeHtml(getAutoSyncLabel(syncConfig.autoSync))}</dd></div>
      </dl>
      ${sheetRows ? `
        <div class="table-wrap compact-table">
          <table>
            <thead>
              <tr>
                <th>시트</th>
                <th>상태</th>
                <th>행</th>
                <th>제목</th>
              </tr>
            </thead>
            <tbody>${sheetRows}</tbody>
          </table>
        </div>
      ` : ""}
    </div>
  `;
}

function getAutoSyncLabel(mode) {
  return {
    manual: "수동으로만 실행",
    pullOnStart: "앱 시작 시 원격 데이터 확인",
    pushAfterSave: "저장 후 원격에 자동 올리기",
  }[mode] || "수동으로만 실행";
}

function openItemModal(item = null) {
  if (!adminMode) return;
  if (item && !canManageLocation(item.location)) {
    alert("이 물품실의 물품을 수정할 권한이 없습니다.");
    return;
  }
  // 새 물품 추가 시에는 현재 선택한 물품실을 보관 장소 기본값으로 쓴다(관리 권한 있는 경우).
  // '전체'(빈 값) 선택이거나 권한 없는 물품실이면 담당 물품실 중 첫 번째로 보정한다.
  const selectedLocation = els.locationFilter?.value || "";
  const defaultLocation = item?.location
    || (selectedLocation && canManageLocation(selectedLocation) ? selectedLocation : "")
    || getAccessibleLocations()[0] || state.locations[0] || "";
  const currentCategory = item?.category || "";
  const getCategoryOptionsFor = (loc) => [...new Set((state.categoriesByLocation?.[loc] || []))].filter(Boolean);
  let categoryOptions = getCategoryOptionsFor(defaultLocation);
  const usesCustomCategory = Boolean(currentCategory) && !categoryOptions.includes(currentCategory);

  const modal = openModal({
    title: item ? "물품 수정" : "새 물품 등록",
    submitText: "저장",
    body: `
      <div class="field-grid">
        ${field("물품명", "name", item?.name || "", true)}
        ${field("규격", "spec", item?.spec || "", false, "text", "예) 5호, 250mm, 1.5L")}
        <label class="field">
          <span>카테고리</span>
          <div class="category-field-wrap">
            <select name="categorySelect" id="categorySelect">
              <option value="">선택 안 함</option>
              ${categoryOptions.map((category) => `<option value="${escapeHtml(category)}" ${currentCategory === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}
              <option value="__custom__" ${usesCustomCategory ? "selected" : ""}>직접 입력</option>
            </select>
            <button class="ghost compact" id="addCategoryOptionBtn" type="button">추가</button>
          </div>
          <input name="categoryCustom" id="categoryCustom" type="text" value="${escapeHtml(usesCustomCategory ? currentCategory : "")}" placeholder="새 카테고리 입력" ${usesCustomCategory ? "" : "hidden"} />
        </label>
        <label class="field">
          <span>보관 장소</span>
          <select name="location" required>
            ${getAccessibleLocations().map((loc) => `<option value="${escapeHtml(loc)}" ${loc === defaultLocation ? "selected" : ""}>${escapeHtml(loc)}</option>`).join("")}
          </select>
        </label>
        <div class="field-3col">
          ${field("총 수량", "total", item?.total || 1, true, "number")}
          ${field("단위", "unit", item?.unit || "개")}
          <label class="field">
            <span>관리 번호</span>
            <div class="code-field-wrap">
              <input name="code" type="text" value="${escapeHtml(item?.code || "")}" placeholder="예) PE-001" />
              <button class="ghost compact" id="autoCodeBtn" type="button">자동 생성</button>
            </div>
          </label>
        </div>
        ${field("구입일", "purchasedAt", item?.purchasedAt || new Intl.DateTimeFormat("sv-SE", { timeZone: KOREA_TIME_ZONE }).format(new Date()), false, "date")}
        <label class="field">
          <span>구입 금액</span>
          <input name="price" type="text" inputmode="numeric" value="${item?.price ? Number(item.price).toLocaleString() : ""}" placeholder="예) 50,000" />
        </label>
        <label class="field">
          <span>상태</span>
          <select name="status">
            ${["사용 가능", "수리 필요", "파손", "분실", "폐기", "비활성"]
              .map((status) => `<option ${(item?.status || "사용 가능") === status ? "selected" : ""}>${status}</option>`)
              .join("")}
          </select>
        </label>
        <label class="field">
          <span>소모품 여부</span>
          <select name="consumable">
            <option value="true" ${item ? (item.consumable ? "selected" : "") : "selected"}>소모품</option>
            <option value="false" ${item && !item.consumable ? "selected" : ""}>비품</option>
          </select>
        </label>
        <label class="field full">
          <span>비고</span>
          <textarea name="note">${escapeHtml(item?.note || "")}</textarea>
        </label>
      </div>
    `,
    onSubmit: (formData) => {
      const selectedCategory = formData.get("categorySelect") || "";
      const category = selectedCategory === "__custom__"
        ? formData.get("categoryCustom").trim()
        : selectedCategory.trim();
      const payload = {
        id: item?.id || createId("item"),
        name: formData.get("name").trim(),
        spec: formData.get("spec").trim(),
        category,
        location: formData.get("location").trim(),
        total: Number(formData.get("total")),
        unit: formData.get("unit").trim() || "개",
        consumable: formData.get("consumable") === "true",
        code: formData.get("code").trim(),
        purchasedAt: formData.get("purchasedAt"),
        price: Number(String(formData.get("price") || "").replace(/[^\d.]/g, "")) || 0,
        damaged: item?.damaged || 0,
        lost: item?.lost || 0,
        disposed: item?.disposed || 0,
        status: formData.get("status"),
        note: formData.get("note").trim(),
        acquisitions: item?.acquisitions || [],
      };

      if (!payload.name || !payload.location || payload.total < 0) {
        alert("물품명, 보관 장소, 총 수량을 확인하세요.");
        return false;
      }
      if (!canManageLocation(payload.location)) {
        alert("담당 물품실에만 물품을 등록하거나 수정할 수 있습니다.");
        return false;
      }

      if (isGlobalAdmin() && !state.locations.includes(payload.location)) state.locations.push(payload.location);
      state.categoriesByLocation = state.categoriesByLocation || {};
      if (!Array.isArray(state.categoriesByLocation[payload.location])) state.categoriesByLocation[payload.location] = [];
      if (payload.category && !state.categoriesByLocation[payload.location].includes(payload.category)) {
        state.categoriesByLocation[payload.location].push(payload.category);
      }

      if (item) {
        state.items = state.items.map((row) => (row.id === item.id ? payload : row));
        addLog("물품 수정", `${payload.name} 정보를 수정했습니다.`, "관리자", payload.id);
      } else {
        const duplicate = state.items.find((i) => i.name === payload.name && i.location === payload.location);
        if (duplicate) {
          openDuplicateItemChoiceModal({ payload, duplicate, itemModal: modal });
          return false;
        }
        addNewItem(payload);
      }
      saveState();
      selectedItemId = payload.id;
      render();
      return true;
    },
  });

  const categorySelect = modal.querySelector("#categorySelect");
  const categoryCustom = modal.querySelector("#categoryCustom");
  const addCategoryOptionBtn = modal.querySelector("#addCategoryOptionBtn");

  function setCategoryValue(value = "") {
    const normalized = String(value || "").trim();
    if (!normalized) {
      categorySelect.value = "";
      categoryCustom.value = "";
      categoryCustom.hidden = true;
      return;
    }
    if ([...categorySelect.options].some((option) => option.value === normalized)) {
      categorySelect.value = normalized;
      categoryCustom.value = "";
      categoryCustom.hidden = true;
      return;
    }
    categorySelect.value = "__custom__";
    categoryCustom.value = normalized;
    categoryCustom.hidden = false;
  }

  categorySelect.addEventListener("change", () => {
    categoryCustom.hidden = categorySelect.value !== "__custom__";
    if (!categoryCustom.hidden) categoryCustom.focus();
    if (categoryCustom.hidden) categoryCustom.value = "";
  });

  addCategoryOptionBtn.addEventListener("click", () => {
    const nextCategory = prompt("추가할 카테고리 이름을 입력하세요.");
    const normalized = String(nextCategory || "").trim();
    if (!normalized) return;
    const currentLocation = modal.querySelector('[name="location"]').value.trim();
    if (!currentLocation) {
      alert("보관 장소를 먼저 입력하세요. 카테고리는 실별로 따로 관리됩니다.");
      return;
    }
    state.categoriesByLocation = state.categoriesByLocation || {};
    if (!Array.isArray(state.categoriesByLocation[currentLocation])) state.categoriesByLocation[currentLocation] = [];
    if (!state.categoriesByLocation[currentLocation].includes(normalized)) {
      state.categoriesByLocation[currentLocation].push(normalized);
      const option = document.createElement("option");
      option.value = normalized;
      option.textContent = normalized;
      categorySelect.insertBefore(option, categorySelect.querySelector('option[value="__custom__"]'));
      saveState();
    }
    setCategoryValue(normalized);
  });

  function refreshCategorySelectForLocation(loc) {
    const previousValue = categorySelect.value === "__custom__" ? categoryCustom.value.trim() : categorySelect.value;
    const opts = getCategoryOptionsFor(loc);
    categorySelect.innerHTML = [
      `<option value="">선택 안 함</option>`,
      ...opts.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`),
      `<option value="__custom__">직접 입력</option>`,
    ].join("");
    if (previousValue && opts.includes(previousValue)) {
      categorySelect.value = previousValue;
      categoryCustom.hidden = true;
      categoryCustom.value = "";
    } else {
      categorySelect.value = "";
      categoryCustom.hidden = true;
      categoryCustom.value = "";
      if (previousValue) toast(`'${previousValue}' 카테고리가 ${loc}에 없어 비웠습니다. 새로 선택하거나 직접 입력하세요.`, "warn");
    }
  }

  const locationInput = modal.querySelector('[name="location"]');
  locationInput.addEventListener("change", () => refreshCategorySelectForLocation(locationInput.value.trim()));
  locationInput.addEventListener("blur", () => refreshCategorySelectForLocation(locationInput.value.trim()));

  // 구입 금액 입력 시 세 자리마다 콤마 자동 표시 (커서 위치 유지)
  const priceInput = modal.querySelector('[name="price"]');
  if (priceInput) {
    priceInput.addEventListener("input", () => {
      const caretFromEnd = priceInput.value.length - (priceInput.selectionStart ?? priceInput.value.length);
      const digits = priceInput.value.replace(/[^\d]/g, "");
      priceInput.value = digits ? Number(digits).toLocaleString() : "";
      const pos = Math.max(0, priceInput.value.length - caretFromEnd);
      priceInput.setSelectionRange(pos, pos);
    });
  }

  if (state.items.length > 0) {
    const nameInput = modal.querySelector('[name="name"]');
    const dropdown = document.createElement("div");
    dropdown.className = "name-autocomplete-dropdown";
    dropdown.hidden = true;
    nameInput.closest(".field").appendChild(dropdown);

    function fillFromSource(source) {
      modal.querySelector('[name="location"]').value = source.location || "";
      refreshCategorySelectForLocation(source.location || "");
      setCategoryValue(source.category || "");
      modal.querySelector('[name="unit"]').value = source.unit || "개";
      modal.querySelector('[name="code"]').value = source.code || "";
      modal.querySelector('[name="purchasedAt"]').value = source.purchasedAt || "";
      modal.querySelector('[name="price"]').value = source.price ? Number(source.price).toLocaleString() : "";
      modal.querySelector('[name="status"]').value = source.status || "사용 가능";
      modal.querySelector('[name="consumable"]').value = String(source.consumable || false);
      modal.querySelector('[name="note"]').value = source.note || "";
    }

    nameInput.addEventListener("input", () => {
      const query = nameInput.value.trim().toLowerCase();
      if (!query) { dropdown.hidden = true; return; }
      const matches = state.items.filter((i) => i.name.toLowerCase().includes(query)).slice(0, 8);
      if (!matches.length) { dropdown.hidden = true; return; }
      dropdown.innerHTML = matches.map((i) => `
        <div class="autocomplete-item" data-id="${escapeHtml(i.id)}">
          <span class="autocomplete-name">${escapeHtml(i.name)}</span>
          <span class="autocomplete-meta">${escapeHtml(i.location)}${i.category ? " · " + escapeHtml(i.category) : ""}</span>
        </div>
      `).join("");
      dropdown.hidden = false;
    });

    dropdown.addEventListener("mousedown", (e) => {
      const itemEl = e.target.closest(".autocomplete-item");
      if (!itemEl) return;
      e.preventDefault();
      const source = state.items.find((i) => i.id === itemEl.dataset.id);
      if (!source) return;
      nameInput.value = source.name;
      fillFromSource(source);
      dropdown.hidden = true;
    });

    nameInput.addEventListener("blur", () => { setTimeout(() => { dropdown.hidden = true; }, 150); });
    nameInput.addEventListener("keydown", (e) => { if (e.key === "Escape") dropdown.hidden = true; });
  }

  modal.querySelector("#autoCodeBtn").addEventListener("click", () => {
    const locationVal = modal.querySelector('[name="location"]').value.trim();
    if (!locationVal) { toast("보관 장소를 먼저 입력하세요.", "warn"); return; }
    const codeInput = modal.querySelector('[name="code"]');
    const next = generateNextCode(locationVal);
    if (next) codeInput.value = next;
    else toast("기존 관리 번호 패턴을 찾을 수 없습니다. 직접 입력해 주세요.", "warn");
  });
}

function openPurchaseRequestModal(prefill = {}) {
  if (!isValidTeacherSelection()) {
    alert("먼저 사용 교사를 선택하세요.");
    return;
  }

  const locationOptions = state.locations || [];
  const selectedLocation = prefill.location || els.locationFilter.value || "";
  const getCategoryOptionsFor = (loc) => loc ? [...new Set((state.categoriesByLocation?.[loc] || []))].filter(Boolean) : [];
  const initialCategoryOptions = getCategoryOptionsFor(selectedLocation);

  // 추가 구입 대상으로 선택된 기존 물품 id (null이면 신규 구입)
  let relatedItemId = prefill.relatedItemId || null;

  const modal = openModal({
    title: "구입 요청",
    submitText: "요청 보내기",
    body: `
      <div class="purchase-modal-layout">
        <div class="purchase-modal-left field-grid">
          <label class="field full">
            <span>요청 물품명</span>
            <input type="text" name="itemName" required autocomplete="off"
                   placeholder="예) 배드민턴 네트" value="${escapeHtml(prefill.itemName || "")}" />
          </label>
          <label class="field full">
            <span>희망 물품실 <em class="req-mark">*</em></span>
            <select name="location" id="purchaseLocationSelect" required>
              <option value="">선택</option>
              ${locationOptions.map((location) => `<option value="${escapeHtml(location)}" ${location === selectedLocation ? "selected" : ""}>${escapeHtml(location)}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="purchase-search-zone" id="purchaseSearchZone" aria-live="polite">
          <p class="purchase-search-zone-title">검색 결과</p>
          <div class="purchase-search-zone-body"></div>
        </div>
      </div>
      <div class="field-grid">
        <label class="field">
          <span>카테고리</span>
          <select name="category" id="purchaseCategorySelect" ${selectedLocation ? "" : "disabled"}>
            <option value="">${selectedLocation ? "선택 안 함" : "희망 물품실을 먼저 고르세요"}</option>
            ${initialCategoryOptions.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}
          </select>
        </label>
        ${field("희망 수량", "quantity", prefill.quantity || 1, true, "number")}
        <label class="field full">
          <span>구입 요청 이유</span>
          <textarea name="note" required placeholder="예) 과학 3학년 1학기 2단원 수업 준비물"></textarea>
        </label>
        <label class="field full">
          <span>참고 사이트 (선택)</span>
          <input type="url" name="referenceUrl" placeholder="예) https://... 구매 가능한 상품 링크" />
        </label>
      </div>
    `,
    onSubmit: (formData) => {
      const itemName = (formData.get("itemName") || "").trim();
      const quantity = Number(formData.get("quantity") || 1);
      const note = (formData.get("note") || "").trim();
      const location = (formData.get("location") || "").trim();
      const referenceUrl = (formData.get("referenceUrl") || "").trim();
      if (!itemName || quantity <= 0 || !note) {
        alert("요청 물품명, 희망 수량, 구입 요청 이유를 확인하세요.");
        return false;
      }
      if (!location) {
        alert("희망 물품실을 반드시 선택하세요.\n그래야 해당 물품실 담당자에게 요청이 전달됩니다.");
        return false;
      }

      const request = {
        id: createId("purchase"),
        itemName,
        category: (formData.get("category") || "").trim(),
        quantity,
        location,
        requester: els.teacherSelect.value,
        note,
        referenceUrl,
        type: relatedItemId ? "추가 구입" : "신규 구입",
        relatedItemId: relatedItemId || "",
        status: "요청됨",
        createdAt: new Date().toISOString(),
        updatedAt: "",
      };

      state.purchaseRequests = state.purchaseRequests || [];
      state.purchaseRequests.push(request);
      if (request.location && request.category) {
        state.categoriesByLocation = state.categoriesByLocation || {};
        if (!Array.isArray(state.categoriesByLocation[request.location])) state.categoriesByLocation[request.location] = [];
        if (!state.categoriesByLocation[request.location].includes(request.category)) {
          state.categoriesByLocation[request.location].push(request.category);
        }
      }
      const typeLabel = request.type;
      addLog("구입 요청", `${request.requester} 교사가 ${request.itemName} ${typeLabel}을(를) 요청했습니다.`, request.requester);
      saveState();
      render();
      toast("구입 요청을 보냈습니다.", "success");
      return true;
    },
  });

  const itemNameInput = modal.querySelector('input[name="itemName"]');
  const locationSelect = modal.querySelector("#purchaseLocationSelect");
  const categorySelect = modal.querySelector("#purchaseCategorySelect");
  const searchBody = modal.querySelector("#purchaseSearchZone .purchase-search-zone-body");

  function refreshCategoryOptions(loc, keepValue = "") {
    const opts = getCategoryOptionsFor(loc);
    categorySelect.innerHTML = [
      `<option value="">${loc ? "선택 안 함" : "희망 물품실을 먼저 고르세요"}</option>`,
      ...opts.map((c) => `<option value="${escapeHtml(c)}" ${c === keepValue ? "selected" : ""}>${escapeHtml(c)}</option>`),
    ].join("");
    categorySelect.disabled = !loc;
  }

  function selectExistingItem(item) {
    relatedItemId = item.id;
    itemNameInput.value = item.name;
    if (item.location && locationOptions.includes(item.location)) {
      locationSelect.value = item.location;
      refreshCategoryOptions(item.location, item.category || "");
    }
    // 카테고리 자동 입력: 목록에 없으면 옵션 추가 후 선택
    if (item.category) {
      const cat = item.category;
      if (![...categorySelect.options].some((o) => o.value === cat)) {
        const opt = document.createElement("option");
        opt.value = cat;
        opt.textContent = cat;
        categorySelect.appendChild(opt);
      }
      categorySelect.value = cat;
      categorySelect.disabled = false;
    }
    renderSearch();
  }

  function renderSearch() {
    // 추가 구입 대상이 선택된 상태 → 안내 배너
    if (relatedItemId) {
      const it = state.items.find((i) => i.id === relatedItemId);
      searchBody.innerHTML = it ? `
        <div class="purchase-search-note is-selected">
          <span>➕ <strong>추가 구입</strong> · ${escapeHtml(it.name)}${it.spec ? ` <span class="purchase-search-spec">${escapeHtml(it.spec)}</span>` : ""} · ${escapeHtml(it.location)} · 현재 보유 ${it.total}${escapeHtml(it.unit || "개")}</span>
          <button type="button" class="ghost compact" id="purchaseClearRelated">신규로 변경</button>
        </div>` : "";
      modal.querySelector("#purchaseClearRelated")?.addEventListener("click", () => {
        relatedItemId = null;
        renderSearch();
      });
      return;
    }

    const q = itemNameInput.value.trim().toLowerCase();
    if (!q) {
      searchBody.innerHTML = `<p class="purchase-search-empty">물품명을 입력하면 등록된 물품을 자동으로 찾아드려요.</p>`;
      return;
    }

    const matches = (state.items || [])
      .filter((i) => (i.name || "").toLowerCase().includes(q))
      .slice(0, 5);

    if (!matches.length) {
      searchBody.innerHTML = `<p class="purchase-search-empty">일치하는 물품이 없어요 — <strong>신규 구입</strong>으로 요청됩니다.</p>`;
      return;
    }

    searchBody.innerHTML = `
      <p class="helper" style="margin-bottom:6px;">수량이 부족하면 ‘추가 구입’으로 요청하세요.</p>
      ${matches.map((i) => `
        <div class="purchase-search-row">
          <span>
            <strong>${escapeHtml(i.name)}</strong>${i.spec ? ` <span class="purchase-search-spec">${escapeHtml(i.spec)}</span>` : ""}
            · ${escapeHtml(i.location)} · 보유 ${i.total}${escapeHtml(i.unit || "개")}
          </span>
          <button type="button" class="ghost compact" data-add-existing="${escapeHtml(i.id)}">추가 구입</button>
        </div>`).join("")}`;
    searchBody.querySelectorAll("[data-add-existing]").forEach((b) => {
      b.addEventListener("click", () => {
        const it = (state.items || []).find((i) => i.id === b.dataset.addExisting);
        if (it) selectExistingItem(it);
      });
    });
  }

  itemNameInput.addEventListener("input", () => {
    if (relatedItemId) relatedItemId = null; // 이름을 직접 고치면 추가구입 해제
    renderSearch();
  });
  locationSelect.addEventListener("change", () => refreshCategoryOptions(locationSelect.value));

  renderSearch();
}

function openPurchaseRequestReviewModal(requestId) {
  const request = state.purchaseRequests.find((row) => row.id === requestId);
  if (!request || !canManagePurchaseRequest(request)) return;

  const modal = openModal({
    title: "구입 요청 검토",
    submitText: "저장",
    body: `
      <div class="detail-card">
        <h3>${escapeHtml(request.itemName || "-")}</h3>
        <p class="helper">${escapeHtml(request.requester || "-")} · ${request.createdAt ? formatDateTime(request.createdAt) : "-"}</p>
        <ul>
          <li>구분: ${escapeHtml(request.type || "신규 구입")}</li>
          <li>카테고리: ${escapeHtml(request.category || "-")}</li>
          <li>희망 수량: ${Number(request.quantity || 1)}</li>
          <li>희망 물품실: ${escapeHtml(request.location || "-")}</li>
          <li>메모: ${escapeHtml(request.note || "-")}</li>
          ${request.referenceUrl ? `<li>참고 사이트: ${purchaseRefLink(request.referenceUrl).replace(/^<br \/>/, "")}</li>` : ""}
        </ul>
      </div>
      <div class="field-grid">
        <label class="field">
          <span>검토 상태</span>
          <select name="status">
            ${getPurchaseRequestStatuses().map((status) => `<option ${request.status === status ? "selected" : ""}>${status}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="modal-actions-inline">
        <button class="danger compact" id="deletePurchaseRequestBtn" type="button">이 요청 삭제</button>
      </div>
    `,
    onSubmit: (formData) => {
      const status = formData.get("status");
      setPurchaseRequestStatus(request.id, status);
      renderPurchaseRequestsView();
      toast("구입 요청 상태를 저장했습니다.", "success");
      return true;
    },
  });
  modal.querySelector("#deletePurchaseRequestBtn")?.addEventListener("click", () => {
    if (!confirm(`${request.itemName || "구입 요청"} 요청을 삭제할까요?\n삭제한 요청은 되돌릴 수 없습니다.`)) return;
    deletePurchaseRequests([request.id]);
    modal.remove();
    renderPurchaseRequestsView();
    toast("구입 요청을 삭제했습니다.", "warn");
  });
}

function openDuplicateItemChoiceModal({ payload, duplicate, itemModal }) {
  const mergedTotal = duplicate.total + payload.total;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal duplicate-item-modal" role="dialog" aria-modal="true" aria-labelledby="duplicateItemTitle">
      <div class="modal-header">
        <h2 id="duplicateItemTitle">이미 등록된 물품입니다</h2>
        <button class="icon-button" data-duplicate-cancel type="button" aria-label="닫기">×</button>
      </div>
      <div class="modal-body">
        <p class="helper"><strong>${escapeHtml(payload.name)}</strong> (${escapeHtml(payload.location)})이 이미 등록되어 있습니다.</p>
        <ul class="quiet-list duplicate-summary">
          <li>기존 수량 — ${duplicate.total}${escapeHtml(duplicate.unit || "개")}</li>
          <li>추가 수량 — ${payload.total}${escapeHtml(payload.unit || "개")}</li>
          <li>통합 후 수량 — ${mergedTotal}${escapeHtml(duplicate.unit || payload.unit || "개")}</li>
        </ul>
        <p class="helper">통합하려면 <strong>통합</strong>, 별도 물품으로 남기려면 <strong>분리 등록</strong>을 누르세요. 취소하면 아무 것도 등록하지 않습니다.</p>
      </div>
      <div class="modal-footer duplicate-actions">
        <button class="ghost" data-duplicate-cancel type="button">취소</button>
        <button class="warning-action" data-duplicate-split type="button">분리 등록</button>
        <button class="primary" data-duplicate-merge type="button">통합</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  backdrop.querySelectorAll("[data-duplicate-cancel]").forEach((button) => {
    button.addEventListener("click", () => backdrop.remove());
  });
  backdrop.querySelector("[data-duplicate-merge]").addEventListener("click", () => {
    mergeDuplicateItem(duplicate, payload, mergedTotal);
    backdrop.remove();
    itemModal.remove();
  });
  backdrop.querySelector("[data-duplicate-split]").addEventListener("click", () => {
    addNewItem(payload);
    saveState();
    selectedItemId = payload.id;
    render();
    backdrop.remove();
    itemModal.remove();
  });
}

function mergeDuplicateItem(duplicate, payload, mergedTotal) {
  const acquisitions = [
    ...normalizeItemAcquisitions(duplicate, state.logs).acquisitions,
    createAcquisitionFromItem(payload, "추가 등록"),
  ];
  state.items = state.items.map((item) => item.id === duplicate.id ? { ...duplicate, total: mergedTotal, acquisitions } : item);
  addLog("물품 수정", `${payload.name} 수량을 ${duplicate.total} → ${mergedTotal}${duplicate.unit || "개"}로 통합했습니다.`, "관리자", duplicate.id);
  saveState();
  selectedItemId = duplicate.id;
  render();
}

function addNewItem(payload) {
  state.items.push({
    ...payload,
    acquisitions: payload.acquisitions?.length ? payload.acquisitions : [createAcquisitionFromItem(payload, "최초 등록")],
  });
  addLog("물품 등록", `${payload.name} ${payload.total}${payload.unit}을 등록했습니다.`, "관리자", payload.id);
}

function createAcquisitionFromItem(item, note = "등록") {
  return {
    id: createId("acq"),
    quantity: Number(item.total || 0),
    purchasedAt: item.purchasedAt || "",
    price: Number(item.price || 0),
    note,
    createdAt: new Date().toISOString(),
  };
}

function deleteItem(itemId) {
  if (!adminMode) return;
  const item = getItem(itemId);
  if (!item || !canManageLocation(item.location)) {
    alert("이 물품을 삭제할 권한이 없습니다.");
    return;
  }

  const linkedReservations = state.reservations.filter((reservation) => reservation.itemId === itemId);
  const activeReservations = linkedReservations.filter((reservation) => ["예약됨", "분출됨"].includes(getReservationDisplayStatus(reservation)));
  if (activeReservations.length) {
    alert("예약 또는 분출 중인 물품은 삭제할 수 없습니다. 먼저 예약 취소나 반납 처리를 완료하세요.");
    return;
  }

  const linkedLogs = state.logs.filter((log) => log.itemId === itemId);
  const message = [
    `${item.name} 물품을 삭제할까요?`,
    "",
    linkedReservations.length ? `연결된 완료/취소 예약 기록 ${linkedReservations.length}건도 함께 삭제됩니다.` : "연결된 예약 기록은 없습니다.",
    linkedLogs.length ? `연결된 사용 기록 ${linkedLogs.length}건도 함께 삭제됩니다.` : "연결된 사용 기록은 없습니다.",
    "",
    "삭제한 물품은 되돌릴 수 없습니다.",
  ].join("\n");
  if (!confirm(message)) return;

  recordDeletion("items", itemId);
  state.items = state.items.filter((row) => row.id !== itemId);
  state.reservations = state.reservations.filter((reservation) => reservation.itemId !== itemId);
  state.logs = state.logs.filter((log) => log.itemId !== itemId);
  addLog("물품 삭제", `${item.name} 물품을 삭제했습니다.`, "관리자");
  selectedItemId = null;
  selectedReservationId = null;
  saveState();
  render();
  toast(`${item.name} 물품을 삭제했습니다.`, "warn");
}

function openReservationModal(defaultItemId = "") {
  if (shouldBlockUnconnectedTeacher()) {
    alert("관리자가 공유한 학교 전용 접속 링크로 먼저 접속해주세요.");
    return;
  }
  // 관리자처럼 표시될 때만 관리 범위로 제한. 교사·실별관리자 타실 예약 시에는 모든 활성 물품을 빌릴 수 있다.
  const itemOptions = state.items
    .filter((item) => item.status !== "비활성" && (!displayAsAdmin() || isItemInAdminScope(item)))
    .map((item) => `<option value="${item.id}" ${defaultItemId === item.id ? "selected" : ""}>${escapeHtml(item.name)} (${getAvailableCountOnDate(item.id, today())}${escapeHtml(item.unit || "개")})</option>`)
    .join("");

  const modal = openModal({
    title: "물품 예약",
    submitText: "예약",
    body: `
      <div class="field-grid res-modal-grid">
        <!-- 1행: 교사명 + 물품 -->
        <label class="field">
          <span>교사명</span>
          <select name="teacher">
            <option value="">선택</option>
            ${state.teachers.map((teacher) => `<option ${teacher === els.teacherSelect.value ? "selected" : ""}>${escapeHtml(teacher)}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>물품</span>
          <select name="itemId">${itemOptions}</select>
        </label>
        <!-- 2행: 수량(좁게) + 사용 시작일 + 반납 예정일 -->
        <div class="res-date-row field full">
          <label class="field res-qty">
            <span>수량</span>
            <input name="quantity" type="number" value="1" required />
          </label>
          <label class="field res-date">
            <span>사용 시작일</span>
            <input name="startDate" type="date" value="${today()}" required />
          </label>
          <label class="field res-date">
            <span>반납 예정일</span>
            <input name="endDate" type="date" value="${today()}" required />
          </label>
        </div>
        <!-- 3행: 비고 -->
        <label class="field full">
          <span>비고</span>
          <textarea name="note"></textarea>
        </label>
        <!-- 4행: 직접 수령 체크박스 -->
        <label class="field full res-self-checkout">
          <input type="checkbox" name="selfCheckout" value="yes" />
          <div>
            <span class="res-checkout-main">직접 가져갈게요</span>
            <span class="res-checkout-sub">사용 시작일에 본인이 직접 수령 예정 — 관리자 분출 처리 불필요</span>
          </div>
        </label>
      </div>
    `,
    onSubmit: (formData) => {
      const itemId = formData.get("itemId");
      let quantity = Number(formData.get("quantity"));
      const item = getItem(itemId);
      const startDate = formData.get("startDate");
      const endDate = formData.get("endDate");

      if (!item || quantity <= 0) {
        alert("예약할 물품과 수량을 확인하세요.");
        return false;
      }
      if (!startDate || !endDate || startDate > endDate) {
        alert("사용 시작일과 반납 예정일을 확인하세요.");
        return false;
      }

      const availability = checkReservationAvailability(itemId, startDate, endDate, quantity);
      if (!availability.ok) {
        const unit = item.unit || "개";
        // 이 기간 동안 예약 가능한 최대 수량 = 날짜별 남은 수량 중 최솟값
        const maxAvail = Math.min(...availability.shortages.map((s) => s.available));
        const reason = formatAvailabilityMessage(item, quantity, availability.shortages);
        if (maxAvail > 0) {
          // 먼저 예약한 사람이 우선 — 뒤 사람은 남은 수량만 예약 가능하도록 제안
          const ok = confirm(
            `${reason}\n\n선택한 기간에는 먼저 예약된 건이 있어 최대 ${maxAvail}${unit}까지만 예약할 수 있어요.\n\n[확인] ${maxAvail}${unit}로 예약하기   ·   [취소] 그만두기`
          );
          if (!ok) return false;
          quantity = maxAvail; // 남은 수량으로 자동 조정
        } else {
          alert(`${reason}\n\n선택한 기간에는 이미 모두 예약되어 빌릴 수 있는 수량이 없습니다.\n다른 날짜를 선택해 주세요.`);
          return false;
        }
      }

      const selfCheckout = formData.get("selfCheckout") === "yes";
      const teacher = formData.get("teacher");
      if (!isValidTeacherSelection(teacher)) {
        alert("사용 교사를 선택하세요.");
        return false;
      }
      const reservation = {
        id: createId("res"),
        itemId,
        teacher,
        quantity,
        startDate,
        endDate,
        status: selfCheckout && startDate <= today() ? "분출됨" : "예약됨",
        note: formData.get("note").trim(),
        createdAt: new Date().toISOString(),
        ...(selfCheckout && { selfCheckout: true }),
        ...(selfCheckout && startDate <= today() && {
          checkedOutAt: new Date().toISOString(),
          checkedOutBy: teacher,
        }),
      };
      state.reservations.push(reservation);
      if (selfCheckout && startDate <= today()) {
        addLog("직접 분출", `${teacher} 교사가 ${item.name} ${quantity}${item.unit}을 직접 가져갔습니다.`, teacher, itemId);
        toast(`${item.name} ${quantity}${item.unit} 직접 분출 완료`, "success");
      } else {
        addLog("예약", `${teacher} 교사가 ${item.name} ${quantity}${item.unit}을 예약했습니다.${selfCheckout ? " 직접 가져갈 예정입니다." : ""}`, teacher, itemId);
        toast(`${item.name} ${quantity}${item.unit} 예약했어요`, "success");
      }
      els.teacherSelect.value = teacher;
      saveSelectedTeacher(teacher);
      saveState();
      currentView = "dashboard";
      selectedReservationId = reservation.id;
      render();
      return true;
    },
  });

  // 물품 옵션의 사용 가능 수량을 '사용 시작일' 기준으로 표시하고, 날짜가 바뀌면 갱신한다.
  const itemSelect = modal.querySelector('select[name="itemId"]');
  const startDateInput = modal.querySelector('input[name="startDate"]');
  if (itemSelect && startDateInput) {
    const refreshAvailabilityLabels = () => {
      const date = startDateInput.value || today();
      Array.from(itemSelect.options).forEach((option) => {
        const item = getItem(option.value);
        if (!item) return;
        option.textContent = `${item.name} (${getAvailableCountOnDate(item.id, date)}${item.unit || "개"})`;
      });
    };
    startDateInput.addEventListener("change", refreshAvailabilityLabels);
    refreshAvailabilityLabels();
  }
}

function openReturnModal(reservationId) {
  const reservation = state.reservations.find((res) => res.id === reservationId);
  const item = getItem(reservation.itemId);
  if (!item || !isReservationInAdminScope(reservation)) {
    alert("이 예약을 처리할 권한이 없습니다.");
    return;
  }

  openModal({
    title: "반납 처리",
    submitText: "반납 저장",
    body: `
      <p class="helper">${escapeHtml(item.name)} · 분출 수량 ${reservation.quantity}${escapeHtml(item.unit || "개")}</p>
      <div class="field-grid">
        <div class="field-4col">
          ${field("정상 반납", "returned", reservation.quantity, true, "number")}
          ${field("파손", "damaged", 0, false, "number")}
          ${field("분실", "lost", 0, false, "number")}
          ${field("폐기", "disposed", 0, false, "number")}
        </div>
        <label class="field full">
          <span>비고</span>
          <textarea name="note"></textarea>
        </label>
      </div>
    `,
    onSubmit: (formData) => {
      const returned = Number(formData.get("returned") || 0);
      const damaged = Number(formData.get("damaged") || 0);
      const lost = Number(formData.get("lost") || 0);
      const disposed = Number(formData.get("disposed") || 0);
      const processedTotal = returned + damaged + lost + disposed;
      const note = formData.get("note").trim();
      if (![returned, damaged, lost, disposed].every((count) => Number.isFinite(count) && count >= 0)) {
        alert("반납 수량은 0 이상의 숫자로 입력하세요.");
        return false;
      }
      if (processedTotal !== reservation.quantity) {
        alert("정상 반납, 파손, 분실, 폐기 수량의 합이 분출 수량과 같아야 합니다.");
        return false;
      }
      if ((damaged || lost || disposed) && !note) {
        alert("파손·분실·폐기 수량이 있으면 비고에 사유를 입력하세요.");
        return false;
      }

      reservation.status = "회수 완료";
      reservation.returnedAt = new Date().toISOString();
      reservation.returned = returned;
      reservation.damaged = damaged;
      reservation.lost = lost;
      reservation.disposed = disposed;
      reservation.returnNote = note;

      if (damaged || lost || disposed) applyDamage(item.id, damaged, lost, disposed, reservation.id, note);
      addLog("회수", `${item.name} ${returned}${item.unit}을 회수했습니다. 파손 ${damaged}${item.unit}, 분실 ${lost}${item.unit}, 폐기 ${disposed}${item.unit}.`, "관리자", item.id);
      saveState();
      render();
      toast(`${item.name} 회수가 기록되었어요`, "success");
      return true;
    },
  });
}

function openDamageModal(reservationId = null, itemId = null) {
  const reservation = state.reservations.find((res) => res.id === reservationId);
  const item = getItem(itemId || reservation?.itemId);
  if (!item || !canManageLocation(item.location)) {
    alert("이 물품실의 손망 처리를 할 권한이 없습니다.");
    return;
  }

  openModal({
    title: "손망·분실 처리",
    submitText: "처리 저장",
    body: `
      <div class="damage-item-info">
        <strong>${escapeHtml(item.name)}</strong>
        <span>현재 사용 가능 <b>${getAvailableCount(item.id)}${escapeHtml(item.unit || "개")}</b></span>
      </div>
      <div class="field-grid">
        <div class="field-3col damage-3col">
          ${field("파손 수량", "damaged", 0, false, "number")}
          ${field("분실 수량", "lost", 0, false, "number")}
          ${field("폐기 수량", "disposed", 0, false, "number")}
        </div>
        <label class="field full">
          <span>처리 사유</span>
          <textarea name="note" required></textarea>
        </label>
      </div>
    `,
    onSubmit: (formData) => {
      const damaged = Number(formData.get("damaged") || 0);
      const lost = Number(formData.get("lost") || 0);
      const disposed = Number(formData.get("disposed") || 0);
      const note = formData.get("note").trim();
      if (damaged + lost + disposed <= 0 || !note) {
        alert("처리 수량과 사유를 입력하세요.");
        return false;
      }
      applyDamage(item.id, damaged, lost, disposed, reservationId, note);
      saveState();
      render();
      toast("손망 처리 내역을 저장했어요", "warn");
      return true;
    },
  });
}

function checkoutReservation(reservationId) {
  const reservation = state.reservations.find((res) => res.id === reservationId);
  const item = getItem(reservation.itemId);
  if (!item || !isReservationInAdminScope(reservation)) {
    alert("이 예약을 분출 처리할 권한이 없습니다.");
    return;
  }
  if (!verifyPin(item.location)) return;
  reservation.status = "분출됨";
  reservation.checkedOutAt = new Date().toISOString();
  reservation.checkedOutBy = "관리자";
  addLog("분출", `${item.name} ${reservation.quantity}${item.unit}을 분출했습니다.`, "관리자", item.id);
  saveState();
  render();
  toast(`${item.name} ${reservation.quantity}${item.unit} 분출 완료`, "success");
}

function cancelReservation(reservationId) {
  const reservation = state.reservations.find((res) => res.id === reservationId);
  const item = getItem(reservation.itemId);
  if (adminMode && (!item || !isReservationInAdminScope(reservation))) {
    alert("이 예약을 취소할 권한이 없습니다.");
    return;
  }
  reservation.status = "취소됨";
  addLog("예약 취소", `${item.name} 예약을 취소했습니다.`, reservation.teacher, item.id);
  saveState();
  render();
  toast("예약이 취소되었어요", "warn");
}

function applyDamage(itemId, damaged, lost, disposed, reservationId, note) {
  const item = getItem(itemId);
  item.damaged += damaged;
  item.lost += lost;
  item.disposed += disposed;
  item.total = Math.max(0, item.total - damaged - lost - disposed);
  if (lost > 0) item.status = "분실";
  if (damaged > 0) item.status = "파손";
  if (disposed > 0) item.status = "폐기";

  const parts = [];
  if (damaged) parts.push(`파손 ${damaged}${item.unit}`);
  if (lost) parts.push(`분실 ${lost}${item.unit}`);
  if (disposed) parts.push(`폐기 ${disposed}${item.unit}`);
  addLog("손망 처리", `${item.name}: ${parts.join(", ")} 처리. ${note}`, "관리자", itemId, reservationId);
}

function setupImportDropZone(dropZone, input) {
  if (!dropZone || !input) return;

  ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, () => {
      dropZone.classList.add("is-dragover");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, () => {
      dropZone.classList.remove("is-dragover");
    });
  });

  dropZone.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    input.value = "";
    handleInventoryFile(file);
  });
}

function importInventoryFile(event) {
  const file = event.target.files[0];
  event.target.value = "";
  handleInventoryFile(file);
}

function handleInventoryFile(file) {
  if (!adminMode) return;
  if (!file) return;
  const resultEl = document.querySelector("#importResult");
  const extension = file.name.split(".").pop().toLowerCase();

  if (["xlsx", "xls"].includes(extension)) {
    if (!window.XLSX) {
      resultEl.innerHTML = `
        <div class="import-alert is-error">
          엑셀 읽기 파일을 불러오지 못했습니다. 배포 폴더에 vendor/xlsx.full.min.js가 함께 있는지 확인하세요.
        </div>
      `;
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const workbook = XLSX.read(reader.result, { type: "array", cellDates: true });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "", raw: false });
        previewImportRows(rows, file.name);
      } catch (error) {
        resultEl.innerHTML = `<div class="import-alert is-error">엑셀 파일을 읽지 못했습니다: ${escapeHtml(error.message)}</div>`;
      }
    };
    reader.readAsArrayBuffer(file);
    return;
  }

  if (extension !== "csv") {
    resultEl.innerHTML = `<div class="import-alert is-error">엑셀(.xlsx, .xls) 또는 CSV 파일만 올릴 수 있습니다.</div>`;
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const rows = parseCsv(String(reader.result));
    previewImportRows(rows, file.name);
  };
  reader.readAsText(file, "utf-8");
}

function previewImportRows(rows, sourceName) {
  const resultEl = document.querySelector("#importResult");
  pendingImport = buildImportPlan(rows, sourceName);

  if (pendingImport.errors.length && !pendingImport.items.length) {
    resultEl.innerHTML = `
      <div class="import-alert is-error">
        등록 가능한 행이 없습니다. ${pendingImport.errors.length}개 행을 확인하세요.
      </div>
      ${renderImportErrors(pendingImport.errors)}
    `;
    return;
  }

  resultEl.innerHTML = `
    <div class="import-preview-head">
      <div>
        <strong>${escapeHtml(sourceName)}</strong>
        <p class="helper">등록 예정 ${pendingImport.items.length}건 · 기존 물품 병합 예정 ${pendingImport.mergeCount}건 · 오류 ${pendingImport.errors.length}건</p>
      </div>
      <button class="primary" id="confirmImportBtn" type="button" ${pendingImport.items.length ? "" : "disabled"}>미리보기대로 등록</button>
    </div>
    ${renderImportPreviewTable(pendingImport.items)}
    ${pendingImport.errors.length ? renderImportErrors(pendingImport.errors) : ""}
  `;

  document.querySelector("#confirmImportBtn").addEventListener("click", commitPendingImport);
}

function buildImportPlan(rows, sourceName) {
  const cleanRows = rows.filter((row) => row.some((cell) => String(cell ?? "").trim()));
  const result = { sourceName, items: [], errors: [], mergeCount: 0 };
  const importKeys = new Set();
  if (cleanRows.length < 2) {
    result.errors.push({ row: "-", reason: "제목 행과 데이터 행이 필요합니다." });
    return result;
  }

  const headers = cleanRows[0].map(normalizeHeader);
  cleanRows.slice(1).forEach((row, index) => {
    const record = Object.fromEntries(headers.map((header, headerIndex) => [header, row[headerIndex] || ""]));
    const name = String(record.name || "").trim();
    const spec = String(record.spec || "").trim();
    const location = String(record.location || "").trim();
    const total = Number(String(record.total || "").replaceAll(",", ""));
    const category = String(record.category || "").trim();
    const unit = String(record.unit || "개").trim() || "개";
    const code = String(record.code || "").trim();
    if (!name || !location || total <= 0) {
      result.errors.push({ row: index + 2, reason: "물품명, 보관 장소, 총 수량을 확인하세요." });
      return;
    }
    if (!state.locations.includes(location)) {
      result.errors.push({ row: index + 2, reason: `${location}은 학교 설정에 등록된 물품실이 아닙니다. 먼저 학교 설정에서 물품실을 추가하세요.` });
      return;
    }
    if (!canManageLocation(location)) {
      result.errors.push({ row: index + 2, reason: `${location} 물품실을 관리할 권한이 없습니다.` });
      return;
    }

    const importKey = code
      ? `code:${location}:${code}`
      : `name:${location}:${name}:${category}:${unit}`;
    if (importKeys.has(importKey)) {
      result.errors.push({ row: index + 2, reason: "같은 파일 안에 중복된 물품 행이 있습니다. 수량을 한 행으로 합친 뒤 다시 가져오세요." });
      return;
    }
    importKeys.add(importKey);

    const existing = state.items.find((item) => isImportMergeMatch(item, { name, location, category, unit, code }));
    if (existing) result.mergeCount += 1;
    result.items.push({
      id: createId("item"),
      name,
      spec,
      category,
      location,
      total,
      unit,
      consumable: ["소모품", "예", "true", "TRUE", "1", "Y", "y"].includes(String(record.consumable || "").trim()),
      code,
      purchasedAt: normalizeDateCell(record.purchasedAt),
      price: Number(String(record.price || 0).replaceAll(",", "")) || 0,
      damaged: 0,
      lost: 0,
      disposed: 0,
      status: String(record.status || "사용 가능").trim() || "사용 가능",
      note: String(record.note || "").trim(),
      willMerge: Boolean(existing),
      existingId: existing?.id || "",
      acquisitions: [],
    });
  });
  return result;
}

function isImportMergeMatch(item, imported) {
  if (item.location !== imported.location) return false;
  if (imported.code) return item.code === imported.code;
  if (item.code) return false;
  return item.name === imported.name
    && String(item.category || "").trim() === imported.category
    && String(item.unit || "개").trim() === imported.unit;
}

function renderImportPreviewTable(items) {
  if (!items.length) return "";
  return `
    <div class="table-wrap import-preview-table" style="overflow-x:auto;">
      <table style="min-width:900px;">
        <thead>
          <tr>
            <th>처리</th>
            <th>물품명</th>
            <th>규격</th>
            <th>카테고리</th>
            <th>보관 장소</th>
            <th>수량</th>
            <th>단위</th>
            <th>소모품</th>
            <th>관리번호</th>
            <th>구입일</th>
            <th>구입금액</th>
            <th>상태</th>
            <th>비고</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => `
            <tr>
              <td>${item.willMerge ? statusBadge("병합") : statusBadge("등록")}</td>
              <td><strong>${escapeHtml(item.name)}</strong></td>
              <td>${escapeHtml(item.spec || "-")}</td>
              <td>${escapeHtml(item.category || "-")}</td>
              <td>${escapeHtml(item.location)}</td>
              <td>${item.total}</td>
              <td>${escapeHtml(item.unit)}</td>
              <td>${item.consumable ? "소모품" : "비품"}</td>
              <td>${escapeHtml(item.code || "-")}</td>
              <td>${escapeHtml(item.purchasedAt || "-")}</td>
              <td>${item.price ? item.price.toLocaleString() + "원" : "-"}</td>
              <td>${escapeHtml(item.status || "-")}</td>
              <td>${escapeHtml(item.note || "")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderImportErrors(errors) {
  return `
    <div class="import-alert ${errors.length ? "is-warn" : ""}">
      <strong>확인할 행</strong>
      <ul>
        ${errors.slice(0, 12).map((error) => `<li>${escapeHtml(error.row)}행 — ${escapeHtml(error.reason)}</li>`).join("")}
        ${errors.length > 12 ? `<li>그 외 ${errors.length - 12}건</li>` : ""}
      </ul>
    </div>
  `;
}

function commitPendingImport() {
  if (!pendingImport || !pendingImport.items.length) return;

  let inserted = 0;
  let merged = 0;
  pendingImport.items.forEach((item) => {
    const existing = state.items.find((row) => row.id === item.existingId);
    if (existing) {
      const acquisition = createAcquisitionFromItem(item, "일괄 추가 등록");
      existing.acquisitions = [...normalizeItemAcquisitions(existing, state.logs).acquisitions, acquisition];
      existing.total += item.total;
      if (item.note) existing.note = [existing.note, item.note].filter(Boolean).join(" / ");
      addLog("일괄 등록", `${item.name} 중복 항목을 병합했습니다.`, "관리자", existing.id);
      merged += 1;
    } else {
      const { willMerge, existingId, ...payload } = item;
      addNewItem(payload);
      addLog("일괄 등록", `${payload.name} ${payload.total}${payload.unit}을 등록했습니다.`, "관리자", payload.id);
      inserted += 1;
    }
  });

  addLog("일괄 등록", `${pendingImport.sourceName}에서 ${inserted}개 물품을 등록하고 ${merged}개 항목을 병합했습니다. 오류 ${pendingImport.errors.length}건.`, "관리자");
  saveState();
  renderStatusGrid();
  document.querySelector("#importResult").innerHTML = `<div class="import-alert is-success">등록 ${inserted}건, 병합 ${merged}건을 완료했습니다.</div>`;
  pendingImport = null;
}

function downloadTemplate() {
  const rows = [
    ["물품명", "규격", "카테고리", "보관 장소", "총 수량", "단위", "소모품 여부", "관리 번호", "구입일", "구입 금액", "상태", "비고"],
    ["축구공", "5호", "체육", "체육실", "20", "개", "아니오", "PE-001", "2026-03-02", "18000", "사용 가능", ""],
    ["비커 500ml", "500ml", "과학", "과학실", "40", "개", "아니오", "SC-009", "2026-03-02", "4200", "사용 가능", "파손 주의"],
  ];
  if (window.XLSX) {
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "물품목록");
    XLSX.writeFile(workbook, "물품_일괄등록_양식.xlsx");
    return;
  }
  downloadCsv("물품_일괄등록_양식.csv", rows);
}

function generateNextCode(location) {
  const prefixMap = {
    체육: "PE", 과학: "SC", 미술: "AR", 음악: "MU", 수학: "MA",
    영어: "EN", 컴퓨터: "IT", 기술: "TC", 가정: "HE", 실과: "PA",
    방송: "BC", 도서: "LB", 보건: "HN", 역사: "HI", 사회: "SS", 국어: "KO",
    교무: "OF", 창고: "ST",
  };

  const roomNum = (location.match(/(\d+)/) || [])[1] || "";
  const basePrefix = Object.entries(prefixMap).find(([k]) => location.includes(k))?.[1]
    ?? location.replace(/\d+/g, "").slice(0, 2).toUpperCase();
  const pattern = /^(.+)-(\d+)$/;

  const codes = state.items.filter((i) => i.location === location && i.code).map((i) => i.code);

  if (codes.length === 0) {
    const prefix = basePrefix + roomNum;
    const allNums = state.items
      .filter((i) => i.code)
      .map((i) => i.code.match(pattern))
      .filter((m) => m && m[1] === prefix)
      .map((m) => parseInt(m[2], 10));
    const nextNum = allNums.length ? Math.max(...allNums) + 1 : 1;
    const digits = Math.max(3, String(nextNum).length);
    return `${prefix}-${String(nextNum).padStart(digits, "0")}`;
  }

  const numbered = codes.map((c) => c.match(pattern)).filter(Boolean);
  if (numbered.length === 0) return null;

  const prefixCount = {};
  numbered.forEach((m) => { prefixCount[m[1]] = (prefixCount[m[1]] || 0) + 1; });
  const prefix = Object.entries(prefixCount).sort((a, b) => b[1] - a[1])[0][0];

  const numsForPrefix = numbered.filter((m) => m[1] === prefix).map((m) => parseInt(m[2], 10));
  const nextNum = Math.max(...numsForPrefix) + 1;
  const digits = Math.max(3, String(Math.max(...numsForPrefix)).length);
  return `${prefix}-${String(nextNum).padStart(digits, "0")}`;
}

function downloadTemplateCsv() {
  const rows = [
    ["물품명", "규격", "카테고리", "보관 장소", "총 수량", "단위", "소모품 여부", "관리 번호", "구입일", "구입 금액", "상태", "비고"],
    ["축구공", "5호", "체육", "체육실", "20", "개", "아니오", "PE-001", "2026-03-02", "18000", "사용 가능", ""],
    ["비커 500ml", "500ml", "과학", "과학실", "40", "개", "아니오", "SC-009", "2026-03-02", "4200", "사용 가능", "파손 주의"],
  ];
  downloadCsv("물품_일괄등록_양식.csv", rows);
}

function exportItems() {
  const rows = [
    ["물품명", "규격", "카테고리", "보관 장소", "총 수량", "단위", "소모품 여부", "관리 번호", "구입일", "구입 금액", "상태", "비고"],
    ...state.items.map((item) => [
      item.name,
      item.spec || "",
      item.category,
      item.location,
      item.total,
      item.unit,
      item.consumable ? "예" : "아니오",
      item.code || "",
      item.purchasedAt || "",
      item.price ?? "",
      item.status,
      item.note || "",
    ]),
  ];
  if (window.XLSX) {
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "물품목록");
    XLSX.writeFile(workbook, `물품목록_${today()}.xlsx`);
    return;
  }
  downloadCsv(`물품목록_${today()}.csv`, rows);
}

function exportLogs() {
  const rows = [
    ["일시", "구분", "내용", "담당"],
    ...state.logs.map((log) => [formatDateTime(log.createdAt), log.type, log.message, log.actor || ""]),
  ];
  downloadCsv(`관리기록_${today()}.csv`, rows);
}

function downloadSetupGuide(formData, stepItems) {
  const checkedSteps = new Set(formData.getAll("setupStep"));
  const lines = [
    "# 교구이음 저장소 구축 가이드",
    "",
    `학교명: ${state.schoolName || "-"}`,
    `공유드라이브: ${formData.get("driveName") || "-"}`,
    `스프레드시트: ${formData.get("spreadsheetName") || "-"}`,
    `담당자: ${formData.get("ownerName") || "-"} ${formData.get("ownerEmail") || ""}`.trim(),
    "",
    "## 체크리스트",
    ...stepItems.map(([key, title]) => `- [${checkedSteps.has(key) ? "x" : " "}] ${title}`),
    "",
    "## Apps Script 연결",
    "1. 공유드라이브의 스프레드시트에서 확장 프로그램 > Apps Script를 엽니다.",
    "2. 처음설정가이드.html의 링크로 학교용 시트 사본을 만들고 교구이음 메뉴에서 처음 설정을 실행합니다.",
    "3. 웹앱으로 배포한 뒤 MVP의 학교 설정에 웹앱 URL과 연결 키를 입력합니다.",
    "4. 연결 진단 후 현재 데이터 올리기를 실행합니다.",
    "",
    "## 운영 메모",
    formData.get("setupNotes") || "-",
  ];
  downloadText(`학교물품관리_구축가이드_${today()}.md`, lines.join("\n"));
}

function downloadFieldTestReport(formData, testItems) {
  const checkedSteps = new Set(formData.getAll("fieldTestStep"));
  const lines = [
    "# 교구이음 현장 테스트 리포트",
    "",
    `학교명: ${state.schoolName || "-"}`,
    `테스트 날짜: ${formData.get("testDate") || today()}`,
    `테스터: ${formData.get("testerName") || "-"}`,
    `참여 교사 수: ${formData.get("teacherCount") || "-"}`,
    `기기/브라우저: ${formData.get("deviceNote") || "-"}`,
    "",
    "## 테스트 결과",
    ...testItems.map(([key, title]) => `- [${checkedSteps.has(key) ? "x" : " "}] ${title}`),
    "",
    "## 현재 데이터 요약",
    `물품: ${state.items.length}건`,
    `예약/반납: ${state.reservations.length}건`,
    `관리 기록: ${state.logs.length}건`,
    `동기화 방식: ${getAutoSyncLabel(syncConfig.autoSync)}`,
    `마지막 동기화: ${syncConfig.lastSyncedAt ? formatDateTime(syncConfig.lastSyncedAt) : "-"}`,
    "",
    "## 피드백 메모",
    formData.get("fieldTestNotes") || "-",
  ];
  downloadText(`학교물품관리_현장테스트_${today()}.md`, lines.join("\n"));
}

function downloadFeedbackReport(items) {
  const highOpenItems = items.filter((item) => item.priority === "높음" && item.status !== "반영 완료");
  const lines = [
    "# 교구이음 시범 운영 피드백",
    "",
    `학교명: ${state.schoolName || "-"}`,
    `작성일: ${today()}`,
    "",
    "## 피드백 목록",
    ...(items.length
      ? items.map((item) => `- [${item.status}] (${item.priority}) ${item.title} / ${item.source || "-"}${item.note ? `\n  - 메모: ${item.note}` : ""}`)
      : ["- 없음"]),
    "",
    "## 우선 반영 후보",
    ...(highOpenItems.length ? highOpenItems.map((item) => `- ${item.title}`) : ["- 없음"]),
  ];
  downloadText(`학교물품관리_피드백_${today()}.md`, lines.join("\n"));
}

function downloadReleaseChecklist(formData, releaseItems) {
  const checkedSteps = new Set(formData.getAll("releaseStep"));
  const highOpenFeedback = feedbackState.items.filter((item) => item.priority === "높음" && item.status !== "반영 완료");
  const lines = [
    "# 교구이음 발표·배포 최종 점검표",
    "",
    `학교명: ${state.schoolName || "-"}`,
    `점검일: ${formData.get("releaseCheckedAt") || today()}`,
    `점검자: ${formData.get("releaseCheckedBy") || "-"}`,
    "",
    "## 체크리스트",
    ...releaseItems.map(([key, title]) => `- [${checkedSteps.has(key) ? "x" : " "}] ${title}`),
    "",
    "## 배포 파일",
    "- index.html",
    "- app.js",
    "- styles.css",
    "- vendor/xlsx.full.min.js",
    "- README.md",
    "",
    "## 남은 높은 우선순위 피드백",
    ...(highOpenFeedback.length ? highOpenFeedback.map((item) => `- ${item.title} (${item.status})`) : ["- 없음"]),
    "",
    "## 최종 메모",
    formData.get("releaseNotes") || "-",
  ];
  downloadText(`학교물품관리_최종점검_${today()}.md`, lines.join("\n"));
}

function isGlobalAdmin() {
  return adminMode && adminScope?.type === "global";
}

function getAccessibleLocations() {
  if (!adminMode || isGlobalAdmin()) return [...state.locations];
  return (adminScope?.locations || []).filter((location) => state.locations.includes(location));
}

function canManageLocation(location) {
  if (!adminMode || isGlobalAdmin()) return true;
  return getAccessibleLocations().includes(location);
}

function isItemInAdminScope(item) {
  return !adminMode || canManageLocation(item.location);
}

// 현재 선택된 물품실을 이 사용자가 관리자로서 다룰 수 있는가
function isManagingCurrentLocation() {
  if (!adminMode) return false;
  if (isGlobalAdmin()) return true;
  const loc = els.locationFilter?.value || "";
  return Boolean(loc) && canManageLocation(loc);
}

// 화면을 관리자용으로 보여줄지 여부.
// 실별 관리자가 자신이 담당하지 않는 물품실을 선택하면 교사처럼 화면이 바뀐다.
function displayAsAdmin() {
  return isManagingCurrentLocation();
}

function isReservationInAdminScope(reservation) {
  const item = getItem(reservation.itemId);
  return !adminMode || Boolean(item && canManageLocation(item.location));
}

function isLogInAdminScope(log) {
  if (!adminMode || isGlobalAdmin()) return true;
  if (!log.itemId) return false;
  const item = getItem(log.itemId);
  return Boolean(item && canManageLocation(item.location));
}

function getFilteredItems() {
  const keyword = els.searchInput.value.trim().toLowerCase();
  const location = els.locationFilter.value;
  const category = els.categoryFilter?.value || "";
  // 예약(대시보드) 화면은 누구나(실별 관리자 포함) 선택한 물품실의 모든 물품을 빌릴 수 있어야 한다.
  // 물품 관리 등 다른 탭에서는 관리 범위(scope)를 그대로 적용한다.
  const inBorrowView = currentView === "dashboard";
  return state.items
    .filter((item) => {
      const haystack = `${item.name} ${item.category} ${item.code}`.toLowerCase();
      return (inBorrowView || isItemInAdminScope(item))
        && (!keyword || haystack.includes(keyword))
        && (!location || item.location === location)
        && (!category || item.category === category);
    })
    .sort((a, b) => {
      // 1순위: 보관 장소
      const locCmp = (a.location || "").localeCompare(b.location || "", "ko");
      if (locCmp !== 0) return locCmp;
      // 2순위: 물품명 (같은 이름끼리 묶임)
      const nameCmp = (a.name || "").localeCompare(b.name || "", "ko");
      if (nameCmp !== 0) return nameCmp;
      // 3순위: 규격 (같은 물품 내 규격 정렬)
      const specCmp = (a.spec || "").localeCompare(b.spec || "", "ko");
      if (specCmp !== 0) return specCmp;
      // 4순위: 관리번호
      return (a.code || "").localeCompare(b.code || "", "ko");
    });
}

function getFilteredReservations(rows) {
  const keyword = els.searchInput.value.trim().toLowerCase();
  const location = els.locationFilter.value;
  return rows.filter((res) => {
    const item = getItem(res.itemId);
    const haystack = `${res.teacher} ${item?.name || ""} ${item?.location || ""} ${res.status}`.toLowerCase();
    return isReservationInAdminScope(res) && (!keyword || haystack.includes(keyword)) && (!location || item?.location === location);
  });
}

function getFilteredPurchaseRequests() {
  const keyword = els.searchInput.value.trim().toLowerCase();
  const location = els.locationFilter.value;
  return [...(state.purchaseRequests || [])]
    .filter((request) => {
      const haystack = `${request.itemName || ""} ${request.category || ""} ${request.requester || ""} ${request.note || ""} ${request.status || ""}`.toLowerCase();
      return canManagePurchaseRequest(request) && (!keyword || haystack.includes(keyword)) && (!location || request.location === location);
    })
    .sort((a, b) => {
      const aDone = a.status === "구입 완료";
      const bDone = b.status === "구입 완료";
      if (aDone !== bDone) return aDone ? 1 : -1;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });
}

function canManagePurchaseRequest(request) {
  if (!adminMode || isGlobalAdmin()) return true;
  return Boolean(request.location && canManageLocation(request.location));
}

function getPurchaseRequestStatuses() {
  return ["요청됨", "검토 중", "구입 예정", "구입 완료", "보류"];
}

function setPurchaseRequestStatus(requestId, status) {
  const request = state.purchaseRequests.find((row) => row.id === requestId);
  if (!request || !canManagePurchaseRequest(request) || request.status === status) return;
  request.status = status;
  request.updatedAt = new Date().toISOString();
  addLog("구입 요청 검토", `${request.itemName} 요청 상태를 ${status}(으)로 변경했습니다.`, "관리자");
  saveState();
}

function setPurchaseRequestStatuses(requestIds, status) {
  const ids = new Set(requestIds);
  let changedCount = 0;
  (state.purchaseRequests || []).forEach((request) => {
    if (!ids.has(request.id) || !canManagePurchaseRequest(request) || request.status === status) return;
    request.status = status;
    request.updatedAt = new Date().toISOString();
    changedCount += 1;
  });
  if (!changedCount) return;
  addLog("구입 요청 일괄 검토", `구입 요청 ${changedCount}건 상태를 ${status}(으)로 변경했습니다.`, "관리자");
  saveState();
}

function deletePurchaseRequests(requestIds) {
  const ids = new Set(requestIds);
  const deletable = (state.purchaseRequests || []).filter((request) => ids.has(request.id) && canManagePurchaseRequest(request));
  if (!deletable.length) return;
  deletable.forEach((request) => recordDeletion("purchaseRequests", request.id));
  state.purchaseRequests = (state.purchaseRequests || []).filter((request) => !ids.has(request.id) || !canManagePurchaseRequest(request));
  addLog("구입 요청 삭제", `구입 요청 ${deletable.length}건을 삭제했습니다.`, "관리자");
  saveState();
}

function getAvailableCount(itemId) {
  return getAvailableCountOnDate(itemId, today());
}

function getAvailableCountOnDate(itemId, date) {
  const item = getItem(itemId);
  if (!item) return 0;
  return Math.max(0, item.total - getReservedCount(itemId, date) - getCheckedOutCount(itemId, date));
}

function checkReservationAvailability(itemId, startDate, endDate, requestQuantity, ignoreReservationId = "") {
  const item = getItem(itemId);
  if (!item) return { ok: false, shortages: [{ date: startDate, available: 0 }] };

  const totalAvailable = Math.max(0, item.total);
  const shortages = [];
  for (const date of eachDateInRange(startDate, endDate)) {
    const reservedOnDate = state.reservations
      .filter((reservation) =>
        reservation.id !== ignoreReservationId &&
        reservation.itemId === itemId &&
        ["예약됨", "분출됨"].includes(reservation.status) &&
        reservation.startDate <= date &&
        reservation.endDate >= date
      )
      .reduce((sum, reservation) => sum + Number(reservation.quantity || 0), 0);
    const available = Math.max(0, totalAvailable - reservedOnDate);
    if (requestQuantity > available) shortages.push({ date, available });
  }
  return shortages.length ? { ok: false, shortages } : { ok: true, shortages: [] };
}

function formatAvailabilityMessage(item, requestQuantity, shortages = []) {
  const unit = item.unit || "개";
  const visibleShortages = shortages.slice(0, 5);
  const shortageLines = visibleShortages.map((shortage) => `- ${shortage.date}: 예약 가능 ${shortage.available}${unit}`);
  if (shortages.length > visibleShortages.length) {
    shortageLines.push(`- 그 외 ${shortages.length - visibleShortages.length}일도 부족합니다.`);
  }
  return [
    `${item.name} 수량이 부족한 날짜가 있습니다.`,
    `요청 수량: ${requestQuantity}${unit}`,
    "",
    ...shortageLines,
  ].join("\n");
}

function eachDateInRange(startDate, endDate) {
  const dates = [];
  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const [endYear, endMonth, endDay] = endDate.split("-").map(Number);
  const cursor = new Date(startYear, startMonth - 1, startDay);
  const end = new Date(endYear, endMonth - 1, endDay);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime()) || cursor > end) return dates;
  while (cursor <= end) {
    dates.push(formatLocalDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function renderUnavailableReason(item) {
  const unit = escapeHtml(item.unit || "개");
  const reasons = [
    ["파손", item.damaged || 0],
    ["분실", item.lost || 0],
    ["폐기", item.disposed || 0],
  ]
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label} ${count}${unit}`);
  return reasons.length ? `<br /><span class="helper">사용 불가: ${reasons.join(" · ")}</span>` : "";
}

function renderItemMeta(item) {
  return [
    item.code ? `관리번호 ${escapeHtml(item.code)}` : "",
    item.category ? escapeHtml(item.category) : "",
  ].filter(Boolean).join(" · ") || "-";
}

// 목록 표의 물품명 아래 부제 — 카테고리는 별도 열에 있으므로 관리번호만 표시
function renderItemCode(item) {
  return item.code ? `관리번호 ${escapeHtml(item.code)}` : "";
}

function getReservedCount(itemId, date = "") {
  return state.reservations
    .filter((res) => res.itemId === itemId && res.status === "예약됨" && (!date || (res.startDate <= date && res.endDate >= date)))
    .reduce((sum, res) => sum + Number(res.quantity), 0);
}

function getCheckedOutCount(itemId, date = "") {
  return state.reservations
    .filter((res) => res.itemId === itemId && res.status === "분출됨" && (!date || (res.startDate <= date && res.endDate >= date)))
    .reduce((sum, res) => sum + Number(res.quantity), 0);
}

function getRecordFilterOptions() {
  return [
    { key: "all", label: "전체" },
    { key: "register", label: "등록" },
    { key: "reservation", label: "예약" },
    { key: "checkout", label: "분출" },
    { key: "return", label: "회수" },
    { key: "damage", label: "손망" },
    { key: "settings", label: "설정" },
    { key: "operation", label: "점검" },
  ];
}

function getReservationActionLabel(reservation) {
  if (adminMode) return "처리";
  const displayStatus = getReservationDisplayStatus(reservation);
  if (displayStatus === "예약됨") return "예약 보기";
  if (displayStatus === "분출됨") return "반납하기";
  return "상세 보기";
}

function getReservationDisplayStatus(reservation, date = today()) {
  if (reservation.selfCheckout && reservation.status === "분출됨" && reservation.startDate > date) return "예약됨";
  if (reservation.selfCheckout && reservation.status === "예약됨" && reservation.startDate <= date && reservation.endDate >= date) return "분출됨";
  return reservation.status;
}

function matchesRecordFilter(log, filterType) {
  if (!filterType || filterType === "all") return true;
  const groups = {
    register: ["물품 등록", "일괄 등록", "물품 수정"],
    reservation: ["예약", "예약 취소"],
    checkout: ["분출", "직접 분출"],
    return: ["회수"],
    damage: ["손망 처리"],
    settings: ["학교 설정", "보안 설정"],
    operation: ["초기 구축", "현장 테스트", "피드백", "최종 점검"],
  };
  return (groups[filterType] || []).includes(log.type);
}

function getItem(itemId) {
  return state.items.find((item) => item.id === itemId);
}

function getLastLogText(itemId) {
  const log = [...state.logs].reverse().find((entry) => entry.itemId === itemId);
  return log ? `${log.type} · ${formatDateTime(log.createdAt)}` : "-";
}

function addLog(type, message, actor = "관리자", itemId = "", reservationId = "") {
  state.logs.push({
    id: createId("log"),
    type,
    message,
    actor,
    itemId,
    reservationId,
    createdAt: new Date().toISOString(),
  });
}

function statusBadge(status) {
  const color =
    {
      예약됨: "blue",
      분출됨: "orange",
      "예약 중": "blue",
      "분출 중": "orange",
      "직접 분출": "orange",
      "회수 완료": "green",
      "사용 가능": "green",
      파손: "red",
      분실: "red",
      폐기: "gray",
      비활성: "gray",
      취소됨: "gray",
      등록: "green",
      병합: "blue",
      정상: "green",
      "확인 필요": "orange",
      요청됨: "blue",
      "검토 중": "orange",
      "구입 예정": "orange",
      "구입 완료": "green",
      보류: "gray",
    }[status] || "gray";
  return `<span class="badge ${color}">${escapeHtml(status)}</span>`;
}

function getAvailableCountOnDate(itemId, date) {
  return InventoryCore.getAvailableCountOnDate(state, itemId, date);
}

function checkReservationAvailability(itemId, startDate, endDate, requestQuantity, ignoreReservationId = "") {
  return InventoryCore.checkReservationAvailability(state, itemId, startDate, endDate, requestQuantity, ignoreReservationId);
}

function eachDateInRange(startDate, endDate) {
  return InventoryCore.eachDateInRange(startDate, endDate);
}

function formatLocalDate(date) {
  return InventoryCore.formatLocalDate(date);
}

function getReservedCount(itemId, date = "") {
  return InventoryCore.getReservedCount(state, itemId, date);
}

function getCheckedOutCount(itemId, date = "") {
  return InventoryCore.getCheckedOutCount(state, itemId, date);
}

function getReservationDisplayStatus(reservation, date = today()) {
  return InventoryCore.getReservationDisplayStatus(reservation, date);
}

function matchesRecordFilter(log, filterType) {
  return InventoryCore.matchesRecordFilter(log, filterType);
}

function verifyPin(location = "") {
  const pin = prompt("관리자 PIN을 입력하세요.");
  const locationManager = location ? state.locationManagers?.[location] : null;
  const managerPinOk = locationManager?.pin && locationManager.pin === pin && (!locationManager.teacher || locationManager.teacher === els.teacherSelect.value);
  if (pin !== getAdminPin() && !managerPinOk) {
    alert("PIN이 일치하지 않습니다.");
    return false;
  }
  return true;
}

function openModal({ title, body, submitText, onSubmit }) {
  const template = document.querySelector("#modalTemplate");
  const node = template.content.cloneNode(true);
  document.body.appendChild(node);
  const backdrop = document.querySelector(".modal-backdrop");
  const form = document.querySelector("#modalForm");
  document.querySelector("#modalTitle").textContent = title;
  document.querySelector("#modalBody").innerHTML = body;
  document.querySelector("#modalSubmit").textContent = submitText;

  backdrop.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => backdrop.remove());
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const shouldClose = onSubmit(new FormData(form));
    if (shouldClose) backdrop.remove();
  });

  return backdrop;
}

function field(label, name, value = "", required = false, type = "text", placeholder = "") {
  return `
    <label class="field">
      <span>${label}</span>
      <input name="${name}" type="${type}" value="${escapeHtml(String(value))}" ${required ? "required" : ""} ${placeholder ? `placeholder="${escapeHtml(placeholder)}"` : ""} />
    </label>
  `;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      current = "";
    } else {
      current += char;
    }
  }
  row.push(current);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function normalizeHeader(header) {
  const map = {
    물품명: "name",
    규격: "spec",
    카테고리: "category",
    "보관 장소": "location",
    보관장소: "location",
    "총 수량": "total",
    총수량: "total",
    단위: "unit",
    "소모품 여부": "consumable",
    소모품여부: "consumable",
    "관리 번호": "code",
    관리번호: "code",
    구입일: "purchasedAt",
    "구입 금액": "price",
    구입금액: "price",
    상태: "status",
    비고: "note",
  };
  const key = String(header || "").trim();
  return map[key] || key;
}

function normalizeDateCell(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return text;
}

function downloadCsv(filename, rows) {
  const csv = rows
    .map((row) =>
      row
        .map((cell) => {
          const value = String(cell ?? "");
          return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
        })
        .join(","),
    )
    .join("\n");
  downloadText(filename, csv, "text/csv;charset=utf-8");
}

function downloadText(filename, text, type = "text/plain;charset=utf-8") {
  const blob = new Blob([`\uFEFF${text}`], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function today() {
  return formatDateInTimeZone(new Date());
}

function toDisplayDate(value) {
  if (!value) return "";
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) return formatDateInTimeZone(parsed);
  return str.slice(0, 10);
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: KOREA_TIME_ZONE,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("ko-KR");
}

// 날짜 값을 항상 YYYY-MM-DD 문자열로 맞춘다(빈 값은 "").
// 스프레드시트가 날짜 칸을 Date로 바꿔 "2026-06-13T15:00:00.000Z" 같은 ISO 시각으로
// 돌려주는 경우 한국 시간 기준 날짜만 추출한다.
function normalizeDateValue(value) {
  if (!value) return "";
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; // 이미 날짜 형태면 그대로
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  return formatDateInTimeZone(d);
}

// 화면 표시용: 날짜만, 없으면 "-"
function formatDateOnly(value) {
  return normalizeDateValue(value) || "-";
}

function formatDateInTimeZone(date, timeZone = KOREA_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
