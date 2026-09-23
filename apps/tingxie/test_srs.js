/* Node 环境下对 srs.js 做一遍逻辑自测 */
const fs = require('fs');
const path = require('path');

const store = {};
const listeners = {};
global.window = global;
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
global.addEventListener = (n, f) => { (listeners[n] = listeners[n] || []).push(f); };

const ROOT = __dirname;
eval(fs.readFileSync(path.join(ROOT, 'js/srs.js'), 'utf8'));

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  -> ' + extra : '')); }
}

console.log('\n=== 1. 判分规则 ===');
t('完全一致', SRS.judge('ability', 'ability') === true);
t('大小写无关', SRS.judge('Ability', 'ability') === true);
t('前后空格', SRS.judge('  ability  ', 'ability') === true);
t('拼错判错', SRS.judge('abilty', 'ability') === false);
t('空答案判错', SRS.judge('', 'ability') === false);
t('多余冠词容错', SRS.judge('the answer', 'answer') === true);
t('多词短语', SRS.judge('car park', 'car park') === true);
t('多词短语空格容错', SRS.judge('car   park', 'car park') === true);
t('撇号规范化', SRS.judge("chemist\u2019s", "chemist's") === true);

console.log('\n=== 2. 构建词库（读取生成的数据文件）===');
const pool = [];
const allEntries = [];
for (let p = 1; p <= 9; p++) {
  const src = fs.readFileSync(path.join(ROOT, 'data/paper' + p + '.js'), 'utf8');
  eval(src);                                   // 定义 window.CORPUS_DATA[p]
  const arr = global.CORPUS_DATA[p] || [];
  arr.forEach((e, i) => {
    pool.push({ paper: p, index: i, w: e.w, m: e.m, ipa: e.ipa });
    allEntries.push({ p: p, e: e });
  });
}
console.log('  词库总数: ' + pool.length);
t('词库非空', pool.length > 1000, 'got ' + pool.length);
t('每个 Test Paper 都有词', [1,2,3,4,5,6,7,8,9].every(p => pool.some(x => x.paper === p)));
t('释义 100% 覆盖', allEntries.every(x => x.e.m && x.e.m.trim()),
  allEntries.filter(x => !x.e.m).slice(0, 5).map(x => x.e.w).join(','));
t('释义均含中文', allEntries.every(x => /[\u4e00-\u9fff]/.test(x.e.m || '')),
  allEntries.filter(x => !/[\u4e00-\u9fff]/.test(x.e.m || '')).slice(0, 5).map(x => x.e.w).join(','));
t('补充释义的词不伪造音标',
  allEntries.every(x => !(x.e.d && x.e.ipa && !x.e.ipad)),
  allEntries.filter(x => x.e.d && x.e.ipa && !x.e.ipad).map(x => x.e.w).join(','));
const pluralCases = { batteries:'电池', switches:'开关', willows:'柳树', thieves:'贼',
                      scandals:'丑闻', pensioners:'养老金', tunnels:'隧道', ferries:'渡' };
Object.keys(pluralCases).forEach(w => {
  const hit = allEntries.filter(x => x.e.w === w)[0];
  t('复数 ' + w + ' 回退到单数释义', hit && (hit.e.m || '').indexOf(pluralCases[w]) >= 0,
    hit ? hit.e.m : 'not found');
});
t('无重复词（同 paper 内）', (() => {
  for (let p = 1; p <= 9; p++) {
    const ws = pool.filter(x => x.paper === p).map(x => x.w.toLowerCase());
    if (new Set(ws).size !== ws.length) return false;
  }
  return true;
})());
t('无空词', pool.every(x => x.w && x.w.trim()));

console.log('\n=== 3. 抽题数量 ===');
let s = SRS.buildSession(pool, { count: 30, mode: 'smart', seed: 1 });
t('smart 抽 30 题', s.length === 30, 'got ' + s.length);
s = SRS.buildSession(pool, { count: 10, mode: 'smart', seed: 1 });
t('smart 抽 10 题', s.length === 10, 'got ' + s.length);
s = SRS.buildSession(pool, { count: pool.length, mode: 'order' });
t('order 全量 = 词库数', s.length === pool.length, 'got ' + s.length);
s = SRS.buildSession(pool, { count: 50, mode: 'new' });
t('new 模式全是新词', s.every(x => x.isNew) && s.length === 50, 'got ' + s.length);
s = SRS.buildSession(pool, { count: 20, mode: 'weak' });
t('weak 模式有结果', s.length === 20, 'got ' + s.length);

