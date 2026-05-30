# 중앙 계정 시스템 구현 계획 (Firebase)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 각 학교 담당자가 사이트 발급 아이디/비번으로 로그인하고, 총괄관리자가 가입을 승인하며, 짧은 접속 주소(`?s=코드`)와 30일 미활용 추적을 제공하는 중앙 계정 시스템을 추가한다. 학교 재고 데이터는 계속 각 학교 구글 시트에만 둔다.

**Architecture:** Firebase Authentication(로그인)+Firestore(학교 명부·연결 포인터). 기존 정적 앱(빌드 없음, 전역 스크립트)에 Firebase **compat SDK**를 `<script>`로 추가하고, 새 전역 모듈 3개(`firebase-config.js`, `account-core.js`, `account-ui.js`)를 더한다. 기존 `app.js`의 `syncConfig`/`applySyncFromUrl` 흐름에 `?s=코드` 해석과 heartbeat 호출만 최소 연동한다.

**Tech Stack:** Vanilla JS(전역 스크립트), Firebase compat SDK(CDN), Firestore, Netlify 정적 호스팅.

**테스트 방식:** 이 프로젝트는 빌드/테스트 러너가 없는 순수 정적 앱이다. 따라서:
- **순수 함수**(코드 생성·검증·기간 계산)는 브라우저 콘솔에서 함수 호출 → 결과 단언으로 검증한다.
- **UI/Firestore 연동**은 로컬에서 페이지를 열고 정해진 클릭 순서대로 수동 검증한다.
- 강제로 npm/Jest를 도입하지 않는다(YAGNI, 기존 패턴 유지).

**참고 — 보안 상수(전 과정 유지):**
- 학교 재고 데이터는 중앙에 저장하지 않는다(per-school 유지). Firestore엔 명부 + 연결 포인터만.
- 연결키+웹앱 URL = 데이터 접근 열쇠 → "학교 내부 메신저로만 공유" 안내 유지.
- `① 처음 설정`(전체 초기화)은 인계 중 절대 실행 금지 안내 유지.
- Firebase 웹 설정값(`firebaseConfig`)은 **설계상 공개되어도 되는 값**이다(보안은 Firestore 규칙+Auth로 강제). 커밋해도 무방.

---

## 확정된 설계 결정 (설계서 2026-05-30 기준)

1. 로그인 아이디 = **담당자가 직접 정함**(중복 검사).
2. 짧은 주소 = `https://item-school.netlify.app/?s=<코드>` (추가 셋업 없이 동작).
3. 총괄관리자 = **구글 로그인**(허용된 구글 계정만).
4. 미활용 = **마지막 활동 후 30일**, 총괄관리자 학교 목록에 배지 표시.

---

## File Structure

새로 만드는 파일:
- `firebase-config.js` — Firebase 앱 초기화. `window.fb = { auth, db }` 전역 노출. (firebaseConfig 값은 Phase 0에서 사용자가 채움)
- `account-core.js` — Firebase 의존 없는 **순수 함수**: 아이디 검증, 아이디→인증이메일 변환, 짧은 코드 생성, 미활용 판정, heartbeat 쓰로틀 판정.
- `account-ui.js` — 가입/로그인/대시보드 모달 + Firestore 읽기/쓰기 + `?s=` 해석 + heartbeat. 기존 `openModal`/`syncConfig`를 재사용.
- `firestore.rules` — Firestore 보안 규칙(콘솔에 붙여넣는 원본 보관용).
- `docs/firebase-setup-guide.md` — 사용자용 Firebase 콘솔 클릭 가이드(Phase 0 산출물).

수정하는 파일:
- `index.html` — 스크립트 태그 추가(Firebase SDK + 새 모듈 3개).
- `app.js` — `syncConfig` 기본값에 `schoolCode` 추가, `applyConnection()` 노출, `?s=` 해석 진입점, sync 성공 시 heartbeat 호출.

책임 분리: 순수 로직(`account-core.js`)과 Firestore/UI(`account-ui.js`)를 나눠 콘솔 단위 검증이 가능하게 한다. `app.js`는 비대(252KB)하므로 신규 로직을 넣지 않고 **연동 훅만** 추가한다.

---

## Phase 0: Firebase 콘솔 셋업 (사용자 수동 작업)

> 이 단계는 코드가 아니라 사용자가 Firebase 콘솔에서 직접 하는 설정이다. 산출물은 `firebaseConfig` 값과 활성화된 Auth/Firestore다. 구현자는 `docs/firebase-setup-guide.md`를 작성해 사용자가 따라 하게 한다.

### Task 0: 콘솔 셋업 가이드 작성

**Files:**
- Create: `docs/firebase-setup-guide.md`

- [ ] **Step 1: 가이드 문서 작성**

아래 내용으로 `docs/firebase-setup-guide.md` 생성:

```markdown
# Firebase 콘솔 셋업 가이드 (1회만)

총괄관리자(개발자)가 1회만 수행합니다.

## 1. 프로젝트 만들기
1. https://console.firebase.google.com 접속 → 구글 로그인
2. "프로젝트 추가" → 이름 `school-inventory` → 만들기 (Analytics는 꺼도 됨)

## 2. 웹 앱 등록 (firebaseConfig 얻기)
1. 프로젝트 개요 옆 톱니 → "프로젝트 설정"
2. "내 앱" → 웹 아이콘(</>) 클릭 → 앱 닉네임 `web` → 등록
3. 화면에 나오는 `firebaseConfig = { apiKey: ..., authDomain: ..., projectId: ..., ... }` 값을 복사
4. 이 값을 프로젝트의 `firebase-config.js` 안 표시된 자리에 붙여넣음

## 3. Authentication 켜기
1. 좌측 "빌드 → Authentication" → "시작하기"
2. "Sign-in method" 탭에서:
   - "이메일/비밀번호" → 사용 설정 → 저장
   - "Google" → 사용 설정 → 지원 이메일 선택 → 저장

## 4. Firestore 만들기
1. 좌측 "빌드 → Firestore Database" → "데이터베이스 만들기"
2. 위치: `asia-northeast3`(서울) 권장
3. **개발 중에는 "테스트 모드로 시작"**(30일간 자유 읽기/쓰기) → 사용 설정
   - 이유: 가입/승인/짧은주소 기능을 만들면서 검증하려면 초기엔 열려 있어야 편하다.

## 5. 보안 규칙 적용 (구현 마지막 단계에서)
> 모든 기능(Task 11)이 끝나 `connections` 미러 컬렉션까지 동작한 뒤에 적용한다.
1. Firestore → "규칙" 탭
2. 프로젝트 `firestore.rules` 파일 내용을 통째로 붙여넣기 → "게시"
3. 게시 후 가입/로그인/`?s=` 접속/동기화가 모두 정상인지 마지막 점검.

## 6. 총괄관리자 구글 계정 등록
1. Firestore → "데이터" 탭 → 컬렉션 시작 `admins`
2. 문서 ID = 총괄관리자 구글 로그인 이메일(예: `endeavor1006@naver.com` 은 구글계정 이메일이어야 함)
   - 필드: `role`(string) = `super`
3. (이 이메일로 구글 로그인한 사람만 승인 대시보드 접근)
```

