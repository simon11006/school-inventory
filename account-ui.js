// account-ui.js — 가입·로그인·대시보드·짧은주소·heartbeat
// index.html 에서 <script type="module" src="./account-ui.js"> 로 로드 (app.js 뒤)
// Firebase 12.14.0 modular SDK 사용

// ─── 텔레그램 알림 설정 (신규 가입 알림용) ──────────────────────────────────
const TELEGRAM_BOT_TOKEN = "8859286021:AAHOwpOluLjWFeOBbNNubWuUHNyuiP8V7pI";
const TELEGRAM_CHAT_ID   = "461325046";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
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
      <div class="acct-form">
        <p class="acct-hint" style="margin:0;">나이스에서 학교를 검색해 선택한 뒤 계정 정보를 입력하세요.<br/>총괄관리자 승인 후 로그인할 수 있습니다.</p>

        <div class="acct-field">
          <span class="acct-label">학교 검색</span>
          <span class="acct-hint">학교 이름의 일부를 입력 후 Enter 또는 검색 버튼을 누르세요</span>
          <div style="display:flex;gap:6px;">
            <input id="regSearchInput" type="text" placeholder="예) 서울초등학교" style="flex:1;" />
            <button class="ghost compact" id="regSearchBtn" type="button">검색</button>
          </div>
        </div>

        <ul id="regSearchResults" style="list-style:none;margin:0;padding:0;
          max-height:180px;overflow:auto;border:1px solid var(--line);border-radius:8px;display:none;"></ul>

        <div id="regManualSection" style="display:none;" class="acct-form">
          <p class="acct-hint" style="margin:0;">나이스에 없는 경우 직접 입력하세요.</p>
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <div class="acct-field" style="flex:2;min-width:150px;">
              <span class="acct-label">학교 이름</span>
              <input id="manualSchoolName" type="text" placeholder="○○초등학교" />
            </div>
            <div class="acct-field" style="flex:1;min-width:100px;">
              <span class="acct-label">학교 종류</span>
              <select id="manualSchoolType">
                <option value="초등학교">초등학교</option>
                <option value="중학교">중학교</option>
                <option value="고등학교">고등학교</option>
                <option value="특수학교">특수학교</option>
                <option value="기타">기타</option>
              </select>
            </div>
          </div>
          <div class="acct-field">
            <span class="acct-label">주소 (선택)</span>
            <input id="manualSchoolAddr" type="text" placeholder="○○시 ○○구..." />
          </div>
          <button class="primary compact" id="manualSchoolConfirm" type="button">이 학교로 선택</button>
        </div>

        <button class="ghost compact" id="regManualToggle" type="button"
          style="font-size:12px;color:var(--ink-mute);">나이스에 없는 학교라면?</button>

        <div id="regSelectedSchool" class="acct-school-card" style="display:none;">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <strong id="regSchoolName"></strong>
            <span id="regSchoolType" class="badge green" style="font-size:11px;"></span>
          </div>
          <span class="acct-hint" id="regSchoolAddress"></span>
          <button class="ghost compact" id="regSchoolReset" type="button" style="margin-top:4px;">다시 검색</button>
        </div>

        <div id="regAccountSection" style="display:none;">

          <!-- 섹션: 계정 정보 -->
          <p class="reg-section-title">계정 정보</p>
          <div class="reg-section">
            <div style="display:flex;gap:12px;">
              <div class="acct-field" style="flex:1;">
                <span class="acct-label">로그인 아이디</span>
                <span class="acct-hint">영문·숫자·- · _ / 4~20자</span>
                <input id="regUser" type="text" autocomplete="username" />
              </div>
              <div class="acct-field" style="flex:1;">
                <span class="acct-label">비밀번호</span>
                <span class="acct-hint">6자 이상</span>
                <input id="regPw" type="password" autocomplete="new-password" />
              </div>
              <div class="acct-field" style="flex:1;">
                <span class="acct-label">비밀번호 확인</span>
                <span class="acct-hint">동일하게 입력</span>
                <input id="regPwConfirm" type="password" autocomplete="new-password" />
              </div>
            </div>
            <div class="acct-field">
              <span class="acct-label">연락 이메일 <span style="color:var(--danger,#c0392b);">*</span></span>
              <span class="acct-hint">총괄관리자 승인 알림 및 공지에 사용됩니다</span>
              <input id="regEmail" type="email" placeholder="school@example.go.kr" />
            </div>
          </div>

          <!-- 섹션: 담당자 정보 -->
          <p class="reg-section-title" style="margin-top:20px;">담당자 정보 <span class="acct-hint" style="font-weight:400;">(선택)</span></p>
          <div class="reg-section">
            <div style="display:flex;gap:12px;">
              <div class="acct-field" style="flex:1;">
                <span class="acct-label">이름</span>
                <input id="regName" type="text" />
              </div>
              <div class="acct-field" style="flex:1;">
                <span class="acct-label">업무</span>
                <input id="regRole" type="text" />
              </div>
            </div>
          </div>

          <!-- 개인정보 동의 -->
          <div class="acct-consent-box" style="margin-top:20px;">
            <strong>개인정보 수집·이용 동의</strong>
            <ul style="margin:8px 0 0;padding-left:18px;">
              <li>수집 항목: 연락 이메일, (선택) 담당자 이름·업무</li>
              <li>이용 목적: 서비스 장애·공지 연락, 가입 승인 확인</li>
              <li>보유 기간: 학교 계정 해지 시까지</li>
            </ul>
            <label style="display:flex;align-items:center;gap:8px;margin-top:10px;font-weight:600;">
              <input id="regConsent" type="checkbox" style="width:auto;margin:0;" />
              위 내용에 동의합니다 (필수)
            </label>
          </div>

          <button class="primary" id="regSubmit" type="button"
            style="width:100%;margin-top:20px;">가입 신청</button>
        </div>
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

  // 엔터로도 검색 (preventDefault로 form 제출 방지)
  modal.querySelector("#regSearchInput").addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      modal.querySelector("#regSearchBtn").click();
    }
  });

  // 나이스에 없는 학교 직접 입력 토글
  modal.querySelector("#regManualToggle").addEventListener("click", () => {
    const sec = modal.querySelector("#regManualSection");
    const visible = sec.style.display !== "none";
    sec.style.display = visible ? "none" : "block";
    modal.querySelector("#regManualToggle").textContent = visible ? "나이스에 없는 학교라면?" : "▲ 직접 입력 닫기";
  });

  // 직접 입력 학교 선택
  modal.querySelector("#manualSchoolConfirm").addEventListener("click", () => {
    const name = modal.querySelector("#manualSchoolName").value.trim();
    const type = modal.querySelector("#manualSchoolType").value;
    const addr = modal.querySelector("#manualSchoolAddr").value.trim();
    if (!name) return alert("학교 이름을 입력하세요.");
    selectedSchool = { name, type, location: addr, address: addr, neisCode: "", officeCode: "", officeNm: "" };
    modal.querySelector("#regSchoolName").textContent    = name;
    modal.querySelector("#regSchoolType").textContent    = type;
    modal.querySelector("#regSchoolAddress").textContent = addr;
    modal.querySelector("#regSelectedSchool").style.display  = "block";
    modal.querySelector("#regManualSection").style.display   = "none";
    modal.querySelector("#regManualToggle").style.display    = "none";
    modal.querySelector("#regAccountSection").style.display  = "block";
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
  const user      = modal.querySelector("#regUser").value.trim().toLowerCase();
  const pw        = modal.querySelector("#regPw").value;
  const pwConfirm = modal.querySelector("#regPwConfirm").value;
  const email     = modal.querySelector("#regEmail").value.trim();
  const name      = modal.querySelector("#regName").value.trim();
  const role      = modal.querySelector("#regRole").value.trim();
  const consent   = modal.querySelector("#regConsent").checked;
  const Core      = window.AccountCore;

  if (!Core.isValidUsername(user))  return alert("아이디는 영문 소문자·숫자·-·_ 4~20자입니다.");
  if (pw.length < 6)               return alert("비밀번호는 6자 이상이어야 합니다.");
  if (pw !== pwConfirm)            return alert("비밀번호와 비밀번호 확인이 일치하지 않습니다.");
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

    // Firebase Auth 세션용 내부 토큰 생성 (사용자에게 노출 안 됨)
    const authToken = Core.generateShortCode(16);
    let cred;
    try {
      cred = await createUserWithEmailAndPassword(auth, Core.usernameToAuthEmail(user), authToken);
    } catch (authErr) {
      if (authErr.code === "auth/email-already-in-use") {
        // 이전에 삭제된 학교의 아이디 — Firestore 문서는 없지만 Auth 계정이 남아있는 경우
        // 기존 Auth 계정에 새 토큰으로 로그인해서 재사용
        const deletedDoc = await getDocs(query(collection(db, "deletedSchools"), where("username", "==", user), limit(1)));
        if (!deletedDoc.empty) {
          const oldToken = deletedDoc.docs[0].data()._authToken;
          cred = await signInWithEmailAndPassword(auth, Core.usernameToAuthEmail(user), oldToken);
        } else {
          submitBtn.textContent = "가입 신청"; submitBtn.disabled = false;
          return alert("이미 사용 중인 아이디입니다. 다른 아이디를 선택해주세요.");
        }
      } else {
        throw authErr;
      }
    }

    // Firestore 학교 문서 생성 — password: 실제 사용자 비밀번호, _authToken: Firebase Auth용
    await setDoc(doc(db, "schools", cred.user.uid), {
      schoolName:  school.name,
      neisCode:    school.neisCode,
      schoolType:  school.type,
      officeCode:  school.officeCode,
      officeNm:    school.officeNm,
      username:    user,
      email,
      contactName: name || "",
      contactRole: role || "",
      password:    pw,
      _authToken:  authToken,
      status:      "pending",
      shortCode:   "",
      connection:  { deploymentId: "", apiKey: "", webAppUrl: "" },
      lastActiveAt: null,
      createdAt:   serverTimestamp(),
      approvedAt:  null,
      consentAt:   serverTimestamp(),
    });

    await signOut(auth); // 승인 전이므로 즉시 로그아웃

    // 관리자에게 텔레그램 알림 발송
    if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
      try {
        const msg = `🏫 새 학교 가입 신청\n\n학교명: ${school.name}\n아이디: ${user}\n이메일: ${email}\n신청 시각: ${new Date().toLocaleString("ko-KR")}`;
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg }),
        });
      } catch { /* 알림 실패 시 가입 흐름에 영향 없음 */ }
    }

    // alert 대신 모달 내용을 완료 화면으로 교체
    const body = modal.querySelector("#modalBody");
    const footer = modal.querySelector(".modal-footer, .modal-actions");
    if (body) {
      body.innerHTML = `
        <div style="text-align:center;padding:24px 8px;">
          <div style="font-size:40px;margin-bottom:16px;">✅</div>
          <h3 style="margin:0 0 12px;font-size:18px;">가입 신청이 접수되었습니다</h3>
          <p style="margin:0 0 8px;line-height:1.7;color:var(--ink-mute);">
            보통 <strong>1~2일 내</strong>에 승인됩니다.<br/>
            승인 완료 전까지는 로그인이 제한됩니다.
          </p>
          <p style="margin:8px 0 0;font-size:13px;color:var(--ink-mute);">
            기간이 지나도 승인되지 않으면<br/>
            화면 왼쪽 하단 <strong>웹앱 수정 요청 문의</strong> 버튼으로<br/>
            문의해 주세요.
          </p>
          <button class="primary" id="regDoneBtn" type="button"
            style="margin-top:24px;min-width:120px;">확인</button>
        </div>
      `;
      modal.querySelector("#regDoneBtn")?.addEventListener("click", () => modal.remove());
    } else {
      alert("가입 신청이 접수되었습니다.\n총괄관리자 승인 후 로그인할 수 있습니다.");
      modal.remove();
    }
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
    title: "학교 계정 로그인",
    submitText: "닫기",
    onSubmit: () => true,
    body: `
      <div class="acct-form">
        <div style="display:flex;gap:12px;">
          <div class="acct-field" style="flex:1;">
            <span class="acct-label">아이디</span>
            <input id="loginUser" type="text" autocomplete="username" />
          </div>
          <div class="acct-field" style="flex:1;">
            <span class="acct-label">비밀번호</span>
            <input id="loginPw" type="password" autocomplete="current-password" />
          </div>
        </div>
        <button class="primary" id="loginSubmit" type="button" style="width:100%;">로그인</button>
        <div style="display:flex;gap:8px;">
          <button class="ghost compact" id="goRegister" type="button" style="flex:1;">
            처음이신가요? 가입 →
          </button>
          <button class="ghost compact" id="forgotPwBtn" type="button"
            style="flex:1;font-size:12px;color:var(--ink-mute);">
            비밀번호 찾기
          </button>
        </div>
      </div>`,
  });
  modal.querySelector(".modal")?.classList.add("modal-sm");

  modal.querySelector("#loginPw").addEventListener("keydown", e => {
    if (e.key === "Enter") modal.querySelector("#loginSubmit").click();
  });
  modal.querySelector("#loginSubmit").addEventListener("click", () => handleLogin(modal));
  modal.querySelector("#goRegister").addEventListener("click", () => {
    modal.remove();
    openRegisterModal();
  });
  modal.querySelector("#forgotPwBtn").addEventListener("click", () => {
    modal.remove();
    openForgotPasswordModal();
  });
}

