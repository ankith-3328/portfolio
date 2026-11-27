// A light CAD touch around the cube: dimension lines for its width, height and depth (drawn
// along the cube's own edges, like a dimensioned part on a drawing), and a short hint line beside
// the top corner when there is something worth saying. The lines are an SVG over the
// canvas, the text is plain HTML, and both follow the cube on screen every frame.
//
// Two layouts:
//   'stack' (cube beside a text column): hint at the top corner on the cube's open side,
//            all three dimensions
//   'side'  (cube centred: hero and finale): the text sits right under the cube there, so only
//            the height is drawn, with width and depth as a small reading under the hint

const SVG = 'http://www.w3.org/2000/svg';

function el(tag, attrs, parent) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent.appendChild(node);
  return node;
}

export function makeCallouts(container) {
  const root = document.createElement('div');
  root.className = 'callouts';
  root.setAttribute('aria-hidden', 'true');
  container.appendChild(root);

  const svg = el('svg', { class: 'co-lines' }, root);
  // Dimension lines, one per axis, each with its reading
  const dimEls = {};
  for (const name of ['x', 'y', 'z']) {
    const label = document.createElement('div');
    label.className = 'co-size';
    root.appendChild(label);
    dimEls[name] = { path: el('path', { class: 'co-measure-line' }, svg), label, text: '', w: 0 };
  }

  const tag = document.createElement('div');
  tag.className = 'co-tag';
  tag.innerHTML = '<em></em><span></span>';
  root.appendChild(tag);
  const [status, reading] = tag.children;

  let tagText = '';
  let tagW = 0;
  let shown = false;

  // One dimension: extension lines off the edge, the dimension line with slashed ends, and the
  // reading breaking the line in the middle. Returns how far right it reaches.
  const OFF = 22;
  function drawDim(d, centre) {
    const e = dimEls[d.name];
    const ex = d.b.x - d.a.x, ey = d.b.y - d.a.y;
    const len = Math.hypot(ex, ey);
    const alpha = Math.min(Math.max((len - 30) / 40, 0), 1); // fades out when seen end-on
    if (!d.show || alpha <= 0) {
      e.path.setAttribute('d', '');
      e.label.style.visibility = 'hidden';
      return -Infinity;
    }
    const ux = ex / len, uy = ey / len;
    // Offset away from the cube's middle
    let nx = -uy, ny = ux;
    if (((d.a.x + d.b.x) / 2 - centre.x) * nx + ((d.a.y + d.b.y) / 2 - centre.y) * ny < 0) { nx = -nx; ny = -ny; }
    const p = (pt, k, t = 0) => `${(pt.x + nx * k + ux * t).toFixed(1)},${(pt.y + ny * k + uy * t).toFixed(1)}`;
    const tick = (pt) => `M${(pt.x + nx * OFF - (ux + nx) * 3.5).toFixed(1)},${(pt.y + ny * OFF - (uy + ny) * 3.5).toFixed(1)} ` +
      `L${(pt.x + nx * OFF + (ux + nx) * 3.5).toFixed(1)},${(pt.y + ny * OFF + (uy + ny) * 3.5).toFixed(1)}`;
    e.path.setAttribute('d',
      `M${p(d.a, 6)} L${p(d.a, OFF + 5)} M${p(d.b, 6)} L${p(d.b, OFF + 5)} ` +
      `M${p(d.a, OFF, -4)} L${p(d.b, OFF, 4)} ${tick(d.a)} ${tick(d.b)}`);
    e.path.style.opacity = alpha;
    const text = d.value.toFixed(1);
    if (text !== e.text) { e.text = text; e.label.textContent = text; e.w = e.label.offsetWidth; }
    const mx = (d.a.x + d.b.x) / 2 + nx * OFF, my = (d.a.y + d.b.y) / 2 + ny * OFF;
    e.label.style.visibility = '';
    e.label.style.opacity = alpha;
    e.label.style.transform = `translate(${Math.round(mx - e.w / 2)}px, ${Math.round(my - 8)}px)`;
    return mx + e.w / 2;
  }

  return {
    // box: the cube's outline on screen {left, right, top, bottom}; W: window width
    // layout: 'stack' or 'side'; outer: +1 (the cube's open side is to the right) or -1
    // alpha: 0..1; texts: { status, reading } (either may be empty)
    // dims: [{ name, a, b, value }]: the edge each dimension measures, in screen px, and its size in mm
    update({ box, W, layout, outer, alpha, texts, dims }) {
      root.style.opacity = alpha;
      const visible = alpha > 0.02;
      if (visible !== shown) {
        shown = visible;
        root.classList.toggle('is-on', visible);
      }
      if (!visible) return;

      const readingText = layout === 'side' ? texts.reading : '';
      const key = `${texts.status}|${readingText}`;
      if (key !== tagText) {
        tagText = key;
        status.textContent = texts.status;
        reading.textContent = readingText;
        tagW = tag.offsetWidth;
      }

      const { left, right, top, bottom } = box;
      const o = 14; // breathing room around the outline
      const bl = left - o, br = right + o, bt = top, bb = bottom + o;

      // Dimensions: all three beside a text column, just the height when the text is underneath
      const centre = { x: (left + right) / 2, y: (top + bottom) / 2 };
      let reach = -Infinity;
      for (const d of dims || []) {
        const r = drawDim({ ...d, show: layout === 'stack' || d.name === 'y' }, centre);
        if (d.name === 'y') reach = r;
      }

      // The hint sits just outside the top corner on the cube's open side, clear of the height
      const s = layout === 'side' ? 1 : outer;
      const x = s > 0 ? Math.max(br + 16, reach + 14) : bl - 16 - tagW;
      tag.style.textAlign = s > 0 ? 'left' : 'right';
      tag.classList.toggle('is-left', s < 0);
      tag.style.transform = `translate(${Math.round(Math.min(Math.max(x, 16), W - tagW - 16))}px, ${Math.round(bt)}px)`;
    },
  };
}