- [ ] **Step 2: 커밋**

```bash
git add docs/firebase-setup-guide.md
git commit -m "docs: add Firebase console setup guide"
```

---

## Phase 1: Firebase 연동 기반 + 순수 함수

### Task 1: 순수 함수 모듈 (account-core.js)

**Files:**
- Create: `account-core.js`

- [ ] **Step 1: 모듈 작성**

```javascript
// account-core.js — Firebase/DOM 의존 없는 순수 함수 모음
(function (global) {
  "use strict";

  const ACCOUNT = {};

  // 로그인 아이디 검증: 4~20자, 소문자/숫자/하이픈/언더스코어
  ACCOUNT.isValidUsername = function (username) {
    return typeof username === "string" && /^[a-z0-9_-]{4,20}$/.test(username);
  };

  // 아이디 → Firebase Auth용 합성 이메일 (비라우팅 내부 도메인)
  ACCOUNT.usernameToAuthEmail = function (username) {
    return String(username).toLowerCase() + "@item-school.app";
  };

  // 짧은 코드 생성: 헷갈리는 글자(0/o/1/l/i) 제외, 기본 4자
  ACCOUNT.generateShortCode = function (length) {
    const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
    const n = length || 4;
    let out = "";
    const rand = (global.crypto && global.crypto.getRandomValues)
      ? Array.from(global.crypto.getRandomValues(new Uint32Array(n)))
      : Array.from({ length: n }, () => Math.floor(Math.random() * 1e9));
    for (let i = 0; i < n; i++) out += alphabet[rand[i] % alphabet.length];
    return out;
  };

  // 미활용 판정: 마지막 활동 후 30일 초과면 true
  ACCOUNT.INACTIVE_DAYS = 30;
  ACCOUNT.isInactive = function (lastActiveMs, nowMs) {
    if (!lastActiveMs) return true;
    const now = nowMs || Date.now();
    return now - lastActiveMs > ACCOUNT.INACTIVE_DAYS * 24 * 60 * 60 * 1000;
  };

  // heartbeat 쓰로틀: 마지막 전송 후 6시간 지났으면 true
  ACCOUNT.HEARTBEAT_THROTTLE_MS = 6 * 60 * 60 * 1000;
  ACCOUNT.shouldHeartbeat = function (lastSentMs, nowMs) {
    if (!lastSentMs) return true;
    return (nowMs || Date.now()) - lastSentMs > ACCOUNT.HEARTBEAT_THROTTLE_MS;
  };

  global.AccountCore = ACCOUNT;
})(window);
```

- [ ] **Step 2: 콘솔 검증**

로컬에서 `index.html`을 열고(아직 import 안 했으면 임시로 콘솔에 위 IIFE 붙여넣기) 브라우저 콘솔에서:

```javascript
console.assert(AccountCore.isValidUsername("seoul-elem-01") === true, "valid id");
console.assert(AccountCore.isValidUsername("ab") === false, "too short");
console.assert(AccountCore.isValidUsername("BigCaps") === false, "no uppercase");
console.assert(AccountCore.usernameToAuthEmail("Seoul01") === "seoul01@item-school.app", "auth email");
console.assert(AccountCore.generateShortCode().length === 4, "code len");
console.assert(/^[a-z2-9]{4}$/.test(AccountCore.generateShortCode()), "code charset");
console.assert(AccountCore.isInactive(Date.now() - 31*864e5) === true, "31d inactive");
console.assert(AccountCore.isInactive(Date.now() - 29*864e5) === false, "29d active");
console.assert(AccountCore.shouldHeartbeat(Date.now() - 7*36e5) === true, "7h throttle");
console.assert(AccountCore.shouldHeartbeat(Date.now() - 1*36e5) === false, "1h throttle");
console.log("AccountCore OK");
```

Expected: 콘솔에 빨간 assert 실패 없음, `AccountCore OK` 출력.

- [ ] **Step 3: 커밋**

```bash
git add account-core.js
git commit -m "feat: add account-core pure helpers (id/code/inactivity/throttle)"
```

### Task 2: Firebase 초기화 모듈 (firebase-config.js)

**Files:**
- Create: `firebase-config.js`

- [ ] **Step 1: 모듈 작성**

```javascript
// firebase-config.js — Firebase 앱 초기화 (compat SDK 전역 'firebase' 사용)
// ⬇⬇ Phase 0에서 콘솔이 알려준 값으로 교체 ⬇⬇
var firebaseConfig = {
  apiKey: "PASTE_API_KEY",
  authDomain: "PASTE.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE.appspot.com",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID",
};
// ⬆⬆ 여기까지 교체 ⬆⬆

(function (global) {
  "use strict";
  if (!global.firebase || !global.firebase.initializeApp) {
    console.warn("[firebase-config] Firebase SDK가 로드되지 않았습니다.");
    global.fb = null;
    return;
  }
  if (firebaseConfig.apiKey === "PASTE_API_KEY") {
    console.warn("[firebase-config] firebaseConfig가 아직 설정되지 않았습니다(계정 기능 비활성).");
    global.fb = null;
    return;
  }
  var app = global.firebase.initializeApp(firebaseConfig);
  global.fb = {
    app: app,
    auth: global.firebase.auth(),
    db: global.firebase.firestore(),
  };
})(window);
```

