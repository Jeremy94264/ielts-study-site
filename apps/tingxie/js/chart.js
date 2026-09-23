/* ============================================================
   chart.js — 纯 SVG 折线图（无任何依赖）
   ------------------------------------------------------------
   用于展示每次拼写小测的正确率变化。
     · 自适应宽度（用 viewBox + preserveAspectRatio 让它跟着容器缩放）
     · 折线 + 数据点 + 网格 + 坐标标签
     · 悬停/点击数据点显示数值
   ============================================================ */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
    }
    return e;
  }

  function fmtTime(ts) {
    var d = new Date(ts);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /**
   * 绘制折线图
   * @param {HTMLElement} host 容器
   * @param {Array} points [{x:时间戳, y:正确率0-100, label?}]
   * @param {Object} opts {yMin, yMax, height, tip}
   */
  function line(host, points, opts) {
    opts = opts || {};
    if (!host) return null;
    host.innerHTML = '';

    if (!points || !points.length) {
      var empty = document.createElement('div');
      empty.className = 'chart-empty';
      empty.textContent = '还没有测验记录，先做一次拼写小测吧';
      host.appendChild(empty);
      return null;
    }

    var W = 800, H = opts.height || 260;
    var padL = 42, padR = 16, padT = 18, padB = 34;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;

    /* 纵轴固定 0-100（正确率），让不同次的图可直接比较 */
    var yMin = opts.yMin != null ? opts.yMin : 0;
    var yMax = opts.yMax != null ? opts.yMax : 100;

    var n = points.length;
    var xAt = function (i) {
      if (n === 1) return padL + plotW / 2;
      return padL + (plotW * i) / (n - 1);
    };
    var yAt = function (v) {
      var t = (v - yMin) / (yMax - yMin);
      t = Math.max(0, Math.min(1, t));
      return padT + plotH * (1 - t);
    };

    var svg = el('svg', {
      viewBox: '0 0 ' + W + ' ' + H,
      preserveAspectRatio: 'none',
      class: 'linechart',
      role: 'img',
      'aria-label': '正确率变化折线图'
    });

    /* ---- 横向网格 + 纵轴刻度 ---- */
    var ticks = [0, 25, 50, 75, 100];
    ticks.forEach(function (t) {
      var y = yAt(t);
      svg.appendChild(el('line', {
        x1: padL, y1: y, x2: W - padR, y2: y,
        class: 'grid' + (t === 0 ? ' base' : '')
      }));
      var tx = el('text', {
        x: padL - 8, y: y + 4, class: 'axis-y', 'text-anchor': 'end'
      });
      tx.textContent = t + '%';
      svg.appendChild(tx);
    });

    /* ---- 及格线 60% ---- */
    if (yMin <= 60 && yMax >= 60) {
      svg.appendChild(el('line', {
        x1: padL, y1: yAt(60), x2: W - padR, y2: yAt(60),
        class: 'grid pass'
      }));
    }

    /* ---- 面积 + 折线 ---- */
    var d = '', area = '';
    points.forEach(function (p, i) {
      var x = xAt(i), y = yAt(p.y);
      d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
      area += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
    });
    area += 'L' + xAt(n - 1).toFixed(1) + ' ' + yAt(yMin).toFixed(1) + ' ';
    area += 'L' + xAt(0).toFixed(1) + ' ' + yAt(yMin).toFixed(1) + ' Z';

    svg.appendChild(el('path', { d: area, class: 'chart-area' }));
    svg.appendChild(el('path', { d: d.trim(), class: 'chart-line' }));

    /* ---- 数据点 ---- */
    var tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    host.appendChild(tip);

    points.forEach(function (p, i) {
      var x = xAt(i), y = yAt(p.y);
      var dot = el('circle', { cx: x, cy: y, r: 4.5, class: 'chart-dot' });
      var title = el('title');
      title.textContent = (p.label || fmtTime(p.x)) + '  ' + p.y + '%';
      dot.appendChild(title);

      dot.addEventListener('mouseenter', function () {
        tip.hidden = false;
        tip.innerHTML = '<b>' + (p.label || fmtTime(p.x)) + '</b><span>' + p.y + '%</span>';
        var r = host.getBoundingClientRect();
        tip.style.left = ((x / W) * r.width) + 'px';
        tip.style.top = ((y / H) * r.height) + 'px';
      });
      dot.addEventListener('mouseleave', function () { tip.hidden = true; });
      svg.appendChild(dot);
    });

    /* ---- 横轴标签（最多显示 6 个，避免挤在一起） ---- */
    var step = Math.max(1, Math.ceil(n / 6));
    points.forEach(function (p, i) {
      if (i % step !== 0 && i !== n - 1) return;
      var tx = el('text', {
        x: xAt(i), y: H - 10, class: 'axis-x', 'text-anchor': 'middle'
      });
      tx.textContent = fmtTime(p.x);
      svg.appendChild(tx);
    });

    host.appendChild(svg);
    return svg;
  }

  global.MiniChart = { line: line, fmtTime: fmtTime };
})(window);
