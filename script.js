const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAXelhtcO_1GD8NJhURqQiiH6XWiv1drQU",
  authDomain: "reading-speed-tracker.firebaseapp.com",
  projectId: "reading-speed-tracker",
  storageBucket: "reading-speed-tracker.firebasestorage.app",
  messagingSenderId: "912736291475",
  appId: "1:912736291475:web:c68d30b83965e16b91db66",
};

// ============================================================

firebase.initializeApp(FIREBASE_CONFIG);
const auth = firebase.auth();
const db = firebase.firestore();

(() => {
  // ── State ──
  let timerInterval = null;
  let startTime = null;
  let elapsedMs = 0;
  let running = false;
  let currentUser = null; // Firebase User | null
  let sessions = []; // 表示中のセッション一覧
  let unsubscribe = null; // Firestore listener の解除関数

  // ── Elements ──
  const textInput = document.getElementById("textInput");
  const readingDisplay = document.getElementById("readingDisplay");
  const inputArea = document.getElementById("inputArea");
  const timerDisplay = document.getElementById("timerDisplay");
  const pulseDot = document.getElementById("pulseDot");
  const btnStart = document.getElementById("btnStart");
  const btnStop = document.getElementById("btnStop");
  const btnReset = document.getElementById("btnReset");
  const historyList = document.getElementById("historyList");
  const historyEmpty = document.getElementById("historyEmpty");
  const historyCount = document.getElementById("historyCount");
  const btnSignIn = document.getElementById("btnSignIn");
  const btnSignOut = document.getElementById("btnSignOut");
  const userInfo = document.getElementById("userInfo");
  const userAvatar = document.getElementById("userAvatar");
  const userName = document.getElementById("userName");
  const authBanner = document.getElementById("authBanner");

  // ── Auth ──
  btnSignIn.addEventListener("click", () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch((err) => {
      console.error("Sign-in error:", err);
      alert("ログインに失敗しました: " + err.message);
    });
  });

  btnSignOut.addEventListener("click", () => {
    auth.signOut();
  });

  auth.onAuthStateChanged((user) => {
    currentUser = user;

    if (user) {
      // ログイン済み UI
      btnSignIn.style.display = "none";
      userInfo.style.display = "flex";
      userAvatar.src = user.photoURL || "";
      userName.textContent = user.displayName || user.email;
      authBanner.style.display = "none";

      // Firestore のリアルタイム履歴を購読
      subscribeToSessions(user.uid);
    } else {
      // 未ログイン UI
      btnSignIn.style.display = "";
      userInfo.style.display = "none";
      authBanner.style.display = "";

      // Firestore 購読解除 → localStorage にフォールバック
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      sessions = JSON.parse(localStorage.getItem("rspd_sessions") || "[]");
      renderHistory();
    }
  });

  // ── Firestore helpers ──
  function sessionsRef(uid) {
    return db.collection("users").doc(uid).collection("sessions");
  }

  function subscribeToSessions(uid) {
    if (unsubscribe) unsubscribe();
    unsubscribe = sessionsRef(uid)
      .orderBy("createdAt", "desc")
      .onSnapshot(
        (snap) => {
          sessions = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
          renderHistory();
        },
        (err) => {
          console.error("Firestore snapshot error:", err);
        },
      );
  }

  async function saveSessionToFirestore(uid, session) {
    const { id, ...data } = session; // Firestore は id をフィールドに含めない
    await sessionsRef(uid)
      .doc(String(session.id))
      .set({
        ...data,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
  }

  async function deleteSessionFromFirestore(uid, id) {
    await sessionsRef(uid).doc(String(id)).delete();
  }

  // ── Helpers ──
  function countWords(text) {
    return text
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0).length;
  }

  function formatTime(ms) {
    const total = Math.floor(ms / 100);
    const tenths = total % 10;
    const secs = Math.floor(total / 10) % 60;
    const mins = Math.floor(total / 600);
    return `${mins}:${String(secs).padStart(2, "0")}.${tenths}`;
  }

  function calcWPM(words, ms) {
    const mins = ms / 60000;
    return mins > 0 ? Math.round(words / mins) : 0;
  }

  function wpmBadge(wpm) {
    if (wpm < 150) return ["badge-slow", "Elementary"];
    if (wpm < 250) return ["badge-avg", "Middle School"];
    if (wpm < 400) return ["badge-fast", "High School"];
    if (wpm < 600) return ["badge-fast", "College"];
    return ["badge-expert", "Speed Reader"];
  }

  function countSyllables(word) {
    word = word.toLowerCase().replace(/[^a-z]/g, "");
    if (!word) return 0;
    if (word.length <= 3) return 1;
    word = word.replace(/e$/, "");
    const groups = word.match(/[aeiouy]+/g);
    return Math.max(1, groups ? groups.length : 1);
  }

  function analyzeDifficulty(text) {
    const sentences = text
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const sentCount = Math.max(1, sentences.length);
    const words = text.match(/[a-zA-Z'-]+/g) || [];
    const wordCount = Math.max(1, words.length);

    let totalSyl = 0,
      complexWc = 0;
    words.forEach((w) => {
      const s = countSyllables(w);
      totalSyl += s;
      if (s >= 3) complexWc++;
    });

    const fkgl =
      0.39 * (wordCount / sentCount) + 11.8 * (totalSyl / wordCount) - 15.59;
    const fogBoost = (complexWc / wordCount) * 40;
    const grade = Math.max(
      0,
      Math.round((fkgl * 0.7 + fogBoost * 0.3) * 10) / 10,
    );

    let cls, label;
    if (grade < 6) {
      cls = "diff-easy";
      label = "Elementary";
    } else if (grade < 9) {
      cls = "diff-intermediate";
      label = "Middle School";
    } else if (grade < 13) {
      cls = "diff-advanced";
      label = "High School";
    } else {
      cls = "diff-academic";
      label = "College";
    }

    return { cls, label, grade };
  }

  function nowLabel() {
    const d = new Date();
    const mon = d.toLocaleString("en-US", { month: "short" });
    const day = d.getDate();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${mon} ${day}  ·  ${hh}:${mm}`;
  }

  // ── LocalStorage fallback ──
  function saveToLocal(session) {
    const local = JSON.parse(localStorage.getItem("rspd_sessions") || "[]");
    local.unshift(session);
    localStorage.setItem("rspd_sessions", JSON.stringify(local));
  }

  function deleteFromLocal(id) {
    const local = JSON.parse(
      localStorage.getItem("rspd_sessions") || "[]",
    ).filter((s) => s.id !== id);
    localStorage.setItem("rspd_sessions", JSON.stringify(local));
    sessions = local;
    renderHistory();
  }

  // ── Render ──
  function renderHistory() {
    [...historyList.querySelectorAll(".history-item")].forEach((el) =>
      el.remove(),
    );

    if (sessions.length === 0) {
      historyEmpty.style.display = "";
      historyCount.textContent = "";
      return;
    }

    historyEmpty.style.display = "none";
    historyCount.textContent = `${sessions.length} 件`;

    sessions.forEach((s) => {
      const [cls, label] = wpmBadge(s.wpm);
      const diff = s.diff || analyzeDifficulty(s.text || "");

      const el = document.createElement("div");
      el.className = "history-item";
      el.dataset.id = s.id;

      // ログイン中はクラウドアイコンを表示
      const syncBadge = currentUser
        ? '<span class="sync-badge" title="クラウド同期済み">☁</span>'
        : "";

      el.innerHTML = `
        <div class="history-item-body">
          <div class="history-datetime">${s.time || ""} ${syncBadge}</div>
          <div class="history-stats">
            <div class="history-wpm">${s.wpm}<span>wpm</span></div>
            <span class="stat-sep">·</span>
            <span class="history-stat">${formatTime(s.ms)}</span>
            <span class="stat-sep">·</span>
            <span class="history-stat">${s.words} words</span>
          </div>
          <div class="history-badges">
            <div class="badge-group">
              <span class="badge-category">Pace</span>
              <span class="wpm-badge ${cls}" title="Reading speed vs. native English speakers">${label}</span>
            </div>
            <div class="badge-group">
              <span class="badge-category">Text</span>
              <span class="diff-badge ${diff.cls}" title="FK Grade ${diff.grade}">${diff.label}</span>
            </div>
          </div>
        </div>
        <div class="history-actions">
          <div class="copy-toast" id="toast-${s.id}">Copied!</div>
          <button class="btn-copy" title="英文をコピー" data-id="${s.id}">⎘</button>
          <button class="btn-delete" title="削除" data-id="${s.id}">✕</button>
        </div>
      `;

      historyList.appendChild(el);
    });
  }

  // ── Timer ──
  function tick() {
    elapsedMs = Date.now() - startTime;
    timerDisplay.textContent = formatTime(elapsedMs);
  }

  // ── Buttons ──
  btnStart.addEventListener("click", () => {
    const text = textInput.value.trim();
    if (!text) {
      textInput.focus();
      textInput.style.borderColor = "var(--danger)";
      setTimeout(() => (textInput.style.borderColor = ""), 1200);
      return;
    }

    running = true;
    startTime = Date.now();
    elapsedMs = 0;

    inputArea.style.display = "none";
    readingDisplay.style.display = "block";
    readingDisplay.textContent = text;
    timerDisplay.classList.add("visible");
    pulseDot.classList.add("visible");
    btnStart.style.display = "none";
    btnStop.style.display = "inline-block";
    btnReset.style.display = "none";

    timerInterval = setInterval(tick, 100);
  });

  btnStop.addEventListener("click", () => {
    if (!running) return;
    clearInterval(timerInterval);
    running = false;

    elapsedMs = Date.now() - startTime;
    const text = textInput.value.trim();
    const words = countWords(text);
    const wpm = calcWPM(words, elapsedMs);

    pulseDot.classList.remove("visible");
    timerDisplay.textContent = formatTime(elapsedMs);

    const session = {
      id: Date.now(),
      text,
      words,
      ms: elapsedMs,
      wpm,
      diff: analyzeDifficulty(text),
      time: nowLabel(),
    };

    if (currentUser) {
      // Firestore へ保存（onSnapshot が自動で renderHistory() を呼ぶ）
      saveSessionToFirestore(currentUser.uid, session).catch((err) => {
        console.error("Firestore save error:", err);
        // フォールバック: ローカルに保存
        saveToLocal(session);
        sessions.unshift(session);
        renderHistory();
      });
    } else {
      saveToLocal(session);
      sessions.unshift(session);
      renderHistory();
    }

    btnStop.style.display = "none";
    btnReset.style.display = "inline-block";
  });

  btnReset.addEventListener("click", () => {
    running = false;
    elapsedMs = 0;

    inputArea.style.display = "";
    readingDisplay.style.display = "none";
    timerDisplay.classList.remove("visible");
    timerDisplay.textContent = "0:00.0";
    pulseDot.classList.remove("visible");
    btnStop.style.display = "none";
    btnReset.style.display = "none";
    btnStart.style.display = "";
    textInput.value = "";
  });

  historyList.addEventListener("click", (e) => {
    // Copy
    const copyBtn = e.target.closest(".btn-copy");
    if (copyBtn) {
      const id = Number(copyBtn.dataset.id);
      const session = sessions.find((s) => s.id == id);
      if (session && session.text) {
        navigator.clipboard.writeText(session.text).then(() => {
          const toast = document.getElementById(`toast-${id}`);
          if (toast) {
            toast.classList.add("visible");
            setTimeout(() => toast.classList.remove("visible"), 3000);
          }
        });
      }
      return;
    }

    // Delete
    const btn = e.target.closest(".btn-delete");
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const item = btn.closest(".history-item");

    item.style.transition = "opacity 0.2s, transform 0.2s";
    item.style.opacity = "0";
    item.style.transform = "translateX(10px)";

    setTimeout(() => {
      if (currentUser) {
        deleteSessionFromFirestore(currentUser.uid, id).catch(console.error);
      } else {
        deleteFromLocal(id);
      }
    }, 200);
  });

  // 初期描画（未ログイン時のローカル履歴）
  sessions = JSON.parse(localStorage.getItem("rspd_sessions") || "[]");
  renderHistory();
})();