- [ ] **Step 2: 검증 (설정 전이라도 안전)**

로컬에서 페이지를 열고 콘솔 확인:
- firebaseConfig 미설정 상태: `window.fb === null` 이고 경고만 출력, 페이지 정상 동작(기존 기능 영향 없음).

Expected: 미설정 시 앱이 깨지지 않음. (실제 연결 검증은 Phase 0 값 입력 후 Task 5에서 수행)

- [ ] **Step 3: 커밋**

```bash
git add firebase-config.js
git commit -m "feat: add firebase init module (graceful no-op until configured)"
```

### Task 3: 스크립트 태그 연결 (index.html)

**Files:**
- Modify: `index.html:233-236`

- [ ] **Step 1: 스크립트 태그 추가**

`index.html`의 기존 스크립트 블록(현재 233~236행)을 아래로 교체:

```html
  <!-- Firebase compat SDK -->
  <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js"></script>
  <script src="./firebase-config.js"></script>
  <script src="./account-core.js"></script>
  <script src="./vendor/xlsx.full.min.js"></script>
  <script src="./inventory-storage.js"></script>
  <script src="./inventory-core.js"></script>
  <script src="./app.js"></script>
  <script src="./account-ui.js"></script>
```

(주의: `account-core.js`/`firebase-config.js`는 `app.js`보다 먼저, `account-ui.js`는 `app.js`가 노출하는 `window.applyConnection` 등을 쓰므로 **app.js 뒤**에 둔다.)

- [ ] **Step 2: 검증**

로컬에서 페이지 새로고침 → 콘솔에 SDK 404/문법 오류 없음. `typeof firebase` → `"object"`. 기존 화면 정상.

Expected: 오류 없음, 기존 기능 그대로.

- [ ] **Step 3: 커밋**

```bash
git add index.html
git commit -m "feat: load firebase SDK and account modules in index.html"
```

---

## Phase 2: 가입 + 개인정보 동의

### Task 4: 가입 모달 + Firestore 문서 생성 (account-ui.js 시작)

**Files:**
- Create: `account-ui.js`

- [ ] **Step 1: account-ui.js 기본 골격 + 가입 모달 작성**

```javascript
// account-ui.js — 가입/로그인/대시보드 + Firestore 연동 (app.js 이후 로드)
(function (global) {
  "use strict";
  var fb = global.fb;
  var Core = global.AccountCore;

  function fbReady() {
    if (!global.fb) {
      alert("계정 기능이 아직 설정되지 않았습니다(관리자 설정 필요).");
      return false;
    }
    fb = global.fb;
    return true;
  }

  // ---- 가입 ----
  function openRegisterModal() {
    if (!fbReady()) return;
    var modal = global.openModal({
      title: "학교 계정 가입",
      submitText: "가입 신청",
      onSubmit: function () { return false; }, // 직접 처리(아래 핸들러)
      body:
        '<p class="helper" style="margin-bottom:12px;">학교 이름으로 가입합니다. 승인 후 로그인할 수 있습니다.</p>' +
        '<label>학교 이름<input id="regSchool" type="text" placeholder="예) 서울초등학교" /></label>' +
        '<label>로그인 아이디(영문 소문자/숫자/-/_ , 4~20자)<input id="regUser" type="text" placeholder="예) seoul-elem-01" /></label>' +
        '<label>비밀번호(6자 이상)<input id="regPw" type="password" /></label>' +
        '<label>연락 이메일(필수)<input id="regEmail" type="email" placeholder="기관 이메일 권장" /></label>' +
        '<label>담당자 이름(선택)<input id="regName" type="text" /></label>' +
        '<div style="margin:12px 0;padding:10px;border:1px solid var(--line);border-radius:8px;font-size:13px;line-height:1.5;">' +
        '<strong>개인정보 수집·이용 동의</strong><br/>' +
        '• 수집 항목: 연락 이메일, (선택)담당자 이름<br/>' +
        '• 이용 목적: 서비스 장애·공지 연락, 가입 승인 확인<br/>' +
        '• 보유 기간: 학교 계정 해지 시까지<br/>' +
        '<label style="display:flex;align-items:center;gap:6px;margin-top:8px;"><input id="regConsent" type="checkbox" style="width:auto;" /> 위 내용에 동의합니다(필수)</label>' +
        '</div>' +
        '<button class="primary" id="regSubmit" type="button" style="width:100%;">가입 신청</button>',
    });
    modal.querySelector("#regSubmit").addEventListener("click", function () {
      handleRegister(modal);
    });
  }

  async function handleRegister(modal) {
    var school = modal.querySelector("#regSchool").value.trim();
    var user = modal.querySelector("#regUser").value.trim().toLowerCase();
    var pw = modal.querySelector("#regPw").value;
    var email = modal.querySelector("#regEmail").value.trim();
    var name = modal.querySelector("#regName").value.trim();
    var consent = modal.querySelector("#regConsent").checked;

    if (!school) return alert("학교 이름을 입력하세요.");
    if (!Core.isValidUsername(user)) return alert("아이디는 영문 소문자/숫자/-/_ 4~20자입니다.");
    if (pw.length < 6) return alert("비밀번호는 6자 이상이어야 합니다.");
    if (!email) return alert("연락 이메일은 필수입니다.");
    if (!consent) return alert("개인정보 수집·이용에 동의해야 가입할 수 있습니다.");

    try {
      // 아이디 중복 검사
      var dup = await fb.db.collection("schools").where("username", "==", user).limit(1).get();
      if (!dup.empty) return alert("이미 사용 중인 아이디입니다.");

      // Auth 사용자 생성(합성 이메일)
      var cred = await fb.auth.createUserWithEmailAndPassword(Core.usernameToAuthEmail(user), pw);

      // Firestore 학교 문서 생성(uid를 문서 ID로)
      await fb.db.collection("schools").doc(cred.user.uid).set({
        schoolName: school,
        username: user,
        email: email,
        contactName: name || "",
        status: "pending",
        shortCode: "",
        connection: { deploymentId: "", apiKey: "", webAppUrl: "" },
        lastActiveAt: null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        approvedAt: null,
        consentAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      await fb.auth.signOut(); // 승인 전이므로 바로 로그아웃
      alert("가입 신청이 접수되었습니다. 총괄관리자 승인 후 로그인할 수 있습니다.");
      modal.remove();
    } catch (e) {
      alert("가입 실패: " + (e && e.message ? e.message : e));
    }
  }

  // 전역 노출(이후 Task에서 확장)
  global.account = global.account || {};
  global.account.openRegister = openRegisterModal;
})(window);
```

