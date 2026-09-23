/* ============================================================
   app.js — 听写训练营主逻辑
   ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- 1. 组装词库 ---------- */
  var PAPERS = [];                 // [{no, items:[{paper,index,w,m,ipa}]}]
  var ALL_ITEMS = [];

  (function buildPool() {
    var data = window.CORPUS_DATA || {};
    for (var p = 1; p <= 9; p++) {
      var arr = data[p] || [];
      var items = [];
      for (var i = 0; i < arr.length; i++) {
        items.push({
          paper: p, index: i, w: arr[i].w, m: arr[i].m || '',
          ipa: arr[i].ipa || '', d: arr[i].d || 0, ipad: arr[i].ipad || 0
        });
      }
      PAPERS.push({ no: p, items: items });
      ALL_ITEMS = ALL_ITEMS.concat(items);
    }
  })();

  /* ---------- 2. 状态 ---------- */
  var state = {
    selected: {},          // {paperNo: true}
    count: 30,
    mode: 'smart',
    autoSpeak: true,
    repeatOnWrong: true,
    dual: false,
    rate: 0.9,
    volume: 1,
    browseSort: 'alpha',    // 词表排序：alpha | prof-desc | prof-asc

    /* 拼写小测 */
    examShuffle: true,
    examFeedback: true,
    examSkipLeak: false,    // 小测里是否允许跳过（跳过的也算错题）
    exam: null,             // 当前小测的状态对象，null 表示不是小测

    queue: [],             // 本组题目
    pos: 0,
    current: null,
    phase: 'ask',          // ask | judged
    qseq: 0,               // 题目序号，用于防重复推进
    results: [],           // [{w,m,paper,ok,kind,attempts}]
    requeued: 0,
    sessionStart: 0,
    busy: false
  };

  var SETTINGS_KEY = 'ielts_tingxie_settings_v1';

  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      if (s.selected) state.selected = s.selected;
      if (s.count) state.count = s.count;
      if (s.mode) state.mode = s.mode;
      if (s.autoSpeak != null) state.autoSpeak = s.autoSpeak;
      if (s.repeatOnWrong != null) state.repeatOnWrong = s.repeatOnWrong;
      if (s.dual != null) state.dual = s.dual;
      if (s.rate != null) state.rate = s.rate;
      if (s.volume != null) state.volume = s.volume;
      if (s.browseSort) state.browseSort = s.browseSort;
      if (s.examShuffle != null) state.examShuffle = s.examShuffle;
      if (s.examFeedback != null) state.examFeedback = s.examFeedback;
      if (s.examSkipLeak != null) state.examSkipLeak = s.examSkipLeak;
    } catch (e) {}
  }
  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        selected: state.selected, count: state.count, mode: state.mode,
        autoSpeak: state.autoSpeak, repeatOnWrong: state.repeatOnWrong,
        dual: state.dual, rate: state.rate, volume: state.volume,
        browseSort: state.browseSort,
        examShuffle: state.examShuffle, examFeedback: state.examFeedback,
        examSkipLeak: state.examSkipLeak
      }));
    } catch (e) {}
  }

  /* ---------- 3. 视图切换 ---------- */
  function show(view) {
    ['setup', 'practice', 'summary', 'browse', 'exam', 'examdone', 'examlog', 'mistakes']
      .forEach(function (v) {
        var el = $('view-' + v);
        if (el) el.classList.toggle('active', v === view);
      });
    window.scrollTo(0, 0);
  }

  /* ---------- 4. 设置页 ---------- */
  function selectedItems() {
    var out = [];
    for (var p = 1; p <= 9; p++) {
      if (state.selected[p]) out = out.concat(PAPERS[p - 1].items);
    }
    return out;
  }

  function renderPapers() {
    var grid = $('paper-grid');
    grid.innerHTML = '';
    PAPERS.forEach(function (pp) {
      var btn = document.createElement('button');
      btn.className = 'paper-card' + (state.selected[pp.no] ? ' active' : '');
      btn.type = 'button';
      var st = SRS.statsFor(pp.items);
      var donePct = Math.round((st.total - st['new']) / st.total * 100);
      btn.innerHTML =
        '<span class="pc-no">Test Paper ' + pp.no + '</span>' +
        '<span class="pc-count">' + pp.items.length + ' 词</span>' +
        '<span class="pc-bar"><i style="width:' + donePct + '%"></i></span>' +
        '<span class="pc-meta">已练 ' + (st.total - st['new']) + ' · 熟练 ' + st.mastered + '</span>';
      btn.addEventListener('click', function () {
        state.selected[pp.no] = !state.selected[pp.no];
        saveSettings();
        renderPapers();
        updateSummaryLine();
      });
      grid.appendChild(btn);
    });
  }

  function renderCount() {
    $('count-value').textContent = state.count;
    var presets = [10, 20, 30, 50, 100];
    var wrap = $('count-presets');
    wrap.innerHTML = '';
    presets.forEach(function (n) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'preset-btn' + (state.count === n ? ' active' : '');
      b.textContent = n;
      b.addEventListener('click', function () { setCount(n); });
      wrap.appendChild(b);
    });
    var all = document.createElement('button');
    all.type = 'button';
    all.className = 'preset-btn' + (state.count >= availableCount() && availableCount() > 0 ? ' active' : '');
    all.textContent = '全部 ' + availableCount();
    all.addEventListener('click', function () {
      var n = Math.floor(availableCount() / 10) * 10;
      setCount(n || 10);
    });
    wrap.appendChild(all);

    var avail = availableCount();
    $('count-note').textContent = avail
      ? '当前可选 ' + avail + ' 词，本组听写 ' + Math.min(state.count, avail) + ' 词'
      : '请先选择至少一个 Test Paper';
  }

  function availableCount() { return selectedItems().length; }

  function setCount(n) {
    n = Math.max(10, Math.round(n / 10) * 10);
    state.count = n;
    saveSettings();
    renderCount();
    updateSummaryLine();
  }

  function updateSummaryLine() {
    var sel = Object.keys(state.selected).filter(function (k) { return state.selected[k]; });
    $('paper-summary').textContent =
      '已选 ' + sel.length + ' 个 Test Paper · ' + availableCount() + ' 个单词';

    var st = SRS.statsFor(selectedItems());
    var accTxt = st.avgAcc < 0 ? '—' : Math.round(st.avgAcc * 100) + '%';
    $('overview').innerHTML =
      '<span class="ov-item"><b>' + st.total + '</b>总词数</span>' +
      '<span class="ov-item"><b>' + st['new'] + '</b>未学</span>' +
      '<span class="ov-item"><b>' + st.learning + '</b>学习中</span>' +
      '<span class="ov-item"><b>' + st.familiar + '</b>较熟</span>' +
      '<span class="ov-item"><b>' + st.mastered + '</b>已熟练</span>' +
      '<span class="ov-item"><b>' + st.due + '</b>待复习</span>' +
      '<span class="ov-item"><b>' + accTxt + '</b>平均正确率</span>';
  }

  function renderModes() {
    var choices = document.querySelectorAll('.choice');
    Array.prototype.forEach.call(choices, function (c) {
      c.classList.toggle('active', c.getAttribute('data-mode') === state.mode);
    });
    Array.prototype.forEach.call(document.querySelectorAll('input[name=mode]'), function (r) {
      r.checked = r.value === state.mode;
    });
  }

  /* ---------- 5. 开始一组 ---------- */
  function startSession() {
    var pool = selectedItems();
    if (!pool.length) { alert('请先至少选择一个 Test Paper'); return; }
    var n = Math.max(10, state.count);
    var picked = SRS.buildSession(pool, {
      count: n, mode: state.mode, seed: Date.now() % 100000
    });
    if (!picked.length) {
      alert(state.mode === 'new' ? '所选范围里已经没有新词了，换个出题方式吧。' : '没有可出题的单词。');
      return;
    }
    state.exam = null;
    state.queue = picked.map(function (x) {
      return { it: x.item, done: false, attempts: 0, requeued: false, everWrong: false, seen: false };
    });
    state.pos = 0;
    state.results = [];
    state.requeued = 0;
    state.sessionStart = Date.now();
    show('practice');
    nextQuestion(true);
  }

  /* ---------- 5b. 拼写小测 ---------- */
  /**
   * 开始一次拼写小测
   * @param {number} paper    要测的 Test Paper
   * @param {Array}  [items]  指定词表（错题本练习用），不传则用整个 Test Paper
   * @param {string} [label]  自定义标签
   */
  function startExam(paper, items, label) {
    var pool = items && items.length ? items.slice() : PAPERS[paper - 1].items.slice();
    if (!pool.length) { alert('这个 Test Paper 没有单词'); return; }

    if (state.examShuffle) {
      /* 简单洗牌，避免每次顺序一样 */
      for (var i = pool.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      }
    }

    state.exam = {
      paper: paper,
      label: label || ('Test Paper ' + paper),
      total: pool.length,
      startedAt: Date.now(),
      fromMistakes: !!(items && items.length)
    };
    state.queue = pool.map(function (it) {
      return { it: it, done: false, attempts: 0, requeued: false, everWrong: false, seen: false };
    });
    state.pos = 0;
    state.results = [];
    state.requeued = 0;
    state.sessionStart = Date.now();
    show('practice');
    nextQuestion(true);
  }

  function nextQuestion(first) {
    /* 找到下一个未完成的题（含本组内追加的复习题） */
    while (state.pos < state.queue.length && state.queue[state.pos].done) state.pos++;
    state.phase = 'ask';
    $('feedback').className = 'feedback';
    $('feedback').innerHTML = '';
    $('answer-input').value = '';
    $('answer-input').disabled = false;
    $('btn-giveup').disabled = false;
    $('btn-skip').disabled = !(state.exam ? state.examSkipLeak : true);

    if (state.pos >= state.queue.length) { finishSession(); return; }

    var q = state.queue[state.pos];
    state.current = q;
    q.attempts++;
    if (!q.seen) { q.seen = true; SRS.markSeen(q.it.paper, q.it.w); }

    $('session-label').textContent = state.exam
      ? ('📝 ' + state.exam.label + (state.exam.fromMistakes ? ' · 错题练习' : ' · 小测'))
      : ('Test Paper ' + q.it.paper + (q.requeued ? ' · 错题重练' : ''));
    updateProgress();
    $('speaker-sub').textContent = '按 Enter 提交答案';
    $('answer-input').focus();

    if (state.autoSpeak || first) playCurrent();
  }

  function updateProgress() {
    var total = state.queue.length;
    var doneN = 0;
    for (var i = 0; i < state.queue.length; i++) if (state.queue[i].done) doneN++;
    $('session-pos').textContent = (state.pos + 1) + ' / ' + total;
    $('progress-fill').style.width = (total ? (doneN / total * 100) : 0) + '%';
  }

  function playCurrent() {
    if (!state.current) return;
    if (!Speech.supported()) {
      $('feedback').className = 'feedback warn';
      $('feedback').innerHTML = '当前浏览器不支持语音合成，请改用 Chrome / Edge。';
      return;
    }
    state.busy = true;
    Speech.setSettings({ rate: state.rate, volume: state.volume, dual: state.dual });
    Speech.speak(state.current.it.w, {
      rate: state.rate, volume: state.volume, dual: state.dual
    }).then(function () { state.busy = false; });
  }

  /* ---------- 6. 判分 ---------- */
  function submitAnswer() {
    if (state.phase !== 'ask' || !state.current) return;
    var input = $('answer-input').value;
    if (!input.trim()) {                               // 空 => 重听
      playCurrent();
      return;
    }
    var ok = SRS.judge(input, state.current.it.w);
    judgeCurrent(ok, 'answer');
  }

  /**
   * 判分
   * @param {boolean} ok
   * @param {string} source 'answer' | 'giveup' | 'skip'
   */
  function judgeCurrent(ok, source) {
    var q = state.current;
    if (!q) return;
    state.phase = 'judged';
    state.qseq++;

    var rec;
    if (state.exam) {
      /* 小测：不写入平时听写的对错统计，只处理"没掌握"的情况 */
      if (ok) {
        rec = SRS.peek(q.it.paper, q.it.w) || SRS.blank();
      } else {
        /* 错词 & 跳过的词：熟练度降一级，并记入错题本 */
        var lowered = SRS.lower(q.it.paper, q.it.w);
        rec = lowered.rec;
        ExamStore.addMistake(q.it.paper, q.it.w, source);
      }
      /* 错题练习里答对了 -> 视为已订正 */
      if (ok && state.exam.fromMistakes) {
        ExamStore.clearMistake(q.it.paper, q.it.w);
      }
    } else {
      rec = SRS.grade(q.it.paper, q.it.w, ok, ok ? 'correct' : 'wrong');
    }

    q.done = true;
    q.everWrong = q.everWrong || !ok;

    state.results.push({
      w: q.it.w, m: q.it.m, ipa: q.it.ipa, paper: q.it.paper,
      d: q.it.d, ipad: q.it.ipad,
      ok: ok, attempts: q.attempts, source: source,
      acc: Math.round(SRS.accuracy(rec) * 100),
      st: rec.st
    });

    renderFeedback(q, ok, source);
    updateProgress();

    if (!ok) {
      if (state.exam) {
        /* 小测要点：错词/跳过的词不在本轮重复出现 */
        if (state.repeatOnWrong && !state.examFeedback) setTimeout(playCurrent, 350);
      } else {
        /* 平时听写：错词（含跳过的）在本组后面再考一次 */
        state.queue.push({
          it: q.it, done: false, attempts: 1, requeued: true, everWrong: true, seen: true
        });
        state.requeued++;
        if (state.repeatOnWrong) setTimeout(playCurrent, 350);
      }
    }

    $('answer-input').disabled = true;
    $('btn-giveup').disabled = true;
    $('btn-skip').disabled = true;

    /* 小测且关闭了「立即显示对错」时：不停顿，直接进入下一题 */
    if (state.exam && !state.examFeedback) {
      advance();
    }
    /* 否则：答对后不自动跳题，等用户按 Enter 手动确认下一题 */
  }

  function renderFeedback(q, ok, source) {
    var fb = $('feedback');
    var show = '<span class="fb-word">' + esc(q.it.w) + '</span>' +
      (q.it.ipa ? '<span class="fb-ipa">' + esc(q.it.ipa) +
        (q.it.ipad ? '<i class="ipa-note">（单数形式音标）</i>' : '') + '</span>' : '') +
      (q.it.m ? '<span class="fb-mean">' + esc(q.it.m) +
        (q.it.d ? '<i class="mean-note">补充释义</i>' : '') + '</span>' : '');
    if (ok) {
      fb.className = 'feedback ok';
      fb.innerHTML = '<div class="fb-head">✓ 正确 &nbsp;<b>' + esc(q.it.w) + '</b></div>' +
        '<div class="fb-body">' + show + '</div>' +
        '<div class="fb-choices">' +
          '<button class="mini-btn" data-act="easy" title="这个词已经不用练了，直接拉到最高熟练度">' +
            '⭐ 标记为太简单</button>' +
          '<button class="mini-btn primary" data-act="next">下一个 <kbd>⏎</kbd></button>' +
        '</div>';
    } else {
      var typed = source === 'skip' ? '' : $('answer-input').value;
      fb.className = 'feedback bad';
      fb.innerHTML = '<div class="fb-head">' +
        (source === 'skip' ? '⏭ 已跳过，按错误处理' : '✗ 写错了') + '</div>' +
        '<div class="fb-body">' + show + '</div>' +
        (typed ? '<div class="fb-yours">你的答案：<s>' + esc(typed) + '</s></div>' : '') +
        '<div class="fb-choices">' +
          '<button class="mini-btn" data-act="right">其实对了 <kbd>1</kbd></button>' +
          '<button class="mini-btn" data-act="easy">太简单 <kbd>3</kbd></button>' +
          '<button class="mini-btn primary" data-act="next">下一个 <kbd>⏎</kbd></button>' +
        '</div>';
    }
    Array.prototype.forEach.call(fb.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () { handleJudgeAction(b.getAttribute('data-act')); });
    });
    $('speaker-sub').textContent = ok
      ? '按 Enter 确认，进入下一个单词'
      : '看一遍正确答案，按 Enter 进入下一个（本词会再考一次）';
  }

  function handleJudgeAction(act) {
    var q = state.current;
    if (!q) return;
    var last = state.results[state.results.length - 1];
    var isMine = last && last.w === q.it.w && last.paper === q.it.paper;

    /* 「太简单」：已经答对了，只是想在熟练度上再跳一级 —— 不重复计分，
       也不推进题目，让用户看清"已标记"，再自己按 Enter 走 */
    if (act === 'easy' && isMine && last.ok === true) {
      if (last.source === 'easy') return;          // 防重复点击
      last.source = 'easy';
      var r0 = SRS.peek(q.it.paper, q.it.w);
      last.st = r0 ? r0.st : last.st;
      SRS.promote(q.it.paper, q.it.w);
      showEasyMarked();
      return;
    }

    if (act === 'right' || act === 'easy') {
      /* 修正判分：把上一条错误记录改判为正确 */
      if (isMine && !last.ok) {
        last.ok = true;
        last.source = act;
        SRS.grade(q.it.paper, q.it.w, true, act === 'easy' ? 'easy' : 'correct');
        var r1 = SRS.peek(q.it.paper, q.it.w);
        last.st = r1 ? r1.st : last.st;
      }
      /* 已经判对了，就不必再重练一次 */
      if (q.requeued) {
        q.done = true;                      // 直接从队列里剔除这条重练题
        state.requeued = Math.max(0, state.requeued - 1);
      }
      updateProgress();
      advance();
    } else {
      advance();
    }
  }

  /* 点「太简单」后的即时反馈 */
  function showEasyMarked() {
    var fb = $('feedback');
    var btn = fb.querySelector('button[data-act="easy"]');
    if (btn) {
      btn.classList.add('done');
      btn.disabled = true;
      btn.innerHTML = '✓ 已标记为熟练';
    }
    var tip = fb.querySelector('.fb-easy-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'fb-easy-tip';
      fb.appendChild(tip);
    }
    tip.textContent = '已跳过后续复习：熟练度直接拉满，7 天后才会再出现';
    $('speaker-sub').textContent = '按 Enter 进入下一个单词';
    /* 同步首页的熟练度统计，避免返回设置页时数字是旧的 */
    renderPapers();
    updateSummaryLine();
  }

  function giveUp() {
    if (state.phase !== 'ask' || !state.current) return;
    judgeCurrent(false, 'giveup');
  }

  /**
   * 跳过 = 不会。
   * 按错误处理：扣熟练度、显示正确答案、并安排本组内再考一次。
   * 如果已经判过分（在 judged 阶段），跳过就等于「进入下一题」。
   */
  function skip() {
    if (!state.current) return;
    if (state.phase === 'judged') { advance(); return; }
    judgeCurrent(false, 'skip');
  }

  function advance() {
    state.pos++;
    nextQuestion(false);
  }

  /* ---------- 7. 结束与小结 ---------- */
  function finishSession() {
    Speech.stop();
    if (state.exam) { finishExam(); return; }

    var total = state.results.length;
    var right = state.results.filter(function (r) { return r.ok === true; }).length;
    var gaveUp = state.results.filter(function (r) { return r.ok === false && r.source === 'giveup'; }).length;
    var skipped = state.results.filter(function (r) { return r.ok === false && r.source === 'skip'; }).length;
    var wrongTyped = state.results.filter(function (r) { return r.ok === false && r.source === 'answer'; }).length;
    var wrong = gaveUp + skipped + wrongTyped;
    var rate = total ? Math.round(right / total * 100) : 0;
    var mins = Math.max(1, Math.round((Date.now() - state.sessionStart) / 60000));

    $('summary-score').textContent = rate + '%';
    $('summary-icon').textContent = rate >= 95 ? '🏆' : rate >= 85 ? '🎉' : rate >= 70 ? '💪' : '📚';
    $('summary-sub').textContent = total
      ? '本组共 ' + total + ' 题 · 用时约 ' + mins + ' 分钟'
      : '本组没有题目';

    $('summary-stats').innerHTML =
      statBox(right, '答对') + statBox(wrong, '答错') +
      statBox(wrongTyped, '拼错') + statBox(skipped + gaveUp, '跳过/不会') +
      statBox(state.requeued, '错题重练');

    renderResultList($('summary-list'), state.results);

    show('summary');
    updateSummaryLine();
    renderPapers();
    renderCount();
  }

  /* ---------- 7b. 小测结束：记录成绩 + 展示本轮 + 正确率对比 ---------- */
  function finishExam() {
    var exam = state.exam;
    var results = state.results;
    var right = results.filter(function (r) { return r.ok; }).length;
    var answered = results.filter(function (r) { return r.ok === false && r.source === 'answer'; }).length;
    var skipped = results.filter(function (r) { return r.ok === false && r.source === 'skip'; }).length;
    var gaveUp = results.filter(function (r) { return r.ok === false && r.source === 'giveup'; }).length;
    var wrongWords = results.filter(function (r) { return !r.ok; });

    /* 只统计真正测过的题（中途结束也算） */
    var total = results.length;
    var rate = total ? Math.round(right / total * 100) : 0;
    var durationMs = Date.now() - exam.startedAt;

    /* 存记录前的历史（用于对比） */
    var before = ExamStore.examStats(exam.paper);

    var rec = ExamStore.saveExam({
      paper: exam.paper,
      paperLabel: exam.label,
      total: total,
      correct: right,
      wrong: answered + gaveUp,
      skipped: skipped,
      accuracy: rate,
      durationMs: durationMs,
      words: results
    });

    var after = ExamStore.examStats(exam.paper);

    /* ---- 顶部成绩 ---- */
    $('examdone-icon').textContent = rate >= 95 ? '🏆' : rate >= 85 ? '🎉'
      : rate >= 70 ? '💪' : rate >= 50 ? '📖' : '📚';
    $('examdone-score').textContent = rate + '%';
    var secs = Math.round(durationMs / 1000);
    var durTxt = secs < 60 ? (secs + ' 秒') : (Math.floor(secs / 60) + ' 分 ' + (secs % 60) + ' 秒');
    $('examdone-sub').textContent = exam.label + ' · 共 ' + total + ' 词 · 用时 ' + durTxt
      + (exam.fromMistakes ? ' · 错题练习' : '');

    $('examdone-stats').innerHTML =
      statBox(right, '答对') + statBox(answered, '拼错') +
      statBox(skipped, '跳过') + statBox(gaveUp, '看答案') +
      statBox(wrongWords.length, '进错题本');

    /* ---- 与历史对比 ---- */
    var cmp = $('examdone-compare');
    if (before.count === 0) {
      cmp.innerHTML = '<div class="cmp-line">这是 <b>' + exam.label + '</b> 的第 1 次测验，'
        + '之后的成绩会画成正确率曲线。</div>';
    } else {
      var diff = rate - before.last.accuracy;
      var arrow = diff > 0 ? '▲' : (diff < 0 ? '▼' : '—');
      var cls = diff > 0 ? 'up' : (diff < 0 ? 'down' : 'flat');
      cmp.innerHTML =
        '<div class="cmp-line">上次 <b>' + before.last.accuracy + '%</b>' +
        '<span class="cmp-diff ' + cls + '">' + arrow + ' ' + (diff > 0 ? '+' : '') + diff + '%</span>' +
        ' · 平均 <b>' + before.avg + '%</b>' +
        ' · 最好 <b>' + before.best + '%</b>' +
        ' · 第 <b>' + after.count + '</b> 次测验</div>';
    }

    /* ---- 本轮错题 ---- */
    $('examdone-list-title').textContent = wrongWords.length
      ? ('本轮错题（' + wrongWords.length + ' 个，已进错题本且熟练度降一级）')
      : '本轮全对，没有错题 🎉';
    renderResultList($('examdone-list'), wrongWords);

    show('examdone');
    updateSummaryLine();
    renderPapers();
    renderCount();
    renderExamGrid();
  }

  /* 结果明细列表（小结页与小数页共用） */
  function renderResultList(list, results) {
    list.innerHTML = '';
    if (!results.length) {
      list.innerHTML = '<div class="empty">没有需要展示的单词</div>';
      return;
    }
    results.forEach(function (r) {
      var cls = r.ok ? 'ok' : 'bad';
      var mark = r.ok ? '✓' : '✗';
      var tag = 'TP' + r.paper;
      if (r.source === 'skip') tag += ' · 跳过';
      else if (r.source === 'giveup') tag += ' · 看答案';
      if (r.attempts > 1) tag += ' · 第' + r.attempts + '次';
      var d = document.createElement('div');
      d.className = 'sl-row ' + cls;
      d.innerHTML = '<span class="sl-mark">' + mark + '</span>' +
        '<span class="sl-word">' + esc(r.w) + '</span>' +
        (r.ipa ? '<span class="sl-ipa">' + esc(r.ipa) + '</span>' : '') +
        '<span class="sl-mean">' + esc(r.m || '') +
          (r.d ? '<i class="mean-note">补充释义</i>' : '') + '</span>' +
        '<span class="sl-tag">' + tag + '</span>' +
        '<button class="sl-play" title="再听一次">🔊</button>';
      d.querySelector('.sl-play').addEventListener('click', function () {
        Speech.speak(r.w, { rate: state.rate, volume: state.volume, dual: state.dual });
      });
      list.appendChild(d);
    });
  }

  function statBox(n, label) {
    return '<div class="stat-box"><b>' + n + '</b><span>' + label + '</span></div>';
  }

  /* ---------- 8. 词表页 ---------- */
  function renderBrowse() {
    var sel = $('browse-paper');
    if (!sel.options.length) {
      for (var p = 1; p <= 9; p++) {
        var o = document.createElement('option');
        o.value = p; o.textContent = 'Test Paper ' + p + '（' + PAPERS[p - 1].items.length + ' 词）';
        sel.appendChild(o);
      }
      $('browse-sort').value = state.browseSort;
    }
    var p = parseInt(sel.value || '1', 10);
    var kw = SRS.normalize($('browse-search').value);

    var items = PAPERS[p - 1].items.filter(function (it) {
      return !kw || it.w.toLowerCase().indexOf(kw) >= 0 || (it.m || '').indexOf(kw) >= 0;
    });
    items = sortBrowseItems(items, state.browseSort);

    var list = $('browse-list');
    list.innerHTML = '';
    if (!items.length) { list.innerHTML = '<div class="empty">没有匹配的单词</div>'; return; }

    items.forEach(function (it) {
      var r = SRS.peek(it.paper, it.w);
      var learned = !!(r && r.all);
      var acc = learned ? Math.round(SRS.accuracy(r) * 100) : -1;
      var st = learned ? r.st : -1;

      /* 熟练度用小方块直观显示，未练过显示空心 */
      var pips = '';
      if (learned) {
        for (var s = 1; s <= 5; s++) {
          pips += '<i class="pip' + (s <= st ? ' on' : '') + '"></i>';
        }
      } else {
        pips = '<i class="pip none"></i>';
      }

      var d = document.createElement('div');
      d.className = 'br-row';
      d.innerHTML =
        '<button class="br-play" title="朗读">🔊</button>' +
        '<span class="br-word">' + esc(it.w) + '</span>' +
        '<span class="br-ipa">' + esc(it.ipa || '') +
          (it.ipad ? '<i class="ipa-note">单数音标</i>' : '') + '</span>' +
        '<span class="br-mean">' + esc(it.m || '') +
          (it.d ? '<i class="mean-note">补充</i>' : '') + '</span>' +
        '<span class="br-stat">' +
          (learned
            ? '<span class="pips">' + pips + '</span>' + acc + '%'
            : '<span class="pips">' + pips + '</span>未练') +
        '</span>';
      d.querySelector('.br-play').addEventListener('click', function () {
        Speech.speak(it.w, { rate: state.rate, volume: state.volume, dual: state.dual });
      });
      list.appendChild(d);
    });
  }

  /**
   * 词表排序
   *   alpha     字母顺序（原书顺序）
   *   prof-desc 熟练度高 -> 低：已熟练在前，未练过的垫底
   *   prof-asc  熟练度低 -> 高：未练过的排最前（最适合找该背的词），已熟练的垫底
   *
   * 熟练度相同时按正确率排，再相同则按字母顺序，保证顺序稳定可预期。
   */
  function sortBrowseItems(items, mode) {
    var alpha = function (a, b) { return a.w.toLowerCase() < b.w.toLowerCase() ? -1 : 1; };
    if (mode === 'alpha' || !mode) return items.slice().sort(alpha);

    var keyed = items.map(function (it) {
      var r = SRS.peek(it.paper, it.w);
      var learned = !!(r && r.all);
      return {
        it: it,
        learned: learned,
        st: learned ? r.st : 0,
        acc: learned ? SRS.accuracy(r) : 0
      };
    });

    keyed.sort(function (a, b) {
      if (mode === 'prof-asc') {
        /* 未练过的排最前 */
        if (a.learned !== b.learned) return a.learned ? 1 : -1;
      } else {
        /* 未练过的垫底 */
        if (a.learned !== b.learned) return a.learned ? -1 : 1;
      }
      if (a.st !== b.st) return mode === 'prof-asc' ? a.st - b.st : b.st - a.st;
      if (a.acc !== b.acc) return mode === 'prof-asc' ? a.acc - b.acc : b.acc - a.acc;
      return alpha(a.it, b.it);
    });

    return keyed.map(function (x) { return x.it; });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ============================================================
     8b. 拼写小测：入口 / 记录 / 正确率曲线 / 错题本
     ============================================================ */

  /* ---- 小测入口：Test Paper 卡片 ---- */
  function renderExamGrid() {
    var grid = $('exam-grid');
    if (!grid) return;
    grid.innerHTML = '';
    var totalMistakes = ExamStore.mistakeTotal(true);

    PAPERS.forEach(function (pp) {
      var st = ExamStore.examStats(pp.no);
      var mk = ExamStore.mistakeCountByPaper(pp.no);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'exam-card';
      btn.innerHTML =
        '<span class="ec-head">' +
          '<span class="ec-no">Test Paper ' + pp.no + '</span>' +
          '<span class="ec-words">' + pp.items.length + ' 词</span>' +
        '</span>' +
        (st.count
          ? '<span class="ec-last">上次 <b>' + st.last.accuracy + '%</b>' +
            (st.trend > 0 ? '<i class="trend up">▲' + st.trend + '</i>'
              : st.trend < 0 ? '<i class="trend down">▼' + Math.abs(st.trend) + '</i>'
              : '<i class="trend flat">—</i>') +
            '<span class="ec-times">已测 ' + st.count + ' 次</span></span>'
          : '<span class="ec-last ec-none">还没测过</span>') +
        '<span class="ec-foot">' +
          (mk ? '<span class="ec-mk">📕 错题 ' + mk + '</span>' : '<span class="ec-mk ok">✓ 无未订正错题</span>') +
          '<span class="ec-go">开始小测 →</span>' +
        '</span>';
      btn.addEventListener('click', function () { startExam(pp.no); });
      grid.appendChild(btn);
    });

    var badge = $('mistake-badge');
    if (badge) badge.textContent = totalMistakes;
  }

  /* ---- 测验记录页：曲线 + 列表 ---- */
  function ensureLogPaperOptions() {
    var sel = $('log-paper');
    if (!sel || sel.options.length > 1) return sel;
    /* 第一个 option 是 HTML 里的「全部 Test Paper」占位，不要重复添加 */
    for (var p = 1; p <= 9; p++) {
      var o = document.createElement('option');
      o.value = String(p);
      o.textContent = 'Test Paper ' + p;
      sel.appendChild(o);
    }
    return sel;
  }

  function renderExamLog() {
    var sel = ensureLogPaperOptions();

    var paper = sel && sel.value ? parseInt(sel.value, 10) : 0;
    var list = ExamStore.listExams(paper || 0);
    var stats = ExamStore.examStats(paper || 0);

    /* 统计摘要 */
    var stat = $('log-stat');
    if (stat) {
      stat.innerHTML = stats.count
        ? ('共 <b>' + stats.count + '</b> 次 · 平均 <b>' + stats.avg + '%</b>' +
           ' · 最好 <b>' + stats.best + '%</b> · 最差 <b>' + stats.worst + '%</b>' +
           ' · 趋势 <b class="' + (stats.trend > 0 ? 'up' : stats.trend < 0 ? 'down' : 'flat') + '">' +
           (stats.trend > 0 ? '▲+' : stats.trend < 0 ? '▼' : '') + stats.trend + '%</b>')
        : '还没有测验记录';
    }

    /* 折线图 */
    var host = $('chart-host');
    if (host) {
      if (list.length) {
        var pts = list.map(function (e) {
          return {
            x: e.time,
            y: e.accuracy,
            label: e.paperLabel + ' · ' + MiniChart.fmtTime(e.time)
          };
        });
        MiniChart.line(host, pts, { yMin: 0, yMax: 100, height: 260 });
      } else {
        MiniChart.line(host, [], {});
      }
    }

    /* 记录列表（最近的在前） */
    var box = $('log-list');
    if (box) {
      box.innerHTML = '';
      var cnt = $('log-count');
      if (cnt) cnt.textContent = list.length ? ('（近 ' + list.length + ' 次，最新在上）') : '';
      if (!list.length) {
        box.innerHTML = '<div class="empty">暂无记录</div>';
      } else {
        list.slice().reverse().forEach(function (e) {
          var secs = Math.round((e.durationMs || 0) / 1000);
          var dur = secs < 60 ? (secs + 's') : (Math.floor(secs / 60) + 'm' + (secs % 60) + 's');
          var cls = e.accuracy >= 85 ? 'good' : e.accuracy >= 60 ? 'mid' : 'poor';
          var d = document.createElement('div');
          d.className = 'log-row';
          d.innerHTML =
            '<span class="lg-time">' + MiniChart.fmtTime(e.time) + '</span>' +
            '<span class="lg-paper">' + esc(e.paperLabel) + '</span>' +
            '<span class="lg-score ' + cls + '">' + e.accuracy + '%</span>' +
            '<span class="lg-detail">' + e.total + ' 词 · 对 ' + e.correct +
              ' · 错 ' + e.wrong + ' · 跳 ' + e.skipped + '</span>' +
            '<span class="lg-dur">' + dur + '</span>';
          if (e.wrongWords && e.wrongWords.length) {
            var det = document.createElement('button');
            det.className = 'lg-toggle';
            det.textContent = '错词 ' + e.wrongWords.length;
            var panel = document.createElement('div');
            panel.className = 'lg-words';
            panel.hidden = true;
            panel.innerHTML = e.wrongWords.map(function (w) {
              return '<span class="lw">' + esc(w.w) +
                (w.source === 'skip' ? '<i>跳过</i>' : '') + '</span>';
            }).join('');
            det.addEventListener('click', function () {
              panel.hidden = !panel.hidden;
              det.classList.toggle('open', !panel.hidden);
            });
            d.appendChild(det);
            d.appendChild(panel);
          }
          box.appendChild(d);
        });
      }
    }
  }

  /* ---- 错题本 ---- */
  function renderMistakes() {
    var sel = $('mk-paper');
    if (sel && !sel.options.length) {
      for (var p = 1; p <= 9; p++) {
        var o = document.createElement('option');
        o.value = p; o.textContent = 'Test Paper ' + p;
        sel.appendChild(o);
      }
    }
    var paper = sel ? parseInt(sel.value, 10) : 1;
    var onlyOpen = $('mk-onlyopen') ? $('mk-onlyopen').checked : true;
    var list = ExamStore.listMistakes({ paper: paper, onlyOpen: onlyOpen });

    var box = $('mistake-list');
    box.innerHTML = '';
    if (!list.length) {
      box.innerHTML = '<div class="empty">'
        + (onlyOpen ? '这个 Test Paper 没有未订正的错题 🎉' : '这个 Test Paper 还没有错题')
        + '</div>';
      updatePracticeMistakeBtn();
      return;
    }

    list.forEach(function (m) {
      var r = SRS.peek(m.paper, m.w);
      var item = (PAPERS[m.paper - 1].items.filter(function (x) { return x.w === m.w; })[0]) || { w: m.w, m: '' };
      var d = document.createElement('div');
      d.className = 'mk-row' + (m.cleared ? ' cleared' : '');
      d.innerHTML =
        '<button class="mk-play" title="朗读">🔊</button>' +
        '<span class="mk-word">' + esc(m.w) + '</span>' +
        '<span class="mk-mean">' + esc(item.m || '') + '</span>' +
        '<span class="mk-st">熟练 ' + (r ? r.st : 0) + '/5</span>' +
        '<span class="mk-count">错 ' + m.count + ' 次</span>' +
        '<span class="mk-time">' + MiniChart.fmtTime(m.lastTime) + '</span>' +
        '<span class="mk-badge">' + (m.cleared ? '已订正' : '待订正') + '</span>' +
        '<button class="mk-del" title="从错题本移除">×</button>';
      d.querySelector('.mk-play').addEventListener('click', function () {
        Speech.speak(m.w, { rate: state.rate, volume: state.volume, dual: state.dual });
      });
      d.querySelector('.mk-del').addEventListener('click', function () {
        ExamStore.clearMistake(m.paper, m.w);
        renderMistakes();
        renderExamGrid();
      });
      box.appendChild(d);
    });

    updatePracticeMistakeBtn();
  }

  function updatePracticeMistakeBtn() {
    var btn = $('btn-mk-practice');
    if (!btn) return;
    var sel = $('mk-paper');
    var paper = sel ? parseInt(sel.value, 10) : 1;
    var n = ExamStore.listMistakes({ paper: paper, onlyOpen: true }).length;
    btn.textContent = n ? ('🎧 练习这些错词（' + n + '）') : '🎧 没有可练习的错词';
    btn.disabled = !n;
  }

  /* 用错题本里的词发起一次练习（走平时听写流程，答对即订正） */
  function practiceMistakes() {
    var sel = $('mk-paper');
    var paper = sel ? parseInt(sel.value, 10) : 1;
    var list = ExamStore.listMistakes({ paper: paper, onlyOpen: true });
    if (!list.length) { alert('这个 Test Paper 没有待订正的错词'); return; }
    var words = {};
    list.forEach(function (m) { words[m.w] = true; });
    var items = PAPERS[paper - 1].items.filter(function (it) { return words[it.w]; });
    if (!items.length) { alert('没找到对应单词'); return; }
    /* 用错题练习模式：答对即从错题本订正 */
    startExam(paper, items, 'Test Paper ' + paper + ' 错题');
  }

  /* ---------- 9. 语音音色 ---------- */
  function renderVoices() {
    var sel = $('opt-voice');
    var vs = Speech.voices();
    if (!vs.length) {
      sel.innerHTML = '<option value="">（未检测到英文音色）</option>';
      return;
    }
    var cur = Speech.current();
    sel.innerHTML = '';
    vs.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v.name;
      o.textContent = v.name + ' · ' + v.lang;
      if (cur && v.name === cur.name) o.selected = true;
      sel.appendChild(o);
    });
  }
  window.__onVoicesReady = function () { renderVoices(); };

  /* ---------- 10. 快捷键 ---------- */
  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      /* 帮助面板 */
      if (e.key === '?' && !isTypingTarget(e.target)) {
        toggleHelp();
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape') {
        if ($('modal-help').classList.contains('open')) { toggleHelp(false); e.preventDefault(); return; }
        if ($('view-practice').classList.contains('active')) { finishSession(); e.preventDefault(); }
        return;
      }

      var inPractice = $('view-practice').classList.contains('active');
      var input = $('answer-input');

      /* 语速调节在设置页和听写页都可用 */
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        var delta = e.key === 'ArrowUp' ? 0.05 : -0.05;
        state.rate = Math.min(1.3, Math.max(0.5, Math.round((state.rate + delta) * 100) / 100));
        $('opt-rate').value = state.rate;
        $('rate-label').textContent = state.rate.toFixed(2).replace(/0$/, '') + '×';
        saveSettings();
        e.preventDefault();
        return;
      }

      if (!inPractice) {
        if (e.key === 'Enter' && !isTypingTarget(e.target)) { startSession(); e.preventDefault(); }
        return;
      }

      /* --- 听写页 --- */
      if (e.key === 'Enter') {
        if (e.ctrlKey) { giveUp(); e.preventDefault(); return; }
        if (state.phase === 'judged') { advance(); }
        else submitAnswer();
        e.preventDefault();
        return;
      }

      if (e.key === 'Tab') { skip(); e.preventDefault(); return; }

      if (e.key === ' ' || e.code === 'Space') {
        if (state.phase === 'judged') { advance(); e.preventDefault(); return; }
        /* 输入框为空时空格=重听；有内容时允许输入空格 */
        if (!input.value) { playCurrent(); e.preventDefault(); }
        return;
      }

      /* 判错后的快捷修正 */
      if (state.phase === 'judged') {
        if (e.key === '1') { handleJudgeAction('right'); e.preventDefault(); return; }
        if (e.key === '3') { handleJudgeAction('easy'); e.preventDefault(); return; }
        if (e.key === '2') { advance(); e.preventDefault(); return; }
      }
    });

    /* 输入框：任何输入都保持焦点 */
    var input = $('answer-input');
    input.addEventListener('focus', function () { /* noop */ });
  }

  function isTypingTarget(el) {
    if (!el) return false;
    var t = (el.tagName || '').toLowerCase();
    return t === 'input' || t === 'textarea' || t === 'select' || el.isContentEditable;
  }

  function toggleHelp(force) {
    var m = $('modal-help');
    var open = force != null ? force : !m.classList.contains('open');
    m.classList.toggle('open', open);
    if (!open) { var i = $('answer-input'); if (i && !i.disabled) i.focus(); }
  }

  /* ---------- 11. 绑定 UI ---------- */
  function bindUI() {
    $('btn-count-minus').addEventListener('click', function () { setCount(state.count - 10); });
    $('btn-count-plus').addEventListener('click', function () { setCount(state.count + 10); });
    $('btn-all-papers').addEventListener('click', function () {
      for (var p = 1; p <= 9; p++) state.selected[p] = true;
      saveSettings(); renderPapers(); updateSummaryLine(); renderCount();
    });
    $('btn-clear-papers').addEventListener('click', function () {
      state.selected = {};
      saveSettings(); renderPapers(); updateSummaryLine(); renderCount();
    });

    Array.prototype.forEach.call(document.querySelectorAll('input[name=mode]'), function (r) {
      r.addEventListener('change', function () {
        state.mode = r.value; saveSettings(); renderModes();
      });
    });

    $('opt-auto').addEventListener('change', function () { state.autoSpeak = this.checked; saveSettings(); });
    $('opt-repeat').addEventListener('change', function () { state.repeatOnWrong = this.checked; saveSettings(); });
    $('opt-accents').addEventListener('change', function () { state.dual = this.checked; saveSettings(); });
    $('opt-rate').addEventListener('input', function () {
      state.rate = parseFloat(this.value);
      $('rate-label').textContent = state.rate.toFixed(2).replace(/0$/, '') + '×';
      saveSettings();
    });
    $('opt-vol').addEventListener('input', function () {
      state.volume = parseFloat(this.value);
      $('vol-label').textContent = Math.round(state.volume * 100) + '%';
      saveSettings();
    });
    $('opt-voice').addEventListener('change', function () { Speech.pickVoice(this.value); });
    $('btn-test-voice').addEventListener('click', function () {
      Speech.speak('dictionary', { rate: state.rate, volume: state.volume, dual: state.dual });
    });

    $('btn-start').addEventListener('click', startSession);

    $('btn-play').addEventListener('click', playCurrent);
    $('btn-giveup').addEventListener('click', giveUp);
    $('btn-skip').addEventListener('click', skip);
    $('btn-end').addEventListener('click', function () { finishSession(); });

    $('btn-again').addEventListener('click', function () { show('setup'); startSession(); });
    $('btn-back').addEventListener('click', function () { show('setup'); updateSummaryLine(); renderPapers(); renderCount(); });

    $('btn-help').addEventListener('click', function () { toggleHelp(); });
    $('btn-help-close').addEventListener('click', function () { toggleHelp(false); });
    $('modal-help').addEventListener('click', function (e) { if (e.target === this) toggleHelp(false); });

    $('btn-browse').addEventListener('click', function () { show('browse'); renderBrowse(); });
    $('btn-browse-back').addEventListener('click', function () { show('setup'); });
    $('browse-paper').addEventListener('change', renderBrowse);
    $('browse-sort').addEventListener('change', function () {
      state.browseSort = this.value;
      saveSettings();
      renderBrowse();
    });
    $('browse-search').addEventListener('input', renderBrowse);

    $('btn-reset').addEventListener('click', function () {
      if (confirm('确定清空全部学习进度（正确率 / 熟练度）吗？此操作不可撤销。')) {
        SRS.reset();
        updateSummaryLine(); renderPapers(); renderCount();
      }
    });

    /* 听写页里点击空白处把焦点还给输入框 */
    $('view-practice').addEventListener('click', function (e) {
      var input = $('answer-input');
      if (input.disabled) return;
      if (e.target.closest && e.target.closest('button')) return;
      input.focus();
    });

    /* ---------- 拼写小测 ---------- */
    $('btn-exam').addEventListener('click', function () {
      renderExamGrid();
      show('exam');
    });
    $('btn-exam-history').addEventListener('click', function () { show('examlog'); renderExamLog(); });
    $('btn-exam-history2').addEventListener('click', function () { show('examlog'); renderExamLog(); });
    $('btn-exam-back').addEventListener('click', function () { show('setup'); updateSummaryLine(); });
    $('btn-log-back').addEventListener('click', function () { show('exam'); renderExamGrid(); });
    $('btn-exam-again').addEventListener('click', function () {
      var paper = state.exam ? state.exam.paper : 1;
      startExam(paper);
    });

    $('exam-shuffle').addEventListener('change', function () {
      state.examShuffle = this.checked; saveSettings();
    });
    $('exam-feedback').addEventListener('change', function () {
      state.examFeedback = this.checked; saveSettings();
    });
    $('exam-skipleak').addEventListener('change', function () {
      state.examSkipLeak = this.checked; saveSettings();
    });

    $('log-paper').addEventListener('change', renderExamLog);
    $('btn-log-clear').addEventListener('click', function () {
      if (confirm('确定清空全部测验记录与正确率曲线吗？此操作不可撤销。')) {
        ExamStore.clearExams();
        renderExamLog();
        renderExamGrid();
      }
    });

    /* ---------- 错题本 ---------- */
    $('btn-mistakes').addEventListener('click', function () {
      renderMistakes();
      show('mistakes');
    });
    $('btn-mk-back').addEventListener('click', function () {
      renderExamGrid();
      show('exam');
    });
    $('mk-paper').addEventListener('change', renderMistakes);
    $('mk-onlyopen').addEventListener('change', renderMistakes);
    $('btn-mk-practice').addEventListener('click', practiceMistakes);
  }

  /* ---------- 12. 启动 ---------- */
  function init() {
    if (!ALL_ITEMS.length) {
      document.body.innerHTML =
        '<div style="padding:40px;font-family:sans-serif">' +
        '<h2>数据未加载</h2><p>请确认 <code>tingxie/data/paper1.js … paper9.js</code> 存在。</p></div>';
      return;
    }
    loadSettings();
    if (!Object.keys(state.selected).length) {
      for (var p = 1; p <= 9; p++) state.selected[p] = true;   // 默认全选
    }
    Speech.setSettings({ rate: state.rate, volume: state.volume, dual: state.dual });

    $('opt-auto').checked = state.autoSpeak;
    $('opt-repeat').checked = state.repeatOnWrong;
    $('opt-accents').checked = state.dual;
    $('opt-rate').value = state.rate;
    $('opt-vol').value = state.volume;
    $('rate-label').textContent = state.rate.toFixed(2).replace(/0$/, '') + '×';
    $('vol-label').textContent = Math.round(state.volume * 100) + '%';

    renderPapers();
    renderModes();
    renderCount();
    updateSummaryLine();
    renderVoices();
    renderExamGrid();

    /* 小测设置的初始状态 */
    $('exam-shuffle').checked = state.examShuffle;
    $('exam-feedback').checked = state.examFeedback;
    $('exam-skipleak').checked = state.examSkipLeak;

    bindUI();
    bindKeys();

    if (!Speech.supported()) {
      var w = document.createElement('div');
      w.className = 'browser-warn';
      w.textContent = '⚠️ 当前浏览器不支持语音合成，听写功能无法使用，请改用 Chrome 或 Edge 打开。';
      document.querySelector('main').prepend(w);
    }

    /* 供自动化自测使用：读取当前题目状态 */
    window.__T = {
      state: state,
      answer: function () { return state.current ? state.current.it.w : null; },
      info: function () {
        return state.current ? {
          w: state.current.it.w, paper: state.current.it.paper,
          pos: state.pos, queue: state.queue.length, phase: state.phase,
          exam: !!state.exam
        } : null;
      },
      next: function () { advance(); },
      finish: function () { finishSession(); },
      startExam: startExam,
      practiceMistakes: practiceMistakes,
      views: function () {
        return ['setup', 'practice', 'summary', 'browse', 'exam', 'examdone', 'examlog', 'mistakes']
          .filter(function (v) { return $('view-' + v).classList.contains('active'); })[0] || 'NONE';
      }
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
