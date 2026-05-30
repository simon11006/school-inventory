// firebase-config.js — Firebase 앱 초기화 (ES module, type="module")
// index.html에서 <script type="module" src="./firebase-config.js"> 로 로드
import { initializeApp }  from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import { getAuth, setPersistence, browserSessionPersistence }
                          from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { getFirestore }   from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyAPOqR-xarDSeU4md4CqSMFujeQShBxnjE",
  authDomain:        "school-inven.firebaseapp.com",
  projectId:         "school-inven",
  storageBucket:     "school-inven.firebasestorage.app",
  messagingSenderId: "251591675855",
  appId:             "1:251591675855:web:4d720efcf1b3ed2ff7ccba",
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// 세션 유지 설정: 새로고침 후에도 로그인 상태 유지, 브라우저 창 닫으면 자동 로그아웃
setPersistence(auth, browserSessionPersistence).catch(() => {});

// window.fb 로 전역 노출 → account-ui.js(모듈)과 app.js(일반 스크립트) 양쪽에서 참조
window.fb = { app, auth, db };