- [ ] **Step 2: 수동 검증 (Phase 0 설정 완료 후)**

1. 로컬에서 페이지 열기 → 콘솔에서 `account.openRegister()` 실행.
2. 잘못된 입력(아이디 2자, 동의 미체크 등) → 적절한 경고.
3. 정상 입력 → "가입 신청이 접수되었습니다" → Firebase 콘솔 Firestore `schools`에 `status:"pending"` 문서 생성 확인, Authentication에 사용자 생성 확인.
4. 같은 아이디로 재가입 → "이미 사용 중인 아이디입니다".

Expected: pending 문서 1개 생성, 중복 차단 동작.

- [ ] **Step 3: 커밋**

```bash
git add account-ui.js
git commit -m "feat: add school registration with consent (pending doc)"
```

---

## Phase 3: 로그인 + 상태 게이팅

### Task 5: 로그인 모달 + 승인 상태 분기

**Files:**
- Modify: `account-ui.js`

- [ ] **Step 1: 로그인 함수 추가 (account-ui.js IIFE 안, `global.account` 노출 직전에 삽입)**

```javascript
  // ---- 로그인 ----
  function openLoginModal() {
    if (!fbReady()) return;
    var modal = global.openModal({
      title: "학교 로그인",
      submitText: "로그인",
      onSubmit: function () { return false; },
      body:
        '<label>아이디<input id="loginUser" type="text" /></label>' +
        '<label>비밀번호<input id="loginPw" type="password" /></label>' +
        '<button class="primary" id="loginSubmit" type="button" style="width:100%;margin-top:8px;">로그인</button>' +
        '<button class="ghost compact" id="goRegister" type="button" style="width:100%;margin-top:8px;">처음이신가요? 학교 가입</button>',
    });
    modal.querySelector("#loginSubmit").addEventListener("click", function () { handleLogin(modal); });
    modal.querySelector("#goRegister").addEventListener("click", function () {
      modal.remove();
      openRegisterModal();
    });
  }

  async function handleLogin(modal) {
    var user = modal.querySelector("#loginUser").value.trim().toLowerCase();
    var pw = modal.querySelector("#loginPw").value;
    if (!Core.isValidUsername(user) || !pw) return alert("아이디/비밀번호를 확인하세요.");
    try {
      var cred = await fb.auth.signInWithEmailAndPassword(Core.usernameToAuthEmail(user), pw);
      var snap = await fb.db.collection("schools").doc(cred.user.uid).get();
      var data = snap.exists ? snap.data() : null;
      if (!data) { await fb.auth.signOut(); return alert("계정 정보를 찾을 수 없습니다."); }
      if (data.status === "pending") { await fb.auth.signOut(); return alert("아직 승인 대기 중입니다. 총괄관리자 승인 후 이용할 수 있습니다."); }
      if (data.status === "rejected") { await fb.auth.signOut(); return alert("가입이 거부되었습니다. 총괄관리자에게 문의하세요."); }
      if (data.status === "suspended") { await fb.auth.signOut(); return alert("정지된 계정입니다. 총괄관리자에게 문의하세요."); }
      // approved
      modal.remove();
      global.account.onLoggedIn(cred.user.uid, data);
    } catch (e) {
      alert("로그인 실패: 아이디 또는 비밀번호가 올바르지 않습니다.");
    }
  }
```

- [ ] **Step 2: `global.account` 노출 블록 확장**

`account-ui.js` 맨 끝 노출부를 아래로 교체:

```javascript
  global.account = global.account || {};
  global.account.openRegister = openRegisterModal;
  global.account.openLogin = openLoginModal;
  // onLoggedIn은 Phase 5(연결 관리)에서 실제 구현으로 교체. 지금은 임시.
  global.account.onLoggedIn = global.account.onLoggedIn || function (uid, data) {
    alert(data.schoolName + " 로그인 성공(승인됨).");
  };
```

- [ ] **Step 3: 수동 검증**

1. Firestore에서 테스트 문서 `status`를 `pending`으로 둔 채 `account.openLogin()` → 로그인 → "승인 대기 중" 경고.
2. 콘솔에서 해당 문서 `status`를 `approved`로 변경 → 다시 로그인 → "로그인 성공(승인됨)" 경고.
3. 틀린 비밀번호 → "로그인 실패" 경고.

Expected: 상태별 분기 정확.

- [ ] **Step 4: 커밋**

```bash
git add account-ui.js
git commit -m "feat: add login with approval-status gating"
```

---

## Phase 4: 총괄관리자 승인 대시보드 (구글 로그인)

### Task 6: 구글 로그인 + 승인/거부 + 학교 목록

**Files:**
- Modify: `account-ui.js`

- [ ] **Step 1: 대시보드 함수 추가 (IIFE 안)**

