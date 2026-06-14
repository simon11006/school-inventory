const API_KEY_PROPERTY = "SCHOOL_INVENTORY_API_KEY";
const SCRIPT_VERSION = "2026-06-14-role-merge";
const APP_BASE_URL = "https://item-school.netlify.app/index.html";

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("교구이음")
    .addItem("① 처음 설정 / 연결 키 발급", "menuRunSetup")
    .addItem("② 연결 키 다시 보기", "menuShowApiKey")
    .addItem("③ 연결 진단", "menuShowDiagnostics")
    .addItem("④ 우리 학교 접속 링크", "menuShowSchoolConnectLink")
    .addSeparator()
    .addItem("연결 키 새로 발급 (재발급)", "menuResetApiKey")
    .addToUi();
}

function menuRunSetup() {
  const ui = SpreadsheetApp.getUi();
  try {
    const result = setupInventorySpreadsheet();
    const html = HtmlService.createHtmlOutput(buildSetupHtml_(result.apiKey, false))
      .setWidth(560)
      .setHeight(320);
    ui.showModalDialog(html, "교구이음 처음 설정 완료");
  } catch (error) {
    ui.alert("설정 실패", error.message, ui.ButtonSet.OK);
  }
}

function menuShowApiKey() {
  const ui = SpreadsheetApp.getUi();
  const apiKey = PropertiesService.getScriptProperties().getProperty(API_KEY_PROPERTY);
  if (!apiKey) {
    ui.alert(
      "연결 키가 아직 없습니다",
      "메뉴에서 '① 처음 설정 / 연결 키 발급'을 먼저 실행하세요.",
      ui.ButtonSet.OK
    );
    return;
  }
  const html = HtmlService.createHtmlOutput(buildSetupHtml_(apiKey, true))
    .setWidth(560)
    .setHeight(320);
  ui.showModalDialog(html, "교구이음 연결 키");
}

function menuResetApiKey() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    "연결 키를 새로 발급할까요?",
    "기존 연결 키는 즉시 무효가 되고, 모든 교사 PC의 학교 설정에 새 연결 키를 다시 입력해야 합니다. 데이터(물품·예약 등)는 그대로 유지됩니다.",
    ui.ButtonSet.OK_CANCEL
  );
  if (response !== ui.Button.OK) return;
  const key = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty(API_KEY_PROPERTY, key);
  const html = HtmlService.createHtmlOutput(buildSetupHtml_(key, false, true))
    .setWidth(560)
    .setHeight(320);
  ui.showModalDialog(html, "교구이음 연결 키 재발급 완료");
}

function menuShowDiagnostics() {
  const ui = SpreadsheetApp.getUi();
  try {
    const diag = getDiagnostics_();
    const html = HtmlService.createHtmlOutput(buildDiagnosticsHtml_(diag))
      .setWidth(560)
      .setHeight(520);
    ui.showModalDialog(html, "교구이음 연결 진단");
  } catch (error) {
    ui.alert("진단 실패", error.message, ui.ButtonSet.OK);
  }
}

