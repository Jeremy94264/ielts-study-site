/* ============================================
 * 我的雅思学习站 - 单词复习模块
 * 词库：kaodianciku.pdf（刘洪波《剑桥雅思阅读考点词真经》考点词库）
 *       三类考点词：第1类(约90%命题) / 第2类(约60%) / 第3类(真题考查过)
 * 复习：SRS间隔重复 —— 不认识(10分钟) / 认识(1天) / 已掌握(3天起翻倍，上限30天)
 * 星级：不再标记重要性（重要性由类别体现），改为标记「掌握程度」1-5★
 *       1★未学习/不认识 · 2★认识(1天) · 3★已掌握(3天) · 4★(6天) · 5★(≥12天)
 * 发音：Web Speech API，默认英音(en-GB)，可切换美音(en-US)
 * ============================================ */
(() => {
  'use strict';

  const WORDS = (typeof window !== 'undefined' && window.IELTS_WORDS)
    ? window.IELTS_WORDS
    : (typeof IELTS_WORDS !== 'undefined' ? IELTS_WORDS : []);

  const STORE_KEY = 'ielts_words_progress_v1';
  const SETTINGS_KEY = 'ielts_settings_v1';
  const SCOPE_KEY = 'ielts_scope_v1';
  const DAY = 24 * 60 * 60 * 1000;
  const AGAIN_MIN = 10 * 60 * 1000;
  const TYPES = ['第1类考点词', '第2类考点词', '第3类考点词'];
  /* 站点七大模块（与 index.html 的 section id 一致） */
  const MODULES = ['words', 'grammar', 'listening', 'reading', 'writing', 'speaking', 'materials'];
  /* 单词模块下的子模块 */
  const SUBS = ['s538', 's100'];

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  /* ================= 模块路由（#模块/子模块） ================= */
  function getHash() {
    try { return (window.location && window.location.hash) || ''; } catch (e) { return ''; }
  }
  function setHash(h) {
    try { if (window.location) window.location.hash = h; } catch (e) {}
  }

  /* 内嵌子应用的 iframe 按需加载（首次进入模块时才请求，避免拖慢首页） */
  const loadedFrames = {};
  function ensureFrame(id) {
    const f = $(id);
    if (!f || loadedFrames[id]) return;
    const src = f.dataset ? f.dataset.src : '';
    if (!src) return;
    loadedFrames[id] = true;
    if (typeof f.setAttribute === 'function') f.setAttribute('src', src);
    else f.src = src;
  }

  function applyRoute() {
    const parts = getHash().replace(/^#/, '').split('/');
    const mod = MODULES.indexOf(parts[0]) >= 0 ? parts[0] : 'words';
    const sub = (mod === 'words' && SUBS.indexOf(parts[1]) >= 0) ? parts[1] : 's538';

    $$('.nav-btn[data-section]').forEach((b) => b.classList.toggle('active', b.dataset.section === mod));
    MODULES.forEach((m) => {
      const s = $('#section-' + m);
      if (s) s.classList.toggle('active', m === mod);
    });

    if (mod === 'words') {
      $$('#word-subtabs .sub-tab').forEach((b) => b.classList.toggle('active', b.dataset.sub === sub));
      SUBS.forEach((s) => {
        const p = $('#sub-' + s);
        if (p) p.classList.toggle('active', s === sub);
      });
      if (sub === 's100') ensureFrame('#frame-s100');
    }
    if (mod === 'listening') ensureFrame('#frame-tingxie');
  }

  function go(mod, sub) {
    const target = (mod === 'words' && sub) ? (mod + '/' + sub) : mod;
    setHash(target);
    applyRoute();
  }

  /* 首次进入时把地址规范化成 #模块/子模块（便于刷新、收藏、前进后退）
   * file:// 下 history.replaceState 可能被浏览器拒绝，退回到直接赋值 location.hash */
  function normalizeHash() {
    const parts = getHash().replace(/^#/, '').split('/');
    const mod = MODULES.indexOf(parts[0]) >= 0 ? parts[0] : 'words';
    const sub = mod === 'words' ? (SUBS.indexOf(parts[1]) >= 0 ? parts[1] : 's538') : '';
    const want = sub ? (mod + '/' + sub) : mod;
    if (getHash().replace(/^#/, '') === want) return;
    try {
      if (window.history && typeof window.history.replaceState === 'function') {
        window.history.replaceState(null, '', '#' + want);
        return;
      }
    } catch (e) { /* file:// 下可能抛 SecurityError */ }
    setHash(want);
  }

  /* ================= 设置 ================= */
  const DEFAULT_SETTINGS = { accent: 'uk', autoSpeak: true, rate: 0.9 };

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw)) : Object.assign({}, DEFAULT_SETTINGS);
    } catch (e) {
      return Object.assign({}, DEFAULT_SETTINGS);
    }
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
  }
  let settings = loadSettings();

  /* ================= 发音（TTS） ================= */
  const ACCENT_LANG = { uk: 'en-GB', us: 'en-US' };
  const ACCENT_NAME = { uk: '英音', us: '美音' };
  const speechSupported = (typeof window !== 'undefined') && ('speechSynthesis' in window) && (typeof SpeechSynthesisUtterance !== 'undefined');
  let voices = [];

  function loadVoices() {
    if (!speechSupported) return;
    try { voices = window.speechSynthesis.getVoices() || []; } catch (e) { voices = []; }
  }

  if (speechSupported) {
    loadVoices();
    try {
      window.speechSynthesis.onvoiceschanged = loadVoices;
      window.speechSynthesis.getVoices();
    } catch (e) {}
  }

  function pickVoice(accent) {
    if (!voices.length) loadVoices();
    const lang = (ACCENT_LANG[accent] || 'en-GB').toLowerCase();
    const norm = (v) => String(v.lang || '').replace('_', '-').toLowerCase();
    let v = voices.find((x) => norm(x) === lang);
    if (!v) {
      const re = accent === 'us' ? /american|united states|\bus\b/i : /british|\buk\b|england/i;
      v = voices.find((x) => re.test(x.name || ''));
    }
    if (!v) v = voices.find((x) => norm(x).indexOf('en') === 0);
    return v || null;
  }

  function speak(text, accentOverride) {
    if (!speechSupported || !text) return false;
    const accent = accentOverride || settings.accent;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = ACCENT_LANG[accent] || 'en-GB';
      const v = pickVoice(accent);
      if (v) { u.voice = v; u.lang = v.lang || u.lang; }
      u.rate = Number(settings.rate) || 0.9;
      window.speechSynthesis.speak(u);
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ================= 进度数据 ================= */
  let progress = loadProgress();

  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function saveProgress() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch (e) {}
  }
  function getCard(id) {
    return progress[id] || { rep: 0, interval: 0, due: 0, status: 'new' };
  }

  /* ================= 掌握程度星级（1-5★，由学习进度决定） ================= */
  function masteryStar(id) {
    const c = progress[id];
    if (!c) return 1;                       // 未学习
    const iv = c.interval || 0;
    if (iv >= 12) return 5;                 // 间隔≥12天：长期记忆
    if (iv >= 6) return 4;
    if (iv >= 3) return 3;                  // 首次"已掌握"
    if (iv >= 1) return 2;                  // "认识"
    return 1;                               // 刚标记"不认识"或未复习
  }

  function starsHtml(idOrLevel, isId) {
    const lv = isId === false ? idOrLevel : masteryStar(idOrLevel);
    let s = '';
    for (let i = 1; i <= 5; i++) s += i <= lv ? '★' : '<span class="empty">★</span>';
    return '<span class="mastery-stars" title="掌握程度 ' + lv + '/5星">' + s + '</span>';
  }

  /* 掌握程度分桶（与星级一致）：
   * mastered 绿 = 掌握度≥3★（"已掌握"过至少一次，复习间隔≥3天）
   * learning 黄 = 有学习记录但仅1-2★（答过"认识/不认识"，尚未牢固）
   * new      红 = 尚无学习记录
   */
  function masteryBucket(id) {
    if (!progress[id]) return 'new';
    return masteryStar(id) >= 3 ? 'mastered' : 'learning';
  }

  /* ================= 调度算法 ================= */
  function schedule(status, card) {
    const now = Date.now();
    const rep = (card.rep || 0) + 1;
    if (status === 'again') {
      return { rep: 0, interval: 0, due: now + AGAIN_MIN, status: 'learning' };
    }
    if (status === 'hard') {
      return { rep, interval: 1, due: now + DAY, status: 'review' };
    }
    let interval;
    if (rep === 1) interval = 3;
    else interval = Math.min(30, (card.interval || 3) * 2);
    return { rep, interval, due: now + interval * DAY, status: rep >= 3 ? 'mastered' : 'review' };
  }

  function answer(wordId, status) {
    progress[wordId] = schedule(status, getCard(wordId));
    saveProgress();
    return progress[wordId];
  }

  /* ================= 复习范围 ================= */
  let scope = 'all'; // 'all' 或某个类别

  function wordsInScope() {
    if (scope === 'all') return WORDS;
    return WORDS.filter((w) => w.type === scope);
  }

  /* ================= 队列选择 ================= */
  function getDueWords() {
    const now = Date.now();
    return wordsInScope()
      .filter((w) => {
        const c = progress[w.id];
        return c && c.due <= now && c.status !== 'mastered';
      })
      .sort((a, b) => progress[a.id].due - progress[b.id].due);
  }

  function getNewWords() {
    return wordsInScope().filter((w) => !progress[w.id]);
  }

  function getReviewPool() {
    const now = Date.now();
    return wordsInScope().filter((w) => {
      const c = progress[w.id];
      return c && c.status !== 'mastered' && c.due > now;
    });
  }

  function pickNextWord() {
    const due = getDueWords();
    if (due.length) return due[0];                       // 1) 到期优先

    const fresh = getNewWords();
    if (fresh.length) {                                   // 2) 未学新词：随机抽取
      return fresh[Math.floor(Math.random() * fresh.length)];
    }

    const pool = getReviewPool();                         // 3) 未到期的复习词
    if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
    return null;                                          // 当前范围已全部掌握
  }

  /* ================= 统计 ================= */
  function computeStats(list) {
    const arr = list || WORDS;
    const st = { total: arr.length, new: 0, learning: 0, review: 0, mastered: 0, dueToday: 0 };
    const dayEnd = new Date();
    dayEnd.setHours(23, 59, 59, 999);
    arr.forEach((w) => {
      const c = progress[w.id];
      if (!c) { st.new++; return; }
      if (c.status === 'mastered') { st.mastered++; return; }
      if (c.status === 'learning') st.learning++;
      if (c.status === 'review') st.review++;
      if (c.due <= dayEnd) st.dueToday++;
    });
    return st;
  }

  function typeOf(name) { return WORDS.filter((w) => w.type === name); }

  /* ================= 渲染：统计 / 范围 / 侧栏 ================= */
  function renderStats() {
    const s = computeStats(wordsInScope());
    const pct = s.total ? Math.round((s.mastered / s.total) * 100) : 0;
    const scopeName = scope === 'all' ? '全部考点词' : scope;

    $('#stats-bar').innerHTML =
      '<span class="stat-item">' + esc(scopeName) + ' <b>' + s.total + '</b></span>' +
      '<span class="stat-item">未学习 <b>' + s.new + '</b></span>' +
      '<span class="stat-item">学习中 <b>' + (s.learning + s.review) + '</b></span>' +
      '<span class="stat-item">已掌握 <b>' + s.mastered + '</b>（' + pct + '%）</span>';

    $('#progress-summary').innerHTML =
      '<div class="progress-row"><span>已掌握</span><b>' + s.mastered + ' / ' + s.total + '</b></div>' +
      '<div class="progress-bar-track"><div class="progress-bar-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="progress-row" style="margin-top:8px"><span>今日待复习</span><b>' + s.dueToday + '</b></div>' +
      '<div class="progress-row"><span>未学习</span><b>' + s.new + '</b></div>';

    renderScopeCounts();
    renderCatProgress();
    renderDueList();
  }

  function renderScopeCounts() {
    const set = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
    set('#count-all', WORDS.length);
    set('#count-t1', typeOf('第1类考点词').length);
    set('#count-t2', typeOf('第2类考点词').length);
    set('#count-t3', typeOf('第3类考点词').length);
  }

  /* 三类考点词掌握分布：绿=已掌握(≥3★) / 黄=学习中(1-2★) / 红=未学习 */
  function renderCatProgress() {
    $('#cat-progress').innerHTML = TYPES.map((t) => {
      const list = typeOf(t);
      const total = list.length;
      let mastered = 0, learning = 0, fresh = 0;
      list.forEach((w) => {
        const b = masteryBucket(w.id);
        if (b === 'mastered') mastered++;
        else if (b === 'learning') learning++;
        else fresh++;
      });
      const pct = (n) => (total ? (n / total) * 100 : 0);
      return '<div class="cat-progress-row">' +
        '<div class="cat-progress-head"><span>' + esc(t) + '</span><b>' + total + ' 词</b></div>' +
        '<div class="seg-bar">' +
          '<div class="seg seg-green" style="width:' + pct(mastered) + '%" title="已掌握 ' + mastered + ' 词"></div>' +
          '<div class="seg seg-yellow" style="width:' + pct(learning) + '%" title="学习中 ' + learning + ' 词"></div>' +
          '<div class="seg seg-red" style="width:' + pct(fresh) + '%" title="未学习 ' + fresh + ' 词"></div>' +
        '</div>' +
        '<div class="cat-legend">' +
          '<span class="lg lg-green">已掌握 ' + mastered + '</span>' +
          '<span class="lg lg-yellow">学习中 ' + learning + '</span>' +
          '<span class="lg lg-red">未学习 ' + fresh + '</span>' +
        '</div>' +
        '</div>';
    }).join('');
  }

  function renderDueList() {
    const due = getDueWords().slice(0, 8);
    const box = $('#due-list');
    if (!due.length) {
      box.innerHTML = '<div class="due-item"><span class="due-word">暂无待复习</span></div>';
      return;
    }
    box.innerHTML = due.map((w) => {
      const mins = Math.max(0, Math.round((progress[w.id].due - Date.now()) / 60000));
      const label = mins < 60 ? mins + '分钟后' : Math.round(mins / 60) + '小时后';
      return '<div class="due-item"><span class="due-word">' + esc(w.word) + '</span><span class="due-time">' + label + '</span></div>';
    }).join('');
  }

  /* ================= 闪卡复习 ================= */
  let current = null;
  let sessionDone = false;

  /* 瞬间复位到正面：先禁用过渡 → 去掉 flipped → 强制重排 → 恢复过渡
   * 避免切换单词时出现"卡片从背面慢慢翻转回来、答案提前泄露"的问题 */
  function resetCardInstant() {
    const card = $('#flashcard');
    card.classList.add('no-anim');
    void card.offsetWidth;              // 让 no-anim 生效
    card.classList.remove('flipped');
    void card.offsetWidth;              // 立即以无过渡方式回到正面
    card.classList.remove('no-anim');
  }

  /* 新单词淡入，避免切换过于生硬 */
  function animateCardIn() {
    const front = $('#card-front');
    if (!front) return;
    front.classList.remove('enter');
    void front.offsetWidth;
    front.classList.add('enter');
  }

  function showNextCard() {
    const w = pickNextWord();
    const info = $('#card-session-info');
    const done = $('#session-done');
    const spoken = $('#pron-note');

    if (!w) {
      sessionDone = true;
      current = null;
      resetCardInstant();
      $('#card-word').textContent = '—';
      $('#card-star').innerHTML = '';
      $('#answer-buttons').classList.add('hidden');
      done.classList.remove('hidden');
      const s = computeStats(wordsInScope());
      $('#session-done-text').textContent = s.new === 0
        ? '太棒了！' + (scope === 'all' ? '全部' : '该类别') + '单词已掌握 🎓'
        : '当前范围没有到期或可学习的单词，休息一下吧～';
      info.innerHTML = '<span>🎉 学习完成</span><span></span>';
      if (spoken) spoken.textContent = '';
      return;
    }

    sessionDone = false;
    done.classList.add('hidden');
    current = w;

    // 先瞬间回到正面，再填充新单词内容（答案不会提前露出）
    resetCardInstant();

    $('#card-word').textContent = w.word;
    $('#card-star').innerHTML = starsHtml(w.id) + ' <span class="mastery-label">当前掌握度</span>';
    $('#card-word-back').textContent = w.word;
    $('#card-pos').textContent = w.pos ? w.pos + '.' : '';
    $('#card-meaning').textContent = w.meaning;
    let synTxt = w.syn ? '真题替换：' + w.syn : '';
    if (w.note) synTxt += (synTxt ? '　' : '') + '★' + w.note;
    $('#card-syn').textContent = synTxt;
    $('#answer-buttons').classList.add('hidden');
    animateCardIn();

    const s = computeStats(wordsInScope());
    info.innerHTML = '<span>' + esc(w.word) + ' · ' + esc(w.type || '') +
      (w.no ? ' · 书中第' + w.no + '词' : '') + '</span>' +
      '<span>未学习 ' + s.new + ' ｜ 待复习 ' + s.dueToday + '</span>';

    // 出现新单词 → 自动发音（默认英音，可在设置中改为美音）
    if (spoken) {
      if (!settings.autoSpeak) {
        spoken.textContent = '';
      } else if (!speechSupported) {
        spoken.textContent = '（当前浏览器不支持朗读）';
      } else {
        const ok = speak(w.word, settings.accent);
        spoken.textContent = ok ? '（自动朗读：' + ACCENT_NAME[settings.accent] + '）' : '（朗读被浏览器拦截，点击上方按钮即可）';
      }
    }
  }

  function flipCard() {
    if (sessionDone || !current) return;
    $('#flashcard').classList.add('flipped');
    $('#answer-buttons').classList.remove('hidden');
  }

  function handleAnswer(status) {
    if (sessionDone || !current) return;
    const w = current;
    const beforeStar = masteryStar(w.id);
    answer(w.id, status);
    const c = progress[w.id];
    const afterStar = masteryStar(w.id);
    const map = {
      again: ['不认识', '10 分钟后复习'],
      hard: ['认识', '1 天后复习'],
      good: [c.status === 'mastered' ? '已掌握 🎓' : '掌握度 +1', c.status === 'mastered' ? '已标记掌握' : c.interval + ' 天后复习']
    };
    const pair = map[status];
    const starInfo = afterStar !== beforeStar
      ? '　掌握度 ' + beforeStar + '★ → ' + afterStar + '★'
      : '　掌握度 ' + afterStar + '★';
    toast(esc(w.word) + '：' + pair[0] + '（' + pair[1] + '）' + starInfo);
    renderStats();
    setTimeout(showNextCard, 350);
  }

  function toast(msg) {
    let el = $('#toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.style.cssText = 'position:fixed;left:50%;bottom:34px;transform:translateX(-50%);background:#23272f;color:#fff;padding:10px 20px;border-radius:999px;font-size:14px;z-index:999;box-shadow:0 6px 20px rgba(0,0,0,.25);opacity:0;transition:opacity .25s;pointer-events:none;max-width:90vw;';
      document.body.appendChild(el);
    }
    el.innerHTML = msg;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '0'; }, 1800);
  }

  /* ================= 词汇表 ================= */
  let listState = { star: 'all', type: 'all', query: '', sort: 'alpha' };

  function renderList() {
    const box = $('#word-list');
    const items = WORDS.filter((w) => {
      // 掌握度筛选（1-5★，由学习进度决定）
      if (listState.star !== 'all' && masteryStar(w.id) !== parseInt(listState.star, 10)) return false;
      if (listState.type !== 'all' && w.type !== listState.type) return false;
      if (listState.query) {
        const q = listState.query.toLowerCase();
        if (!(w.word.toLowerCase().indexOf(q) >= 0 ||
              w.meaning.indexOf(listState.query) >= 0 ||
              (w.syn || '').toLowerCase().indexOf(q) >= 0)) return false;
      }
      return true;
    });

    if (!items.length) {
      box.innerHTML = '<div class="list-empty">没有符合条件的单词，试试调整筛选条件～</div>';
      return;
    }

    const groups = {};
    items.forEach((w) => { (groups[w.type] = groups[w.type] || []).push(w); });

    box.innerHTML = TYPES.filter((t) => groups[t]).map((t) => {
      const list = groups[t].slice();
      // 排序：字母顺序 / 掌握度高低
      if (listState.sort === 'star-desc') {
        list.sort((a, b) => masteryStar(b.id) - masteryStar(a.id) || a.word.localeCompare(b.word));
      } else if (listState.sort === 'star-asc') {
        list.sort((a, b) => masteryStar(a.id) - masteryStar(b.id) || a.word.localeCompare(b.word));
      } else {
        list.sort((a, b) => a.word.localeCompare(b.word));
      }

      const rows = list.map((w) => {
        const b = masteryBucket(w.id);
        const badge = b === 'mastered'
          ? '<span class="w-badge mastered">✓已掌握</span>'
          : (b === 'learning' ? '<span class="w-badge learning">学习中</span>' : '');
        return '<div class="word-row">' +
          '<div class="w-word">' + esc(w.word) + badge + '</div>' +
          '<div class="w-star">' + starsHtml(w.id) + '</div>' +
          '<div class="w-meaning">' + (w.pos ? esc(w.pos + '. ') : '') + esc(w.meaning) + '</div>' +
          '<div class="w-syn">' + (w.syn ? esc(w.syn) : '') + (w.note ? (w.syn ? '<br>' : '') + '<span class="w-note">★' + esc(w.note) + '</span>' : '') + (!w.syn && !w.note ? '<span class="w-empty">—</span>' : '') + '</div>' +
          '</div>';
      }).join('');
      return '<div class="word-group-title">' + esc(t) + '<span class="count">' + list.length + ' 个</span></div>' + rows;
    }).join('');
  }

  /* ================= 设置面板 ================= */
  function openSettings() {
    const modal = $('#settings-modal');
    if (!modal) return;
    $('#accent-uk').checked = settings.accent === 'uk';
    $('#accent-us').checked = settings.accent === 'us';
    $('#auto-speak').checked = !!settings.autoSpeak;
    $('#speech-rate').value = settings.rate;
    $('#rate-value').textContent = Number(settings.rate).toFixed(2).replace(/0$/, '') + '×';
    updateTtsStatus();
    modal.classList.remove('hidden');
  }

  function closeSettings() {
    const modal = $('#settings-modal');
    if (modal) modal.classList.add('hidden');
  }

  function updateTtsStatus() {
    const el = $('#tts-status');
    if (!el) return;
    if (!speechSupported) {
      el.className = 'tts-status warn';
      el.textContent = '⚠️ 当前浏览器不支持语音合成（Web Speech API），发音功能不可用。建议使用 Chrome / Edge。';
      return;
    }
    loadVoices();
    const uk = pickVoice('uk');
    const us = pickVoice('us');
    el.className = 'tts-status';
    el.textContent = '可用语音 —— 英音：' + (uk ? '✓ ' + (uk.name || uk.lang) : '✗ 未安装（将回退到默认英语语音）') +
      ' ｜ 美音：' + (us ? '✓ ' + (us.name || us.lang) : '✗ 未安装（将回退到默认英语语音）');
  }

  /* ================= 事件绑定 ================= */
  function bindEvents() {
    // 主导航：七大模块（只绑定带 data-section 的按钮，避免与设置按钮冲突）
    $$('.nav-btn[data-section]').forEach((btn) => {
      btn.addEventListener('click', () => go(btn.dataset.section));
    });

    // 单词模块内的子模块切换（阅读538词汇 / 100句记7000词）
    $$('#word-subtabs .sub-tab').forEach((tab) => {
      tab.addEventListener('click', () => go('words', tab.dataset.sub));
    });
    // 浏览器前进/后退
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('hashchange', applyRoute);
    }

    // 模式切换
    $$('.mode-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        $$('.mode-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        $$('.mode-panel').forEach((p) => p.classList.remove('active'));
        $('#mode-' + tab.dataset.mode).classList.add('active');
        if (tab.dataset.mode === 'cards') { renderStats(); showNextCard(); }
        if (tab.dataset.mode === 'list') renderList();
      });
    });

    // 复习范围选择
    $$('#scope-btns .scope-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('#scope-btns .scope-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        scope = btn.dataset.scope;
        try { localStorage.setItem(SCOPE_KEY, scope); } catch (e) {}
        renderStats();
        showNextCard();
      });
    });

    // 闪卡
    $('#flashcard').addEventListener('click', flipCard);
    $('#btn-again').addEventListener('click', () => handleAnswer('again'));
    $('#btn-hard').addEventListener('click', () => handleAnswer('hard'));
    $('#btn-good').addEventListener('click', () => handleAnswer('good'));
    $('#btn-continue').addEventListener('click', showNextCard);

    // 发音按钮
    $('#btn-pron-uk').addEventListener('click', (e) => {
      e.stopPropagation();
      if (current) { speak(current.word, 'uk'); flashPronBtn('#btn-pron-uk'); }
    });
    $('#btn-pron-us').addEventListener('click', (e) => {
      e.stopPropagation();
      if (current) { speak(current.word, 'us'); flashPronBtn('#btn-pron-us'); }
    });

    // 设置
    $('#btn-settings').addEventListener('click', openSettings);
    $('#btn-settings-close').addEventListener('click', closeSettings);
    $('#settings-modal').addEventListener('click', (e) => {
      if (e.target && e.target.id === 'settings-modal') closeSettings();
    });
    $('#accent-uk').addEventListener('change', () => {
      settings.accent = 'uk'; saveSettings();
      if (current) speak(current.word, 'uk');
    });
    $('#accent-us').addEventListener('change', () => {
      settings.accent = 'us'; saveSettings();
      if (current) speak(current.word, 'us');
    });
    $('#auto-speak').addEventListener('change', (e) => {
      settings.autoSpeak = !!e.target.checked; saveSettings();
    });
    $('#speech-rate').addEventListener('input', (e) => {
      settings.rate = Number(e.target.value); saveSettings();
      $('#rate-value').textContent = settings.rate.toFixed(2).replace(/0$/, '') + '×';
    });
    $('#speech-rate').addEventListener('change', () => { if (current) speak(current.word, settings.accent); });
    $('#btn-reset-progress').addEventListener('click', () => {
      if (window.confirm('确定要清除所有单词复习进度吗？此操作不可恢复。')) {
        progress = {};
        saveProgress();
        renderStats();
        renderList();
        showNextCard();
        toast('学习进度已清除');
      }
    });

    // 键盘快捷键（仅在「单词 → 阅读538词汇 → 闪卡复习」可见时生效）
    document.addEventListener('keydown', (e) => {
      const modal = $('#settings-modal');
      if (modal && !modal.classList.contains('hidden')) {
        if (e.code === 'Escape') closeSettings();
        return;
      }
      if (!isCardModeVisible()) return;
      if (e.code === 'Space') { e.preventDefault(); flipCard(); }
      if (e.code === 'Digit1') handleAnswer('again');
      if (e.code === 'Digit2') handleAnswer('hard');
      if (e.code === 'Digit3') handleAnswer('good');
      if (e.code === 'KeyP') { if (current) speak(current.word, settings.accent); }
    });

    // 词汇表筛选 / 排序
    $('#search-input').addEventListener('input', (e) => {
      listState.query = e.target.value.trim();
      renderList();
    });
    $$('#star-filter .filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('#star-filter .filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        listState.star = btn.dataset.star;
        renderList();
      });
    });
    $$('#type-filter .filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('#type-filter .filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        listState.type = btn.dataset.type;
        renderList();
      });
    });
    $$('#sort-group .filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('#sort-group .filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        listState.sort = btn.dataset.sort;
        try { localStorage.setItem('ielts_sort_v1', listState.sort); } catch (e) {}
        renderList();
      });
    });
  }

  function flashPronBtn(sel) {
    const btn = $(sel);
    if (!btn) return;
    btn.classList.add('speaking');
    setTimeout(() => btn.classList.remove('speaking'), 500);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* 闪卡快捷键只在「单词 → 阅读538词汇 → 闪卡复习」界面可见时生效
   * （避免在听力内嵌页、100句学习页等界面误触发） */
  function isCardModeVisible() {
    const sec = $('#section-words');
    if (sec && !sec.classList.contains('active')) return false;
    const sub = $('#sub-s538');
    if (sub && !sub.classList.contains('active')) return false;
    const panel = $('#mode-cards');
    return !!(panel && panel.classList.contains('active'));
  }

  /* ================= 启动 ================= */
  function init() {
    if (!WORDS.length) {
      const msg = document.getElementById('stats-bar');
      if (msg) msg.innerHTML = '<span style="color:#e5484d">⚠️ 词库加载失败：未找到 IELTS_WORDS 数据（检查 js/words-data.js 是否正常加载）</span>';
      return;
    }

    // 恢复上次选择的复习范围与排序方式
    try {
      const savedScope = localStorage.getItem(SCOPE_KEY);
      if (savedScope && (savedScope === 'all' || TYPES.indexOf(savedScope) >= 0)) scope = savedScope;
      const savedSort = localStorage.getItem('ielts_sort_v1');
      if (savedSort && ['alpha', 'star-desc', 'star-asc'].indexOf(savedSort) >= 0) listState.sort = savedSort;
    } catch (e) {}

    $$('#scope-btns .scope-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.scope === scope);
    });
    $$('#sort-group .filter-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.sort === listState.sort);
    });

    bindEvents();
    normalizeHash();       // 地址规范化：#模块/子模块
    applyRoute();          // 按地址栏 hash 选中界面（默认 #words/s538）
    renderStats();
    showNextCard();
    updateTtsStatus();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
