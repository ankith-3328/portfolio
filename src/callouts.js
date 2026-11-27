// CAD-style annotations around the cube: thin leader lines from the cube to small mono labels,
// plus dimension lines measuring the cube's real size. Drawn in an SVG over the canvas (lines)
// and plain HTML (labels), and repositioned every frame from the cube's outline on screen.
//
// Two layouts:
//   'stack' (cube beside a text column): labels above and below the cube, on its outer side
//   'side'  (cube centred: hero and finale): one label out to each side of the cube

const SVG = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent?.appendChild(node);
  return node;
}

function label(className, parent) {
  const div = document.createElement('div');
  div.className = `co-label ${className}`;
  div.innerHTML = '<b></b><span></span>';
  parent.appendChild(div);
  return { div, title: div.firstChild, sub: div.lastChild, w: 0, h: 0, text: '' };
}

export function makeCallouts(container) {
  const root = document.createElement('div');
  root.className = 'callouts';
  root.setAttribute('aria-hidden', 'true');
  container.appendChild(root);

  const svg = el('svg', { class: 'co-lines' }, root);
  // pathLength="1" lets CSS draw every line in from 0 to 1, whatever its real length
  const leadA = el('path', { pathLength: 1, class: 'co-lead' }, svg);
  const leadB = el('path', { pathLength: 1, class: 'co-lead' }, svg);
  const dotA = el('circle', { r: 3, class: 'co-dot' }, svg);
  const dotB = el('circle', { r: 3, class: 'co-dot' }, svg);
  const dimH = el('path', { pathLength: 1, class: 'co-dim' }, svg);
  const dimV = el('path', { pathLength: 1, class: 'co-dim' }, svg);

  const a = label('co-a', root);
  const b = label('co-b', root);
  const dimHLabel = label('co-measure', root);
  const dimVLabel = label('co-measure co-measure-v', root);

  const setText = (lab, title, sub) => {
    const key = title + '|' + sub;
    if (key === lab.text) return;
    lab.text = key;
    lab.title.textContent = title;
    lab.sub.textContent = sub;
    lab.w = lab.div.offsetWidth;
    lab.h = lab.div.offsetHeight;
  };
  const place = (lab, x, y) => { lab.div.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`; };
  const clampX = (x, w, W) => Math.min(Math.max(x, 16), W - w - 16);

  let shown = false;

  return {
    // box: the cube's outline on screen {left, right, top, bottom}; W, H: window size
    // layout: 'stack' or 'side'; outer: +1 (cube's free side is to the right) or -1
    // alpha: 0..1 visibility; texts: { a: [title, sub], b: [...], width, height }
    update({ box, W, H, layout, outer, alpha, texts }) {
      root.style.opacity = alpha;
      const visible = alpha > 0.02;
      if (visible !== shown) {
        shown = visible;
        root.classList.toggle('is-on', visible); // draws the lines in
      }
      if (!visible) return;

      setText(a, ...texts.a);
      setText(b, ...texts.b);
      setText(dimHLabel, texts.width, '');
      setText(dimVLabel, texts.height, '');

      const { left, right, top, bottom } = box;
      const w = right - left;
      const h = bottom - top;
      const gap = 14;

      if (layout === 'side') {
        // A: from the upper right of the cube, out to the right
        const ax = right - w * 0.18, ay = top + h * 0.3;
        const ex = right + 34, ey = ay - 34;
        const lx = clampX(ex + 6, a.w, W);
        leadA.setAttribute('d', `M${ax},${ay} L${ex},${ey} L${lx + a.w},${ey}`);
        dotA.setAttribute('cx', ax); dotA.setAttribute('cy', ay);
        place(a, lx, ey - a.h - 6);

        // B: from the lower left of the cube, out to the left
        const bx = left + w * 0.18, by = bottom - h * 0.3;
        const fx = left - 34, fy = by + 34;
        const mx = clampX(fx - 6 - b.w, b.w, W);
        leadB.setAttribute('d', `M${bx},${by} L${fx},${fy} L${mx},${fy}`);
        dotB.setAttribute('cx', bx); dotB.setAttribute('cy', by);
        place(b, mx, fy + 6);
        b.div.style.textAlign = 'right';
        a.div.style.textAlign = 'left';

        // Height dimension down the left side of the cube
        const vx = left - gap - 8;
        dimV.setAttribute('d', dimPath(vx, top, vx, bottom));
        place(dimVLabel, vx - dimVLabel.w / 2, (top + bottom) / 2 - dimVLabel.h / 2);
        dimH.setAttribute('d', '');
        dimHLabel.div.style.visibility = 'hidden';
        dimVLabel.div.style.visibility = '';
        return;
      }

      // 'stack': A above the cube, B below it, both reaching toward the screen edge on the outer side
      const s = outer;
      const align = s > 0 ? 'left' : 'right';
      a.div.style.textAlign = b.div.style.textAlign = align;

      const ax = s > 0 ? right - w * 0.26 : left + w * 0.26, ay = top + h * 0.1;
      const ex = ax + s * 30, ey = top - 26;
      const lx = clampX(s > 0 ? ex + 6 : ex - 6 - a.w, a.w, W);
      leadA.setAttribute('d', `M${ax},${ay} L${ex},${ey} L${s > 0 ? lx + a.w : lx},${ey}`);
      dotA.setAttribute('cx', ax); dotA.setAttribute('cy', ay);
      place(a, lx, ey - a.h - 6);

      // Width dimension just under the cube
      const hy = bottom + gap + 8;
      dimH.setAttribute('d', dimPath(left, hy, right, hy));
      place(dimHLabel, (left + right) / 2 - dimHLabel.w / 2, hy - dimHLabel.h / 2);
      dimHLabel.div.style.visibility = '';

      const bx = s > 0 ? right - w * 0.2 : left + w * 0.2, by = bottom - h * 0.1;
      const fx = bx + s * 30, fy = hy + 34;
      const mx = clampX(s > 0 ? fx + 6 : fx - 6 - b.w, b.w, W);
      leadB.setAttribute('d', `M${bx},${by} L${fx},${fy} L${s > 0 ? mx + b.w : mx},${fy}`);
      dotB.setAttribute('cx', bx); dotB.setAttribute('cy', by);
      place(b, mx, Math.min(fy + 6, H - b.h - 12));

      // Height dimension on the outer side, if there is room for it
      const vx = s > 0 ? right + gap + 8 : left - gap - 8;
      const room = vx > 24 && vx < W - 24;
      dimV.setAttribute('d', room ? dimPath(vx, top, vx, bottom) : '');
      dimVLabel.div.style.visibility = room ? '' : 'hidden';
      if (room) place(dimVLabel, vx - dimVLabel.w / 2, (top + bottom) / 2 - dimVLabel.h / 2);
    },
  };
}

// A dimension line between two points: the line, a tick across each end, and small arrowheads
function dimPath(x1, y1, x2, y2) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len; // along
  const nx = -uy, ny = ux;                          // across
  const t = 6, ah = 6, aw = 3;
  const tick = (x, y) => `M${x - nx * t},${y - ny * t} L${x + nx * t},${y + ny * t}`;
  const arrow = (x, y, dir) => {
    const bx = x + ux * ah * dir, by = y + uy * ah * dir;
    return `M${bx + nx * aw},${by + ny * aw} L${x},${y} L${bx - nx * aw},${by - ny * aw}`;
  };
  return `M${x1},${y1} L${x2},${y2} ${tick(x1, y1)} ${tick(x2, y2)} ${arrow(x1, y1, 1)} ${arrow(x2, y2, -1)}`;
}