function menuShowSchoolConnectLink() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty(API_KEY_PROPERTY);
  if (!apiKey) {
    ui.alert("먼저 '교구이음 → ① 처음 설정 / 연결 키 발급'을 실행하세요.");
    return;
  }

  const storedUrl = props.getProperty("WEB_APP_URL") || "";
  const promptMsg = storedUrl
    ? "현재 저장된 주소:\n" + storedUrl + "\n\n그대로 사용하려면 빈 칸으로 두고 확인을 누르세요.\n새로 배포했거나 인계를 받았다면 새 주소를 아래에 붙여넣으세요:"
    : "배포 관리에서 복사한 웹앱 URL(/exec로 끝나는 주소)을 붙여넣으세요:";

  const response = ui.prompt("웹앱 URL 확인", promptMsg, ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;

  const input = (response.getResponseText() || "").trim();
  const webAppUrl = input || storedUrl;
  if (!webAppUrl) {
    ui.alert("웹앱 URL이 없습니다. 먼저 웹앱을 배포하고 다시 실행해 주세요.");
    return;
  }
  if (input && input !== storedUrl) {
    props.setProperty("WEB_APP_URL", input);
  }

  const m = webAppUrl.match(/\/macros\/s\/([^/]+)\/exec/);
  let link;
  if (m) {
    link = APP_BASE_URL + "?d=" + encodeURIComponent(m[1]) + "&k=" + encodeURIComponent(apiKey);
  } else {
    link = APP_BASE_URL + "?u=" + encodeURIComponent(webAppUrl) + "&k=" + encodeURIComponent(apiKey);
  }

  const safe = link.replace(/[&<>"]/g, function(c) {
    return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c];
  });

  // ─── 변경: "앱 열기" 버튼 제거, 복사 후 붙여넣기 흐름으로 안내 ───
  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',\'Malgun Gothic\',sans-serif;font-size:14px;line-height:1.65;padding:16px;">' +
    '<p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#1f1d18;">우리 학교 접속 링크가 준비되었습니다.</p>' +
    '<p style="margin:0 0 14px;color:#45413a;font-size:13px;">' +
    '① 아래 <b>[주소 복사]</b> 버튼을 누르세요.<br>' +
    '② <b>교구이음 웹페이지</b>로 돌아가세요.<br>' +
    '③ <b>\'접속 링크 붙여넣기\'</b> 칸에 붙여넣고 <b>[연결하기]</b>를 누르세요.' +
    '</p>' +
    '<textarea readonly onclick="this.select()" style="width:100%;height:72px;font-size:12px;padding:8px;box-sizing:border-box;border:1px solid #d8d3c2;border-radius:6px;background:#f9f7f2;resize:none;">' + safe + '</textarea>' +
    '<button onclick="var t=document.querySelector(\'textarea\');t.select();document.execCommand(\'copy\');this.textContent=\'✓ 복사됨\';var btn=this;setTimeout(function(){btn.textContent=\'주소 복사\';},2000);" ' +
    'style="margin-top:10px;padding:10px;background:#3f6b53;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;width:100%;">주소 복사</button>' +
    '<p style="color:#863a30;margin:12px 0 0;font-size:13px;">⚠️ 이 링크에는 연결 키가 들어 있습니다. <b>학교 내부 메신저로만</b> 공유하세요.</p>' +
    '</div>'
  ).setWidth(460).setHeight(320);
  ui.showModalDialog(html, "④ 우리 학교 접속 링크");
}

function buildSetupHtml_(apiKey, alreadyIssued, reissued) {
  const title = reissued
    ? "연결 키가 재발급되었습니다."
    : alreadyIssued
      ? "기존 연결 키를 확인하세요."
      : "처음 설정이 완료되었습니다.";
  const sub = reissued
    ? "기존 키는 더 이상 사용할 수 없습니다. 새 키로 다시 배포 후 연결하세요."
    : alreadyIssued
      ? "잃어버렸을 때만 이 화면을 참고하세요."
      : "교구이음 설정 가이드 <b>3단계</b>를 계속 진행해주세요.";
  const safe = String(apiKey).replace(/[&<>"]/g, function (c) {
    return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c];
  });
  return (
    "<style>" +
    "body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Malgun Gothic',sans-serif;" +
    "color:#1f1d18;margin:0;padding:24px;line-height:1.6;text-align:center;}" +
    "h3{margin:0 0 8px;font-size:18px;color:#3f6b53;}" +
    "p{margin:8px 0;font-size:14px;color:#45413a;}" +
    ".key{margin:16px 0;padding:14px;background:#f3f1ea;border-radius:8px;" +
    "font-family:Consolas,'Courier New',monospace;font-size:13px;word-break:break-all;" +
    "user-select:all;text-align:left;}" +
    ".hint{font-size:12px;color:#898170;margin-bottom:16px;}" +
    "button{margin-top:8px;padding:10px 32px;background:#3f6b53;color:#fff;" +
    "border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;}" +
    "button:hover{background:#2e5040;}" +
    "</style>" +
    "<h3>" + title + "</h3>" +
    "<p>" + sub + "</p>" +
    "<div class='key'>" + safe + "</div>" +
    "<p class='hint'>위 연결 키는 학교 데이터 접근에 사용됩니다. 외부에 공개하지 마세요.</p>" +
    "<button onclick='google.script.host.close()'>확인</button>"
  );
}

