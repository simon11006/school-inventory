// account-core.js — Firebase/DOM 의존 없는 순수 함수 모음
// 일반 <script> 로 로드 (app.js 보다 먼저)
(function (global) {
  "use strict";

  const ACCOUNT = {};

  /** 아이디 검증: 4~20자, 영문 소문자·숫자·하이픈·언더스코어 */
  ACCOUNT.isValidUsername = function (username) {
    return typeof username === "string" && /^[a-z0-9_-]{4,20}$/.test(username);
  };

  /** 아이디 → Firebase Auth 합성 이메일 (비라우팅 내부 도메인) */
  ACCOUNT.usernameToAuthEmail = function (username) {
    return String(username).toLowerCase() + "@item-school.app";
  };

  /** 짧은 코드 생성: 헷갈리는 글자(0/o/1/l/i) 제외, 기본 4자 */
  ACCOUNT.generateShortCode = function (length) {
    const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
    const n = length || 4;
    const rand = (global.crypto && global.crypto.getRandomValues)
      ? Array.from(global.crypto.getRandomValues(new Uint32Array(n)))
      : Array.from({ length: n }, () => Math.floor(Math.random() * 1e9));
    return rand.map(function (r) { return alphabet[r % alphabet.length]; }).join("");
  };

  /** 미활용 판정: 마지막 활동 후 30일 초과면 true */
  ACCOUNT.INACTIVE_DAYS = 30;
  ACCOUNT.isInactive = function (lastActiveMs, nowMs) {
    if (!lastActiveMs) return true;
    return (nowMs || Date.now()) - lastActiveMs > ACCOUNT.INACTIVE_DAYS * 24 * 60 * 60 * 1000;
  };

  /** heartbeat 쓰로틀: 마지막 전송 후 6시간 지났으면 true */
  ACCOUNT.HEARTBEAT_THROTTLE_MS = 6 * 60 * 60 * 1000;
  ACCOUNT.shouldHeartbeat = function (lastSentMs, nowMs) {
    if (!lastSentMs) return true;
    return (nowMs || Date.now()) - lastSentMs > ACCOUNT.HEARTBEAT_THROTTLE_MS;
  };

  global.AccountCore = ACCOUNT;
})(window);