// ─── 비밀번호 찾기 (학교 사용자용) ──────────────────────────────────────────
function openForgotPasswordModal() {
  if (!fbReady()) return;
  const modal = window.openModal({
    title: "비밀번호 찾기",
    submitText: "닫기",
    onSubmit: () => true,
    body: `
      <div class="acct-form">
        <p class="acct-hint" style="margin:0;">가입 시 사용한 아이디를 입력하면 등록 연락처를 확인해 드립니다.</p>
        <div style="display:flex;gap:8px;align-items:flex-end;">
          <div class="acct-field" style="flex:1;">
            <span class="acct-label">아이디</span>
            <input id="forgotUser" type="text" autocomplete="username" />
          </div>
          <button class="primary" id="forgotSubmit" type="button"
            style="white-space:nowrap;margin-bottom:0;">확인</button>
        </div>
        <div id="forgotResult"></div>
      </div>`,
  });

  modal.querySelector("#forgotUser").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); modal.querySelector("#forgotSubmit").click(); }
  });

  modal.querySelector("#forgotSubmit").addEventListener("click", async () => {
    const username = modal.querySelector("#forgotUser").value.trim().toLowerCase();
    if (!username) return;
    const btn = modal.querySelector("#forgotSubmit");
    btn.textContent = "조회 중…"; btn.disabled = true;
    try {
      const db = getDb();
      const qs = await getDocs(
        query(collection(db, "schools"), where("username", "==", username), limit(1))
      );
      const result = modal.querySelector("#forgotResult");
      if (qs.empty) {
        result.innerHTML = `
          <div class="acct-school-card" style="border-color:var(--danger,#c0392b);">
            <p style="margin:0;color:var(--danger,#c0392b);">해당 아이디로 가입된 계정을 찾을 수 없습니다.</p>
          </div>`;
      } else {
        const data  = qs.docs[0].data();
        const email = data.email || "";
        result.innerHTML = `
          <div class="acct-school-card">
            <p style="margin:0 0 6px;font-weight:600;">${esc(data.schoolName)}</p>
            <p style="margin:0 0 8px;">총괄관리자에게 비밀번호 초기화를 요청하세요.</p>
            <p class="acct-hint" style="margin:0;">문의처: <strong>endeavor1006@naver.com</strong></p>
          </div>`;
      }
    } catch (e) {
      alert("조회 실패: " + (e?.message || e));
    } finally {
      btn.textContent = "확인"; btn.disabled = false;
    }
  });
}

