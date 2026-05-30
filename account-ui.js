// account-ui.js — 가입·로그인·대시보드·짧은주소·heartbeat
// index.html 에서 <script type="module" src="./account-ui.js"> 로 로드 (app.js 뒤)
// Firebase 12.14.0 modular SDK 사용

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────
function getDb()   { return window.fb.db;   }
function getAuth() { return window.fb.auth; }

function fbReady() {
  if (!window.fb) {
    alert("계정 기능이 아직 설정되지 않았습니다(관리자 설정 필요).");
    return false;
  }
  return true;
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ─── NEIS 학교 검색 ──────────────────────────────────────────────────────────
async function getNeisApiKey() {
  try {
    const snap = await getDoc(doc(getDb(), "settings", "neis"));
    return snap.exists() ? (snap.data().apiKey || "") : "";
  } catch { return ""; }
}

async function searchNeisSchools(schoolName) {
  const key = await getNeisApiKey();
  let url = `https://open.neis.go.kr/hub/schoolInfo?Type=json&pIndex=1&pSize=15&SCHUL_NM=${encodeURIComponent(schoolName)}`;
  if (key) url += `&KEY=${encodeURIComponent(key)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  const json = await resp.json();
  const rows = json.schoolInfo?.[1]?.row;
  if (!rows) return [];
  return rows.map(r => ({
    name:       r.SCHUL_NM,
    type:       r.SCHUL_KND_SC_NM,
    location:   r.LCTN_SC_NM,
    address:    r.ORG_RDNMA || "",
    neisCode:   r.SD_SCHUL_CODE,
    officeCode: r.ATPT_OFCDC_SC_CODE,
    officeNm:   r.ATPT_OFCDC_SC_NM,
  }));
}

// ─── 가입 ────────────────────────────────────────────────────────────────────
function openRegisterModal() {
  if (!fbReady()) return;
  let selectedSchool = null;

  const modal = window.openModal({
    title: "학교 계정 가입",
    submitText: "닫기",
    onSubmit: () => true,
    body: `
      <p class="helper" style="margin-bottom:12px;">
        나이스에서 학교를 검색해 선택한 뒤 계정 정보를 입력하세요. 총괄관리자 승인 후 로그인할 수 있습니다.
      </p>

      <label>학교 이름으로 검색
        <span style="display:flex;gap:6px;">
          <input id="regSearchInput" type="text" placeholder="예) 서울초" style="flex:1;" />
          <button class="ghost compact" id="regSearchBtn" type="button">검색</button>
        </span>
      </label>
      <ul id="regSearchResults" style="list-style:none;margin:0 0 8px;padding:0;
        max-height:200px;overflow:auto;border:1px solid var(--line);border-radius:6px;display:none;"></ul>

      <div id="regSelectedSchool" style="display:none;padding:10px;
        background:var(--surface2,#f0f4f0);border-radius:8px;margin-bottom:12px;">
        <span id="regSchoolName" style="font-weight:600;"></span>
        <span id="regSchoolType" class="badge green" style="font-size:11px;vertical-align:middle;margin-left:4px;"></span><br/>
        <small id="regSchoolAddress" style="color:var(--text2);"></small><br/>
        <button class="ghost compact" id="regSchoolReset" type="button" style="margin-top:4px;">다시 검색</button>
      </div>

      <div id="regAccountSection" style="display:none;">
        <label>로그인 아이디 (영문 소문자·숫자·-·_ / 4~20자)
          <input id="regUser" type="text" placeholder="예) seoul-elem-01" autocomplete="username" />
        </label>
        <label>비밀번호 (6자 이상)
          <input id="regPw" type="password" autocomplete="new-password" />
        </label>
        <label>연락 이메일 (필수)
          <input id="regEmail" type="email" placeholder="기관 이메일 권장" />
        </label>
        <label>담당자 이름 (선택)
          <input id="regName" type="text" />
        </label>
        <div style="margin:12px 0;padding:10px;border:1px solid var(--line);
          border-radius:8px;font-size:13px;line-height:1.6;">
          <strong>개인정보 수집·이용 동의</strong><br/>
          • 수집 항목: 연락 이메일, (선택)담당자 이름<br/>
          • 이용 목적: 서비스 장애·공지 연락, 가입 승인 확인<br/>
          • 보유 기간: 학교 계정 해지 시까지<br/>
          <label style="display:flex;align-items:center;gap:6px;margin-top:8px;">
            <input id="regConsent" type="checkbox" style="width:auto;" />
            위 내용에 동의합니다 (필수)
          </label>
        </div>
        <button class="primary" id="regSubmit" type="button" style="width:100%;">가입 신청</button>
      </div>`,
  });

  // 검색
  modal.querySelector("#regSearchBtn").addEventListener("click", async () => {
    const q = modal.querySelector("#regSearchInput").value.trim();
    if (q.length < 2) return alert("두 글자 이상 입력하세요.");
    const btn = modal.querySelector("#regSearchBtn");
    btn.textContent = "검색 중…";
    btn.disabled = true;
    const ul = modal.querySelector("#regSearchResults");
    ul.style.display = "none";
    ul.innerHTML = "";
    try {
      const results = await searchNeisSchools(q);
      if (!results.length) {
        ul.innerHTML = '<li style="padding:8px 10px;color:var(--text2);">검색 결과가 없습니다.</li>';
      } else {
        results.forEach(s => {
          const li = document.createElement("li");
          li.style.cssText = "padding:8px 10px;cursor:pointer;border-bottom:1px solid var(--line);";
          li.innerHTML = `<strong>${esc(s.name)}</strong>
            <span style="font-size:12px;color:var(--text2);">${esc(s.type)} · ${esc(s.location)}</span>`;
          li.addEventListener("click", () => {
            selectedSchool = s;
            modal.querySelector("#regSchoolName").textContent    = s.name;
            modal.querySelector("#regSchoolType").textContent    = s.type;
            modal.querySelector("#regSchoolAddress").textContent = s.address || s.location;
            modal.querySelector("#regSelectedSchool").style.display  = "block";
            modal.querySelector("#regSearchResults").style.display   = "none";
            modal.querySelector("#regAccountSection").style.display  = "block";
          });
          ul.appendChild(li);
        });
      }
      ul.style.display = "block";
    } catch (e) {
      alert("나이스 검색 오류: " + (e?.message || "네트워크를 확인하세요."));
    } finally {
      btn.textContent = "검색";
      btn.disabled = false;
    }
  });

  // 엔터로도 검색
  modal.querySelector("#regSearchInput").addEventListener("keydown", e => {
    if (e.key === "Enter") modal.querySelector("#regSearchBtn").click();
  });

  // 다시 검색
  modal.querySelector("#regSchoolReset").addEventListener("click", () => {
    selectedSchool = null;
    modal.querySelector("#regSelectedSchool").style.display  = "none";
    modal.querySelector("#regAccountSection").style.display  = "none";
    modal.querySelector("#regSearchInput").value = "";
  });

  // 가입 신청
  modal.querySelector("#regSubmit").addEventListener("click", () => handleRegister(modal, selectedSchool));
}

async function handleRegister(modal, school) {
  if (!school) return alert("학교를 먼저 검색해 선택하세요.");
  const user    = modal.querySelector("#regUser").value.trim().toLowerCase();
  const pw      = modal.querySelector("#regPw").value;
  const email   = modal.querySelector("#regEmail").value.trim();
  const name    = modal.querySelector("#regName").value.trim();
  const consent = modal.querySelector("#regConsent").checked;
  const Core    = window.AccountCore;

  if (!Core.isValidUsername(user))  return alert("아이디는 영문 소문자·숫자·-·_ 4~20자입니다.");
  if (pw.length < 6)               return alert("비밀번호는 6자 이상이어야 합니다.");
  if (!email)                      return alert("연락 이메일은 필수입니다.");
  if (!consent)                    return alert("개인정보 수집·이용에 동의해야 가입할 수 있습니다.");

  const submitBtn = modal.querySelector("#regSubmit");
  submitBtn.textContent = "처리 중…";
  submitBtn.disabled = true;

  try {
    const db   = getDb();
    const auth = getAuth();

    // 아이디 중복 검사
    const dup = await getDocs(query(collection(db, "schools"), where("username", "==", user), limit(1)));
    if (!dup.empty) { submitBtn.textContent = "가입 신청"; submitBtn.disabled = false; return alert("이미 사용 중인 아이디입니다."); }

    // Firebase Auth 사용자 생성 (합성 이메일)
    const cred = await createUserWithEmailAndPassword(auth, Core.usernameToAuthEmail(user), pw);

    // Firestore 학교 문서 생성 (uid = 문서 ID)
    await setDoc(doc(db, "schools", cred.user.uid), {
      schoolName:  school.name,
      neisCode:    school.neisCode,
      schoolType:  school.type,
      officeCode:  school.officeCode,
      officeNm:    school.officeNm,
      username:    user,
      email,
      contactName: name || "",
      status:      "pending",
      shortCode:   "",
      connection:  { deploymentId: "", apiKey: "", webAppUrl: "" },
      lastActiveAt: null,
      createdAt:   serverTimestamp(),
      approvedAt:  null,
      consentAt:   serverTimestamp(),
    });

    await signOut(auth); // 승인 전이므로 즉시 로그아웃
    alert("가입 신청이 접수되었습니다.\n총괄관리자 승인 후 로그인할 수 있습니다.");
    modal.remove();
  } catch (e) {
    submitBtn.textContent = "가입 신청";
    submitBtn.disabled = false;
    alert("가입 실패: " + (e?.message || e));
  }
}

// ─── 로그인 ──────────────────────────────────────────────────────────────────
function openLoginModal() {
  if (!fbReady()) return;
  const modal = window.openModal({
    title: "학교 로그인",
    submitText: "닫기",
    onSubmit: () => true,
    body: `
      <label>아이디 (이메일 아님 — 가입 시 직접 정한 영문 아이디)
        <input id="loginUser" type="text" placeholder="예) myschool-admin" autocomplete="username" />
      </label>
      <label>비밀번호<input id="loginPw" type="password" autocomplete="current-password" /></label>
      <button class="primary" id="loginSubmit" type="button" style="width:100%;margin-top:8px;">로그인</button>
      <button class="ghost compact" id="goRegister" type="button" style="width:100%;margin-top:8px;">
        처음이신가요? 학교 가입
      </button>`,
  });

  modal.querySelector("#loginPw").addEventListener("keydown", e => {
    if (e.key === "Enter") modal.querySelector("#loginSubmit").click();
  });
  modal.querySelector("#loginSubmit").addEventListener("click", () => handleLogin(modal));
  modal.querySelector("#goRegister").addEventListener("click", () => {
    modal.remove();
    openRegisterModal();
  });
}

async function handleLogin(modal) {
  const user = modal.querySelector("#loginUser").value.trim().toLowerCase();
  const pw   = modal.querySelector("#loginPw").value;
  const Core = window.AccountCore;
  if (!Core.isValidUsername(user) || !pw) return alert("아이디/비밀번호를 확인하세요.");

  const btn = modal.querySelector("#loginSubmit");
  btn.textContent = "로그인 중…";
  btn.disabled = true;

  try {
    const auth = getAuth();
    const db   = getDb();
    const cred = await signInWithEmailAndPassword(auth, Core.usernameToAuthEmail(user), pw);

    // 총괄관리자 확인 (uid 기반)
    const adminSnap = await getDoc(doc(db, "admins", cred.user.uid));
    if (adminSnap.exists() && adminSnap.data().role === "super") {
      modal.remove();
      openSuperAdminView();
      return;
    }

    // 일반 학교 계정 확인
    const snap = await getDoc(doc(db, "schools", cred.user.uid));
    const data = snap.exists() ? snap.data() : null;

    if (!data) {
      await signOut(auth);
      return alert("계정 정보를 찾을 수 없습니다. 관리자에게 문의하세요.");
    }
    if (data.status === "pending")   { await signOut(auth); return alert("아직 승인 대기 중입니다.\n총괄관리자 승인 후 이용할 수 있습니다."); }
    if (data.status === "rejected")  { await signOut(auth); return alert("가입이 거부되었습니다. 총괄관리자에게 문의하세요."); }
    if (data.status === "suspended") { await signOut(auth); return alert("정지된 계정입니다. 총괄관리자에게 문의하세요."); }

    // approved → 연결 관리 모달로
    modal.remove();
    openConnectionManager(cred.user.uid, data);
  } catch {
    alert("로그인 실패: 아이디 또는 비밀번호가 올바르지 않습니다.");
  } finally {
    btn.textContent = "로그인";
    btn.disabled = false;
  }
}

// ─── 연결 관리(로그인 후) ──────────────────────────────────────────────────
function openConnectionManager(uid, data) {
  const shortLink = data.shortCode ? `${location.origin}/?s=${data.shortCode}` : null;
  const conn      = data.connection || {};

  const modal = window.openModal({
    title: `${esc(data.schoolName)} — 연결 관리`,
    submitText: "닫기",
    onSubmit: () => true,
    body: `
      <div style="padding:8px 10px;background:var(--surface2,#f0f4f0);border-radius:6px;font-size:13px;margin-bottom:12px;">
        <strong>${esc(data.schoolName)}</strong>
        ${data.schoolType ? `<span class="badge green" style="font-size:11px;">${esc(data.schoolType)}</span>` : ""}
        <br/><span style="color:var(--text2);">${esc(data.officeNm || "")}</span>
      </div>

      <p class="helper">스프레드시트 웹앱을 배포한 뒤 아래에 연결정보를 저장하세요.</p>
      <label>웹앱 URL (/exec 로 끝나는 주소)
        <input id="connUrl" type="url" value="${esc(conn.webAppUrl || "")}"
          placeholder="https://script.google.com/macros/s/.../exec" />
      </label>
      <label>연결 키 (API_KEY)
        <input id="connKey" type="text" value="${esc(conn.apiKey || "")}" />
      </label>
      <button class="primary" id="connSave" type="button" style="width:100%;margin:8px 0;">연결정보 저장</button>

      ${shortLink ? `
      <div style="margin-top:12px;padding:10px;border:1px solid var(--line);border-radius:8px;">
        <strong>교사용 짧은 접속 주소</strong><br/>
        <code id="shortLinkText" style="font-size:13px;word-break:break-all;">${esc(shortLink)}</code><br/>
        <button class="ghost compact" id="copyShort" type="button" style="margin-top:6px;">복사</button>
        <p class="helper" style="margin-top:6px;">학교 내부 메신저로만 공유하세요. 외부에 공개하지 마세요.</p>
      </div>` : `<p class="helper">승인 후 짧은 접속 주소가 발급됩니다.</p>`}`,
  });

  // 연결정보 저장
  modal.querySelector("#connSave").addEventListener("click", async () => {
    const url = modal.querySelector("#connUrl").value.trim();
    const key = modal.querySelector("#connKey").value.trim();
    if (!url.includes("/macros/s/") || !url.endsWith("/exec"))
      return alert("웹앱 URL은 /macros/s/... 로 시작하고 /exec 로 끝나야 합니다.");
    if (!key) return alert("연결 키를 입력하세요.");
    const m = url.match(/\/macros\/s\/([^/]+)\/exec/);
    const deploymentId = m ? m[1] : "";
    const btn = modal.querySelector("#connSave");
    btn.textContent = "저장 중…";
    btn.disabled = true;
    try {
      const db = getDb();
      await updateDoc(doc(db, "schools", uid), {
        "connection.webAppUrl":    url,
        "connection.apiKey":       key,
        "connection.deploymentId": deploymentId,
      });
      // connections 미러도 갱신 (짧은 주소 조회용)
      if (data.shortCode) {
        await updateDoc(doc(db, "connections", data.shortCode), {
          webAppUrl: url, apiKey: key, deploymentId,
        });
      }
      alert("연결정보를 저장했습니다.");
    } catch (e) {
      alert("저장 실패: " + (e?.message || e));
    } finally {
      btn.textContent = "연결정보 저장";
      btn.disabled = false;
    }
  });

  // 짧은 주소 복사
  const copyBtn = modal.querySelector("#copyShort");
  if (copyBtn && shortLink) {
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(shortLink).then(() => {
        copyBtn.textContent = "복사됨 ✓";
        setTimeout(() => { copyBtn.textContent = "복사"; }, 2000);
      });
    });
  }
}

// ─── 총괄관리자 Google 로그인 ────────────────────────────────────────────────
async function openGoogleAdminLogin() {
  if (!fbReady()) return;
  try {
    const result = await signInWithPopup(getAuth(), new GoogleAuthProvider());
    const email  = result.user.email;
    const snap   = await getDoc(doc(getDb(), "admins", email));
    if (!snap.exists() || snap.data().role !== "super") {
      await signOut(getAuth());
      return alert("총괄관리자 권한이 없는 계정입니다:\n" + email +
        "\n\nFirestore admins 컬렉션에 이 이메일로 role:super 문서를 추가하세요.");
    }
    openSuperAdminView();
  } catch (e) {
    if (e.code !== "auth/popup-closed-by-user") {
      alert("Google 로그인 실패: " + (e?.message || e));
    }
  }
}

// ─── 총괄관리자 대시보드 (메인 뷰에 렌더링) ────────────────────────────────

/** 로그인 후 메인 뷰 전체를 총괄관리자 대시보드로 전환 */
function openSuperAdminView() {
  window._superAdminMode = true;
  document.body.classList.add("super-admin-mode"); // CSS로 불필요 UI 일괄 숨김

  // Hero 영역 업데이트
  const heroTitle = document.querySelector("#heroTitle");
  const heroSub   = document.querySelector("#heroSub");
  if (heroTitle) heroTitle.textContent = "총괄관리자 대시보드";
  if (heroSub) {
    heroSub.classList.remove("hero-sub-notice");
    heroSub.innerHTML = `<button class="ghost compact" id="superAdminLogoutBtn" type="button">로그아웃</button>`;
    heroSub.querySelector("#superAdminLogoutBtn").addEventListener("click", async () => {
      await signOut(getAuth());
      window._superAdminMode = false;
      document.body.classList.remove("super-admin-mode");
      location.reload();
    });
  }

  const mainView = document.querySelector("#mainView");
  if (!mainView) return;
  mainView.innerHTML = `<div class="empty-state"><p>불러오는 중…</p></div>`;
  renderSuperAdminContent(mainView).catch(e => {
    mainView.innerHTML = `<div class="empty-state"><h4>로드 실패</h4><p>${esc(e?.message || e)}</p></div>`;
  });
}

async function renderSuperAdminContent(container) {
  const db   = getDb();
  const Core = window.AccountCore;

  // NEIS 키
  const neisSnap    = await getDoc(doc(db, "settings", "neis"));
  const currentNeis = neisSnap.exists() ? (neisSnap.data().apiKey || "") : "";

  // 학교 목록 (최신 가입 순)
  const snap = await getDocs(query(collection(db, "schools"), orderBy("createdAt", "desc")));
  const now  = Date.now();

  const rows = snap.docs.map(d => {
    const v      = d.data();
    const lastMs = v.lastActiveAt?.toMillis?.() || 0;
    const inactive = v.status === "approved" && Core.isInactive(lastMs, now);

    const statusBadge =
      v.status === "pending"   ? '<span class="badge orange">승인대기</span>' :
      v.status === "approved"  ? '<span class="badge green">승인됨</span>'   :
      v.status === "suspended" ? '<span class="badge gray">정지</span>'      :
                                 '<span class="badge gray">거부</span>';
    const useBadge = v.status === "approved"
      ? (inactive ? '<span class="badge orange">미활용 30일+</span>' : '<span class="badge green">활용중</span>')
      : "";
    const lastTxt    = lastMs ? new Date(lastMs).toLocaleDateString("ko-KR") : "기록 없음";
    const shortLink  = v.shortCode ? `<a href="/?s=${esc(v.shortCode)}" target="_blank" class="helper">${esc(v.shortCode)}</a>` : "-";
    const schoolLabel = esc(v.schoolName) +
      (v.schoolType ? ` <small style="color:var(--text2);">(${esc(v.schoolType)})</small>` : "");

    let actions = "";
    if (v.status === "pending") {
      actions = `<button class="primary compact" data-approve="${d.id}">승인</button>
                 <button class="ghost compact" data-reject="${d.id}">거부</button>`;
    } else if (v.status === "approved") {
      actions = `<button class="ghost compact" data-suspend="${d.id}">정지</button>`;
    } else {
      actions = `<button class="ghost compact" data-approve="${d.id}">승인</button>`;
    }

    return `<tr>
      <td>${schoolLabel}</td>
      <td>${statusBadge} ${useBadge}</td>
      <td>${esc(v.email || "")}</td>
      <td>${shortLink}</td>
      <td>${lastTxt}</td>
      <td>${actions}</td>
    </tr>`;
  }).join("");

  container.innerHTML = `
    <div class="super-admin-dashboard">

      <div class="settings-block first">
        <div class="settings-block-head">
          <div>
            <h3>나이스(NEIS) API 키 설정</h3>
            <p class="helper">학교 가입 시 학교 검색에 사용됩니다.
              <a href="https://open.neis.go.kr" target="_blank" rel="noopener">open.neis.go.kr</a>에서 무료 신청.
              미설정 시 일 300건 제한.</p>
          </div>
        </div>
        <span style="display:flex;gap:6px;max-width:480px;">
          <input id="neisKeyInput" type="text" placeholder="발급받은 인증키 붙여넣기"
            value="${esc(currentNeis)}" style="flex:1;" />
          <button class="primary compact" id="neisKeySave" type="button">저장</button>
        </span>
        ${currentNeis
          ? `<p class="helper">현재 키: ${esc(currentNeis.slice(0, 12))}… (저장됨)</p>`
          : `<p class="helper">미설정 — 저장 없이도 하루 300건까지 검색 가능합니다.</p>`}
      </div>

      <div class="settings-block">
        <div class="settings-block-head">
          <div>
            <h3>가입 학교 목록</h3>
            <p class="helper">승인 대기 학교를 확인하고 승인 또는 거부하세요.</p>
          </div>
          <button class="ghost compact" id="superAdminRefresh" type="button">새로고침</button>
        </div>
        <div style="overflow-x:auto;">
          <table class="table">
            <thead><tr>
              <th>학교</th><th>상태</th><th>연락 이메일</th><th>접속 코드</th><th>마지막 활동</th><th>작업</th>
            </tr></thead>
            <tbody>
              ${rows || `<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:24px;">
                가입한 학교가 없습니다.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

    </div>`;

  // NEIS 키 저장
  container.querySelector("#neisKeySave").addEventListener("click", async () => {
    const key = container.querySelector("#neisKeyInput").value.trim();
    try {
      await setDoc(doc(db, "settings", "neis"), { apiKey: key }, { merge: true });
      alert(key ? "NEIS API 키를 저장했습니다." : "NEIS API 키를 삭제했습니다.");
      renderSuperAdminContent(container);
    } catch (e) { alert("저장 실패: " + (e?.message || e)); }
  });

  // 새로고침
  container.querySelector("#superAdminRefresh").addEventListener("click", () => {
    renderSuperAdminContent(container);
  });

  // 승인·거부·정지 — tbody에 직접 달아서 innerHTML 교체 시 자동 정리
  const tbody = container.querySelector("tbody");
  tbody?.addEventListener("click", async ev => {
    const t       = ev.target.closest("[data-approve],[data-reject],[data-suspend]");
    if (!t) return;
    const approve = t.getAttribute("data-approve");
    const reject  = t.getAttribute("data-reject");
    const suspend = t.getAttribute("data-suspend");
    t.disabled = true;
    try {
      if (approve) {
        const code  = await issueUniqueShortCode();
        const sref  = doc(db, "schools", approve);
        const sdoc  = await getDoc(sref);
        const sconn = sdoc.data()?.connection || {};
        const batch = writeBatch(db);
        batch.update(sref, { status: "approved", approvedAt: serverTimestamp(), shortCode: code });
        batch.set(doc(db, "connections", code), {
          shortCode:    code,
          deploymentId: sconn.deploymentId || "",
          apiKey:       sconn.apiKey       || "",
          webAppUrl:    sconn.webAppUrl    || "",
          lastActiveAt: null,
        });
        await batch.commit();
      } else if (reject) {
        await updateDoc(doc(db, "schools", reject), { status: "rejected" });
      } else if (suspend) {
        await updateDoc(doc(db, "schools", suspend), { status: "suspended" });
      }
      renderSuperAdminContent(container);
    } catch (e) {
      t.disabled = false;
      alert("작업 실패: " + (e?.message || e));
    }
  });
}

async function issueUniqueShortCode() {
  const db   = getDb();
  const Core = window.AccountCore;
  for (let i = 0; i < 8; i++) {
    const code = Core.generateShortCode(i < 4 ? 4 : 5);
    const snap = await getDoc(doc(db, "connections", code));
    if (!snap.exists()) return code;
  }
  return Core.generateShortCode(6);
}

// ─── 짧은 주소(?s=코드) 자동 연결 ──────────────────────────────────────────
async function resolveShortCodeFromUrl() {
  if (!window.fb) return;
  const code = new URLSearchParams(location.search).get("s");
  if (!code) return;

  // 이미 이 코드로 연결돼 있으면 heartbeat만 (재로드 루프 방지)
  if (window.getSchoolCode?.() === code) {
    heartbeat(code);
    return;
  }

  try {
    const connDoc = await getDoc(doc(getDb(), "connections", code));
    if (!connDoc.exists()) return;
    const conn = { ...connDoc.data(), shortCode: code };
    if (window.applyConnectionFromAccount?.(conn)) {
      // ?s= 파라미터 제거 후 리로드 → 다음 방문에서는 위의 getSchoolCode() 분기 탐
      const newUrl = new URL(location.href);
      newUrl.searchParams.delete("s");
      history.replaceState({}, "", newUrl.toString());
      location.reload();
    }
  } catch { /* 무시: 연결 실패 시 평소 화면 유지 */ }
}

// ─── 활용 추적(heartbeat) ────────────────────────────────────────────────────
const HEARTBEAT_KEY = "account_last_heartbeat_ms";

async function heartbeat(code) {
  if (!window.fb || !code) return;
  const Core = window.AccountCore;
  const last = parseInt(localStorage.getItem(HEARTBEAT_KEY) || "0", 10);
  if (!Core.shouldHeartbeat(last)) return; // 6시간 쓰로틀
  try {
    await updateDoc(doc(getDb(), "connections", code), {
      lastActiveAt: serverTimestamp(),
    });
    localStorage.setItem(HEARTBEAT_KEY, String(Date.now()));
  } catch { /* 조용히 무시 */ }
}

// ─── 전역 노출 ───────────────────────────────────────────────────────────────
window.account = {
  openRegister:       openRegisterModal,
  openLogin:          openLoginModal,
  openSuperAdminView,          // 콘솔에서 직접 호출 가능 (로그인 후)
  heartbeat,
  _searchNeisSchools: searchNeisSchools, // 브라우저 콘솔 테스트용
};

// ─── 부팅: 버튼 연결 + 짧은 주소 해석 ──────────────────────────────────────
document.querySelector("#accountBtn")?.addEventListener("click", openLoginModal);
document.querySelector("#superAdminBtn")?.addEventListener("click", openGoogleAdminLogin);

resolveShortCodeFromUrl().catch(() => {}); // 실패해도 앱 정상 동작