console.log('\n=== 4. 熟练度 / 间隔推进 ===');
SRS.reset();
let r = SRS.grade(1, 'ability', true, 'correct');
t('答对一次 熟练度=1', r.st === 1, 'st=' + r.st);
t('答对后 next 在 30 分钟后', Math.abs((r.next - r.last) - 30 * 60 * 1000) < 1000);
r = SRS.grade(1, 'ability', true, 'correct');
t('答对两次 熟练度=2', r.st === 2);
for (let i = 0; i < 10; i++) r = SRS.grade(1, 'ability', true, 'correct');
t('熟练度封顶 5', r.st === 5, 'st=' + r.st);
t('熟练后间隔 = 7 天', Math.abs((r.next - r.last) - 7 * 24 * 3600 * 1000) < 1000);
r = SRS.grade(1, 'ability', false, 'wrong');
t('答错降一级', r.st === 4, 'st=' + r.st);
t('答错后 streak 归零', r.streak === 0);
r = SRS.grade(1, 'ability', false, 'wrong');
t('连续答错继续降', r.st === 3);
t('正确率统计 ok/all', r.ok === 12 && r.all === 14, 'ok=' + r.ok + ' all=' + r.all);

console.log('\n=== 5. 太简单 直接跳熟练 ===');
SRS.reset();
r = SRS.grade(2, 'cage', true, 'easy');
t('easy -> 熟练度 5', r.st === 5);
t('easy 标记 known', r.known === true);

console.log('\n=== 5b. promote()：答对后再标记「太简单」===');
SRS.reset();
SRS.grade(2, 'cage', true, 'correct');           // 先正常答对一次
let before = SRS.peek(2, 'cage');
t('先答对一次：熟练度 1', before.st === 1, 'st=' + before.st);
t('先答对一次：all=1', before.all === 1, 'all=' + before.all);
let promoted = SRS.promote(2, 'cage');
t('promote 后熟练度拉满 5', promoted.st === 5, 'st=' + promoted.st);
t('promote 标记 known', promoted.known === true);
t('promote 不会重复计分（all 仍为 1）', promoted.all === 1, 'all=' + promoted.all);
t('promote 不会重复计分（ok 仍为 1）', promoted.ok === 1, 'ok=' + promoted.ok);
t('promote 后间隔 = 7 天',
  Math.abs((promoted.next - Date.now()) - 7 * 24 * 3600 * 1000) < 5000,
  Math.round((promoted.next - Date.now()) / 3600000) + 'h');
t('promote 不消耗作答次数 try', promoted.try === before.try,
  before.try + ' -> ' + promoted.try);

/* promote 后的词不该在智能模式里被优先抽中 */
const cageSess = SRS.buildSession(pool.filter(x => x.paper === 2), { count: 10, mode: 'smart' });
t('promote 后的词不占前 10', !cageSess.some(x => x.item.w === 'cage'),
  cageSess.map(x => x.item.w).join(','));

console.log('\n=== 5c. lower()：拼写小测的降级（不计入平时统计）===');
SRS.reset();
/* 用词库里真实存在的词，取每个 Test Paper 的第 1 个词，避免写错篇号 */
const w1p3 = pool.filter(x => x.paper === 3)[0].w;
const w1p4 = pool.filter(x => x.paper === 4)[0].w;
console.log('   用 TP3 的 "' + w1p3 + '" 和 TP4 的 "' + w1p4 + '" 做校验');