async function handleLogin(modal) {
  const user = modal.querySelector("#loginUser").value.trim().toLowerCase();
  const pw   = modal.querySelector("#loginPw").value;
  const Core = window.AccountCore;
  if (!user || !pw) return alert("아이디/비밀번호를 확인하세요.");

  const btn = modal.querySelector("#loginSubmit");
  btn.textContent = "로그인 중…";
  btn.disabled = true;

  try {
    const auth = getAuth();
    const db   = getDb();

    // ── 학교 계정: Firestore 비밀번호 검증 후 내부 토큰으로 Firebase Auth ──
    const qs = await getDocs(query(collection(db, "schools"), where("username", "==", user), limit(1)));
    if (!qs.empty) {
      const schoolDoc  = qs.docs[0];
      const schoolData = schoolDoc.data();

      if (schoolData.password !== pw) {
        btn.textContent = "로그인"; btn.disabled = false;
        return alert("아이디 또는 비밀번호가 올바르지 않습니다.");
      }
      const cred = await signInWithEmailAndPassword(auth, Core.usernameToAuthEmail(schoolData.username), schoolData._authToken);

      if (schoolData.status === "pending")   { await signOut(auth); btn.textContent = "로그인"; btn.disabled = false; return alert("아직 승인 대기 중입니다.\n총괄관리자 승인 후 이용할 수 있습니다."); }
      if (schoolData.status === "rejected")  { await signOut(auth); btn.textContent = "로그인"; btn.disabled = false; return alert("가입이 거부되었습니다. 총괄관리자에게 문의하세요."); }
      if (schoolData.status === "suspended") { await signOut(auth); btn.textContent = "로그인"; btn.disabled = false; return alert("정지된 계정입니다. 총괄관리자에게 문의하세요."); }

      modal.remove();
      // 학교 계정 인증 완료 → 관리자 모드 자동 진입 (PIN 재입력 불필요)
      window.enterSchoolAdminMode?.();
      // 설정 완료 상태면 팝업 생략 — 미완료 상태일 때만 연결 관리 화면 표시
      const conn = schoolData.connection || {};
      const fullyConnected = !!(schoolData.shortCode && conn.webAppUrl && conn.apiKey);
      if (!fullyConnected) openConnectionManager(cred.user.uid, schoolData);
      return;
    }

    // ── 총괄관리자: 합성 이메일로 Firebase Auth 직접 로그인 ──
    const cred = await signInWithEmailAndPassword(auth, Core.usernameToAuthEmail(user), pw);
    const adminSnap = await getDoc(doc(db, "admins", cred.user.uid));
    if (adminSnap.exists() && adminSnap.data().role === "super") {
      modal.remove();
      openSuperAdminView();
      return;
    }

    await signOut(auth);
    alert("계정 정보를 찾을 수 없습니다. 관리자에게 문의하세요.");
  } catch {
    alert("로그인 실패: 아이디 또는 비밀번호가 올바르지 않습니다.");
  } finally {
    btn.textContent = "로그인";
    btn.disabled = false;
  }
}