function buildDiagnosticsHtml_(diag) {
  const sheetRows = Object.entries(diag.sheets || {}).map(function (entry) {
    const name = entry[0];
    const status = entry[1] || {};
    const ok = status.exists && status.headersOk;
    const badge = ok
      ? "<span style='color:#2c5b3e;font-weight:700;'>정상</span>"
      : "<span style='color:#863a30;font-weight:700;'>점검 필요</span>";
    const detail = status.exists
      ? (status.headersOk ? "헤더 정상, " + status.rows + "행" : "누락 헤더: " + (status.missingHeaders || []).join(", "))
      : "시트 없음";
    return "<tr><td>" + name + "</td><td>" + badge + "</td><td>" + detail + "</td></tr>";
  }).join("");
  const safe = function (v) {
    return String(v == null ? "" : v).replace(/[&<>"]/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c];
    });
  };
  return (
    "<style>" +
    "body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Malgun Gothic',sans-serif;color:#1f1d18;margin:0;padding:18px;line-height:1.55;}" +
    "h3{margin:0 0 8px;font-size:17px;color:#3f6b53;}" +
    "table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px;}" +
    "th,td{padding:7px 9px;border:1px solid #e8e4d6;text-align:left;}" +
    "th{background:#f5f2e8;}" +
    ".meta{margin-top:10px;padding:10px 12px;background:#f3f1ea;border-radius:8px;font-size:13px;}" +
    "</style>" +
    "<h3>스프레드시트 상태</h3>" +
    "<div class='meta'>" +
    "스크립트 버전: <b>" + safe(diag.scriptVersion) + "</b><br>" +
    "스프레드시트: <b>" + safe(diag.spreadsheetName) + "</b><br>" +
    "학교명(저장됨): <b>" + (safe(diag.schoolName) || "(없음)") + "</b><br>" +
    "마지막 저장 시각: <b>" + (safe(diag.savedAt) || "(없음)") + "</b>" +
    "</div>" +
    "<h3>시트별 상태</h3>" +
    "<table><tr><th>시트</th><th>상태</th><th>세부</th></tr>" + sheetRows + "</table>"
  );
}

// 각 시트의 base 헤더(사람이 보기 좋은 고정 순서). items 의 'spec'(규격)은 name 바로 뒤에 둔다.
// 앱이 보낸 행에 base에 없는 새 필드가 있으면 tableHeaders_ 가 모든 테이블에서 뒤에
// 자동으로 덧붙인다 → 어떤 테이블이든 새 필드를 추가해도 이 스크립트 재수정이 필요 없다.
const TABLES = {
  items: [
    "id", "name", "spec", "category", "location", "total", "unit", "consumable",
    "code", "purchasedAt", "price", "acquisitions", "damaged", "lost",
    "disposed", "status", "note",
  ],
  reservations: [
    "id", "itemId", "teacher", "quantity", "startDate", "endDate", "status",
    "note", "createdAt", "checkedOutAt", "checkedOutBy", "returnedAt",
    "returnedBy", "selfCheckout",
  ],
  logs: ["id", "type", "message", "actor", "itemId", "reservationId", "createdAt"],
  teachers: ["name"],
  locations: ["name"],
  settings: ["key", "value"],
};

// 실제로 시트에 쓸 헤더 목록을 계산한다.
// 모든 데이터 테이블에서 base 헤더 + (앱이 보낸 행에 들어 있는 새 필드)를 합쳐 자동 확장한다.
// → 어떤 테이블이든 앱에서 새 필드를 추가해도 이 스크립트를 다시 고칠 필요가 없다.
// '__' 로 시작하는 내부 전용 필드(__damageInTotal__ 등)는 저장에서 제외한다.
function tableHeaders_(sheetName, rows) {
  const base = (TABLES[sheetName] || []).slice();
  (rows || []).forEach(function (row) {
    Object.keys(row || {}).forEach(function (key) {
      if (key.indexOf("__") === 0) return;
      if (base.indexOf(key) === -1) base.push(key);
    });
  });
  return base;
}

function setupInventorySpreadsheet() {
  const key = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty(API_KEY_PROPERTY, key);
  Object.entries(TABLES).forEach(([sheetName, headers]) => {
    const sheet = getOrCreateSheet_(sheetName);
    sheet.clear();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  });
  const result = {
    apiKey: key,
    message: "웹앱으로 배포한 뒤 이 apiKey와 웹앱 URL을 MVP의 학교 설정에 입력하세요.",
  };
  Logger.log(`apiKey: ${key}`);
  Logger.log(result.message);
  return result;
}

function doPost(event) {
  return handleRequest_(event);
}

function doGet(event) {
  return handleRequest_(event);
}

