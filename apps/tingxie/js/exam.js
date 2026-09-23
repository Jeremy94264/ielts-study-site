/* ============================================================
   exam.js — 拼写小测的记录存储 + 错题本
   ------------------------------------------------------------
   与 srs.js 的分工：
     srs.js   负责「平时听写」的间隔重复调度
     exam.js  负责「拼写小测」的成绩记录与错题归档

   两个 localStorage 键：
     ielts_tingxie_exams_v1   测验记录（时间、正确率、错词）
     ielts_tingxie_mistakes_v1 错题本（按 Test Paper 归档）

   测验与平时听写的区别：
     · 一次测完整个 Test Paper，错词/跳过的词**不在本轮重复出现**
     · 错词与跳过的词记入错题本，并把熟练度降低一级
     · 每次测验结果都留档，用于看正确率变化曲线
   ============================================================ */
(function (global) {
  'use strict';

  var EXAM_KEY = 'ielts_tingxie_exams_v1';
  var MISTAKE_KEY = 'ielts_tingxie_mistakes_v1';
  var MAX_EXAMS = 300;          // 防止 localStorage 无限膨胀

  function read(key, fallback) {
    try {
      var raw = global.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn('读取 ' + key + ' 失败，已重置', e);
      return fallback;
    }
  }

  function write(key, val) {
    try {
      global.localStorage.setItem(key, JSON.stringify(val));
      return true;
    } catch (e) {
      console.warn('写入 ' + key + ' 失败（可能是隐私模式）', e);
      return false;
    }
  }

  var exams = read(EXAM_KEY, []);
  var mistakes = read(MISTAKE_KEY, {});   // { "p1|ability": {...} }

  function mkey(paper, word) { return 'p' + paper + '|' + word; }

  /* ---------------- 测验记录 ---------------- */

  /**
   * 保存一次测验结果
   * @param {Object} r {paper, total, correct, wrong, skipped, accuracy, durationMs, words:[{w,m,ok,source}]}
   * @returns {Object} 保存后的记录（含 id / time）
   */
  function saveExam(r) {
    var rec = {
      id: 'e' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      time: Date.now(),
      paper: r.paper,
      paperLabel: r.paperLabel || ('Test Paper ' + r.paper),
      total: r.total,
      correct: r.correct,
      wrong: r.wrong,
      skipped: r.skipped,
      accuracy: r.accuracy,
      durationMs: r.durationMs || 0,
      /* 只留错题的词表摘要，避免记录过大 */
      wrongWords: (r.words || []).filter(function (x) { return !x.ok; })
        .map(function (x) { return { w: x.w, m: x.m || '', source: x.source }; })
    };
    exams.push(rec);
    if (exams.length > MAX_EXAMS) exams = exams.slice(-MAX_EXAMS);
    write(EXAM_KEY, exams);
    return rec;
  }

  /**
   * 列出测验记录
   * @param {number|null} paper 传 Test Paper 号则只列该篇；传 null / undefined / 0 表示全部
   *
   * 注意：这里必须用 != null 判断，不能写成 `paper ? ... : ...`。
   * 0 是假值，用假值判断会让 `listExams(0)` 意外返回全部记录，
   * 之前就踩过这个坑（"全部 Test Paper" 筛选形同失效）。
   */
  function listExams(paper) {
    var want = (paper == null || paper === 0 || paper === '') ? null : Number(paper);
    var list = want == null
      ? exams.slice()
      : exams.filter(function (e) { return e.paper === want; });
    return list.sort(function (a, b) { return a.time - b.time; });
  }

  function examStats(paper) {
    var list = listExams(paper);
    if (!list.length) return { count: 0, avg: -1, best: -1, worst: -1, trend: 0, last: null };
    var sum = 0, best = -1, worst = 101;
    list.forEach(function (e) {
      sum += e.accuracy;
      if (e.accuracy > best) best = e.accuracy;
      if (e.accuracy < worst) worst = e.accuracy;
    });
    /* 趋势：最近 3 次 - 最早 3 次的平均差 */
    var head = list.slice(0, Math.min(3, list.length));
    var tail = list.slice(-Math.min(3, list.length));
    var avg = function (a) {
      return a.reduce(function (s, x) { return s + x.accuracy; }, 0) / a.length;
    };
    return {
      count: list.length,
      avg: Math.round(sum / list.length),
      best: best,
      worst: worst,
      trend: Math.round(avg(tail) - avg(head)),
      last: list[list.length - 1]
    };
  }

  function clearExams() { exams = []; write(EXAM_KEY, []); }

  /* ---------------- 错题本 ---------------- */

  /**
   * 记录一个错词（拼错或跳过）
   * @param {number} paper
   * @param {string} word
   * @param {string} source 'answer' | 'skip' | 'giveup'
   */
  function addMistake(paper, word, source) {
    var k = mkey(paper, word);
    var m = mistakes[k];
    if (!m) {
      m = mistakes[k] = {
        paper: paper, w: word,
        count: 0,          // 累计错次数
        lastTime: 0,
        firstTime: 0,
        sources: {},
        cleared: false     // 在错题本重练中答对过
      };
    }
    var now = Date.now();
    m.count += 1;
    m.lastTime = now;
    if (!m.firstTime) m.firstTime = now;
    m.sources[source || 'answer'] = (m.sources[source || 'answer'] || 0) + 1;
    m.cleared = false;
    write(MISTAKE_KEY, mistakes);
    return m;
  }

  /** 错题本里答对 -> 标记为已订正 */
  function clearMistake(paper, word) {
    var k = mkey(paper, word);
    if (!mistakes[k]) return null;
    mistakes[k].cleared = true;
    write(MISTAKE_KEY, mistakes);
    return mistakes[k];
  }

  function peek(paper, word) { return mistakes[mkey(paper, word)] || null; }

  /**
   * 列出错题
   * @param {Object} opts {paper, onlyOpen}
   */
  function listMistakes(opts) {
    opts = opts || {};
    var out = [];
    for (var k in mistakes) {
      if (!Object.prototype.hasOwnProperty.call(mistakes, k)) continue;
      var m = mistakes[k];
      if (opts.paper && m.paper !== opts.paper) continue;
      if (opts.onlyOpen && m.cleared) continue;
      out.push(m);
    }
    /* 错得最多的排前面，其次最近的往前 */
    out.sort(function (a, b) {
      if (a.cleared !== b.cleared) return a.cleared ? 1 : -1;
      if (b.count !== a.count) return b.count - a.count;
      return b.lastTime - a.lastTime;
    });
    return out;
  }

  /** 每个 Test Paper 的错题数（未订正的） */
  function mistakeCountByPaper(paper) {
    var n = 0;
    for (var k in mistakes) {
      if (!Object.prototype.hasOwnProperty.call(mistakes, k)) continue;
      var m = mistakes[k];
      if (m.paper !== paper) continue;
      if (!m.cleared) n++;
    }
    return n;
  }

  function mistakeTotal(onlyOpen) {
    var n = 0;
    for (var k in mistakes) {
      if (!Object.prototype.hasOwnProperty.call(mistakes, k)) continue;
      if (onlyOpen && mistakes[k].cleared) continue;
      n++;
    }
    return n;
  }

  function clearMistakes(paper) {
    if (!paper) { mistakes = {}; }
    else {
      for (var k in mistakes) {
        if (Object.prototype.hasOwnProperty.call(mistakes, k) && mistakes[k].paper === paper) {
          delete mistakes[k];
        }
      }
    }
    write(MISTAKE_KEY, mistakes);
  }

  global.ExamStore = {
    EXAM_KEY: EXAM_KEY,
    MISTAKE_KEY: MISTAKE_KEY,
    saveExam: saveExam,
    listExams: listExams,
    examStats: examStats,
    clearExams: clearExams,
    addMistake: addMistake,
    clearMistake: clearMistake,
    peek: peek,
    listMistakes: listMistakes,
    mistakeCountByPaper: mistakeCountByPaper,
    mistakeTotal: mistakeTotal,
    clearMistakes: clearMistakes
  };
})(window);