for (let i = 0; i < 6; i++) SRS.grade(3, w1p3, true, 'correct');   // 刷到 5
let pre = SRS.peek(3, w1p3);
t('预置：熟练度 5', pre.st === 5, 'st=' + pre.st);
let ok0 = pre.ok, all0 = pre.all, rw0 = pre.rw.length;
let low = SRS.lower(3, w1p3);
t('lower 返回 from/to', low.from === 5 && low.to === 4, low.from + '->' + low.to);
t('熟练度降 1 级', pre.st === 4, 'st=' + pre.st);
t('lower 不改变 ok', pre.ok === ok0, ok0 + '->' + pre.ok);
t('lower 不改变 all', pre.all === all0, all0 + '->' + pre.all);
t('lower 不写入近 5 次记录 rw', pre.rw.length === rw0, rw0 + '->' + pre.rw.length);
t('lower 记录 examWrong 次数', pre.examWrong === 1, pre.examWrong);
t('lower 后 streak 归零', pre.streak === 0, pre.streak);
/* 刚在小测里写错的词必须很快回来：5 -> 4 用 INTERVALS[4] = 3 天，而不是 7 天 */
t('lower 的复习间隔按降级后的档位算（5->4 => 3 天）',
  Math.abs((pre.next - Date.now()) - SRS.INTERVALS[4]) < 2000,
  Math.round((pre.next - Date.now()) / 3600000) + 'h vs ' + (SRS.INTERVALS[4] / 3600000) + 'h');
t('lower 的间隔绝不会超过 3 天（不会因为原本很熟而被推远）',
  pre.next - Date.now() <= SRS.INTERVALS[4] + 2000,
  Math.round((pre.next - Date.now()) / 3600000) + 'h');

/* 只降 1 级（5 -> 4）的词仍算"较熟"，但应比同篇完全没练过的词排得靠前 */
const p3Sess = SRS.buildSession(pool.filter(x => x.paper === 3), { count: 999, mode: 'smart' });
const r1 = p3Sess.findIndex(x => x.item.w === w1p3);
t('小测降级过的词排在同篇未练词之前（前半段）',
  r1 >= 0 && r1 < p3Sess.length * 0.5,
  'rank=' + r1 + '/' + p3Sess.length);

/* 连续错很多次 -> 降到 0，应该被优先抽中 */
SRS.reset();
for (let i = 0; i < 6; i++) SRS.grade(4, w1p4, true, 'correct');
let lastLow = null;
for (let i = 0; i < 6; i++) lastLow = SRS.lower(4, w1p4);   // 一路降到 0
let dam = SRS.peek(4, w1p4);
t('连续 lower 后熟练度为 0（不为负）', dam.st === 0, 'st=' + dam.st);
t('examWrong 累计 6 次', dam.examWrong === 6, dam.examWrong);
t('降到 0 时的间隔 = 10 分钟', Math.abs(lastLow.gapMs - SRS.INTERVALS[0]) < 1000,
  Math.round(lastLow.gapMs / 60000) + 'min');
const damSess = SRS.buildSession(pool.filter(x => x.paper === 4), { count: 10, mode: 'smart' });
t('降到 0 的小测错词排进前 10', damSess.some(x => x.item.w === w1p4),
  damSess.map(x => x.item.w).join(','));

/* 边界：对同一个词疯狂降级，熟练度不会变成负数 */
t('连续 lower 不会把熟练度降成负数',
  (function () {
    let last = null;
    for (let i = 0; i < 10; i++) last = SRS.lower(3, w1p3);
    return last.rec.st === 0;
  })(), 'last st=' + SRS.lower(3, w1p3).rec.st);
t('降到 0 后继续 lower，间隔锁在 10 分钟',
  (function () {
    const g = SRS.lower(3, w1p3);
    return Math.abs(g.gapMs - SRS.INTERVALS[0]) < 1000;
  })());

console.log('\n=== 5d. ExamStore：测验记录与错题本 ===');
delete global.ExamStore;
eval(fs.readFileSync(path.join(ROOT, 'js/exam.js'), 'utf8'));
const ES = global.ExamStore;
ES.clearExams(); ES.clearMistakes();

t('初始无记录', ES.listExams(0).length === 0 && ES.mistakeTotal(false) === 0);

