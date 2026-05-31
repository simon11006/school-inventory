# 스펙: 학교 계정 가입 후 중복 온보딩 단계 제거

**날짜:** 2026-05-31  
**상태:** 승인됨

---

## 문제

Firebase 학교 계정으로 가입·승인·연결을 마친 관리자가 앱을 열면 다음 세 가지 중복이 존재한다.

1. **학교명 재입력** — 가입 시 이미 입력한 학교명을 `학교 설정` 모달에서 다시 입력해야 한다.
2. **저장소 연결 중복 노출** — `?s=code`로 연결이 완료된 상태임에도 `학교 설정`에 저장소 연결 섹션이 항상 표시된다.
3. **잘못된 교사 초대 링크** — `학교 설정`의 교사 초대 링크가 `?u=endpoint&k=apiKey` 형식(자격증명 내장)이지만, Firebase 계정 모드에서는 `?s=shortCode` 형식이 올바른 링크다.

---

## 목표

Firebase 계정 모드(`syncConfig.schoolCode` 존재)일 때:

- 학교명을 자동으로 채워 사용자가 직접 입력하지 않아도 된다.
- `학교 설정` 모달의 저장소 연결 섹션을 "연결됨" 카드로 대체한다 (고급 토글로 접을 수 있게 유지).
- 교사 초대 링크를 `?s=shortCode` URL로 교체한다.

비(非) Firebase 모드(독립 모드)는 현행 동작을 그대로 유지한다.

---

## 범위 밖

- Firebase `schoolName` 필드 자체를 수정하거나 동기화하는 기능
- 학교 설정 모달 UI 전체 리팩터 또는 탭 구조 변경
- `connections` Firestore 문서에 `schoolName` 추가

---

## 설계

### 1. 학교명 자동 세팅

**파일:** `app.js`, `account-ui.js`

#### app.js

`applyConnectionFromAccount` 함수 아래에 전역 함수 추가:

```js
window.setFirebaseSchoolName = function(name) {
  if (!state.schoolName?.trim() && name?.trim()) {
    state.schoolName = name.trim();
    saveState();
    render();
  }
};
```

- `state.schoolName`이 이미 있으면 덮어쓰지 않는다 (사용자가 직접 수정한 값 보존).

#### account-ui.js

`onAuthStateChanged` 콜백에서 학교 계정 승인 확인 직후, `window.enterSchoolAdminMode?.()` 호출 바로 다음에 추가:

```js
window.setFirebaseSchoolName?.(data.schoolName);
```

---

### 2. 저장소 연결 섹션 조건 분기

**파일:** `app.js`의 `openSchoolSettingsModal()`

#### 헬퍼 추가 (함수 상단)

```js
const isFirebaseConnected = !!(syncConfig.schoolCode);
```

#### syncSectionHtml 조건 분기

```js
const syncSectionHtml = isFirebaseConnected
  ? `
    <div class="settings-block">
      <div class="settings-block-head">
        <div>
          <h3>저장소 연결</h3>
          <p class="helper">학교 계정으로 연결되어 있습니다.</p>
        </div>
        <span class="badge green">연결됨</span>
      </div>
      <p class="helper">연결 설정을 변경하려면 <strong>학교 계정(내 계정 ✓)</strong>에서 수정하세요.</p>
      <button class="ghost compact" id="showAdvSyncBtn" type="button" style="margin-top:4px;">
        고급: 연결 정보 직접 수정 ▾
      </button>
      <div id="advSyncArea" style="display:none;margin-top:12px;">
        ${syncSectionHtmlFull}
      </div>
    </div>
  `
  : syncSectionHtmlFull;
```

`syncSectionHtmlFull`은 현재 `syncSectionHtml`의 내용을 변수로 추출한 것.

모달 마운트 후 이벤트:

```js
modal.querySelector("#showAdvSyncBtn")?.addEventListener("click", (e) => {
  const area = modal.querySelector("#advSyncArea");
  area.style.display = area.style.display === "none" ? "block" : "none";
  e.currentTarget.textContent = area.style.display === "none"
    ? "고급: 연결 정보 직접 수정 ▾"
    : "고급: 연결 정보 직접 수정 ▴";
});
```

---

### 3. 교사 초대 링크 교체

**파일:** `app.js`의 `openSchoolSettingsModal()` — `inviteLinkSection` 및 `refreshInviteLink`

#### HTML 조건 분기

`isFirebaseConnected`가 `true`일 때:

```html
<div class="settings-block">
  <div class="settings-block-head">
    <div>
      <h3>교사 초대 링크</h3>
      <p class="helper">이 링크를 교사들에게 공유하면 자동으로 우리 학교로 연결됩니다.
        학교 내부 메신저로만 공유하세요.</p>
    </div>
  </div>
  <div class="invite-link-area">
    <input type="text" id="inviteLinkInput" readonly class="invite-link-input"
      value="{origin}/?s={syncConfig.schoolCode}" />
    <button class="primary compact" id="copyInviteLinkBtn" type="button">링크 복사</button>
    <button class="ghost compact" id="showInviteQrBtn" type="button">QR 보기</button>
  </div>
  <div class="invite-qr-area" id="inviteQrArea" hidden>
    <img id="inviteQrImage" alt="교사용 접속 링크 QR코드" />
    <p class="helper">QR이 보이지 않으면 링크 복사 버튼으로 교사들에게 공유하세요.</p>
  </div>
  <p class="helper" id="inviteLinkHelp">교사들은 이 링크를 즐겨찾기해 두면 편리합니다.</p>
</div>
```

- `refreshInviteLink` 함수와 `syncEndpoint`/`syncApiKey` 입력 이벤트 리스너는 `isFirebaseConnected`가 `false`일 때만 연결.
- `isFirebaseConnected`일 때 `copyInviteLinkBtn` 클릭 → `?s=shortCode` URL 복사 (기존 로직 그대로 사용).
- QR 이미지 src도 `?s=shortCode` URL 기준으로 세팅.

---

## 동작 매트릭스

| 상황 | 학교명 | 저장소 연결 | 초대 링크 |
|---|---|---|---|
| Firebase 연결 + `state.schoolName` 없음 | 자동 세팅 | "연결됨" 카드 | `?s=code` |
| Firebase 연결 + `state.schoolName` 있음 | 기존 값 유지 | "연결됨" 카드 | `?s=code` |
| 독립 모드 (`schoolCode` 없음) | 기존 동작 | 전체 섹션 표시 | `?u=&k=` 방식 |

---

## 영향 범위

- `app.js`: `openSchoolSettingsModal` 함수 내 HTML 생성 및 이벤트 바인딩 수정, `window.setFirebaseSchoolName` 추가
- `account-ui.js`: `onAuthStateChanged` 콜백에 한 줄 추가
- `styles.css`: 변경 없음
- Firebase 스키마: 변경 없음
- Google Sheets 스키마: 변경 없음
