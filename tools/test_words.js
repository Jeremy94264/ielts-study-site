/* 单词复习模块测试：掌握度星级 + 三色进度条 + 排序筛选
 * 单次加载 app.js，进度状态通过预置 localStorage 注入，避免多实例干扰
 */
const fs = require('fs');
const vm = require('vm');
const BASE = 'D:/dsh workspace';

class FakeClassList {
  constructor() { this.set = new Set(); this.log = []; }
  add(...cs) { cs.forEach(c => { this.set.add(c); this.log.push('+' + c); }); }
  remove(...cs) { cs.forEach(c => { this.set.delete(c); this.log.push('-' + c); }); }
  contains(c) { return this.set.has(c); }
  toggle(c, f) { const on = f === undefined ? !this.set.has(c) : !!f; on ? this.set.add(c) : this.set.delete(c); return on; }
}
class FakeEl {
  constructor(id) {
    this.id = id; this.innerHTML = ''; this.textContent = ''; this.value = '';
    this.style = {}; this.dataset = {}; this.classList = new FakeClassList();
    this._handlers = {}; this.checked = false; this.attrs = {};
  }
  addEventListener(t, fn) { (this._handlers[t] = this._handlers[t] || []).push(fn); }
  trigger(t, ev) { const e = Object.assign({ stopPropagation(){}, preventDefault(){}, target: this }, ev || {}); (this._handlers[t] || []).forEach(fn => fn(e)); }
  appendChild(c) { return c; }
  remove() {}
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return (k in this.attrs) ? this.attrs[k] : null; }
}

const els = {};
const getEl = id => els[id] || (els[id] = new FakeEl(id));
['stats-bar','progress-summary','cat-progress','due-list','card-session-info','session-done','flashcard',
 'card-word','card-star','card-front','card-word-back','card-pos','card-meaning','card-syn','answer-buttons','pron-note',
 'session-done-text','btn-again','btn-hard','btn-good','btn-continue','mode-cards','mode-list','word-list',
 'search-input','btn-pron-uk','btn-pron-us','btn-settings','settings-modal','btn-settings-close',
 'accent-uk','accent-us','auto-speak','speech-rate','rate-value','btn-reset-progress','tts-status',
 'count-all','count-t1','count-t2','count-t3',
 'sub-s538','sub-s100','frame-s100','frame-tingxie'].forEach(getEl);

// 七大模块 section
const MODULES = ['words','grammar','listening','reading','writing','speaking','materials'];
MODULES.forEach(m => getEl('section-' + m));

// 内嵌 iframe 的 data-src（模拟 HTML 上的 data-src 属性）
getEl('frame-s100').dataset.src = 'apps/ielts-sentences/index.html?embed=1';
getEl('frame-tingxie').dataset.src = 'apps/tingxie/index.html?embed=1';

const navBtns = MODULES.map(s => { const b = new FakeEl('nav-'+s); b.dataset.section = s; return b; });
const tabCards = new FakeEl('tab-cards'); tabCards.dataset.mode = 'cards';
const tabList = new FakeEl('tab-list'); tabList.dataset.mode = 'list';
const subTabBtns = ['s538','s100'].map(s => { const b = new FakeEl('subtab-'+s); b.dataset.sub = s; return b; });
const scopeBtns = ['all','第1类考点词','第2类考点词','第3类考点词'].map(s => { const b = new FakeEl('scope-'+s); b.dataset.scope = s; return b; });
const starBtns = ['all','5','4','3','2','1'].map(v => { const b = new FakeEl('star-'+v); b.dataset.star = v; return b; });
const typeBtns = ['all','第1类考点词','第2类考点词','第3类考点词'].map(v => { const b = new FakeEl('type-'+v); b.dataset.type = v; return b; });
const sortBtns = ['alpha','star-desc','star-asc'].map(v => { const b = new FakeEl('sort-'+v); b.dataset.sort = v; return b; });

