/* ============================================================
 * 上线前检查（GitHub Pages / 自定义域名 通用）
 *   node tools/check_pages.js
 *
 * 检查项：
 *   1. HTML 标签是否配平
 *   2. 全部站内引用（HTML + CSS）的路径与大小写是否与磁盘一致
 *      —— Windows 不区分大小写、GitHub Pages 跑在 Linux 上严格区分，
 *         这是"本地正常、上线白屏/404"的最常见原因
 *   3. Pages 部署必备条件：根目录 index.html、.nojekyll
 *   4. 域名无关性：站内不得写死 github.io 等主机名，保证换自定义域名可用
 *   5. 在线/本地模式判定：class 名在 HTML 与 CSS 中是否一致，
 *      并验证判定逻辑在各种访问场景下是否符合预期
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTML_FILES = ['index.html', 'apps/ielts-sentences/index.html', 'apps/tingxie/index.html'];
const CSS_FILES = ['css/style.css', 'apps/ielts-sentences/styles.css', 'apps/tingxie/css/style.css'];

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS  ' + m); };
const bad = (m) => { fail++; console.log('  FAIL  ' + m); };
const section = (t) => console.log('\n' + t);

/* ---------- 1. HTML 标签配平 ---------- */
section('1. HTML 标签配平');
const VOID = new Set(['meta', 'link', 'br', 'hr', 'img', 'input', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr']);
for (const rel of HTML_FILES) {
  const html = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '');
  const stack = [], errs = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const closing = m[1] === '/', tag = m[2].toLowerCase(), self = m[4] === '/';
    if (VOID.has(tag) || self) continue;
    if (!closing) stack.push(tag);
    else if (!stack.length) errs.push('多余的 </' + tag + '>');
    else if (stack.pop() !== tag) errs.push('标签不匹配 </' + tag + '>');
  }
  stack.forEach(t => errs.push('未闭合 <' + t + '>'));
  errs.length ? bad(rel + ' -> ' + errs.join('; ')) : ok(rel);
}

/* ---------- 2. 站内引用的大小写 ---------- */
section('2. 站内引用路径与大小写');
function checkRel(relPath) {
  const parts = relPath.replace(/\\/g, '/').split('/').filter(s => s && s !== '.');
  let cur = ROOT;
  for (const seg of parts) {
    let entries;
    try { entries = fs.readdirSync(cur); } catch (e) { return '目录不可读: ' + cur; }
    if (entries.includes(seg)) { cur = path.join(cur, seg); continue; }
    const ci = entries.find(e => e.toLowerCase() === seg.toLowerCase());
    return ci ? `大小写不符：引用 "${seg}"，实际为 "${ci}"` : `不存在："${seg}"`;
  }
  return null;
}
let refCount = 0;
const refProblems = [];
for (const rel of HTML_FILES.concat(CSS_FILES)) {
  const isCss = rel.endsWith('.css');
  const dirRel = path.posix.dirname(rel.replace(/\\/g, '/'));
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const re = isCss ? /url\(\s*['"]?([^'")]+)['"]?\s*\)/g : /(?:src|href|data-src)\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const url = m[1];
    if (/^(https?:|mailto:|#|data:|javascript:|\/\/)/.test(url)) continue;
    const clean = url.split('?')[0].split('#')[0];
    if (!clean) continue;
    const targetRel = path.posix.normalize(path.posix.join(dirRel === '.' ? '' : dirRel, clean));
    if (targetRel.startsWith('..')) continue;
    refCount++;
    const err = checkRel(targetRel);
    if (err) refProblems.push(`${rel}  ->  ${url}\n          ${err}`);
  }
}
refProblems.length
  ? refProblems.forEach(p => bad(p))
  : ok(`${refCount} 个站内引用的路径与大小写全部一致（Linux 上可正常加载）`);

/* ---------- 3. Pages 部署必备条件 ---------- */
section('3. Pages 部署必备条件');
fs.existsSync(path.join(ROOT, 'index.html')) ? ok('根目录存在 index.html（Deploy from a branch → / (root) 可用）') : bad('缺少根目录 index.html');
fs.existsSync(path.join(ROOT, '.nojekyll')) ? ok('存在 .nojekyll（跳过 Jekyll 处理）') : bad('缺少 .nojekyll');
fs.existsSync(path.join(ROOT, '.gitignore')) ? ok('存在 .gitignore（版权 PDF 等不入库）') : bad('缺少 .gitignore');

/* ---------- 4. 域名无关性 ---------- */
section('4. 域名无关性（自定义域名可用）');
const hardHosts = [];
for (const rel of HTML_FILES.concat(CSS_FILES)) {
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  // 允许 w3.org（SVG 命名空间标识，非网络请求）
  const hits = text.match(/https?:\/\/(?!www\.w3\.org)[a-zA-Z0-9.-]+/g) || [];
  hits.forEach(h => hardHosts.push(rel + ' -> ' + h));
}
hardHosts.length ? hardHosts.forEach(h => bad('写死了外部主机: ' + h)) : ok('站内没有写死任何外部主机名');

/* ---------- 5. 在线/本地模式判定 ---------- */
section('5. 在线 / 本地模式判定');
const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');
const mClass = idx.match(/classList\.add\('([a-z-]+)'\)/);
const modeClass = mClass ? mClass[1] : null;
if (!modeClass) bad('index.html 中未找到在线模式标记类名');
else {
  css.includes('html.' + modeClass) ? ok(`类名一致：HTML 用 "${modeClass}"，CSS 选择器 html.${modeClass} 存在`) : bad(`CSS 中缺少 html.${modeClass} 选择器`);
  idx.includes('res-item local-only') ? ok('本地专属资料已标记 local-only（在线时置灰）') : bad('未找到 local-only 标记');
  css.includes('local-only-hint') ? ok('在线提示条样式存在') : bad('缺少 local-only-hint 样式');
}
// 判定逻辑验证（与 index.html 中的实现保持一致）
function isLocal(protocol, hostname) {
  const h = (hostname || '').toLowerCase(), p = protocol;
  return p === 'file:' ||
    h === '' || h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' ||
    /^192\.168\./.test(h) || /^10\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /\.local$/.test(h);
}
const cases = [
  ['file:', '', true], ['http:', 'localhost', true], ['http:', '127.0.0.1', true],
  ['http:', '192.168.1.20', true], ['http:', '10.0.0.5', true],
  ['https:', 'jeremy94264.github.io', false], ['https:', 'ielts.example.com', false],
  ['https:', 'myielts.top', false], ['https:', 'site.pages.dev', false],
];
const wrong = cases.filter(([p, h, want]) => isLocal(p, h) !== want);
wrong.length
  ? wrong.forEach(([p, h]) => bad(`判定错误: ${p}//${h}`))
  : ok(`${cases.length} 种访问场景判定全部正确（file://、localhost、内网 → 本地；任意公网域名 → 在线）`);

/* ---------- 汇总 ---------- */
console.log('\n' + '='.repeat(52));
console.log(`  上线前检查结果: ${pass} 通过, ${fail} 失败`);
console.log('='.repeat(52));
process.exitCode = fail ? 1 : 0;
