# 사용 통계 수집기 셋업 (만든이 전용)

> **참고:** 중앙 계정 시스템 도입 후에는 **총괄관리자 대시보드 → 가입 학교**에서 각 학교의 승인 상태와 활용중/미활용(마지막 활동 기준)을 바로 확인할 수 있습니다. 이 구글 시트 수집기는 그 이전부터 쓰던 **선택적·독립** 핑 기능으로, 계정 시스템 없이도 학교명 단위 사용량만 가볍게 보고 싶을 때 씁니다. 둘 중 하나만 써도 됩니다.

이 문서대로 한 번 셋업하면, 앱을 켜는 모든 학교가 하루 1회 학교명을 보내주고, 만든이 본인 구글 시트에 자동으로 누적됩니다.

학교 화면에는 "사용 학교명만 수집됩니다. 개별 학교의 물품·개인정보는 수집되지 않습니다."로 안내합니다.

> **수집 항목**: 학교명, 앱 버전.
> **수집되지 않는 항목**: 교사 이름, 물품, 예약 내용, 비밀번호, 운영 데이터 일체.

소요 시간 약 10분.

---

## 1. 새 구글 스프레드시트 생성

1. [drive.google.com](https://drive.google.com)에서 **새로 만들기 → Google 스프레드시트 → 빈 스프레드시트**.
2. 이름: `교구이음 사용 등록부` (자유)
3. 첫 시트 이름을 `registry`로 변경.
4. 1행에 헤더 입력:
   ```
   schoolName    firstSeenAt    lastSeenAt    pingCount    version
   ```

## 2. Apps Script 작성

1. 같은 스프레드시트에서 **확장 프로그램 → Apps Script**.
2. `Code.gs`에 아래 코드 붙여넣기:

```javascript
const SHEET_NAME = "registry";

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || "{}");
    const schoolName = String(body.schoolName || "").trim();
    if (!schoolName) {
      return _json({ ok: false, error: "schoolName required" });
    }
    const version = String(body.version || "").trim();
    const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const now = new Date();

    let rowIdx = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === schoolName) { rowIdx = i + 1; break; }
    }

    if (rowIdx === -1) {
      sheet.appendRow([schoolName, now, now, 1, version]);
    } else {
      const prevCount = Number(data[rowIdx - 1][3]) || 0;
      sheet.getRange(rowIdx, 3).setValue(now);
      sheet.getRange(rowIdx, 4).setValue(prevCount + 1);
      if (version) sheet.getRange(rowIdx, 5).setValue(version);
    }
    return _json({ ok: true });
  } catch (err) {
    return _json({ ok: false, error: String(err && err.message || err) });
  }
}

function doGet() {
  return _json({ ok: true, hint: "POST schoolName/version only" });
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

3. 저장 (`Ctrl+S`).

## 3. 웹앱 배포

1. **배포 → 새 배포** (오른쪽 위 톱니 → "웹 앱" 선택).
2. 설정:
   - **설명**: `교구이음 사용 등록부`
   - **다음 사용자로 실행**: **나** (만든이 본인)
   - **액세스 권한**: **모든 사용자** (익명 POST 허용)
3. **배포** → 권한 승인 → **웹 앱 URL** 복사.

URL 형태:
```
https://script.google.com/macros/s/AKfycbz...../exec
```

## 4. 앱 코드에 URL 박기

`app.js` 상단에서 다음 상수의 값을 위 URL로 바꿉니다:

```javascript
const USAGE_REGISTRY_URL = "여기에_복사한_URL_붙여넣기";
```

비워두면 (`""`) 핑이 비활성화되어 아무 데도 전송되지 않습니다 (기본값).

## 5. 결과 확인

학교들이 앱을 한 번씩 열고 나면 시트가 이렇게 채워집니다:

| schoolName | firstSeenAt | lastSeenAt | pingCount | version |
|---|---|---|---|---|
| 광명초등학교 | 2026-04-12 09:11 | 2026-05-10 14:32 | 28 | 1.0.0 |
| 둔촌중학교 | 2026-04-28 13:00 | 2026-05-09 09:11 | 12 | 1.0.0 |

활용:
- **활성 학교 = `lastSeenAt`이 최근 7일 이내**인 행 수.
- **휴면 학교 = 30일 이상 미접속**.
- 새 학교가 등록되면 자동으로 행이 추가됩니다.

---

## 보안 / 사생활

- 시트는 만든이 구글 계정 소유. 다른 학교는 접근 권한 없음.
- Apps Script는 `doPost`만 받음. 외부에서 `doGet`으로 데이터 조회 불가 (열어도 의미 없는 안내만 반환).
- 학교 데이터(물품, 예약 등)는 학교 자체 스프레드시트에만 살아 있고 이 등록부엔 안 들어옴.