```javascript
  // ---- 총괄관리자 대시보드 ----
  async function isSuperAdmin(email) {
    if (!email) return false;
    var snap = await fb.db.collection("admins").doc(email).get();
    return snap.exists && snap.data().role === "super";
  }

  async function openAdminDashboard() {
    if (!fbReady()) return;
    var provider = new firebase.auth.GoogleAuthProvider();
    var result;
    try { result = await fb.auth.signInWithPopup(provider); }
    catch (e) { return alert("구글 로그인 실패: " + (e && e.message ? e.message : e)); }
    var email = result.user.email;
    if (!(await isSuperAdmin(email))) {
      await fb.auth.signOut();
      return alert("총괄관리자 권한이 없는 계정입니다: " + email);
    }
    renderDashboard();
  }

  async function renderDashboard() {
    var snap = await fb.db.collection("schools").orderBy("createdAt", "desc").get();
    var now = Date.now();
    var rows = snap.docs.map(function (doc) {
      var d = doc.data();
      var lastMs = d.lastActiveAt && d.lastActiveAt.toMillis ? d.lastActiveAt.toMillis() : 0;
      var inactive = d.status === "approved" && Core.isInactive(lastMs, now);
      var statusBadge =
        d.status === "pending" ? '<span class="badge orange">승인대기</span>' :
        d.status === "approved" ? '<span class="badge green">승인됨</span>' :
        d.status === "suspended" ? '<span class="badge gray">정지</span>' :
        '<span class="badge gray">거부</span>';
      var useBadge = d.status === "approved"
        ? (inactive ? '<span class="badge orange">미활용(30일+)</span>' : '<span class="badge green">활용중</span>')
        : "";
      var lastTxt = lastMs ? new Date(lastMs).toLocaleDateString() : "기록 없음";
      var actions = "";
      if (d.status === "pending") {
        actions = '<button class="primary compact" data-approve="' + doc.id + '">승인</button> ' +
                  '<button class="ghost compact" data-reject="' + doc.id + '">거부</button>';
      } else if (d.status === "approved") {
        actions = '<button class="ghost compact" data-suspend="' + doc.id + '">정지</button>';
      } else {
        actions = '<button class="ghost compact" data-approve="' + doc.id + '">승인</button>';
      }
      return '<tr><td>' + escapeHtmlSafe(d.schoolName) + '</td><td>' + statusBadge + ' ' + useBadge +
             '</td><td>' + escapeHtmlSafe(d.email || "") + '</td><td>' + lastTxt + '</td><td>' + actions + '</td></tr>';
    }).join("");

    var modal = global.openModal({
      title: "총괄관리자 대시보드",
      submitText: "닫기",
      onSubmit: function () { return true; },
      body:
        '<div style="overflow:auto;max-height:60vh;"><table class="table"><thead><tr>' +
        '<th>학교</th><th>상태</th><th>연락 이메일</th><th>마지막 활동</th><th>작업</th>' +
        '</tr></thead><tbody>' + (rows || '<tr><td colspan="5">가입한 학교가 없습니다.</td></tr>') + '</tbody></table></div>',
    });

    modal.addEventListener("click", async function (ev) {
      var t = ev.target;
      var approve = t.getAttribute && t.getAttribute("data-approve");
      var reject = t.getAttribute && t.getAttribute("data-reject");
      var suspend = t.getAttribute && t.getAttribute("data-suspend");
      try {
        if (approve) {
          var code = await issueUniqueShortCode();
          await fb.db.collection("schools").doc(approve).update({
            status: "approved", approvedAt: firebase.firestore.FieldValue.serverTimestamp(), shortCode: code,
          });
        } else if (reject) {
          await fb.db.collection("schools").doc(reject).update({ status: "rejected" });
        } else if (suspend) {
          await fb.db.collection("schools").doc(suspend).update({ status: "suspended" });
        } else return;
        modal.remove();
        renderDashboard();
      } catch (e) { alert("작업 실패: " + (e && e.message ? e.message : e)); }
    });
  }

  // 중복 없는 짧은 코드 발급
  async function issueUniqueShortCode() {
    for (var i = 0; i < 8; i++) {
      var code = Core.generateShortCode(i < 4 ? 4 : 5); // 충돌 잦으면 길이 +1
      var dup = await fb.db.collection("schools").where("shortCode", "==", code).limit(1).get();
      if (dup.empty) return code;
    }
    return Core.generateShortCode(6);
  }

  // app.js의 escapeHtml이 전역이 아닐 수 있으므로 안전한 자체 이스케이프
  function escapeHtmlSafe(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
```

- [ ] **Step 2: 노출부에 대시보드 추가**

```javascript
  global.account.openAdminDashboard = openAdminDashboard;
```

- [ ] **Step 3: 수동 검증**

1. Firestore `admins/{내구글이메일}` 문서에 `role:"super"` 있는 상태에서 `account.openAdminDashboard()` → 구글 로그인 팝업 → 대시보드 표시.
2. pending 학교 "승인" → 상태 `approved`로 바뀌고 `shortCode` 발급됨(Firestore 확인).
3. `role:"super"` 없는 다른 구글계정 → "권한이 없는 계정" 경고.

Expected: 승인 시 shortCode 생성, 권한 없는 계정 차단.

- [ ] **Step 4: 커밋**

```bash
git add account-ui.js
git commit -m "feat: add super-admin dashboard (google login, approve/reject/suspend, short code)"
```

---

## Phase 5: 연결정보 저장 + 짧은 주소(?s=) 조회

### Task 7: app.js에 연결 적용 진입점 + schoolCode 필드

**Files:**
- Modify: `app.js:708-717` (syncConfig 기본값)
- Modify: `app.js` (전역 함수 `applyConnection` 추가, applySyncFromUrl 근처)

- [ ] **Step 1: syncConfig 기본값에 schoolCode 추가**

`app.js`의 `loadSyncConfig` fallback(현재 708~716행)에 한 줄 추가:

```javascript
  const fallback = {
    provider: "local",
    endpoint: "",
    apiKey: "",
    autoSync: "manual",
    lastCheckedAt: "",
    lastSyncedAt: "",
    lastRemoteSavedAt: "",
    schoolCode: "",
  };
```

- [ ] **Step 2: 전역 연결 적용 함수 추가**

`app.js`의 `generateTeacherInviteLink` 함수(현재 760행) **바로 위**에 추가:

```javascript
// account-ui.js가 ?s=코드 해석 후 호출하는 연결 적용 진입점
function applyConnectionFromAccount(conn) {
  if (!conn || !conn.apiKey) return false;
  let endpoint = conn.webAppUrl || "";
  if (!endpoint && conn.deploymentId) {
    endpoint = APPS_SCRIPT_URL_PREFIX + conn.deploymentId + APPS_SCRIPT_URL_SUFFIX;
  }
  if (!endpoint) return false;
  syncConfig.provider = "appsScript";
  syncConfig.endpoint = endpoint;
  syncConfig.apiKey = conn.apiKey;
  if (conn.shortCode) syncConfig.schoolCode = conn.shortCode;
  if (syncConfig.autoSync === "manual") syncConfig.autoSync = "pushAfterSave";
  saveSyncConfig();
  justConnectedViaLink = true;
  return true;
}
window.applyConnectionFromAccount = applyConnectionFromAccount;
```