// 스프레드시트가 만든 "접속 링크"에서 웹앱 URL·연결 키를 자동 추출
// 지원 형식: ?d=배포ID&k=키 / ?u=URL&k=키 / ?gs_url=&gs_key= / 순수 /exec URL
function parseConnectionLink(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const PREFIX = "https://script.google.com/macros/s/";
  const SUFFIX = "/exec";
  let params;
  try {
    params = new URL(text).searchParams;
  } catch {
    const q = text.indexOf("?");
    params = new URLSearchParams(q >= 0 ? text.slice(q + 1) : text);
  }
  const apiKey = params.get("k") || params.get("gs_key") || "";
  let webAppUrl = params.get("u") || params.get("gs_url") || "";
  const d = params.get("d");
  if (!webAppUrl && d) webAppUrl = PREFIX + d + SUFFIX;
  // 파라미터 없이 /exec 주소만 붙여넣은 경우
  if (!webAppUrl && text.includes("/macros/s/") && text.includes("/exec")) {
    webAppUrl = text.split(/[?#]/)[0];
  }
  if (!webAppUrl || !apiKey) return null;
  const m = webAppUrl.match(/\/macros\/s\/([^/]+)\/exec/);
  return { webAppUrl, apiKey, deploymentId: m ? m[1] : "" };
}

// ─── 학교 관리자 로그아웃 (종료 버튼 및 로그아웃 버튼 공통) ──────────────────
async function doSchoolAdminLogout() {
  await signOut(getAuth());
  window.exitSchoolAdminMode?.();
  const accountBtn = document.querySelector("#accountBtn");
  if (accountBtn) {
    accountBtn.textContent = "학교 관리자 로그인";
    accountBtn.style.color = "";
    accountBtn.onclick = null;
    accountBtn.addEventListener("click", openLoginModal);
  }
  location.reload();
}

function setupLogoutBtn(accountBtn) {
  // 별도 로그아웃 버튼 제거 — 종료 버튼이 로그아웃까지 처리하므로 불필요
  const logoutBtn = document.querySelector("#accountLogoutBtn");
  if (logoutBtn) logoutBtn.hidden = true;
}

// ─── 학교 계정 비밀번호 변경 ─────────────────────────────────────────────────
// schools/{uid}.password 만 갱신한다. Firebase Auth 세션은 내부 _authToken 으로
// 유지되므로 비밀번호를 바꿔도 로그아웃되지 않는다.
async function changeSchoolPassword(currentPw, newPw) {
  if (!window.fb) return { ok: false, message: "계정 기능이 설정되지 않았습니다." };
  const user = getAuth().currentUser;
  if (!user) return { ok: false, message: "로그인 상태가 아닙니다. 다시 로그인해 주세요." };
  try {
    const ref = doc(getDb(), "schools", user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { ok: false, message: "학교 계정을 찾을 수 없습니다." };
    if (snap.data().password !== currentPw) {
      return { ok: false, message: "현재 비밀번호가 일치하지 않습니다." };
    }
    await updateDoc(ref, { password: newPw });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: "변경 실패: " + (e?.message || e) };
  }
}

// ─── 연결 관리(로그인 후) ──────────────────────────────────────────────────
function openConnectionManager(uid, data) {
  const shortLink      = data.shortCode ? `${location.origin}/?s=${data.shortCode}` : null;
  const conn           = data.connection || {};
  const hasConn        = !!(conn.webAppUrl && conn.apiKey);
  const fullyConnected = shortLink && hasConn;   // 승인 + 웹앱 설정 모두 완료

  const modal = window.openModal({
    title: `${esc(data.schoolName)}`,
    submitText: "닫기",
    onSubmit: () => { location.reload(); return true; },
    body: `
      <div class="acct-form">

        <!-- 학교 정보 + 로그아웃 -->
        <div class="acct-school-card" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <div>
            <strong>${esc(data.schoolName)}</strong>
            ${data.schoolType ? `<span class="badge green" style="font-size:11px;margin-left:4px;">${esc(data.schoolType)}</span>` : ""}
            <br/><span class="acct-hint">${esc(data.officeNm || "")}</span>
          </div>
          <button class="ghost compact" id="connLogoutBtn" type="button"
            style="white-space:nowrap;font-size:12px;">로그아웃</button>
        </div>

        ${!shortLink ? `
        <!-- 상태 1: 승인 대기 -->
        <div style="padding:14px 16px;background:#fff8e1;border:1px solid #f0c040;border-radius:10px;">
          <p style="margin:0;font-weight:600;color:#a07000;">⏳ 총괄관리자 승인을 기다리고 있습니다.</p>
          <p class="acct-hint" style="margin:6px 0 0;">승인 후 로그인하면 다음 설정을 진행할 수 있습니다.</p>
        </div>

        ` : !hasConn ? `
        <!-- 상태 2: 승인됨 — 구글 스프레드시트 연결 설정 필요 -->
        <div style="padding:14px 16px;background:#f0f8f4;border:1px solid var(--accent,#5B8A6F);border-radius:10px;margin-bottom:4px;">
          <p style="margin:0;font-weight:600;color:var(--accent,#5B8A6F);">✅ 계정 승인 완료 — 아래 설정을 진행하세요</p>
        </div>

        ` : `
        <!-- 상태 3: 완전 연결 완료 -->
        <div style="padding:14px 16px;background:#f0f8f4;border:1px solid var(--accent,#5B8A6F);border-radius:10px;">
          <p style="margin:0 0 10px;font-weight:600;color:var(--accent,#5B8A6F);">✅ 설정 완료</p>
          <button class="primary" id="openSchoolBtn" type="button" style="width:100%;margin-bottom:12px;">
            지금 바로 우리 학교 열기 →
          </button>
          <p class="acct-hint" style="margin:0 0 4px;">교사 초대 주소</p>
          <code id="shortLinkText" style="font-size:13px;word-break:break-all;display:block;margin-bottom:10px;">${esc(shortLink)}</code>
          <div style="display:flex;gap:8px;">
            <button class="primary compact" id="copyShort" type="button">주소 복사</button>
            <button class="ghost compact" id="showConnEdit" type="button">연결 정보 수정</button>
          </div>
          <p class="acct-hint" style="margin:8px 0 0;color:#c0392b;">⚠️ 학교 내부 메신저로만 공유. 외부 공개 금지.</p>
        </div>
        `}

        <!-- 연결 정보 입력 영역: 미설정이거나 수정 버튼 클릭 시 표시 -->
        ${shortLink ? `
        <div id="connEditArea" style="display:${hasConn ? "none" : "block"};">
          <div style="padding:16px;border:1px solid var(--line);border-radius:10px;background:var(--surface2,#f9f9f9);">
            <p style="margin:0 0 6px;font-weight:600;font-size:14px;">📋 구글 스프레드시트 연결</p>
            <p style="margin:0 0 10px;font-size:13px;line-height:1.7;color:var(--ink-mute);">
              아직 스프레드시트를 안 만드셨다면 가이드를 먼저 따라 하세요.
            </p>
            <a href="./처음설정가이드.html" target="_blank" rel="noopener"
              style="display:inline-block;margin-bottom:14px;font-size:13px;font-weight:600;color:var(--accent,#5B8A6F);">
              📖 처음 설정 가이드 열기 →
            </a>

            <div class="acct-field">
              <span class="acct-label">접속 링크 붙여넣기</span>
              <span class="acct-hint">스프레드시트 메뉴 [교구이음 → ④ 우리 학교 접속 링크]에서 복사한 주소</span>
              <input id="connLink" type="text"
                placeholder="https://item-school.netlify.app/?d=...&k=..." />
            </div>
            <button class="primary" id="connSave" type="button" style="width:100%;margin-top:12px;">연결하기</button>

            <button class="ghost compact" id="connAdvToggle" type="button"
              style="width:100%;font-size:12px;color:var(--ink-mute);margin-top:8px;">
              링크가 없으면 · URL과 연결 키 직접 입력
            </button>
            <div id="connAdvArea" style="display:none;margin-top:12px;padding-top:12px;border-top:1px dashed var(--line);">
              <div class="acct-field" style="margin-bottom:12px;">
                <span class="acct-label">웹앱 주소</span>
                <span class="acct-hint">/exec 로 끝나는 배포 주소</span>
                <input id="connUrl" type="url" value="${esc(conn.webAppUrl || "")}"
                  placeholder="https://script.google.com/macros/s/.../exec" />
              </div>
              <div class="acct-field">
                <span class="acct-label">연결 키</span>
                <span class="acct-hint">시트 settings 탭의 API_KEY 값</span>
                <input id="connKey" type="text" value="${esc(conn.apiKey || "")}" />
              </div>
            </div>
          </div>
        </div>
        ` : ""}

      </div>`,
  });

  // 지금 바로 우리 학교 열기 — 검증된 ?s= 접속 경로 재사용(연결 적용 후 리로드)
  modal.querySelector("#openSchoolBtn")?.addEventListener("click", () => {
    location.href = shortLink;
  });

  // 주소 복사
  const copyBtn = modal.querySelector("#copyShort");
  if (copyBtn && shortLink) {
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(shortLink).then(() => {
        copyBtn.textContent = "복사됨 ✓";
        setTimeout(() => { copyBtn.textContent = "주소 복사"; }, 2000);
      });
    });
  }

  // 로그아웃 — 관리자 권한도 함께 해제
  modal.querySelector("#connLogoutBtn").addEventListener("click", async () => {
    await signOut(getAuth());
    window.exitSchoolAdminMode?.();
    modal.remove();
    const accountBtn = document.querySelector("#accountBtn");
    if (accountBtn) {
      accountBtn.textContent = "학교 관리자 로그인";
      accountBtn.style.color = "";
      accountBtn.onclick = null;
    }
    location.reload();
  });

  // 연결 정보 수정 토글
  modal.querySelector("#showConnEdit")?.addEventListener("click", () => {
    modal.querySelector("#connEditArea").style.display = "block";
  });

  // URL·키 직접 입력 토글
  modal.querySelector("#connAdvToggle")?.addEventListener("click", () => {
    const adv = modal.querySelector("#connAdvArea");
    adv.style.display = adv.style.display === "none" ? "block" : "none";
  });

  // 연결정보 저장 — 링크 우선, 없으면 직접 입력
  modal.querySelector("#connSave")?.addEventListener("click", async () => {
    const link = modal.querySelector("#connLink").value.trim();
    let parsed = null;

    if (link) {
      parsed = parseConnectionLink(link);
      if (!parsed)
        return alert("올바른 접속 링크가 아닙니다.\n스프레드시트 [교구이음 → ④ 우리 학교 접속 링크]에서 복사한 주소를 그대로 붙여넣으세요.");
    } else {
      const url = modal.querySelector("#connUrl").value.trim();
      const key = modal.querySelector("#connKey").value.trim();
      if (!url && !key)
        return alert("접속 링크를 붙여넣거나, URL·연결 키를 직접 입력하세요.");
      if (!url.includes("/macros/s/") || !url.endsWith("/exec"))
        return alert("웹앱 URL은 /macros/s/... 로 시작하고 /exec 로 끝나야 합니다.");
      if (!key) return alert("연결 키를 입력하세요.");
      const m = url.match(/\/macros\/s\/([^/]+)\/exec/);
      parsed = { webAppUrl: url, apiKey: key, deploymentId: m ? m[1] : "" };
    }

    const btn = modal.querySelector("#connSave");
    btn.textContent = "연결 중…";
    btn.disabled = true;
    try {
      const db = getDb();
      await updateDoc(doc(db, "schools", uid), {
        "connection.webAppUrl":    parsed.webAppUrl,
        "connection.apiKey":       parsed.apiKey,
        "connection.deploymentId": parsed.deploymentId,
      });
      if (data.shortCode) {
        await updateDoc(doc(db, "connections", data.shortCode), {
          schoolName:   data.schoolName || "",
          webAppUrl: parsed.webAppUrl, apiKey: parsed.apiKey, deploymentId: parsed.deploymentId,
        });
      }
      // 로컬 연결에도 즉시 반영 → 닫기 후 새로고침 시 추가 리로드 방지
      window.applyConnectionFromAccount?.({
        webAppUrl: parsed.webAppUrl, apiKey: parsed.apiKey, deploymentId: parsed.deploymentId,
        shortCode: data.shortCode, schoolName: data.schoolName,
      });
      alert("연결됐습니다! 교사 초대 주소를 학교 내부 메신저로 공유하세요.");
      modal.remove();
      // 갱신된 연결 정보로 모달 재오픈 → 교사 초대 주소·복사 버튼 즉시 표시
      openConnectionManager(uid, {
        ...data,
        connection: { webAppUrl: parsed.webAppUrl, apiKey: parsed.apiKey, deploymentId: parsed.deploymentId },
      });
    } catch (e) {
      alert("저장 실패: " + (e?.message || e));
      btn.textContent = "연결하기";
      btn.disabled = false;
    }
  });
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
  document.body.classList.add("super-admin-mode");

  // 상단 학교명 영역 → 총괄관리자 표시
  const schoolNameEl = document.querySelector("#schoolName");
  if (schoolNameEl) {
    schoolNameEl.textContent = "총괄관리자 모드";
    schoolNameEl.classList.remove("needs-setup");
  }

  // Hero 영역: 제목·로그아웃 버튼 제거 (헤더로 이동)
  const heroTitle = document.querySelector("#heroTitle");
  const heroSub   = document.querySelector("#heroSub");
  if (heroTitle) heroTitle.textContent = "";
  if (heroSub)  { heroSub.classList.remove("hero-sub-notice"); heroSub.innerHTML = ""; }

  // 헤더 오른쪽에 로그아웃 버튼 추가
  const topbarButtons = document.querySelector(".topbar-buttons");
  if (topbarButtons && !topbarButtons.querySelector("#superAdminLogoutBtn")) {
    const logoutBtn = document.createElement("button");
    logoutBtn.className = "ghost";
    logoutBtn.id = "superAdminLogoutBtn";
    logoutBtn.textContent = "로그아웃";
    logoutBtn.addEventListener("click", async () => {
      await signOut(getAuth());
      window._superAdminMode = false;
      document.body.classList.remove("super-admin-mode");
      const sadminNav = document.querySelector("#sadminSideNav");
      if (sadminNav) sadminNav.remove();
      logoutBtn.remove();
      location.reload();
    });
    topbarButtons.prepend(logoutBtn);
  }

  // ── 사이드바에 관리자 메뉴 주입 ─────────────────────────
  const sidebar = document.querySelector(".sidebar");
  if (sidebar && !sidebar.querySelector("#sadminSideNav")) {
    const adminNav = document.createElement("nav");
    adminNav.id = "sadminSideNav";
    adminNav.innerHTML = `
      <p class="side-label">관리자 메뉴</p>
      <button class="nav-item active" data-sadmin-tab="schools" type="button">
        <span class="nav-glyph" aria-hidden="true">🏫</span>가입 학교
      </button>
      <button class="nav-item" data-sadmin-tab="accounts" type="button">
        <span class="nav-glyph" aria-hidden="true">🔑</span>아이디 관리
      </button>
      <button class="nav-item" data-sadmin-tab="settings" type="button">
        <span class="nav-glyph" aria-hidden="true">⚙️</span>시스템 설정
      </button>`;
    sidebar.appendChild(adminNav);

    // 사이드바 클릭 → 패널 전환
    adminNav.addEventListener("click", e => {
      const btn = e.target.closest("[data-sadmin-tab]");
      if (!btn) return;
      adminNav.querySelectorAll("[data-sadmin-tab]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const mainView = document.querySelector("#mainView");
      mainView?.querySelectorAll(".sadmin-panel").forEach(p => p.classList.remove("active"));
      mainView?.querySelector(`#sadmin-${btn.dataset.sadminTab}`)?.classList.add("active");
    });
  }

  const mainView = document.querySelector("#mainView");
  if (!mainView) return;
  mainView.innerHTML = `<div style="padding:28px;color:var(--ink-mute);">불러오는 중…</div>`;
  renderSuperAdminContent(mainView).catch(e => {
    mainView.innerHTML = `<div class="empty-state"><h4>로드 실패</h4><p>${esc(e?.message || e)}</p></div>`;
  });
}

async function renderSuperAdminContent(container) {
  const db   = getDb();
  const Core = window.AccountCore;

  container.innerHTML = `<div style="padding:28px;color:var(--ink-mute);">불러오는 중…</div>`;

  const [neisSnap, snap] = await Promise.all([
    getDoc(doc(db, "settings", "neis")),
    getDocs(query(collection(db, "schools"), orderBy("createdAt", "desc"))),
  ]);
  const currentNeis = neisSnap.exists() ? (neisSnap.data().apiKey || "") : "";
  const now = Date.now();

  // ── 탭1: 가입 학교 관리 행 ───────────────────────────────
  const schoolRows = snap.docs.map(d => {
    const v      = d.data();
    const lastMs = v.lastActiveAt?.toMillis?.() || 0;
    const inactive = v.status === "approved" && Core.isInactive(lastMs, now);

    const statusBadge =
      v.status === "pending"   ? '<span class="badge orange">승인대기</span>' :
      v.status === "approved"  ? '<span class="badge green">승인됨</span>'    :
      v.status === "suspended" ? '<span class="badge gray">정지</span>'       :
                                 '<span class="badge gray">거부</span>';
    const useBadge = v.status === "approved"
      ? (inactive ? '<span class="badge orange">미활용</span>' : '<span class="badge green">활용중</span>')
      : "";
    const lastTxt   = lastMs ? new Date(lastMs).toLocaleDateString("ko-KR") : "−";
    const shortLink = v.shortCode
      ? `<a href="/?s=${esc(v.shortCode)}" target="_blank">${esc(v.shortCode)}</a>`
      : "−";

    let actions = "";
    if (v.status === "pending") {
      actions = `<button class="primary compact" data-approve="${d.id}">승인</button>
                 <button class="ghost compact"   data-reject="${d.id}">거부</button>`;
    } else if (v.status === "approved") {
      actions = `<button class="ghost compact" data-suspend="${d.id}">정지</button>`;
    } else {
      actions = `<button class="ghost compact" data-approve="${d.id}">승인</button>`;
    }
    actions += ` <button class="ghost compact" data-edit="${d.id}">편집</button>
               <button class="ghost compact" data-delete="${d.id}" data-name="${esc(v.schoolName)}"
                 style="color:var(--danger,#c0392b);">삭제</button>`;

    return `<tr>
      <td>${esc(v.schoolName)}${v.schoolType ? ` <small style="color:var(--ink-mute);">(${esc(v.schoolType)})</small>` : ""}</td>
      <td style="white-space:nowrap;">${statusBadge} ${useBadge}</td>
      <td>${esc(v.email || "")}</td>
      <td>${shortLink}</td>
      <td>${lastTxt}</td>
      <td style="white-space:nowrap;">${actions}</td>
    </tr>`;
  }).join("");

  // ── 탭2: 아이디 관리 행 ─────────────────────────────────
  const accountRows = snap.docs.map(d => {
    const v = d.data();
    const statusBadge =
      v.status === "pending"   ? '<span class="badge orange">승인대기</span>' :
      v.status === "approved"  ? '<span class="badge green">승인됨</span>'    :
      v.status === "suspended" ? '<span class="badge gray">정지</span>'       :
                                 '<span class="badge gray">거부</span>';
    const contact = [v.contactName, v.contactRole].filter(Boolean).join(" · ") || "−";
    return `<tr>
      <td>${esc(v.schoolName)}</td>
      <td>${statusBadge}</td>
      <td><code style="font-size:13px;">${esc(v.username || "")}</code></td>
      <td>${esc(v.email || "")}</td>
      <td>${esc(contact)}</td>
      <td><button class="ghost compact"
            data-pwreset="${d.id}"
            data-username="${esc(v.username || "")}">비밀번호 초기화</button></td>
    </tr>`;
  }).join("");

  const empty6 = `<tr><td colspan="6" style="text-align:center;color:var(--ink-mute);padding:28px;">가입한 학교가 없습니다.</td></tr>`;
  const empty5 = `<tr><td colspan="6" style="text-align:center;color:var(--ink-mute);padding:28px;">등록된 계정이 없습니다.</td></tr>`;

  container.innerHTML = `
    <div class="super-admin-dashboard">

      <!-- 패널1: 가입 학교 -->
      <div class="sadmin-panel active" id="sadmin-schools">
        <div class="sadmin-panel-head">
          <div>
            <h3>가입 학교 목록</h3>
            <p class="helper">승인 대기 학교를 확인하고 승인 또는 거부하세요.</p>
          </div>
          <button class="ghost compact" id="superAdminRefresh" type="button">새로고침</button>
        </div>
        <div style="overflow-x:auto;">
          <table class="table">
            <thead><tr>
              <th>학교</th><th>상태</th><th>연락 이메일</th>
              <th>접속 코드</th><th>마지막 활동</th><th>작업</th>
            </tr></thead>
            <tbody>${schoolRows || empty6}</tbody>
          </table>
        </div>
      </div>

      <!-- 패널2: 아이디 관리 -->
      <div class="sadmin-panel" id="sadmin-accounts">
        <div class="sadmin-panel-head">
          <div>
            <h3>아이디 관리</h3>
            <p class="helper">등록된 계정을 확인하고 비밀번호 초기화를 안내할 수 있습니다.</p>
          </div>
        </div>
        <div style="overflow-x:auto;">
          <table class="table">
            <thead><tr>
              <th>학교</th><th>상태</th><th>아이디</th>
              <th>연락 이메일</th><th>담당자</th><th>비밀번호</th>
            </tr></thead>
            <tbody>${accountRows || empty5}</tbody>
          </table>
        </div>
      </div>

      <!-- 패널3: 시스템 설정 -->
      <div class="sadmin-panel" id="sadmin-settings">
        <div class="sadmin-panel-head">
          <div><h3>시스템 설정</h3></div>
        </div>
        <div class="settings-block">
          <h4 style="margin:0 0 6px;">나이스(NEIS) API 키</h4>
          <p class="helper" style="margin:0 0 12px;">학교 가입 시 학교 검색에 사용됩니다.
            <a href="https://open.neis.go.kr" target="_blank" rel="noopener">open.neis.go.kr</a>에서 무료 신청.
            미설정 시 일 300건 제한.</p>
          <div style="display:flex;gap:8px;max-width:520px;">
            <input id="neisKeyInput" type="text"
              placeholder="발급받은 인증키 붙여넣기"
              value="${esc(currentNeis)}" style="flex:1;" />
            <button class="primary compact" id="neisKeySave" type="button">저장</button>
          </div>
          ${currentNeis
            ? `<p class="helper" style="margin-top:8px;">현재 키: ${esc(currentNeis.slice(0, 16))}… (저장됨)</p>`
            : `<p class="helper" style="margin-top:8px;">미설정 상태입니다.</p>`}
        </div>
      </div>

    </div>`;

  // ── 새로고침 ─────────────────────────────────────────────
  container.querySelector("#superAdminRefresh").addEventListener("click", () => {
    renderSuperAdminContent(container);
  });

  // ── NEIS 키 저장 ─────────────────────────────────────────
  container.querySelector("#neisKeySave").addEventListener("click", async () => {
    const key = container.querySelector("#neisKeyInput").value.trim();
    try {
      await setDoc(doc(db, "settings", "neis"), { apiKey: key }, { merge: true });
      alert(key ? "NEIS API 키를 저장했습니다." : "NEIS API 키를 삭제했습니다.");
      renderSuperAdminContent(container);
    } catch (e) { alert("저장 실패: " + (e?.message || e)); }
  });

  // ── 탭1: 승인·거부·정지·편집 ────────────────────────────
  container.querySelector("#sadmin-schools tbody")
    ?.addEventListener("click", async ev => {
      const t       = ev.target.closest("[data-approve],[data-reject],[data-suspend],[data-edit],[data-delete]");
      if (!t) return;
      const approve = t.getAttribute("data-approve");
      const reject  = t.getAttribute("data-reject");
      const suspend = t.getAttribute("data-suspend");
      const edit    = t.getAttribute("data-edit");
      const del     = t.getAttribute("data-delete");

      if (edit) {
        const editSnap = await getDoc(doc(db, "schools", edit));
        if (editSnap.exists()) openSchoolEditModal(edit, editSnap.data());
        return;
      }

      if (del) {
        const name = t.dataset.name || "이 학교";
        if (!confirm(`"${name}" 계정을 정말 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
        t.disabled = true;
        try {
          const sSnap = await getDoc(doc(db, "schools", del));
          const sData = sSnap.data() || {};
          const shortCode = sData.shortCode;
          const batch = writeBatch(db);
          batch.delete(doc(db, "schools", del));
          if (shortCode) batch.delete(doc(db, "connections", shortCode));
          // 삭제된 아이디 기록 — 재가입 시 Firebase Auth 계정 재사용에 필요
          if (sData.username) {
            batch.set(doc(db, "deletedSchools", del), {
              username: sData.username,
              _authToken: sData._authToken || "",
              deletedAt: serverTimestamp(),
            });
          }
          await batch.commit();
          renderSuperAdminContent(container);
        } catch (e) {
          t.disabled = false;
          alert("삭제 실패: " + (e?.message || e));
        }
        return;
      }

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
            schoolUid:    approve,
            schoolName:   sdoc.data()?.schoolName || "",
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

  // ── 탭2: 비밀번호 초기화 안내 ───────────────────────────
  container.querySelector("#sadmin-accounts tbody")
    ?.addEventListener("click", ev => {
      const t = ev.target.closest("[data-pwreset]");
      if (!t) return;
      openPasswordResetGuideModal(t.dataset.pwreset, t.dataset.username);
    });
}

// ─── 비밀번호 초기화 (총괄관리자용) — Firestore 비밀번호를 123456으로 변경 ──
function openPasswordResetGuideModal(schoolId, username) {
  const modal = window.openModal({
    title: "비밀번호 초기화",
    submitText: "닫기",
    onSubmit: () => true,
    body: `
      <div class="acct-form">
        <div class="acct-school-card">
          <span class="acct-label">아이디</span>
          <code style="font-size:15px;display:block;margin-top:2px;">${esc(username)}</code>
        </div>
        <p style="margin:0;">초기화하면 비밀번호가 <strong>123456</strong>으로 변경됩니다.<br/>
          담당자에게 새 비밀번호를 알려주세요.</p>
        <button class="primary" id="resetPwBtn" type="button" style="width:100%;">
          비밀번호를 123456으로 초기화
        </button>
        <div id="resetResult"></div>
      </div>`,
  });

  modal.querySelector("#resetPwBtn").addEventListener("click", async () => {
    const btn = modal.querySelector("#resetPwBtn");
    btn.textContent = "처리 중…"; btn.disabled = true;
    try {
      await updateDoc(doc(getDb(), "schools", schoolId), { password: "123456" });
      modal.querySelector("#resetResult").innerHTML = `
        <div class="acct-school-card" style="border-color:var(--accent,#5B8A6F);">
          <p style="margin:0;color:var(--accent,#5B8A6F);">✓ 비밀번호가 <strong>123456</strong>으로 초기화되었습니다.</p>
          <p class="acct-hint" style="margin:4px 0 0;">담당자에게 알려주세요.</p>
        </div>`;
      modal.querySelector("#resetPwBtn").style.display = "none";
    } catch (e) {
      btn.textContent = "비밀번호를 123456으로 초기화"; btn.disabled = false;
      alert("초기화 실패: " + (e?.message || e));
    }
  });
}

// ─── 학교 편집 모달 ──────────────────────────────────────────────────────────
function openSchoolEditModal(schoolId, data) {
  const db   = getDb();
  const conn = data.connection || {};

  const modal = window.openModal({
    title: `편집: ${esc(data.schoolName)}`,
    submitText: "닫기",
    onSubmit: () => true,
    body: `
      <div class="acct-form">

        <!-- 학교 정보 카드 -->
        <div class="acct-school-card">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <strong>${esc(data.schoolName)}</strong>
            ${data.schoolType ? `<span class="badge green" style="font-size:11px;">${esc(data.schoolType)}</span>` : ""}
          </div>
          <p class="acct-hint" style="margin:4px 0 0;">
            아이디: <code>${esc(data.username || "")}</code>
            &nbsp;·&nbsp; 접속 코드: <code>${esc(data.shortCode || "없음")}</code>
          </p>
        </div>

        <!-- 계정 정보 -->
        <div class="acct-field">
          <span class="acct-label">연락 이메일</span>
          <input id="editEmail" type="email" value="${esc(data.email || "")}" />
        </div>

        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <div class="acct-field" style="flex:1;min-width:120px;">
            <span class="acct-label">담당자 이름</span>
            <input id="editContactName" type="text" value="${esc(data.contactName || "")}" />
          </div>
          <div class="acct-field" style="flex:1;min-width:120px;">
            <span class="acct-label">담당자 업무</span>
            <input id="editContactRole" type="text" value="${esc(data.contactRole || "")}" />
          </div>
        </div>

        <div class="acct-field">
          <div style="display:flex;justify-content:space-between;align-items:baseline;">
            <span class="acct-label">비밀번호</span>
            <span class="acct-hint">변경 시 입력, 비워두면 유지</span>
          </div>
          <input id="editPassword" type="text" placeholder="변경할 경우에만 입력" autocomplete="off" />
        </div>

        <!-- 연결 정보 -->
        <div style="border-top:1px solid var(--line);padding-top:16px;">
          <p class="acct-label" style="margin:0 0 12px;">연결 정보</p>
          <div class="acct-field" style="margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;align-items:baseline;">
              <span class="acct-label">웹앱 URL</span>
              <span class="acct-hint">/exec 로 끝나는 주소</span>
            </div>
            <input id="editWebAppUrl" type="url" value="${esc(conn.webAppUrl || "")}"
              placeholder="https://script.google.com/macros/s/.../exec" />
          </div>
          <div class="acct-field">
            <span class="acct-label">연결 키 (API_KEY)</span>
            <input id="editApiKey" type="text" value="${esc(conn.apiKey || "")}" />
          </div>
        </div>

        <button class="primary" id="editSaveBtn" type="button" style="width:100%;">저장</button>

        <!-- 위험 영역: 삭제 -->
        <div style="border-top:1px solid var(--line);padding-top:14px;">
          <button class="ghost" id="editDeleteBtn" type="button"
            style="width:100%;color:var(--danger,#c0392b);border-color:var(--danger,#c0392b);">
            이 학교 계정 삭제
          </button>
        </div>
      </div>`,
  });

  // 저장
  modal.querySelector("#editSaveBtn").addEventListener("click", async () => {
    const newEmail = modal.querySelector("#editEmail").value.trim();
    const newCName = modal.querySelector("#editContactName").value.trim();
    const newCRole = modal.querySelector("#editContactRole").value.trim();
    const newPw    = modal.querySelector("#editPassword").value.trim();
    const newUrl   = modal.querySelector("#editWebAppUrl").value.trim();
    const newKey   = modal.querySelector("#editApiKey").value.trim();
    const btn      = modal.querySelector("#editSaveBtn");
    btn.textContent = "저장 중…"; btn.disabled = true;
    try {
      const m        = newUrl.match(/\/macros\/s\/([^/]+)\/exec/);
      const deployId = m ? m[1] : (conn.deploymentId || "");

      const updates = {
        email:                     newEmail,
        contactName:               newCName,
        contactRole:               newCRole,
        "connection.webAppUrl":    newUrl,
        "connection.apiKey":       newKey,
        "connection.deploymentId": deployId,
      };
      if (newPw) updates.password = newPw;

      await updateDoc(doc(db, "schools", schoolId), updates);

      if (data.shortCode) {
        await updateDoc(doc(db, "connections", data.shortCode), {
          schoolName:   data.schoolName || "",
          webAppUrl: newUrl, apiKey: newKey, deploymentId: deployId,
        });
      }

      alert("저장했습니다.");
      modal.remove();
      const container = document.querySelector("#mainView");
      if (container) renderSuperAdminContent(container);
    } catch (e) {
      alert("저장 실패: " + (e?.message || e));
      btn.textContent = "저장"; btn.disabled = false;
    }
  });

  // 삭제
  modal.querySelector("#editDeleteBtn").addEventListener("click", async () => {
    if (!confirm(`"${data.schoolName}" 계정을 정말 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
    const btn = modal.querySelector("#editDeleteBtn");
    btn.textContent = "삭제 중…"; btn.disabled = true;
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, "schools", schoolId));
      if (data.shortCode) batch.delete(doc(db, "connections", data.shortCode));
      await batch.commit();
      modal.remove();
      const container = document.querySelector("#mainView");
      if (container) renderSuperAdminContent(container);
    } catch (e) {
      alert("삭제 실패: " + (e?.message || e));
      btn.textContent = "이 학교 계정 삭제"; btn.disabled = false;
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
      // 배포 주소(/?s=코드)를 그대로 유지한 채 리로드한다.
      // ?s 를 떼고 리로드하면 "/" 로 가서 랜딩이 뜨므로 절대 떼지 않는다.
      // 리로드 후에는 syncConfig.schoolCode 가 채워져 위의 getSchoolCode()===code 분기로
      // heartbeat 만 수행되어 무한 리로드가 발생하지 않는다.
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
    const connRef  = doc(getDb(), "connections", code);
    const connSnap = await getDoc(connRef);
    if (!connSnap.exists()) return;
    const schoolUid = connSnap.data().schoolUid || null;
    await updateDoc(connRef, { lastActiveAt: serverTimestamp() });
    if (schoolUid) {
      updateDoc(doc(getDb(), "schools", schoolUid), {
        lastActiveAt: serverTimestamp(),
      }).catch(() => {});
    }
    localStorage.setItem(HEARTBEAT_KEY, String(Date.now()));
  } catch { /* 조용히 무시 */ }
}

// ─── 전역 노출 ───────────────────────────────────────────────────────────────
window.account = {
  openRegister:       openRegisterModal,
  openLogin:          openLoginModal,
  openSuperAdminView,
  schoolAdminLogout:  doSchoolAdminLogout, // app.js 종료 버튼에서 호출
  changeSchoolPassword,
  heartbeat,
  _searchNeisSchools: searchNeisSchools,
};

// ─── 부팅: 버튼 연결 + 짧은 주소 해석 ──────────────────────────────────────
document.querySelector("#accountBtn")?.addEventListener("click", openLoginModal);

resolveShortCodeFromUrl().catch(() => {}); // 실패해도 앱 정상 동작

// 저장된 schoolCode 가 Firebase에서 삭제됐으면 로컬 연결 초기화
(async function validateStoredConnection() {
  const code = window.getSchoolCode?.();
  if (!code || !window.fb) return;
  try {
    const snap = await getDoc(doc(getDb(), "connections", code));
    if (!snap.exists()) {
      window.clearSchoolConnection?.();
      location.reload();
    }
  } catch { /* Firebase 접근 실패 시 무시 */ }
})();

// ─── 세션 복원: 새로고침 후 로그인 상태 자동 복원 ───────────────────────────
onAuthStateChanged(getAuth(), async (user) => {
  // auth 상태 확정 — 미로그인이면 로그인 유도 UI 표시
  window.setFirebaseAuthReady?.();
  if (!user) return; // 로그아웃 상태 → 정상 앱 화면 유지

  try {
    const db = getDb();

    // 총괄관리자 확인 (UID 기반 — username/password 로그인)
    const adminByUid = await getDoc(doc(db, "admins", user.uid));
    if (adminByUid.exists() && adminByUid.data().role === "super") {
      openSuperAdminView();
      return;
    }

    // 총괄관리자 확인 (이메일 기반 — Google 로그인)
    if (user.email) {
      const adminByEmail = await getDoc(doc(db, "admins", user.email));
      if (adminByEmail.exists() && adminByEmail.data().role === "super") {
        openSuperAdminView();
        return;
      }
    }

    // 학교 계정 확인
    const schoolSnap = await getDoc(doc(db, "schools", user.uid));
    const data = schoolSnap.exists() ? schoolSnap.data() : null;

    if (!data || data.status !== "approved") {
      // 미승인·거부·정지 계정 → 조용히 로그아웃
      await signOut(getAuth());
      return;
    }

    // 학교 연결이 현재 세션에 없으면 (루트 URL 직접 로그인 등) 자동 복원 후 리로드
    const conn = data.connection || {};
    if (data.shortCode && conn.webAppUrl && conn.apiKey &&
        window.getSchoolCode?.() !== data.shortCode) {
      window.applyConnectionFromAccount?.({ ...conn, shortCode: data.shortCode, schoolName: data.schoolName });
      window.enterSchoolAdminMode?.(); // reload 후 세션 복원을 위해 미리 저장
      location.reload();
      return;
    }

    // 승인된 학교 계정 → 관리자 모드 자동 진입 + 버튼 전환
    window.enterSchoolAdminMode?.();
    window.setFirebaseSchoolName?.(data.schoolName);
    // schools 문서: 마지막 활동 기록 (대시보드 활동 시각 표시용)
    updateDoc(doc(getDb(), "schools", user.uid), {
      lastActiveAt: serverTimestamp(),
    }).catch(() => {});
    // connections 문서: schoolName 채우기
    if (data.shortCode) {
      getDoc(doc(getDb(), "connections", data.shortCode)).then((snap) => {
        if (!snap.exists()) return;
        const updates = {};
        if (data.schoolName && !snap.data().schoolName) updates.schoolName = data.schoolName;
        if (Object.keys(updates).length) {
          updateDoc(doc(getDb(), "connections", data.shortCode), updates).catch(() => {});
        }
      }).catch(() => {});
    }
    const accountBtn = document.querySelector("#accountBtn");
    if (accountBtn) {
      accountBtn.textContent = "학교 계정 ✓";
      accountBtn.style.color = "var(--accent, #5B8A6F)";
      // 부팅 시 등록된 openLoginModal 리스너 제거 후 새 핸들러로 교체
      accountBtn.removeEventListener("click", openLoginModal);
      accountBtn.onclick = () => openConnectionManager(user.uid, data);
    }
    // 로그아웃 버튼 노출 및 연결
    setupLogoutBtn(accountBtn);
  } catch {
    // 오류 시 조용히 로그아웃 (Firestore 접근 실패 등)
    signOut(getAuth()).catch(() => {});
  }
});