function handleRequest_(event) {
  try {
    const body = parseBody_(event);
    verifyKey_(body.apiKey || body.key);

    if (body.action === "ping") return json_({ ok: true, ...getDiagnostics_() });
    if (body.action === "diagnose") return json_({ ok: true, ...getDiagnostics_() });
    if (body.action === "save") {
      const savedAt = saveData_(body.data, body.role || "admin", body.deletions || []);
      return json_({ ok: true, savedAt });
    }
    if (body.action === "load") {
      const data = loadData_();
      return json_({ ok: true, data, remoteSavedAt: data.meta.updatedAt || "" });
    }

    throw new Error("지원하지 않는 action입니다.");
  } catch (error) {
    return json_({ ok: false, error: error.message });
  }
}

function parseBody_(event) {
  if (event.postData && event.postData.contents) return JSON.parse(event.postData.contents);
  return event.parameter || {};
}

function verifyKey_(apiKey) {
  const expected = PropertiesService.getScriptProperties().getProperty(API_KEY_PROPERTY);
  if (!expected) throw new Error("setupInventorySpreadsheet를 먼저 실행하세요.");
  if (!apiKey || apiKey !== expected) throw new Error("연결 키가 올바르지 않습니다.");
}

function getDiagnostics_() {
  const spreadsheet = SpreadsheetApp.getActive();
  const settings = Object.fromEntries(readTable_("settings").map((row) => [row.key, row.value]));
  const sheets = Object.fromEntries(Object.keys(TABLES).map((sheetName) => [sheetName, getSheetStatus_(sheetName)]));
  return {
    scriptVersion: SCRIPT_VERSION,
    // 역할(role) 기반 안전 병합을 지원하는 스크립트임을 앱에 알린다.
    // 앱은 이 값이 true 일 때만 '교사' 변경분을 올린다(옛 스크립트에서의 전체 덮어쓰기 방지).
    mergeSupport: true,
    spreadsheetId: spreadsheet.getId(),
    spreadsheetName: spreadsheet.getName(),
    spreadsheetUrl: spreadsheet.getUrl(),
    savedAt: settings.updatedAt || "",
    schoolName: settings.schoolName || "",
    sheets,
  };
}

function getSheetStatus_(sheetName) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  const expectedHeaders = TABLES[sheetName];
  if (!sheet) {
    return { exists: false, rows: 0, columns: 0, headersOk: false, missingHeaders: expectedHeaders };
  }
  const lastColumn = Math.max(sheet.getLastColumn(), expectedHeaders.length);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].filter(String);
  const missingHeaders = expectedHeaders.filter((header) => !headers.includes(header));
  return {
    exists: true,
    rows: Math.max(0, sheet.getLastRow() - 1),
    columns: sheet.getLastColumn(),
    headersOk: missingHeaders.length === 0,
    missingHeaders,
  };
}