const doc = {
  getElementById: getEl,
  querySelector: sel => { const m = sel.match(/#([^\s.#\[]+)/); return getEl(m ? m[1] : 'stub'); },
  querySelectorAll: sel => {
    if (sel === '.nav-btn[data-section]') return navBtns;
    if (sel === '.nav-btn') return navBtns.concat([getEl('btn-settings')]);
    if (sel === '.mode-tab') return [tabCards, tabList];
    if (sel === '.mode-panel') return [getEl('mode-cards'), getEl('mode-list')];
    if (sel === '.section') return MODULES.map(m => getEl('section-' + m));
    if (sel.indexOf('word-subtabs') >= 0) return subTabBtns;
    if (sel.indexOf('scope-btns') >= 0) return scopeBtns;
    if (sel.indexOf('star-filter') >= 0) return starBtns;
    if (sel.indexOf('type-filter') >= 0) return typeBtns;
    if (sel.indexOf('sort-group') >= 0) return sortBtns;
    return [];
  },
  addEventListener(t, fn) { if (t === 'DOMContentLoaded') doc._loaded = fn; },
  createElement: () => new FakeEl('dyn'), body: new FakeEl('body'),
};

const DAY = 86400000;
const FUTURE = Date.now() + 20 * DAY;
// 预置进度：id1=5★  id2=3★  id3=2★  id4=1★(有不认识记录)  id21(第2类)=4★
const seeded = {
  1:  { rep: 5, interval: 24, due: FUTURE, status: 'mastered' }, // 5★ 绿
  2:  { rep: 1, interval: 3,  due: FUTURE, status: 'review'   }, // 3★ 绿
  3:  { rep: 1, interval: 1,  due: FUTURE, status: 'review'   }, // 2★ 黄
  4:  { rep: 0, interval: 0,  due: Date.now() - 1000, status: 'learning' }, // 1★ 黄（有不认识记录）
  21: { rep: 2, interval: 6,  due: FUTURE, status: 'review'   }, // 4★ 绿（第2类）
};

const spoken = [];
class Utterance { constructor(t) { this.text = t; this.lang = ''; this.rate = 1; this.voice = null; } }
const store = { ielts_words_progress_v1: JSON.stringify(seeded) };
const localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };

// window（= vm 全局）上的事件与 location 桩，用于验证模块路由
const winHandlers = {};
let _hash = '';
const locationStub = {
  get hash() { return _hash ? (_hash.charAt(0) === '#' ? _hash : '#' + _hash) : ''; },
  set hash(v) { _hash = String(v).replace(/^#/, ''); }   // 模拟浏览器：赋值自动补 #
};

const ctx = {
  document: doc, localStorage, window: {}, console, setTimeout, clearTimeout, Date, Math, JSON,
  location: locationStub,
  addEventListener: (t, fn) => { (winHandlers[t] = winHandlers[t] || []).push(fn); },
  speechSynthesis: { getVoices: () => [{ name: 'Google UK English Female', lang: 'en-GB' }, { name: 'Google US English', lang: 'en-US' }], speak: u => spoken.push({ text: u.text, lang: u.lang, rate: u.rate, voice: u.voice ? u.voice.name : null }), cancel(){}, onvoiceschanged: null },
  SpeechSynthesisUtterance: Utterance, confirm: () => true,
};
vm.createContext(ctx);
vm.runInContext('this.window = this;', ctx);
vm.runInContext(fs.readFileSync(BASE + '/js/words-data.js', 'utf8'), ctx);
const W = vm.runInContext('IELTS_WORDS', ctx);
vm.runInContext(fs.readFileSync(BASE + '/js/app.js', 'utf8'), ctx);
doc._loaded();

let pass = 0, fail = 0;
function assert(c, m) { if (c) { pass++; console.log('PASS - ' + m); } else { fail++; console.log('FAIL - ' + m); } }
const stripTags = s => String(s).replace(/<[^>]*>/g, '');
function catRows() {
  // 拆出每个类别的三段宽度与图例计数
  const html = getEl('cat-progress').innerHTML;
  const rows = html.split('cat-progress-row').slice(1);
  return rows.map(r => ({
    green: parseFloat((r.match(/seg-green" style="width:([\d.]+)%/) || [])[1] || 0),
    yellow: parseFloat((r.match(/seg-yellow" style="width:([\d.]+)%/) || [])[1] || 0),
    red: parseFloat((r.match(/seg-red" style="width:([\d.]+)%/) || [])[1] || 0),
    legend: ['已掌握', '学习中', '未学习'].map(k => k + '=' + ((r.match(new RegExp('lg lg-(green|yellow|red)">' + k + ' (\\d+)')) || [])[2] || '?')).join(' '),
  }));
}
function listWords() {
  return [...getEl('word-list').innerHTML.matchAll(/<div class="w-word">([^<]*)/g)].map(x => x[1].trim());
}
// 按类别分组解析（词汇表为"类别分组 + 组内排序"）
function listGroups() {
  const html = getEl('word-list').innerHTML;
  const parts = html.split('<div class="word-group-title">').slice(1);
  return parts.map(p => {
    const title = (p.match(/^([^<]*)/) || [])[1].trim();
    const words = [...p.matchAll(/<div class="w-word">([^<]*)/g)].map(x => x[1].trim());
    return { title, words };
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  /* ===== 1. 词库 ===== */
  assert(W.length === 376, '词库376词');
  assert(!W.some(w => 'star' in w), '词库已移除重要性star字段（重要性由类别体现）');

  /* ===== 2. 掌握度星级（由进度换算） ===== */
  assert(getEl('card-star').innerHTML.indexOf('当前掌握度') >= 0, '卡片正面显示掌握度星级');
  const shownWord = getEl('card-word').textContent;
  const shownObj = W.find(w => w.word === shownWord);
  const filled = (getEl('card-star').innerHTML.match(/★/g) || []).length - (getEl('card-star').innerHTML.match(/empty/g) || []).length;
  const st = seeded[shownObj.id] ? (seeded[shownObj.id].interval >= 12 ? 5 : seeded[shownObj.id].interval >= 6 ? 4 : seeded[shownObj.id].interval >= 3 ? 3 : seeded[shownObj.id].interval >= 1 ? 2 : 1) : 1;
  assert(filled === st, '卡片星级与进度一致（' + shownWord + ' = ' + st + '★）');

  /* ===== 3. 三色分段进度条 ===== */
  const rows = catRows();
  assert(rows.length === 3, '侧栏显示三类考点词');
  // 第1类20词：绿2(5★,3★) 黄2(2★,1★) 红16
  assert(rows[0].green === 10, '第1类绿段=10%（2/20 掌握度≥3★）实际 ' + rows[0].green);
  assert(rows[0].yellow === 10, '第1类黄段=10%（2/20 掌握度1-2★）实际 ' + rows[0].yellow);
  assert(rows[0].red === 80, '第1类红段=80%（16/20 未学习）实际 ' + rows[0].red);
  assert(rows[0].legend === '已掌握=2 学习中=2 未学习=16', '第1类图例计数: ' + rows[0].legend);
  // 第2类100词：绿1(4★) 黄0 红99
  assert(rows[1].green === 1 && rows[1].yellow === 0 && rows[1].red === 99, '第2类 1%/0%/99% 实际 ' + rows[1].green + '/' + rows[1].yellow + '/' + rows[1].red);
  // 第3类256词：全红
  assert(rows[2].green === 0 && rows[2].yellow === 0 && rows[2].red === 100, '第3类全红（未学习）');
  const sumOk = rows.every(r => Math.abs(r.green + r.yellow + r.red - 100) < 0.01);
  assert(sumOk, '三段宽度合计均为100%');

  /* ===== 4. 词汇表：排序（类别分组 + 组内排序） ===== */
  tabList.trigger('click');
  sortBtns.find(b => b.dataset.sort === 'alpha').trigger('click');
  let words = listWords();
  assert(words.length === 376, '词汇表显示376词');
  let groups = listGroups();
  assert(groups.length === 3 && groups[0].title === '第1类考点词' && groups[2].title === '第3类考点词', '按三类考点词分组显示');
  const eachGroupSorted = groups.every(g => JSON.stringify(g.words) === JSON.stringify(g.words.slice().sort((a, b) => a.localeCompare(b))));
  assert(eachGroupSorted, '字母顺序排序正确（每组内 A→Z，第1类首词 ' + groups[0].words[0] + '）');
  assert(groups[0].words.length === 20 && groups[1].words.length === 100 && groups[2].words.length === 256, '各组词数 20/100/256');

  sortBtns.find(b => b.dataset.sort === 'star-desc').trigger('click');
  groups = listGroups();
  const g1Desc = groups[0].words;
  assert(g1Desc[0] === 'resemble' && g1Desc[1] === 'recognize' && g1Desc[2] === 'adjust', '第1类按掌握度降序：5★resemble → 3★recognize → 2★adjust（实际 ' + g1Desc.slice(0, 3).join(',') + '）');
  assert(groups[1].words[0] === 'diversity', '第2类首位为4★词 diversity（实际 ' + groups[1].words[0] + '）');

  sortBtns.find(b => b.dataset.sort === 'star-asc').trigger('click');
  groups = listGroups();
  const g1Asc = groups[0].words;
  assert(g1Asc[g1Asc.length - 1] === 'resemble' && g1Asc[g1Asc.length - 2] === 'recognize', '第1类按掌握度升序：高星词在末尾（末尾 ' + g1Asc.slice(-2).join(',') + '）');
  assert(g1Asc[0] === 'and', '最低星词排最前（实际 ' + g1Asc[0] + '）');

  /* ===== 5. 词汇表：掌握度筛选 ===== */
  sortBtns.find(b => b.dataset.sort === 'alpha').trigger('click');
  const expect = { 5: ['resemble'], 4: ['diversity'], 3: ['recognize'], 2: ['adjust'] };
  Object.keys(expect).forEach(k => {
    starBtns.find(b => b.dataset.star === k).trigger('click');
    const got = listWords();
    assert(got.length === 1 && got[0] === expect[k][0], '筛选' + k + '★ → ' + expect[k][0] + '（实际 ' + got.join(',') + '）');
  });
  starBtns.find(b => b.dataset.star === '1').trigger('click');
  assert(listWords().length === 372, '筛选1★ → 372词（376-4）实际 ' + listWords().length);
  starBtns.find(b => b.dataset.star === 'all').trigger('click');

  /* ===== 6. 类别筛选 + 排序组合 ===== */
  typeBtns.find(b => b.dataset.type === '第1类考点词').trigger('click');
  assert(listWords().length === 20, '类别筛选第1类=20词');
  typeBtns.find(b => b.dataset.type === 'all').trigger('click');

  /* ===== 7. 状态徽章与颜色一致 ===== */
  const html = getEl('word-list').innerHTML;
  assert(html.indexOf('w-badge mastered') >= 0, '掌握度≥3★显示"✓已掌握"绿色徽章');
  assert(html.indexOf('w-badge learning') >= 0, '掌握度1-2★（有记录）显示"学习中"徽章');
  const masteredBadges = (html.match(/w-badge mastered/g) || []).length;
  assert(masteredBadges === 3, '已掌握徽章数量=3（5★+4★+3★）实际 ' + masteredBadges);

  /* ===== 8. 通过作答更新掌握度星级（UI流程） ===== */
  scopeBtns.find(b => b.dataset.scope === '第3类考点词').trigger('click'); // 第3类全部未学习
  const before = getEl('card-word').textContent;
  const beforeObj = W.find(w => w.word === before);
  assert(!seeded[beforeObj.id], '第3类抽到未学习词: ' + before);
  getEl('flashcard').trigger('click');
  getEl('btn-good').trigger('click');
  const saved = JSON.parse(store['ielts_words_progress_v1']);
  assert(saved[beforeObj.id] && saved[beforeObj.id].interval === 3, '作答"已掌握"后 interval=3');
  const afterRows = catRows();
  assert(Math.abs(afterRows[2].green - 0.390625) < 0.001, '第3类绿段=1/256≈0.39%（实际 ' + afterRows[2].green + '）');

  await sleep(420);
  const nextWord = getEl('card-word').textContent;
  assert(nextWord !== before, '自动切换到下一个单词: ' + nextWord);

  /* ===== 9. 发音 + 复习范围 + 设置（回归验证） ===== */
  spoken.length = 0;
  scopeBtns.find(b => b.dataset.scope === '第1类考点词').trigger('click');
  assert(spoken.length >= 1 && spoken[spoken.length - 1].lang === 'en-GB', '默认英音自动朗读（回归）');
  const cur = getEl('card-word').textContent;
  assert(W.filter(w => w.type === '第1类考点词').map(w => w.word).indexOf(cur) >= 0, '第1类范围抽词正确: ' + cur);

  spoken.length = 0;
  getEl('btn-pron-us').trigger('click');
  assert(spoken.length === 1 && spoken[0].lang === 'en-US' && spoken[0].text === cur, '点击"美音"→ 当前词 en-US');
  spoken.length = 0;
  getEl('btn-pron-uk').trigger('click');
  assert(spoken.length === 1 && spoken[0].lang === 'en-GB', '点击"英音"→ en-GB');

  getEl('btn-settings').trigger('click');
  assert(!getEl('settings-modal').classList.contains('hidden'), '打开设置弹窗（回归）');
  getEl('accent-us').checked = true;
  getEl('accent-us').trigger('change');
  assert(JSON.parse(store['ielts_settings_v1']).accent === 'us', '默认发音改为美音并保存');

  spoken.length = 0;
  scopeBtns.find(b => b.dataset.scope === '第2类考点词').trigger('click');
  assert(spoken.length >= 1 && spoken[spoken.length - 1].lang === 'en-US', '默认改美音后自动朗读使用 en-US');

  getEl('auto-speak').checked = false;
  getEl('auto-speak').trigger('change');
  spoken.length = 0;
  scopeBtns.find(b => b.dataset.scope === '第3类考点词').trigger('click');
  assert(spoken.length === 0, '关闭自动朗读后不自动发音');

  getEl('auto-speak').checked = true;
  getEl('auto-speak').trigger('change');
  getEl('speech-rate').value = '0.7';
  getEl('speech-rate').trigger('input', { target: { value: '0.7' } });
  spoken.length = 0;
  getEl('btn-pron-uk').trigger('click');
  assert(spoken.length === 1 && Math.abs(spoken[0].rate - 0.7) < 1e-6, '语速 0.7 生效');
  getEl('btn-settings-close').trigger('click');
  assert(getEl('settings-modal').classList.contains('hidden'), '关闭设置弹窗');

  /* ===== 10. 清除进度后三色条复位 ===== */
  getEl('btn-reset-progress').trigger('click');
  assert(Object.keys(JSON.parse(store['ielts_words_progress_v1'])).length === 0, '清除学习进度生效');
  const rowsReset = catRows();
  assert(rowsReset.every(r => r.red === 100), '清除后三类均回到100%红（未学习）');

  /* ===== 11. 切换单词时不泄露答案（卡片复位顺序） ===== */
  scopeBtns.find(b => b.dataset.scope === '第3类考点词').trigger('click');
  const cardCl = getEl('flashcard').classList;
  assert(!cardCl.contains('flipped'), '新卡片初始为正面（未翻转）');
  // 翻面查看答案
  getEl('flashcard').trigger('click');
  assert(cardCl.contains('flipped'), '点击卡片翻面显示答案');
  assert(!getEl('answer-buttons').classList.contains('hidden'), '翻面后出现作答按钮');
  // 记录切换过程中的 class 操作顺序
  cardCl.log = [];
  getEl('btn-good').trigger('click');
  await sleep(420);
  const log = cardCl.log.join(' ');
  const iNoAnim = cardCl.log.indexOf('+no-anim');
  const iUnflip = cardCl.log.indexOf('-flipped');
  const iRestore = cardCl.log.indexOf('-no-anim');
  assert(iNoAnim >= 0 && iUnflip > iNoAnim, '切换时先禁用过渡(+no-anim)再复位(-flipped)：' + log);
  assert(iRestore > iUnflip, '复位后恢复过渡，翻面动画仍可用：' + log);
  assert(!cardCl.contains('flipped'), '切换后卡片直接显示正面（答案不泄露）');
  assert(getEl('answer-buttons').classList.contains('hidden'), '切换后作答按钮保持隐藏');
  assert(getEl('card-front').classList.contains('enter'), '新单词带淡入动画');
  // 再次点击仍可正常翻面
  getEl('flashcard').trigger('click');
  assert(cardCl.contains('flipped'), '切换后仍可正常翻面查看答案');

  /* ===== 12. 七大模块与子模块路由 ===== */
  assert(getEl('section-words').classList.contains('active'), '默认显示「单词」模块');
  assert(getEl('sub-s538').classList.contains('active') && !getEl('sub-s100').classList.contains('active'), '默认显示子模块「阅读538词汇」');
  assert(locationStub.hash === '#words/s538', '地址 hash = #words/s538（实际 ' + locationStub.hash + '）');

  assert(navBtns.length === 7, '顶部导航共 7 个模块');
  const modNames = navBtns.map(b => b.dataset.section).join(',');
  assert(modNames === 'words,grammar,listening,reading,writing,speaking,materials', '模块顺序：' + modNames);

  // 听力模块：iframe 懒加载
  assert(getEl('frame-tingxie').getAttribute('src') === null, '听力内嵌页初始未加载（懒加载）');
  navBtns.find(b => b.dataset.section === 'listening').trigger('click');
  assert(getEl('section-listening').classList.contains('active') && !getEl('section-words').classList.contains('active'), '切换到「听力」模块');
  assert(getEl('frame-tingxie').getAttribute('src') === 'apps/tingxie/index.html?embed=1', '听力内嵌页按需加载：' + getEl('frame-tingxie').getAttribute('src'));
  assert(locationStub.hash === '#listening', 'hash = #listening（实际 ' + locationStub.hash + '）');

  // 五个占位模块均可切换
  let allOk = true;
  ['grammar', 'reading', 'writing', 'speaking', 'materials'].forEach((m) => {
    navBtns.find(b => b.dataset.section === m).trigger('click');
    if (!getEl('section-' + m).classList.contains('active')) allOk = false;
  });
  assert(allOk, '语法 / 阅读 / 写作 / 口语 / 资料 五个模块均可切换');

  // 单词模块的第二个子模块
  navBtns.find(b => b.dataset.section === 'words').trigger('click');
  assert(getEl('frame-s100').getAttribute('src') === null, '100句内嵌页初始未加载（懒加载）');
  subTabBtns.find(b => b.dataset.sub === 's100').trigger('click');
  assert(getEl('sub-s100').classList.contains('active') && !getEl('sub-s538').classList.contains('active'), '切换到子模块「100句记7000词」');
  assert(getEl('frame-s100').getAttribute('src') === 'apps/ielts-sentences/index.html?embed=1', '100句内嵌页按需加载');
  assert(locationStub.hash === '#words/s100', 'hash = #words/s100（实际 ' + locationStub.hash + '）');

  // 切回 538 子模块，闪卡功能不受影响
  subTabBtns.find(b => b.dataset.sub === 's538').trigger('click');
  assert(getEl('sub-s538').classList.contains('active'), '切回子模块「阅读538词汇」');
  assert(getEl('card-word').textContent !== '—', '切回后闪卡仍显示单词：' + getEl('card-word').textContent);

  // 深链接 / 前进后退（hashchange）
  locationStub.hash = '#listening';
  (winHandlers.hashchange || []).forEach(fn => fn());
  assert(getEl('section-listening').classList.contains('active'), '深链接 #listening 生效');
  locationStub.hash = '#materials';
  (winHandlers.hashchange || []).forEach(fn => fn());
  assert(getEl('section-materials').classList.contains('active'), '深链接 #materials 生效');
  locationStub.hash = '#words/s100';
  (winHandlers.hashchange || []).forEach(fn => fn());
  assert(getEl('section-words').classList.contains('active') && getEl('sub-s100').classList.contains('active'), '深链接 #words/s100 生效');
  locationStub.hash = '#unknown-module';
  (winHandlers.hashchange || []).forEach(fn => fn());
  assert(getEl('section-words').classList.contains('active'), '无效 hash 回退到「单词」模块');

  console.log('\n========== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ==========');
  process.exitCode = fail ? 1 : 0;
})();