const e1 = ES.saveExam({
  paper: 1, paperLabel: 'Test Paper 1', total: 100, correct: 80, wrong: 15,
  skipped: 5, accuracy: 80, durationMs: 60000,
  words: [
    { w: 'ability', m: 'n.能力', ok: true, source: 'answer' },
    { w: 'acid', m: 'n.酸', ok: false, source: 'answer' },
    { w: 'adult', m: 'n.成人', ok: false, source: 'skip' }
  ]
});
t('保存后记录数 = 1', ES.listExams(0).length === 1, ES.listExams(0).length);
t('记录带 id 与 time', !!e1.id && e1.time > 0);
t('只保留错题摘要', e1.wrongWords.length === 2, e1.wrongWords.length);
t('错题摘要含来源', e1.wrongWords[1].source === 'skip', e1.wrongWords[1].source);

const e2 = ES.saveExam({
  paper: 1, paperLabel: 'Test Paper 1', total: 100, correct: 92, wrong: 8,
  skipped: 0, accuracy: 92, durationMs: 50000, words: []
});
let eStat = ES.examStats(1);
t('统计次数 = 2', eStat.count === 2, eStat.count);
t('统计平均 = 86', eStat.avg === 86, eStat.avg);
t('统计最好 = 92', eStat.best === 92, eStat.best);
t('统计最差 = 80', eStat.worst === 80, eStat.worst);
t('统计最近一次 = 92', eStat.last.accuracy === 92, eStat.last.accuracy);
/* 只有 2 次时，首尾窗口重叠，趋势必然为 0 —— 这是算法的设定，不是 bug */
t('仅 2 次时趋势为 0（首尾窗口重叠）', eStat.trend === 0, eStat.trend);

/* 再补 4 次（Test Paper 5），保留前面的 paper1 记录，便于验证按篇过滤 */
[60, 70, 80, 90].forEach(function (acc) {
  ES.saveExam({
    paper: 5, paperLabel: 'Test Paper 5', total: 100,
    correct: acc, wrong: 100 - acc, skipped: 0, accuracy: acc,
    durationMs: 30000, words: []
  });
});
let eStat5 = ES.examStats(5);
t('4 次记录：平均 75', eStat5.avg === 75, eStat5.avg);
/* 首窗 = 前 3 次的均值 70，尾窗 = 后 3 次的均值 80，趋势 = +10 */
t('4 次记录：趋势 +10（首窗 70 → 尾窗 80）', eStat5.trend === 10, eStat5.trend);
t('记录按时间升序排列', ES.listExams(5).map(function (x) { return x.accuracy; }).join(',') === '60,70,80,90',
  ES.listExams(5).map(function (x) { return x.accuracy; }).join(','));

/* 过滤断言：此处 paper1 有 2 条、paper5 有 4 条 */
t('按 Test Paper 过滤', ES.listExams(1).length === 2 && ES.listExams(2).length === 0,
  ES.listExams(1).length + '/' + ES.listExams(2).length);
t('全部记录 = 6 条（不传参数即全部）', ES.listExams(0).length === 6, ES.listExams(0).length);
t('listExams(null) 也是全部', ES.listExams(null).length === 6, ES.listExams(null).length);
t('不存在的 Test Paper 统计返回 count=0', ES.examStats(9).count === 0);
t('examStats(5) 只看 TP5', ES.examStats(5).count === 4, ES.examStats(5).count);
ES.clearExams();
t('清空后无记录', ES.listExams(0).length === 0);

/* 错题本 */
ES.addMistake(1, 'acid', 'answer');
ES.addMistake(1, 'acid', 'answer');          // 同一个词错两次
ES.addMistake(1, 'adult', 'skip');
t('错题本共 2 个词', ES.mistakeTotal(false) === 2, ES.mistakeTotal(false));
t('acid 累计错 2 次', ES.peek(1, 'acid').count === 2, ES.peek(1, 'acid').count);
t('adult 来源记为 skip', ES.peek(1, 'adult').sources.skip === 1,
  JSON.stringify(ES.peek(1, 'adult').sources));
t('按 Test Paper 统计错题数', ES.mistakeCountByPaper(1) === 2, ES.mistakeCountByPaper(1));
t('错得多的排前面', ES.listMistakes({ paper: 1 })[0].w === 'acid',
  ES.listMistakes({ paper: 1 }).map(x => x.w).join(','));