// role: "admin"(학교 관리자·실별 담당자) | "teacher"(일반 교사)
//  - admin   : 전 영역 권한. 물품·예약·구입요청은 id 기준 병합(원격 단독 항목 보존)하고,
//              교사 명부·물품실·설정은 권위 있게 덮어쓴다.
//  - teacher : 본인 예약·구입요청만 추가/본인 항목 갱신. 관리자 영역(물품·명부·설정 등)은
//              원격을 그대로 보존해 오래된 사본이 관리자 데이터를 덮어쓰지 않게 한다.
// 삭제는 deletions(툼스톤)로 전파한다(원격 단독 항목은 기본 보존되므로).
function saveData_(data, role, deletions) {
  if (!data) throw new Error("저장할 데이터가 없습니다.");
  role = role === "teacher" ? "teacher" : "admin";
  const lock = LockService.getDocumentLock();
  let locked = false;
  try {
    lock.waitLock(15000);
    locked = true;

    const remote = loadData_();
    const savedAt = new Date().toISOString();

    const mergedDeletions = mergeDeletions_(remote.deletions, deletions);
    const deletedItems = collectDeletedIds_(mergedDeletions, "items");
    const deletedRequests = collectDeletedIds_(mergedDeletions, "purchaseRequests");

    // 로그는 추가 전용 → id 기준 합집합
    const logs = mergeById_(remote.logs, data.logs);

    let items, reservations, purchaseRequests, teachers, locations;
    let schoolName, adminPin, locationManagers, categories, categoriesByLocation;

    if (role === "teacher") {
      // 관리자 영역은 원격 보존
      items = remote.items;
      teachers = remote.teachers;
      locations = remote.locations;
      schoolName = remote.schoolName;
      adminPin = remote.adminPin;
      locationManagers = remote.locationManagers;
      categories = remote.categories;
      categoriesByLocation = remote.categoriesByLocation;
      // 본인 소유 항목만 추가/갱신
      reservations = mergeOwned_(remote.reservations, data.reservations, "teacher");
      purchaseRequests = mergeOwned_(remote.purchaseRequests, data.purchaseRequests, "requester");
    } else {
      items = mergeById_(remote.items, data.items);
      reservations = mergeById_(remote.reservations, data.reservations);
      purchaseRequests = mergeById_(remote.purchaseRequests, data.purchaseRequests);
      teachers = (data.teachers || []).filter(String);
      locations = (data.locations || []).filter(String);
      schoolName = data.schoolName || "";
      adminPin = data.adminPin || "";
      locationManagers = data.locationManagers || {};
      categories = data.categories || [];
      categoriesByLocation = data.categoriesByLocation || {};
    }

    // 삭제 적용: 삭제된 물품/구입요청 제거 + 삭제된 물품의 예약 제거
    if (deletedItems.length) {
      items = items.filter((i) => deletedItems.indexOf(String(i.id)) === -1);
    }
    if (deletedRequests.length) {
      purchaseRequests = purchaseRequests.filter((p) => deletedRequests.indexOf(String(p.id)) === -1);
    }
    if (deletedItems.length) {
      reservations = reservations.filter((r) => deletedItems.indexOf(String(r.itemId)) === -1);
    }

    writeTable_("items", items);
    writeTable_("reservations", reservations);
    writeTable_("logs", logs);
    writeTable_("teachers", teachers.map((name) => ({ name })));
    writeTable_("locations", locations.map((name) => ({ name })));
    writeTable_("settings", [
      { key: "schoolName", value: schoolName || "" },
      { key: "adminPin", value: adminPin || "" },
      { key: "locationManagers", value: JSON.stringify(locationManagers || {}) },
      { key: "categories", value: JSON.stringify(categories || []) },
      { key: "categoriesByLocation", value: JSON.stringify(categoriesByLocation || {}) },
      { key: "purchaseRequests", value: JSON.stringify(purchaseRequests || []) },
      { key: "deletions", value: JSON.stringify(mergedDeletions || []) },
      { key: "updatedAt", value: savedAt },
      { key: "clientUpdatedAt", value: data.meta?.updatedAt || "" },
      { key: "deviceId", value: data.meta?.deviceId || "" },
    ]);
    return savedAt;
  } finally {
    if (locked) lock.releaseLock();
  }
}

// id 기준 병합: 원격을 바탕으로 incoming이 같은 id를 덮어쓰고, 원격 단독 항목은 보존한다.
function mergeById_(remoteList, incomingList) {
  const map = {};
  (remoteList || []).forEach((r) => { if (r && r.id != null && r.id !== "") map[String(r.id)] = r; });
  (incomingList || []).forEach((r) => { if (r && r.id != null && r.id !== "") map[String(r.id)] = r; });
  return Object.keys(map).map((k) => map[k]);
}

// 교사 푸시용: 새 항목은 추가, 같은 id는 본인 소유(ownerField 일치)일 때만 갱신.
// 그 외(남의 항목)는 원격을 그대로 유지 → 오래된 사본으로 남의 것을 덮어쓰지 않는다.
function mergeOwned_(remoteList, incomingList, ownerField) {
  const map = {};
  (remoteList || []).forEach((r) => { if (r && r.id != null && r.id !== "") map[String(r.id)] = r; });
  (incomingList || []).forEach((i) => {
    if (!i || i.id == null || i.id === "") return;
    const id = String(i.id);
    const existing = map[id];
    if (!existing) { map[id] = i; return; }
    if (existing[ownerField] && i[ownerField] && existing[ownerField] === i[ownerField]) {
      map[id] = i;
    }
  });
  return Object.keys(map).map((k) => map[k]);
}