- [ ] **Step 3: 검증**

콘솔에서:
```javascript
applyConnectionFromAccount({ deploymentId: "TEST123", apiKey: "key123", shortCode: "ab23" });
console.assert(syncConfig.apiKey === "key123" && syncConfig.schoolCode === "ab23", "applied");
```
Expected: assert 통과, syncConfig 갱신.

- [ ] **Step 4: 커밋**

```bash
git add app.js
git commit -m "feat: expose applyConnectionFromAccount and add schoolCode to syncConfig"
```

### Task 8: ?s=코드 자동 연결 + 담당자 연결정보 저장 UI

**Files:**
- Modify: `account-ui.js`

- [ ] **Step 1: ?s= 해석 + 로그인 후 연결관리 구현 (IIFE 안)**

```javascript
  // ---- 짧은 주소(?s=코드) 자동 연결 ----
  async function resolveShortCodeFromUrl() {
    if (!global.fb) return;
    var code = new URLSearchParams(global.location.search).get("s");
    if (!code) return;
    try {
      var snap = await fb.db.collection("schools").where("shortCode", "==", code).limit(1).get();
      if (snap.empty) return;
      var d = snap.docs[0].data();
      if (d.status !== "approved") return;
      var conn = d.connection || {};
      conn.shortCode = code;
      if (global.applyConnectionFromAccount && global.applyConnectionFromAccount(conn)) {
        // 연결 반영 후 화면 갱신은 app.js가 justConnectedViaLink로 처리.
        global.location.reload();
      }
    } catch (e) { /* 무시: 짧은 코드 실패 시 평소 화면 */ }
  }

  // ---- 로그인 후: 연결정보 등록/짧은 링크 보기 ----
  function openConnectionManager(uid, data) {
    var modal = global.openModal({
      title: data.schoolName + " — 연결 관리",
      submitText: "닫기",
      onSubmit: function () { return true; },
      body:
        '<p class="helper">스프레드시트 웹앱을 배포한 뒤, 아래에 연결정보를 저장하세요.</p>' +
        '<label>웹앱 URL(/exec로 끝나는 주소)<input id="connUrl" type="url" value="' + escapeHtmlSafe((data.connection||{}).webAppUrl||"") + '" /></label>' +
        '<label>연결 키(API_KEY)<input id="connKey" type="text" value="' + escapeHtmlSafe((data.connection||{}).apiKey||"") + '" /></label>' +
        '<button class="primary" id="connSave" type="button" style="width:100%;margin:8px 0;">연결정보 저장</button>' +
        (data.shortCode
          ? '<div style="margin-top:12px;padding:10px;border:1px solid var(--line);border-radius:8px;">' +
            '<strong>교사용 짧은 접속 주소</strong><br/>' +
            '<code id="shortLink">' + global.location.origin + '/?s=' + data.shortCode + '</code><br/>' +
            '<button class="ghost compact" id="copyShort" type="button" style="margin-top:6px;">복사</button>' +
            '<p class="helper" style="margin-top:6px;">학교 내부 메신저로만 공유하세요.</p></div>'
          : '<p class="helper" style="margin-top:12px;">승인 후 짧은 주소가 발급됩니다.</p>'),
    });
    modal.querySelector("#connSave").addEventListener("click", async function () {
      var url = modal.querySelector("#connUrl").value.trim();
      var key = modal.querySelector("#connKey").value.trim();
      if (!url.includes("/macros/s/") || !url.endsWith("/exec")) return alert("웹앱 URL은 /macros/s/...로 시작하고 /exec로 끝나야 합니다.");
      if (!key) return alert("연결 키를 입력하세요.");
      var m = url.match(/\/macros\/s\/([^/]+)\/exec/);
      try {
        await fb.db.collection("schools").doc(uid).update({
          "connection.webAppUrl": url,
          "connection.apiKey": key,
          "connection.deploymentId": m ? m[1] : "",
        });
        alert("연결정보를 저장했습니다.");
      } catch (e) { alert("저장 실패: " + (e && e.message ? e.message : e)); }
    });
    var copyBtn = modal.querySelector("#copyShort");
    if (copyBtn) copyBtn.addEventListener("click", function () {
      navigator.clipboard.writeText(modal.querySelector("#shortLink").textContent);
      copyBtn.textContent = "복사됨";
    });
  }

  // 로그인 성공 시 실제 동작으로 교체
  global.account.onLoggedIn = function (uid, data) { openConnectionManager(uid, data); };
```

- [ ] **Step 2: 부팅 시 ?s= 자동 연결 호출 (IIFE 맨 아래, 노출부 뒤)**

```javascript
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", resolveShortCodeFromUrl);
  } else {
    resolveShortCodeFromUrl();
  }
```

- [ ] **Step 3: 수동 검증**

1. 승인된 학교로 로그인 → 연결 관리 모달 → 웹앱 URL/키 저장 → Firestore `connection` 갱신 확인.
2. 같은 학교의 `shortCode`로 `index.html?s=<코드>` 접속 → 자동으로 해당 학교에 연결되고 reload 후 데이터 동기화 동작.
3. 잘못된 코드 → 평소 로컬 화면(오류 없음).

Expected: 짧은 주소로 교사가 무로그인 자동 연결.

- [ ] **Step 4: 커밋**

```bash
git add account-ui.js
git commit -m "feat: short-code auto-connect and admin connection manager"
```

---

## Phase 6: 활용 추적(heartbeat) + 30일 미활용

### Task 9: sync 성공 시 heartbeat

**Files:**
- Modify: `account-ui.js` (heartbeat 함수)
- Modify: `app.js` (sync 성공 지점에서 호출)

- [ ] **Step 1: heartbeat 함수 추가 (account-ui.js IIFE 안, 노출부 앞)**

```javascript
  // ---- 활용 추적(heartbeat): 6시간 쓰로틀, lastActiveAt만 갱신 ----
  var HEARTBEAT_KEY = "account_last_heartbeat_ms";
  async function heartbeat(shortCode) {
    if (!global.fb) return;
    if (!shortCode) return;
    var last = parseInt(global.localStorage.getItem(HEARTBEAT_KEY) || "0", 10);
    if (!Core.shouldHeartbeat(last)) return;
    try {
      var snap = await fb.db.collection("schools").where("shortCode", "==", shortCode).limit(1).get();
      if (snap.empty) return;
      await snap.docs[0].ref.update({ lastActiveAt: firebase.firestore.FieldValue.serverTimestamp() });
      global.localStorage.setItem(HEARTBEAT_KEY, String(Date.now()));
    } catch (e) { /* 조용히 무시 */ }
  }
  global.account.heartbeat = heartbeat;
```