t('只列未订正时也是 2', ES.listMistakes({ paper: 1, onlyOpen: true }).length === 2);

ES.clearMistake(1, 'acid');
t('订正后 cleared = true', ES.peek(1, 'acid').cleared === true);
t('未订正数减为 1', ES.mistakeTotal(true) === 1, ES.mistakeTotal(true));
t('onlyOpen 过滤掉已订正', ES.listMistakes({ paper: 1, onlyOpen: true }).length === 1,
  ES.listMistakes({ paper: 1, onlyOpen: true }).length);
t('全部（含已订正）仍是 2', ES.listMistakes({ paper: 1 }).length === 2);
t('已订正的排到最后', ES.listMistakes({ paper: 1 })[1].w === 'acid',
  ES.listMistakes({ paper: 1 }).map(x => x.w).join(','));

/* 再次答错会把已订正状态复位 */
ES.addMistake(1, 'acid', 'answer');
t('再次答错 -> 回到未订正', ES.peek(1, 'acid').cleared === false);
t('累计次数累加为 3', ES.peek(1, 'acid').count === 3, ES.peek(1, 'acid').count);

ES.clearMistakes(1);
t('清空某 Test Paper 的错题', ES.mistakeTotal(false) === 0, ES.mistakeTotal(false));
ES.clearExams();
t('清空测验记录', ES.listExams(0).length === 0);

console.log('\n=== 6. 错词优先出题 ===');
SRS.reset();
/* 把 ability 弄得很差（刚写错，10 分钟后才到期），把 acid 弄得很熟 */
for (let i = 0; i < 6; i++) SRS.grade(1, 'ability', false, 'wrong');
for (let i = 0; i < 6; i++) SRS.grade(1, 'acid', true, 'correct');
const p1 = pool.filter(x => x.paper === 1);
const sess = SRS.buildSession(p1, { count: 10, mode: 'smart', seed: 7 });
t('刚写错的词优先出现（排在全新词之前）', sess.some(x => x.item.w === 'ability'),
  'top10 = ' + sess.map(x => x.item.w).join(','));
t('第一个就是错词', sess[0].item.w === 'ability', 'first = ' + sess[0].item.w);
t('已熟练的词不进前 10', !sess.some(x => x.item.w === 'acid'));
const full = SRS.buildSession(p1, { count: p1.length, mode: 'smart' });
t('错词排名靠前（前 3）', full.findIndex(x => x.item.w === 'ability') < 3,
  'rank = ' + full.findIndex(x => x.item.w === 'ability'));
t('熟练词排名垫底（后 20%）',
  full.findIndex(x => x.item.w === 'acid') > p1.length * 0.8,
  'rank = ' + full.findIndex(x => x.item.w === 'acid'));

console.log('\n=== 7. weak 模式过滤已熟练 ===');
const w1 = SRS.buildSession(p1, { count: 1000, mode: 'weak' });
t('weak 不包含已熟练词', !w1.some(x => x.item.w === 'acid'));
t('weak 包含错词', w1.some(x => x.item.w === 'ability'));

console.log('\n=== 8. 统计 ===');
const st = SRS.statsFor(p1);
t('statistics 总数正确', st.total === p1.length, 'got ' + st.total);
t('已练数量 = 2', (st.total - st['new']) === 2, 'got ' + (st.total - st['new']));
t('平均正确率在 0-1', st.avgAcc >= 0 && st.avgAcc <= 1, 'got ' + st.avgAcc);

console.log('\n=== 9. 持久化 ===');
SRS.save();
t('写入 localStorage', !!store['ielts_tingxie_srs_v1']);
const saved = JSON.parse(store['ielts_tingxie_srs_v1']);
t('保存了 ability 记录', !!saved['p1|ability']);

console.log('\n----------------------------------------');
console.log(pass + ' passed, ' + fail + ' failed');
/* srs.js 里有一个 setInterval 自动保存，会挂住 node 事件循环，这里显式退出 */
process.exit(fail ? 1 : 0);