function mergeDeletions_(remoteDel, incomingDel) {
  const map = {};
  const add = (list) => (list || []).forEach((d) => {
    if (!d || !d.coll || d.id == null || d.id === "") return;
    map[d.coll + ":" + d.id] = { coll: d.coll, id: String(d.id), at: d.at || "" };
  });
  add(remoteDel);
  add(incomingDel);
  const arr = Object.keys(map).map((k) => map[k]);
  arr.sort((a, b) => ((b.at || "") < (a.at || "") ? -1 : 1)); // 최근 우선
  return arr.slice(0, 1000);
}

function collectDeletedIds_(deletions, coll) {
  const ids = [];
  (deletions || []).forEach((d) => { if (d && d.coll === coll) ids.push(String(d.id)); });
  return ids;
}

function loadData_() {
  const spreadsheet = SpreadsheetApp.getActive();
  const sheets = spreadsheet.getSheets();
  const data = {};

  sheets.forEach((sheet) => {
    const sheetName = sheet.getName();
    if (!TABLES[sheetName]) return;
    const values = sheet.getDataRange().getValues();
    if (values.length < 2) {
      data[sheetName] = [];
      return;
    }
    const headers = values[0];
    data[sheetName] = values.slice(1).map((row) =>
      Object.fromEntries(headers.map((header, index) => [header, row[index]]))
    );
  });

  Object.keys(TABLES).forEach(sheetName => {
    if (!data[sheetName]) data[sheetName] = [];
  });

  const settings = Object.fromEntries((data.settings || []).map((row) => [row.key, row.value]));
  let locationManagers = {};
  try { locationManagers = settings.locationManagers ? JSON.parse(settings.locationManagers) : {}; } catch (e) {}
  let categories = [];
  try { categories = settings.categories ? JSON.parse(settings.categories) : []; } catch (e) {}
  let purchaseRequests = [];
  try { purchaseRequests = settings.purchaseRequests ? JSON.parse(settings.purchaseRequests) : []; } catch (e) {}
  let categoriesByLocation = {};
  try { categoriesByLocation = settings.categoriesByLocation ? JSON.parse(settings.categoriesByLocation) : {}; } catch (e) {}
  let deletions = [];
  try { deletions = settings.deletions ? JSON.parse(settings.deletions) : []; } catch (e) {}

  return {
    schoolName: settings.schoolName || "",
    adminPin: settings.adminPin || "",
    locationManagers,
    categories: Array.isArray(categories) ? categories.filter(Boolean) : [],
    categoriesByLocation: (categoriesByLocation && typeof categoriesByLocation === "object") ? categoriesByLocation : {},
    deletions: Array.isArray(deletions) ? deletions : [],
    purchaseRequests: Array.isArray(purchaseRequests) ? purchaseRequests : [],
    teachers: (data.teachers || []).map((row) => row.name).filter(Boolean),
    locations: (data.locations || []).map((row) => row.name).filter(Boolean),
    items: (data.items || []).map((row) => ({
      ...row,
      total: Number(row.total || 0),
      price: Number(row.price || 0),
      acquisitions: parseJsonArray_(row.acquisitions),
      damaged: Number(row.damaged || 0),
      lost: Number(row.lost || 0),
      disposed: Number(row.disposed || 0),
      consumable: row.consumable === true || row.consumable === "TRUE" || row.consumable === "true",
    })),
    reservations: (data.reservations || []).map((row) => ({
      ...row,
      quantity: Number(row.quantity || 0),
      selfCheckout: row.selfCheckout === true || row.selfCheckout === "TRUE" || row.selfCheckout === "true",
    })),
    logs: data.logs || [],
    meta: {
      updatedAt: settings.updatedAt || "",
      remoteSavedAt: settings.updatedAt || "",
      clientUpdatedAt: settings.clientUpdatedAt || "",
      deviceId: settings.deviceId || "",
    },
  };
}

function writeTable_(sheetName, rows) {
  const headers = tableHeaders_(sheetName, rows);
  const sheet = getOrCreateSheet_(sheetName);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (!rows.length) return;
  const values = rows.map((row) => headers.map((header) => serializeCell_(row[header])));
  sheet.getRange(2, 1, values.length, headers.length).setValues(values);
}

function serializeCell_(value) {
  if (Array.isArray(value) || (value && typeof value === "object")) return JSON.stringify(value);
  return value ?? "";
}

function parseJsonArray_(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function readTable_(sheetName) {
  const sheet = getOrCreateSheet_(sheetName);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index]]))
  );
}

function getOrCreateSheet_(sheetName) {
  const spreadsheet = SpreadsheetApp.getActive();
  return spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