- [ ] **Step 2: app.js sync 성공 지점에서 호출**

`app.js`의 `markSyncChecked` 함수(현재 724~729행)의 `saveSyncConfig();` 다음 줄에 추가:

```javascript
function markSyncChecked(remoteSavedAt = "") {
  syncConfig.lastCheckedAt = new Date().toISOString();
  if (remoteSavedAt) syncConfig.lastRemoteSavedAt = remoteSavedAt;
  saveSyncConfig();
  if (syncConfig.schoolCode && window.account?.heartbeat) window.account.heartbeat(syncConfig.schoolCode);
  renderTodayLabel();
}
```

또한 수동 동기화 성공 블록(현재 3808~3811행 부근, `syncConfig.lastSyncedAt = new Date().toISOString();` 직후)에 한 줄 추가:

```javascript
      syncConfig.lastSyncedAt = new Date().toISOString();
      syncConfig.lastCheckedAt = syncConfig.lastSyncedAt;
      syncConfig.lastRemoteSavedAt = result.savedAt || syncConfig.lastRemoteSavedAt || "";
      if (syncConfig.schoolCode && window.account?.heartbeat) window.account.heartbeat(syncConfig.schoolCode);
```

- [ ] **Step 3: 수동 검증**

1. `?s=코드`로 접속해 동기화가 일어나면 Firestore 해당 학교 `lastActiveAt`이 갱신됨(첫 동기화 시).
2. 6시간 내 재동기화 → `localStorage`의 쓰로틀로 추가 쓰기 없음(콘솔에서 `localStorage.getItem("account_last_heartbeat_ms")` 확인).
3. 대시보드에서 31일 이전 활동 학교 → "미활용(30일+)" 배지.

Expected: 활동 시 timestamp 갱신, 쓰로틀 동작, 미활용 배지 표시.

- [ ] **Step 4: 커밋**

```bash
git add app.js account-ui.js
git commit -m "feat: heartbeat on sync success with 6h throttle"
```

---

## Phase 7: 진입 버튼 + 기존 인계 흐름 통합 + 보안 규칙

### Task 10: Firestore 보안 규칙 파일

> 순서 주의: 이 규칙은 **Task 11(connections 미러)까지 끝난 뒤** 콘솔에 게시한다. 그 전까지 Firestore는 Phase 0의 "테스트 모드"(열림)로 두고 기능을 검증한다. 잠금 규칙을 먼저 게시하면 무로그인 `?s=` 조회 테스트가 막힌다.

**Files:**
- Create: `firestore.rules`

- [ ] **Step 1: 규칙 작성**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSuper() {
      return request.auth != null
        && exists(/databases/$(database)/documents/admins/$(request.auth.token.email));
    }

    match /admins/{email} {
      allow read: if request.auth != null && request.auth.token.email == email;
      allow write: if false; // 콘솔에서만 관리
    }

    match /schools/{uid} {
      // 본인 학교 문서: 읽기/생성/수정 가능(상태/승인 필드는 본인이 못 바꾸게 제한)
      allow read: if request.auth != null && (request.auth.uid == uid || isSuper());
      allow create: if request.auth != null && request.auth.uid == uid
        && request.resource.data.status == 'pending';
      allow update: if isSuper()
        || (request.auth != null && request.auth.uid == uid
            && request.resource.data.status == resource.data.status
            && request.resource.data.shortCode == resource.data.shortCode);
      allow delete: if isSuper();

      // 짧은 주소 조회/ heartbeat: 무로그인 공개 (단, lastActiveAt만 변경 허용은 별도 함수로)
    }

    // 짧은 코드 조회를 위한 공개 읽기는 보안상 별도 컬렉션으로 분리 권장(아래 Step 2 참고)
  }
}
```

> 주의: 위 규칙은 "로그인한 본인/총괄관리자"만 `schools`를 읽게 한다. 그러나 교사는 무로그인으로 `?s=코드` 조회가 필요하다. 이를 위해 **공개 조회 전용 미러 컬렉션 `connections/{shortCode}`** 를 둔다(연결 포인터만, 개인정보 없음). 다음 Step에서 규칙·코드를 보완한다.

- [ ] **Step 2: 공개 연결 미러 컬렉션 규칙 추가**

`firestore.rules`의 `match /schools/{uid}` 블록 뒤에 추가:

```
    // 교사 무로그인 연결용: 연결 포인터만(개인정보 없음)
    match /connections/{shortCode} {
      allow read: if true;                 // 짧은 주소 조회(공개)
      allow update: if request.resource.data.diff(resource.data).affectedKeys()
                       .hasOnly(['lastActiveAt']); // heartbeat: lastActiveAt만 변경 허용
      allow create, delete: if isSuper()
        || (request.auth != null);         // 학교 승인/연결저장 시 본인이 생성
    }
```

> 설계 보정: `schools`(개인정보 포함)는 비공개로 두고, **무로그인 조회·heartbeat는 `connections/{shortCode}`** 에서만 일어나게 한다. `connections` 문서엔 `{ deploymentId, apiKey, webAppUrl, shortCode, lastActiveAt }` 만 둔다(이메일·담당자명 등 개인정보 없음). account-ui.js의 승인/연결저장/heartbeat/짧은조회 코드는 이 컬렉션을 사용하도록 다음 Task에서 일원화한다.

- [ ] **Step 3: 커밋**

```bash
git add firestore.rules
git commit -m "feat: add firestore security rules (private schools + public connections mirror)"
```

### Task 11: connections 미러 컬렉션으로 일원화

**Files:**
- Modify: `account-ui.js`

- [ ] **Step 1: 승인 시 connections 문서 생성**

Task 6의 `issueUniqueShortCode` 사용 후 승인 처리에서, `schools` 업데이트와 함께 `connections/{code}` 생성. `renderDashboard`의 approve 분기를 아래로 교체:

```javascript
        if (approve) {
          var code = await issueUniqueShortCode();
          var sref = fb.db.collection("schools").doc(approve);
          var sdoc = await sref.get();
          var sconn = (sdoc.data() && sdoc.data().connection) || {};
          var batch = fb.db.batch();
          batch.update(sref, { status: "approved", approvedAt: firebase.firestore.FieldValue.serverTimestamp(), shortCode: code });
          batch.set(fb.db.collection("connections").doc(code), {
            shortCode: code,
            deploymentId: sconn.deploymentId || "",
            apiKey: sconn.apiKey || "",
            webAppUrl: sconn.webAppUrl || "",
            lastActiveAt: null,
          });
          await batch.commit();
        }
