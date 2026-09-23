/* =====================================================================
   100个句子记完7000个雅思单词 · 交互逻辑
   四种模式：句子翻译 / 语法结构 / 重点单词 / 主题单词
   ===================================================================== */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const state = {
    unitIndex: 0,
    mode: null,          // 'translation' | 'grammar' | 'vocab' | 'theme'
    activeWord: null,    // 重点单词模式下选中的词条 w
    activeTheme: 0       // 主题单词模式下选中的分组下标
  };

  /* ------------------------------------------------------------------
     一、把句子切成「词元」，用于重点单词模式的下划线标注
     ------------------------------------------------------------------ */

  /* 生成某个词条的候选匹配形式（含常见词形变化，覆盖本文件实际出现的形态） */
  function wordForms(w) {
    const s = new Set();
    const add = (x) => { if (x) s.add(x); };
    const low = w.toLowerCase();
    add(low);

    const head = low.split(/\s+/)[0];   // 词组只对首个实词做变形
    const parts = low.split(/\s+/);

    if (head.endsWith('e')) {
      add(head + 'd');                                   // produce -> produced
      add(head.slice(0, -1) + 'ed');                     // produce -> produc+ed
      add(head.slice(0, -1) + 'ing');                    // produce -> producing
      add(head + 's');
    } else if (/[^aeiou]y$/.test(head)) {
      add(head.slice(0, -1) + 'ies');
    } else {
      add(head + 's');
      add(head + 'ed');
      add(head + 'ing');
      if (/[^aeiou][aeiou][^aeiouwxy]$/.test(head)) {
        add(head + head.slice(-1) + 'ed');               // stop -> stopped
        add(head + head.slice(-1) + 'ing');
      }
    }

    /* 本册出现的补充变形（含词组整体变形） */
    const EXTRA = {
      show: ['shown'], lead: ['led'], study: ['studied'],
      supply: ['supplies', 'supplied'], industry: ['industries'], sort: ['sorts'],
      stifle: ['stifled', 'stifles'], interrupt: ['interrupted'],
      operate: ['operates', 'operated'], display: ['displays'],
      suppress: ['suppressed'], evoke: ['evokes', 'evoked'], row: ['rows']
    };
    if (EXTRA[head]) EXTRA[head].forEach(add);

    /* 词组：优先整串匹配（含复数等整体变形），再退化为首词变形 */
    const out = new Set();
    if (parts.length > 1) {
      const tail = parts.slice(1).join(' ');
      out.add(low);
      out.add(head + 's ' + tail);        // world war -> world wars
      out.add(head + ' ' + parts.slice(1).map((p) => p + 's').join(' '));
      s.forEach((f) => out.add(f + ' ' + tail));
    } else {
      s.forEach((f) => out.add(f));
      add(head + 's');                    // 名词复数兜底
      add(head + 'es');
    }
    return Array.from(out).sort((a, b) => b.length - a.length);
  }

  /* 在句子中定位某个词条：返回 {start, end} 或 null */
  function locate(sentence, item) {
    const forms = wordForms(item.w);
    for (const f of forms) {
      const re = new RegExp('(?<![A-Za-z])' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z])', 'i');
      const m = re.exec(sentence);
      if (m) return { start: m.index, end: m.index + m[0].length, form: m[0] };
    }
    /* 词组兜底：退化为首个实词（仅限常见实词，不含介词/冠词，避免误标注） */
    const STOP = new Set(['in', 'on', 'at', 'of', 'to', 'the', 'a', 'an', 'with', 'by', 'for', 'and', 'as']);
    if (/\s/.test(item.w)) {
      const head = item.w.split(/\s+/)[0];
      if (!STOP.has(head.toLowerCase())) {
        const re = new RegExp('(?<![A-Za-z])' + head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z])', 'i');
        const m = re.exec(sentence);
        if (m) return { start: m.index, end: m.index + m[0].length, form: m[0] };
      }
    }
    return null;
  }

  /* 为某个单元建立「重点单词 → 句子区间」映射（区间互不重叠） */
  function buildVocabMap(unit) {
    const found = unit.vocab.map((item) => ({ item, hit: locate(unit.sentence, item) }))
                            .filter((r) => r.hit);
    found.sort((a, b) => b.hit.end - b.hit.start - (a.hit.end - a.hit.start));
    const taken = [];
    const kept = [];
    for (const r of found) {
      if (taken.some((t) => r.hit.start < t.end && t.start < r.hit.end)) continue;
      taken.push(r.hit); kept.push(r);
    }
    kept.sort((a, b) => a.hit.start - b.hit.start);
    return kept;
  }

  /* 依据 vocab 区间把句子切成 HTML：重点词用红色下划线，其余为普通文本 */
  function renderVocabSentence(unit, map) {
    const s = unit.sentence;
    let html = '', cursor = 0;
    map.forEach(({ item, hit }) => {
      if (hit.start > cursor) html += spanFiller(s.slice(cursor, hit.start));
      html += `<span class="word key" data-word="${escapeAttr(item.w)}">${escapeHtml(hit.form)}</span>`;
      cursor = hit.end;
    });
    if (cursor < s.length) html += spanFiller(s.slice(cursor));
    return html;
  }

  /* 非重点部分也按单词切分，保证只有核心词是红色下划线 */
  function spanFiller(text) {
    return text.replace(/[A-Za-z][A-Za-z'’\-]*/g, (m) => `<span class="word filler">${m}</span>`)
               .replace(/\n/g, ' ');
  }

  /* ------------------------------------------------------------------
     二、句子块渲染
     ------------------------------------------------------------------ */

  function renderSentence() {
    const unit = UNITS[state.unitIndex];
    const block = $('sentenceBlock');
    const legend = $('legend');

    block.className = 'sentence-block';

    /* 荧光笔图例只在「语法结构」模式下出现，其余模式一律隐藏并清空 */
    function hideLegend() {
      if (!legend) return;
      legend.hidden = true;
      legend.innerHTML = '';
    }

    /* --- 模式一：句子翻译 → 纯句子 --- */
    if (state.mode === 'translation') {
      hideLegend();
      block.innerHTML = `<p class="sentence-text mode-translation">${escapeHtml(unit.sentence)}</p>`;
      return;
    }

    /* --- 模式二：语法结构 → 荧光笔切分 + 图例 --- */
    if (state.mode === 'grammar') {
      const html = unit.segments.map((seg) => {
        const tag = TAGS[seg.tag] || { color: 'transparent', label: seg.tag };
        const cls = seg.tag === 'main' && seg.t.trim().length < 2 ? 'seg plain' : 'hl';
        const style = seg.tag === 'conj' ? 'background:transparent;font-weight:700;color:#7a4df0;'
                                         : `background:${tag.color};`;
        return `<span class="${cls}" style="${style}" title="${escapeAttr(tag.label || '')}">${escapeHtml(seg.t)}</span>`;
      }).join('');
      block.innerHTML = `<p class="sentence-text mode-grammar">${html}</p>`;

      if (legend) {
        const used = [];
        unit.segments.forEach((s) => { if (!used.includes(s.tag)) used.push(s.tag); });
        legend.innerHTML =
          `<span class="legend-note">荧光笔图例（把鼠标停在句子上可查看结构名称）：</span>` +
          used.map((t) => {
            const tag = TAGS[t] || { color: '#eee', label: t };
            return `<span class="legend-item"><i class="swatch" style="background:${tag.color}"></i>${escapeHtml(tag.label || t)}</span>`;
          }).join('');
        legend.hidden = false;
      }
      return;
    }

    /* --- 模式三：重点单词 → 红色下划线，可点击 --- */
    if (state.mode === 'vocab') {
      hideLegend();
      const map = buildVocabMap(unit);
      block.innerHTML = `<p class="sentence-text mode-vocab">${renderVocabSentence(unit, map)}</p>`;

      const active = state.activeWord;
      block.querySelectorAll('.word.key').forEach((el) => {
        if (active && el.dataset.word === active) el.classList.add('active');
        el.addEventListener('click', () => selectWord(el.dataset.word));
      });
      return;
    }

    /* --- 模式四：主题单词 → 句子只作语境，不加任何标记 --- */
    if (state.mode === 'theme') {
      hideLegend();
      block.innerHTML = `<p class="sentence-text mode-theme">${escapeHtml(unit.sentence)}</p>`;
      return;
    }

    /* --- 未选模式：静态展示句子 --- */
    hideLegend();
    block.innerHTML = `<p class="sentence-text mode-translation">${escapeHtml(unit.sentence)}</p>`;
  }

  /* ------------------------------------------------------------------
     三、内容块渲染
     ------------------------------------------------------------------ */

  function renderContent() {
    const unit = UNITS[state.unitIndex];
    const box = $('contentBlock');
    const title = $('contentTitle');
    const sub = $('contentSub');

    /* --- 空状态 --- */
    if (!state.mode) {
      title.textContent = '内容块';
      sub.textContent = '';
      box.innerHTML = `<div class="empty">
          <div class="big">▤</div>
          <b>请点击中间四个按钮中的一个</b>
          <div>句子翻译 · 语法结构 · 重点单词 · 主题单词</div>
        </div>`;
      return;
    }

    /* --- 模式一：句子翻译 --- */
    if (state.mode === 'translation') {
      title.textContent = '句子翻译';
      sub.textContent = '本句对应的中文翻译';
      box.innerHTML = `<div class="trans-card">
          <div>
            <div class="trans-label" style="margin-bottom:8px">参考译文</div>
            <div class="trans-cn">${escapeHtml(unit.translation)}</div>
          </div>
        </div>`;
      return;
    }

    /* --- 模式二：语法结构 --- */
    if (state.mode === 'grammar') {
      title.textContent = '语法结构';
      sub.textContent = '参考文档「语法笔记」一栏，对应上方句子的荧光笔标注';
      const rows = unit.segments
        .filter((s) => s.t.trim().length)
        .map((s) => {
          const tag = TAGS[s.tag] || { color: '#eee', label: s.tag };
          return `<div class="struct-row">
              <span class="struct-tag" style="background:${tag.color}">${escapeHtml(tag.label || s.tag)}</span>
              <span class="struct-text">${escapeHtml(s.t)}</span>
            </div>`;
        }).join('');
      box.innerHTML = `<div class="grammar-wrap">
          <div class="grammar-note">
            <span class="t">语法笔记</span>${escapeHtml(unit.grammarNote)}
          </div>
          <div class="section-title"><i class="bar"></i>句子结构逐段拆解</div>
          <div class="struct-list">${rows}</div>
        </div>`;
      return;
    }

    /* --- 模式三：重点单词 --- */
    if (state.mode === 'vocab') {
      title.textContent = '重点单词';
      sub.textContent = '文档「核心词表」一栏 · 点击句子中的红色下划线单词或下方词条';
      const chips = unit.vocab.map((v) =>
        `<button class="word-chip${state.activeWord === v.w ? ' active' : ''}" data-word="${escapeAttr(v.w)}">${escapeHtml(v.w)}</button>`
      ).join('');

      let detail;
      const item = unit.vocab.find((v) => v.w === state.activeWord);
      if (!item) {
        detail = `<div class="empty" style="min-height:110px">
            <div class="big">☝</div><b>点击句子中的红色下划线单词</b>
            <div>内容块将显示该单词在「核心词表」中的全部内容</div>
          </div>`;
      } else {
        detail = `<div class="detail-card">
            <div class="detail-head">
              <span class="detail-word">${escapeHtml(item.w)}</span>
              ${item.ph ? `<span class="detail-ph">${escapeHtml(item.ph)}</span>` : ''}
            </div>
            <div class="detail-body">
              <div class="detail-pos">${escapeHtml(item.pos || '')}</div>
              ${(item.extra || []).map((e) =>
                `<div class="extra"><span class="extra-k">【${escapeHtml(e.k)}】</span><span class="extra-v">${escapeHtml(e.v)}</span></div>`
              ).join('')}
            </div>
          </div>`;
      }

      box.innerHTML = `<div class="vocab-wrap">
          <div class="section-title"><i class="bar"></i>本句核心词表（${unit.vocab.length} 个词条）</div>
          <div class="vocab-strip">${chips}</div>
          ${detail}
        </div>`;
      box.querySelectorAll('.word-chip').forEach((el) =>
        el.addEventListener('click', () => selectWord(el.dataset.word)));
      return;
    }

    /* --- 模式四：主题单词 --- */
    if (state.mode === 'theme') {
      title.textContent = '主题单词';
      sub.textContent = '文档「主题归纳」一栏 · 选择分组查看该组全部单词';
      if (state.activeTheme >= unit.themes.length) state.activeTheme = 0;
      const group = unit.themes[state.activeTheme];
      const tabs = unit.themes.map((t, i) =>
        `<button class="theme-tab${i === state.activeTheme ? ' on' : ''}" data-theme="${i}">
           ${escapeHtml(t.title)}<span class="n">${t.words.length}</span>
         </button>`).join('');
      const cards = group.words.map((w) => `
        <div class="word-card">
          <div class="wc-top">
            <span class="wc-word">${escapeHtml(w.w)}</span>
            ${w.ph ? `<span class="wc-ph">${escapeHtml(w.ph)}</span>` : ''}
          </div>
          <div class="wc-pos">${escapeHtml(w.pos || '')}</div>
          ${(w.extra || []).map((e) =>
            `<div class="wc-extra"><span class="k">【${escapeHtml(e.k)}】</span>${escapeHtml(e.v)}</div>`).join('')}
        </div>`).join('');

      box.innerHTML = `<div class="theme-wrap">
          <div class="section-title"><i class="bar"></i>主题分组（共 ${unit.themes.length} 组）</div>
          <div class="theme-tabs">${tabs}</div>
          <div class="section-title"><i class="bar"></i>${escapeHtml(group.title)} · ${group.words.length} 个词</div>
          <div class="word-grid">${cards}</div>
        </div>`;
    /* 主题分组切换 */
    box.querySelectorAll('.theme-tab').forEach((el) =>
      el.addEventListener('click', () => {
        state.activeTheme = Number(el.dataset.theme);
        renderContent();
        renderSentence();
        writeHash();
      }));
      return;
    }
  }

  /* ------------------------------------------------------------------
     四、交互动作
     ------------------------------------------------------------------ */

  function selectWord(word) {
    state.activeWord = (state.activeWord === word) ? null : word;
    renderSentence();
    renderContent();
    writeHash();
    /* 让详情卡进入视野 */
    const card = document.querySelector('.detail-card');
    if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function setMode(mode) {
    /* 再次点击同一按钮 → 取消该模式 */
    state.mode = (state.mode === mode) ? null : mode;
    if (state.mode === 'vocab') state.activeWord = null;
    if (state.mode === 'theme') state.activeTheme = 0;

    document.querySelectorAll('.mode-btn').forEach((b) =>
      b.classList.toggle('on', b.dataset.mode === state.mode));

    const hintMap = {
      translation: '已切换：句子块显示原句，下方显示对应译文',
      grammar: '已切换：句子块用不同颜色荧光笔标出各语法结构',
      vocab: '已切换：点击句子中的红色下划线单词查看释义',
      theme: '已切换：选择分组，内容块显示该组全部主题单词'
    };
    $('modeHint').textContent = state.mode ? hintMap[state.mode] : '点击下方按钮切换学习模式';

    renderSentence();
    renderContent();
    writeHash();
  }

  function setUnit(index, keepMode) {
    const n = UNITS.length;
    state.unitIndex = ((index % n) + n) % n;
    state.activeWord = null;
    state.activeTheme = 0;

    const unit = UNITS[state.unitIndex];
    $('unitLabel').textContent = `Sentence ${String(unit.id).padStart(2, '0')}`;
    $('sourceLabel').textContent = unit.source;

    document.querySelectorAll('.chip').forEach((c, i) =>
      c.classList.toggle('on', i === state.unitIndex));

    renderSentence();
    renderContent();
    writeHash();
  }

  /* ------------------------------------------------------------------
     四·五、地址栏深链接：#u=3&m=vocab&w=issue&g=1
     ------------------------------------------------------------------ */
  function writeHash() {
    const p = new URLSearchParams();
    p.set('u', String(state.unitIndex + 1));
    if (state.mode) p.set('m', state.mode);
    if (state.mode === 'vocab' && state.activeWord) p.set('w', state.activeWord);
    if (state.mode === 'theme') p.set('g', String(state.activeTheme + 1));
    const next = '#' + p.toString();
    if (location.hash !== next) history.replaceState(null, '', next);
  }

  function readHash() {
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    const u = Number(p.get('u'));
    if (Number.isFinite(u) && u >= 1 && u <= UNITS.length) state.unitIndex = u - 1;

    const m = p.get('m');
    state.mode = ['translation', 'grammar', 'vocab', 'theme'].includes(m) ? m : null;

    state.activeWord = p.get('w') || null;
    const g = Number(p.get('g'));
    state.activeTheme = (Number.isFinite(g) && g >= 1) ? g - 1 : 0;

    document.querySelectorAll('.mode-btn').forEach((b) =>
      b.classList.toggle('on', b.dataset.mode === state.mode));

    const hintMap = {
      translation: '已切换：句子块显示原句，下方显示对应译文',
      grammar: '已切换：句子块用不同颜色荧光笔标出各语法结构',
      vocab: '已切换：点击句子中的红色下划线单词查看释义',
      theme: '已切换：选择分组，内容块显示该组全部主题单词'
    };
    $('modeHint').textContent = state.mode ? hintMap[state.mode] : '点击下方按钮切换学习模式';
  }

  /* ------------------------------------------------------------------
     五、初始化
     ------------------------------------------------------------------ */

  function init() {
    /* 句子总数（用于提示与跳转） */
    document.title = `100个句子记完7000个雅思单词 · Sentence 01–${String(UNITS.length).padStart(2, '0')}`;
    const sub = document.querySelector('.brand-text p');
    if (sub) sub.innerHTML = `Sentence 01 – ${UNITS.length} &nbsp;·&nbsp; 每句一单元：翻译 / 语法结构 / 重点单词 / 主题单词`;

    /* 单元选择按钮：每 10 句一组 */
    const chipHtml = [];
    UNITS.forEach((u, i) => {
      if (i % 10 === 0) chipHtml.push(`<span class="chip-group">${Math.floor(i / 10) + 1}</span>`);
      chipHtml.push(
        `<button class="chip${i === 0 ? ' on' : ''}" title="${escapeAttr(u.sentence.slice(0, 46))}…">
           ${String(u.id).padStart(2, '0')}
         </button>`);
    });
    $('unitChips').innerHTML = chipHtml.join('');
    $('unitChips').querySelectorAll('.chip').forEach((el, i) =>
      el.addEventListener('click', () => setUnit(i)));

    $('prevUnit').addEventListener('click', () => setUnit(state.unitIndex - 1));
    $('nextUnit').addEventListener('click', () => setUnit(state.unitIndex + 1));

    /* 四个模式按钮 */
    $('modeBar').querySelectorAll('.mode-btn').forEach((b) =>
      b.addEventListener('click', () => setMode(b.dataset.mode)));

    /* 键盘：← → 切换句子，↑ ↓ 跨 10 句，1-4 切换模式 */
    document.addEventListener('keydown', (e) => {
      if (e.target.matches('input,textarea,select')) return;
      if (e.key === 'ArrowLeft') setUnit(state.unitIndex - 1);
      else if (e.key === 'ArrowRight') setUnit(state.unitIndex + 1);
      else if (e.key === 'ArrowUp') { e.preventDefault(); setUnit(state.unitIndex - 10); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setUnit(state.unitIndex + 10); }
      else if (['1', '2', '3', '4'].includes(e.key)) {
        setMode(['translation', 'grammar', 'vocab', 'theme'][Number(e.key) - 1]);
      }
    });

    /* 浏览器前进/后退 */
    window.addEventListener('hashchange', () => {
      readHash();
      const unit = UNITS[state.unitIndex];
      $('unitLabel').textContent = `Sentence ${String(unit.id).padStart(2, '0')}`;
      $('sourceLabel').textContent = unit.source;
      document.querySelectorAll('.chip').forEach((c, i) =>
        c.classList.toggle('on', i === state.unitIndex));
      renderSentence();
      renderContent();
    });

    /* 从地址栏恢复状态 */
    readHash();
    const unit = UNITS[state.unitIndex];
    $('unitLabel').textContent = `Sentence ${String(unit.id).padStart(2, '0')}`;
    $('sourceLabel').textContent = unit.source;
    document.querySelectorAll('.chip').forEach((c, i) =>
      c.classList.toggle('on', i === state.unitIndex));
    renderSentence();
    renderContent();
    writeHash();
  }

  /* ------------------------------------------------------------------
     工具
     ------------------------------------------------------------------ */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  document.addEventListener('DOMContentLoaded', init);
})();
