(() => {
  // ── State ──
  let timerInterval = null;
  let startTime     = null;
  let elapsedMs     = 0;
  let running       = false;
  let sessions      = JSON.parse(localStorage.getItem('rspd_sessions') || '[]');

  // ── Elements ──
  const textInput      = document.getElementById('textInput');
  const readingDisplay = document.getElementById('readingDisplay');
  const inputArea      = document.getElementById('inputArea');
  const timerDisplay   = document.getElementById('timerDisplay');
  const pulseDot       = document.getElementById('pulseDot');
  const btnStart       = document.getElementById('btnStart');
  const btnStop        = document.getElementById('btnStop');
  const btnReset       = document.getElementById('btnReset');
  const historyList    = document.getElementById('historyList');
  const historyEmpty   = document.getElementById('historyEmpty');
  const historyCount   = document.getElementById('historyCount');

  // ── Helpers ──
  function countWords(text) {
    return text.trim().split(/\s+/).filter(w => w.length > 0).length;
  }

  function formatTime(ms) {
    const total = Math.floor(ms / 100);
    const tenths = total % 10;
    const secs   = Math.floor(total / 10) % 60;
    const mins   = Math.floor(total / 600);
    return `${mins}:${String(secs).padStart(2,'0')}.${tenths}`;
  }

  function calcWPM(words, ms) {
    const mins = ms / 60000;
    return mins > 0 ? Math.round(words / mins) : 0;
  }

  function wpmBadge(wpm) {
    if (wpm <  150) return ['badge-slow',   'Elementary'];
    if (wpm <  250) return ['badge-avg',    'Middle School'];
    if (wpm <  400) return ['badge-fast',   'High School'];
    if (wpm <  600) return ['badge-fast',   'College'];
    return              ['badge-expert', 'Speed Reader'];
  }

  function countSyllables(word) {
    word = word.toLowerCase().replace(/[^a-z]/g, '');
    if (!word) return 0;
    if (word.length <= 3) return 1;
    word = word.replace(/e$/, '');
    const groups = word.match(/[aeiouy]+/g);
    return Math.max(1, groups ? groups.length : 1);
  }

  function analyzeDifficulty(text) {
    const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);
    const sentCount = Math.max(1, sentences.length);
    const words     = text.match(/[a-zA-Z'-]+/g) || [];
    const wordCount = Math.max(1, words.length);

    let totalSyl = 0, complexWc = 0;
    words.forEach(w => {
      const s = countSyllables(w);
      totalSyl += s;
      if (s >= 3) complexWc++;
    });

    const fkgl = 0.39 * (wordCount / sentCount) + 11.8 * (totalSyl / wordCount) - 15.59;
    const fogBoost = (complexWc / wordCount) * 40;
    const grade = Math.max(0, Math.round((fkgl * 0.7 + fogBoost * 0.3) * 10) / 10);

    let cls, label;
    if      (grade <  6) { cls = 'diff-easy';         label = 'Elementary';   }
    else if (grade <  9) { cls = 'diff-intermediate'; label = 'Middle School'; }
    else if (grade < 13) { cls = 'diff-advanced';     label = 'High School';  }
    else                 { cls = 'diff-academic';     label = 'College';      }

    return { cls, label, grade };
  }

  function nowLabel() {
    const d   = new Date();
    const mon = d.toLocaleString('en-US', { month: 'short' });
    const day = d.getDate();
    const hh  = String(d.getHours()).padStart(2, '0');
    const mm  = String(d.getMinutes()).padStart(2, '0');
    return `${mon} ${day}  ·  ${hh}:${mm}`;
  }

  function saveSession(session) {
    sessions.unshift(session);
    localStorage.setItem('rspd_sessions', JSON.stringify(sessions));
  }

  function deleteSession(id) {
    sessions = sessions.filter(s => s.id !== id);
    localStorage.setItem('rspd_sessions', JSON.stringify(sessions));
    renderHistory();
  }

  function renderHistory() {
    [...historyList.querySelectorAll('.history-item')].forEach(el => el.remove());

    if (sessions.length === 0) {
      historyEmpty.style.display = '';
      historyCount.textContent   = '';
      return;
    }

    historyEmpty.style.display = 'none';
    historyCount.textContent   = `${sessions.length} 件`;

    sessions.forEach(s => {
      const [cls, label] = wpmBadge(s.wpm);
      const diff = s.diff || analyzeDifficulty(s.text);

      const el = document.createElement('div');
      el.className  = 'history-item';
      el.dataset.id = s.id;

      el.innerHTML = `
        <div class="history-item-body">
          <div class="history-datetime">${s.time}</div>
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
        <button class="btn-delete" title="削除" data-id="${s.id}">✕</button>
      `;

      historyList.appendChild(el);
    });
  }

  function tick() {
    elapsedMs = Date.now() - startTime;
    timerDisplay.textContent = formatTime(elapsedMs);
  }

  btnStart.addEventListener('click', () => {
    const text = textInput.value.trim();
    if (!text) {
      textInput.focus();
      textInput.style.borderColor = 'var(--danger)';
      setTimeout(() => textInput.style.borderColor = '', 1200);
      return;
    }

    running = true;
    startTime = Date.now();
    elapsedMs = 0;

    inputArea.style.display       = 'none';
    readingDisplay.style.display  = 'block';
    readingDisplay.textContent    = text;
    timerDisplay.classList.add('visible');
    pulseDot.classList.add('visible');
    btnStart.style.display        = 'none';
    btnStop.style.display         = 'inline-block';
    btnReset.style.display        = 'none';

    timerInterval = setInterval(tick, 100);
  });

  btnStop.addEventListener('click', () => {
    if (!running) return;
    clearInterval(timerInterval);
    running = false;

    elapsedMs = Date.now() - startTime;
    const text  = textInput.value.trim();
    const words = countWords(text);
    const wpm   = calcWPM(words, elapsedMs);

    pulseDot.classList.remove('visible');
    timerDisplay.textContent = formatTime(elapsedMs);

    const session = { id: Date.now(), text, words, ms: elapsedMs, wpm, diff: analyzeDifficulty(text), time: nowLabel() };
    saveSession(session);
    renderHistory();

    btnStop.style.display  = 'none';
    btnReset.style.display = 'inline-block';
  });

  btnReset.addEventListener('click', () => {
    running = false;
    elapsedMs = 0;

    inputArea.style.display       = '';
    readingDisplay.style.display  = 'none';
    timerDisplay.classList.remove('visible');
    timerDisplay.textContent      = '0:00.0';
    pulseDot.classList.remove('visible');
    btnStop.style.display         = 'none';
    btnReset.style.display        = 'none';
    btnStart.style.display        = '';
    textInput.value               = '';
  });

  historyList.addEventListener('click', e => {
    const btn = e.target.closest('.btn-delete');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const item = btn.closest('.history-item');
    item.style.transition = 'opacity 0.2s, transform 0.2s';
    item.style.opacity    = '0';
    item.style.transform  = 'translateX(10px)';
    setTimeout(() => { deleteSession(id); }, 200);
  });

  renderHistory();
})();