```

- [ ] **Step 2: 연결정보 저장 시 connections도 갱신**

Task 8 `openConnectionManager`의 저장 핸들러에서 `schools` 업데이트 뒤에 `connections` 갱신 추가(shortCode 있을 때만):

```javascript
        await fb.db.collection("schools").doc(uid).update({
          "connection.webAppUrl": url, "connection.apiKey": key, "connection.deploymentId": m ? m[1] : "",
        });
        if (data.shortCode) {
          await fb.db.collection("connections").doc(data.shortCode).set({
            shortCode: data.shortCode, webAppUrl: url, apiKey: key, deploymentId: m ? m[1] : "", lastActiveAt: null,
          }, { merge: true });
        }
        alert("연결정보를 저장했습니다.");
```

- [ ] **Step 3: 짧은 조회·heartbeat를 connections로 변경**

`resolveShortCodeFromUrl`: `schools.where('shortCode'==)` 대신 `connections.doc(code).get()` 사용:

```javascript
      var doc = await fb.db.collection("connections").doc(code).get();
      if (!doc.exists) return;
      var conn = doc.data();
      conn.shortCode = code;
      if (global.applyConnectionFromAccount && global.applyConnectionFromAccount(conn)) {
        global.location.reload();
      }
```

`heartbeat`: `connections.doc(shortCode).update({ lastActiveAt })` 사용:

```javascript
    try {
      await fb.db.collection("connections").doc(shortCode).update({ lastActiveAt: firebase.firestore.FieldValue.serverTimestamp() });
      global.localStorage.setItem(HEARTBEAT_KEY, String(Date.now()));
    } catch (e) { /* 무시 */ }
```

대시보드 미활용 배지는 `schools`에 `connections.lastActiveAt`을 합치기 어렵다 → 대시보드에서 학교별 `connections/{shortCode}` 를 추가 조회해 `lastActiveAt` 표시(또는 승인 학교만 N건 조회). `renderDashboard`에서 각 승인 학교의 lastActive는 `connections` 문서에서 읽는다.

- [ ] **Step 4: 수동 검증**

1. 승인 → `connections/{code}` 문서 생성 확인.
2. `?s=code` 접속 → `connections` 조회로 자동 연결.
3. 동기화 → `connections.lastActiveAt` 갱신, 6시간 쓰로틀.
4. 대시보드 미활용 배지 정상.

Expected: 개인정보는 `schools`(비공개)에만, 무로그인 동작은 `connections`(공개)에서만.

- [ ] **Step 5: 커밋**

```bash
git add account-ui.js
git commit -m "refactor: route public read/heartbeat through connections mirror (keep PII private)"
```

### Task 12: 진입 버튼 배치

**Files:**
- Modify: `index.html` 또는 `app.js`(헤더/설정 영역에 버튼 추가하는 기존 패턴을 따름)

- [ ] **Step 1: 로그인/대시보드 진입 버튼 추가**

기존 헤더/설정 영역(앱의 관리자 메뉴가 렌더되는 곳)에 두 버튼을 추가한다. 정확한 위치는 구현자가 `renderSettings`/헤더 렌더 함수를 찾아, 다음 버튼을 붙인다:

```html
<button class="ghost compact" type="button" onclick="window.account?.openLogin?.()">학교 로그인</button>
<button class="ghost compact" type="button" onclick="window.account?.openAdminDashboard?.()">총괄관리자</button>
```

> 참고: 기존 `bindEvents`에 `#handoverBtn` 등을 addEventListener로 묶는 패턴이 있으므로, 인라인 onclick 대신 버튼에 id를 주고 `bindEvents`에서 묶어도 된다(구현자 재량, 기존 패턴 우선).

- [ ] **Step 2: 인계 점검 모달에 계정 안내 추가**

`app.js`의 `renderHandoverPanel`(현재 약 2314행) ① 단계 근처에, 계정이 있는 학교를 위한 안내 한 단락을 추가:

```javascript
// (renderHandoverPanel body 내 적절한 위치)
'<div class="panel-card"><strong>학교 계정을 쓰는 경우</strong><br/>' +
'후임자는 같은 <b>학교 아이디/비밀번호</b>로 로그인하면 됩니다. 새 웹앱을 배포한 뒤 ' +
'<b>로그인 → 연결 관리</b>에서 새 웹앱 URL/연결 키만 갱신하세요. 교사에게 준 짧은 주소(?s=코드)는 그대로 유지됩니다.</div>'
```

- [ ] **Step 3: 수동 검증**

1. 헤더/설정에 "학교 로그인", "총괄관리자" 버튼 노출 및 동작.
2. 인계 점검 모달에 계정 인계 안내 단락 표시.

Expected: 진입 동선 완성.

- [ ] **Step 4: 커밋**

```bash
git add index.html app.js
git commit -m "feat: add login/admin entry buttons and account handover note"
```

---

## 최종 점검 (전체 통합)

- [ ] 미설정(`window.fb===null`) 상태에서도 기존 앱 100% 정상 동작(계정 버튼은 안내만).
- [ ] 가입 → 승인 → 로그인 → 연결 저장 → 짧은 주소 발급 → 교사 `?s=`로 접속 → 동기화 → heartbeat → 대시보드 활용중/미활용 표시까지 end-to-end 1회 통과.
- [ ] 개인정보(이메일·담당자명)는 `schools`에만 있고 공개 `connections`엔 없음 확인.
- [ ] GitHub main에 푸시.

```bash
git push origin main
```
