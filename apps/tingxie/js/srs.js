/* ============================================================
   srs.js — 间隔重复 + 熟练度调度
   ------------------------------------------------------------
   每个单词一条记录，key = "p<TestPaper>|<word>"
   记录结构：
     st     熟练度 0-5（0=刚接触，5=已熟练）
     ok/all 累计对/总次数（正确率来源）
     last   上次作答时间戳
     next   下次应复习时间戳
     try    显示次数
     streak 连续答对次数
     rw     最近 5 次作答（1=对 0=错），用于计算近期正确率
     known  是否被标记为「太简单」
   ============================================================ */
(function (global) {
  'use strict';

  var STORE_KEY = 'ielts_tingxie_srs_v1';

  /* 熟练度 -> 复习间隔（毫秒） */
  var INTERVALS = [
    10 * 60 * 1000,          // 0 刚接触   -> 10 分钟后
    30 * 60 * 1000,          // 1 有点印象 -> 30 分钟
    8 * 60 * 60 * 1000,      // 2 勉强记得 -> 8 小时
    24 * 60 * 60 * 1000,     // 3 基本掌握 -> 1 天
    3 * 24 * 60 * 60 * 1000, // 4 熟练     -> 3 天
    7 * 24 * 60 * 60 * 1000  // 5 已熟练   -> 7 天
  ];

  var MAX_STRENGTH = 5;

  function key(paper, word) { return 'p' + paper + '|' + word; }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.warn('读取进度失败，已重置', e);
      return {};
    }
  }

  var store = load();
  var dirty = false;

  function save() {
    if (!dirty) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
      dirty = false;
    } catch (e) {
      console.warn('保存进度失败（可能是隐私模式）', e);
    }
  }
  global.addEventListener('beforeunload', save);
  setInterval(save, 4000);

  function blank() {
    return { st: 0, ok: 0, all: 0, last: 0, next: 0, try: 0, streak: 0, rw: [], known: false };
  }

  function rec(paper, word) {
    var k = key(paper, word);
    if (!store[k]) store[k] = blank();
    var r = store[k];
    if (!r.rw) r.rw = [];
    return r;
  }

  function peek(paper, word) { return store[key(paper, word)] || null; }

  /* 正确率：优先用累计，未作答时返回 -1 表示「新词」 */
  function accuracy(r) {
    if (!r || !r.all) return -1;
    return r.ok / r.all;
  }

  /* 近期正确率：最近 5 次，权重更高 */
  function recentAccuracy(r) {
    if (!r || !r.rw || !r.rw.length) return -1;
    var s = 0;
    for (var i = 0; i < r.rw.length; i++) s += r.rw[i];
    return s / r.rw.length;
  }

  /* 弱点分：越高越需要练 */
  function weakness(r) {
    if (!r || !r.all) return 1.0;              // 全新词，给基准权重
    var acc = accuracy(r);
    var recent = recentAccuracy(r);
    if (recent >= 0) acc = acc * 0.45 + recent * 0.55;
    var w = (1 - acc) * (1 - r.st / MAX_STRENGTH);
    if (r.streak === 0) w += 0.15;              // 刚答错过，加权

    /* 拼写小测里写错的词：完全不进平时听写的 ok/all 统计，
       若只看正确率，一个"平时全对但小测写不出"的词弱点分会是 0，
       结果永远排不上复习队列 —— 这正是小测最该暴露的问题。
       所以小测错一次就补一份权重（并随熟练度下降而加大），
       保证它能被优先安排。 */
    if (r.examWrong) {
      w += 0.8 + 1.6 * (r.examWrong > 3 ? 3 : r.examWrong) * (1 - r.st / MAX_STRENGTH);
    }

    return Math.max(0.02, w);
  }

  /* 到期系数：0 = 无需立刻复习，1 = 已经到期 */
  function dueFactor(r, now) {
    if (!r || !r.next) return 1.0;              // 全新词
    var base = INTERVALS[Math.min(r.st, MAX_STRENGTH)];
    var overdue = now - r.next;
    if (overdue <= 0) return 0;                 // 还没到期
    return Math.min(1, 0.55 + overdue / Math.max(1, base));
  }

  /* 新近度：刚练过的稍降权。惩罚必须很轻，否则「刚写错的词」会被新词挤到最后 */
  function recencyFactor(r, now) {
    if (!r || !r.last) return 1.0;
    var age = now - r.last;
    if (age < 3 * 60 * 1000) return 0.92;       // 3 分钟内
    if (age < 30 * 60 * 1000) return 0.97;
    return 1.0;
  }

  /*
   * 综合优先级（越大越先考）
   *
   *   prio = 0.85 × 应付系数  +  0.70 × 到期系数  +  0.25 × 新鲜度奖励
   *
   *   应付系数 = 弱点分 × 新近度修正
   *   到期系数 = 0 未到期 / 0.5~1 已到期（逾期越久越接近 1）
   *   新鲜度奖励 = 越小(与上次练习间隔越久)越接近 1，让冷门词按机会冒头
   *
   * 各情形的实际取值：
   *   ① 已到期 + 薄弱（一直写错）  0.85×1.15 + 0.70×1.0 + 0.25×(刚练过≈0)  ≈ 1.68  ← 最优先
   *   ② 刚写错、还没到期(10min后)  0.85×1.15×0.92 + 0 + 0.25×0      ≈ 0.90  ┐
   *   ③ 全新词                     0.85×1.00 + 0 + 0.25×1.0          = 1.10  ┘ ② 仍高于…
   *
   *   ↑ 注意：②(0.90) 低于 ③(1.10)，所以这里额外给「写错过」一个直接加分，
   *     保证「本组刚写错的词」一定排在全新词前面（见 MISS_BONUS）。
   *   ⑤ 已熟练且未到期             0.85×0.02 + 0 + 0.25×0           ≈ 0.02  ← 垫底
   */
  var FRESH_SCORE = 1.10;      // 全新词基准
  var MISS_BONUS = 0.30;       // 写错过但还没到期的直接加分

  function scoreOf(r, now) {
    if (!r || !r.all) return FRESH_SCORE;
    var need = weakness(r) * recencyFactor(r, now);
    var due = dueFactor(r, now);
    /* 新鲜度：距上次练习越久，越容易被抽到（上限 14 天） */
    var ageDays = Math.min(14, (now - (r.last || now)) / 86400000);
    var fresh = ageDays / 14;
    var s = 0.85 * need + 0.70 * due + 0.25 * fresh;
    if (due === 0) s += MISS_BONUS;             // 还没到期却仍需练 => 最近写错过
    return s;
  }

  /* ---------------- 抽题 ---------------- */

  /**
   * 构建一组题目
   * @param {Array} pool   [{paper, index, w, m, ipa}]
   * @param {Object} opts  {count, mode, seed}
   */
  function buildSession(pool, opts) {
    var now = Date.now();
    var mode = opts.mode || 'smart';
    var items = [], i;

    for (i = 0; i < pool.length; i++) {
      var it = pool[i];
      var r = peek(it.paper, it.w);
      var jit = ((it.index * 2654435761 + it.paper * 40503) % 1000) / 1000;  // 稳定抖动，打散同分
      items.push({
        item: it,
        rec: r,
        isNew: !r || !r.all,
        due: !r || !r.next || r.next <= now,
        prio: scoreOf(r, now),
        jit: jit,
        acc: accuracy(r)
      });
    }

    var chosen;

    if (mode === 'order') {
      chosen = items.slice().sort(function (a, b) {
        if (a.item.paper !== b.item.paper) return a.item.paper - b.item.paper;
        return a.item.index - b.item.index;
      });
    } else if (mode === 'new') {
      chosen = items.filter(function (x) { return x.isNew; })
                   .sort(function (a, b) {
                     if (a.item.paper !== b.item.paper) return a.item.paper - b.item.paper;
                     return a.item.index - b.item.index;
                   });
    } else if (mode === 'weak') {
      chosen = items.filter(function (x) {
        if (x.isNew) return true;
        return (x.acc < 0.8) || (x.rec.st < 3) || x.due;
      }).sort(function (a, b) { return (b.prio + b.jit * 0.05) - (a.prio + a.jit * 0.05); });
    } else {
      /* smart：到期/薄弱优先，全新词其次，已熟练未到期的垫底 */
      chosen = items.slice().sort(function (a, b) {
        var sa = a.prio + a.jit * 0.05;
        var sb = b.prio + b.jit * 0.05;
        if (Math.abs(sa - sb) > 1e-9) return sb - sa;
        if (a.item.paper !== b.item.paper) return a.item.paper - b.item.paper;
        return a.item.index - b.item.index;
      });
    }

    return chosen.slice(0, opts.count);
  }

  /* ---------------- 作答 ---------------- */

  /**
   * 规范化用户输入，便于判分
   */
  function normalize(s) {
    return String(s == null ? '' : s)
      .replace(/[\u2018\u2019\u02bc]/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function judge(input, answer) {
    var a = normalize(answer);
    var b = normalize(input);
    if (!b) return false;
    if (a === b) return true;
    /* 允许 “the answer” / “an answer” 之类冠词冗余 */
    var strip = function (x) { return x.replace(/^(the|a|an)\s+/, '').trim(); };
    return strip(a) === strip(b);
  }

  /**
   * 记录一次作答
   * @param {number} paper
   * @param {string} word
   * @param {boolean} correct
   * @param {string} grade  'correct' | 'wrong' | 'easy' | 'skip'
   */
  function grade(paper, word, correct, kind) {
    var r = rec(paper, word);
    var now = Date.now();
    r.all += 1;
    r.last = now;
    r.try += 1;

    if (kind === 'easy') {
      r.ok += 1;
      r.st = MAX_STRENGTH;
      r.known = true;
      r.streak += 1;
      r.rw.push(1);
    } else if (correct) {
      r.ok += 1;
      r.st = Math.min(MAX_STRENGTH, r.st + 1);
      r.streak += 1;
      r.rw.push(1);
    } else {
      r.st = Math.max(0, r.st - 1);
      r.streak = 0;
      r.rw.push(0);
    }

    if (r.rw.length > 5) r.rw = r.rw.slice(-5);
    r.next = now + INTERVALS[Math.min(r.st, MAX_STRENGTH)];
    dirty = true;
    save();
    return r;
  }

  function markSeen(paper, word) {
    var r = rec(paper, word);
    r.try += 1;
    dirty = true;
  }

  /**
   * 把某个词直接标记为「太简单」。
   * 用于「已经答对」之后再补一次熟练度升级：熟练度拉满、复习间隔拉到最长，
   * 但**不再累加作答次数**（这一次作答已经由 grade() 记过了，避免重复计分）。
   */
  function promote(paper, word) {
    var r = rec(paper, word);
    var now = Date.now();
    r.st = MAX_STRENGTH;
    r.known = true;
    r.streak = Math.max(r.streak, 1);
    if (!r.last) r.last = now;
    r.next = now + INTERVALS[MAX_STRENGTH];
    dirty = true;
    save();
    return r;
  }

  /**
   * 拼写小测专用：只把熟练度降低一级、并让这个词尽快重新出现，
   * 但**不计入平时听写的对错统计**（all / ok / rw 都不动）。
   *
   * 这样小测就纯粹是"摸底"，不会把平时听写的正确率统计搞乱，
   * 同时又把没掌握的词的复习优先级提上来。
   *
   * 关于复习间隔，这里用的是降级**后**的熟练度去查表（INTERVALS[r.st]）：
   * 一个刚在小测里写错的词必须很快回来，绝不能因为"它原本很熟"就被推后。
   * 例：5 级写错 -> 降到 4 级 -> 3 天后复习（用 INTERVALS[4]）；
   *     1 级写错 -> 降到 0 级 -> 10 分钟后复习（用 INTERVALS[0]）。
   *
   * 下限：即使原本是 5 级降到 4 级，也必须至少 10 分钟后就能再见到它。
   */
  function lower(paper, word) {
    var r = rec(paper, word);
    var now = Date.now();
    var from = r.st;
    r.st = Math.max(0, r.st - 1);
    r.streak = 0;
    r.last = now;
    var gap = Math.max(INTERVALS[r.st], INTERVALS[0]);   // 至少 10 分钟
    r.next = now + gap;
    r.examWrong = (r.examWrong || 0) + 1;               // 小测错过的累计次数
    dirty = true;
    save();
    return { rec: r, from: from, to: r.st, gapMs: gap };
  }

  /* ---------------- 统计 ---------------- */

  function statsFor(pool) {
    var s = { total: pool.length, new: 0, learning: 0, familiar: 0, mastered: 0, due: 0, accSum: 0, accN: 0 };
    var now = Date.now();
    for (var i = 0; i < pool.length; i++) {
      var r = peek(pool[i].paper, pool[i].w);
      if (!r || !r.all) { s['new']++; continue; }
      if (r.st >= 5) s.mastered++;
      else if (r.st >= 3) s.familiar++;
      else s.learning++;
      if (r.next && r.next <= now) s.due++;
      s.accSum += r.ok / r.all; s.accN++;
    }
    s.avgAcc = s.accN ? s.accSum / s.accN : -1;
    return s;
  }

  function reset() {
    store = {};
    dirty = true;
    save();
  }

  function exportAll() { return JSON.parse(JSON.stringify(store)); }

  global.SRS = {
    STORE_KEY: STORE_KEY,
    MAX_STRENGTH: MAX_STRENGTH,
    INTERVALS: INTERVALS,
    peek: peek,
    blank: blank,
    buildSession: buildSession,
    judge: judge,
    normalize: normalize,
    grade: grade,
    markSeen: markSeen,
    promote: promote,
    lower: lower,
    statsFor: statsFor,
    accuracy: accuracy,
    weakness: weakness,
    reset: reset,
    save: save,
    exportAll: exportAll
  };
})(window);
