// CAD-style annotations around the cube, like a technical drawing of it:
//   - corner brackets framing the cube, with a view label ("VIEW A · ISO")
//   - dash-dot centre lines reaching out from the middle of each side
//   - leader lines from the cube to two mono labels (stage and move; status)
//   - width and height dimension lines with extension lines, reading the cube's real size
//   - in the finale, a reference leader from the status label down to the contact title block
// Lines are drawn in an SVG over the canvas and labels are plain HTML; everything is
// repositioned every frame from the cube's outline on screen.
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
  const brackets = el('path', { pathLength: 1, class: 'co-bracket' }, svg);
  const centres = el('path', { class: 'co-centre' }, svg);
  const leadA = el('path', { pathLength: 1, class: 'co-lead' }, svg);
  const leadB = el('path', { pathLength: 1, class: 'co-lead' }, svg);
  const leadC = el('path', { pathLength: 1, class: 'co-lead co-ref' }, svg);
  const dotA = el('circle', { r: 3, class: 'co-dot' }, svg);
  const dotB = el('circle', { r: 3, class: 'co-dot' }, svg);
  const dimH = el('path', { pathLength: 1, class: 'co-dim' }, svg);
  const dimV = el('path', { pathLength: 1, class: 'co-dim' }, svg);

  const a = label('co-a', root);
  const b = label('co-b', root);
  const view = label('co-view', root);
  const dimHLabel = label('co-measure', root);
  const dimVLabel = label('co-measure co-measure-v', root);

  const setText = (lab, title, sub = '') => {
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
  const show = (lab, on) => { lab.div.style.visibility = on ? '' : 'hidden'; };

  let shown = false;
  let refShown = false;

  return {
    // box: the cube's outline on screen {left, right, top, bottom}; W, H: window size
    // layout: 'stack' or 'side'; outer: +1 (cube's free side is to the right) or -1
    // alpha: 0..1 visibility
    // texts: { a: [title, sub], b: [...], width, height, view }; target: a screen rect to point at
    update({ box, W, H, layout, outer, alpha, texts, target }) {
      root.style.opacity = alpha;
      const visible = alpha > 0.02;
      if (visible !== shown) {
        shown = visible;
        root.classList.toggle('is-on', visible); // draws the lines in
      }
      if (!visible) return;

      setText(a, ...texts.a);
      setText(b, ...texts.b);
      setText(view, texts.view);
      setText(dimHLabel, texts.width);
      setText(dimVLabel, texts.height);

      const { left, right, top, bottom } = box;
      const w = right - left;
      const h = bottom - top;
      const cx = (left + right) / 2;
      const cy = (top + bottom) / 2;
      const gap = 14;

      // Corner brackets just outside the outline
      const o = 12, L = 16;
      const bl = left - o, br = right + o, bt = top - o, bb = bottom + o;
      brackets.setAttribute('d',
        `M${bl},${bt + L} V${bt} H${bl + L} M${br - L},${bt} H${br} V${bt + L} ` +
        `M${br},${bb - L} V${bb} H${br - L} M${bl + L},${bb} H${bl} V${bb - L}`);

      // Centre lines: dash-dot, reaching out of the middle of each side
      const c0 = 6, c1 = 46;
      centres.setAttribute('d',
        `M${left - c0},${cy} H${left - c1} M${right + c0},${cy} H${right + c1} ` +
        `M${cx},${top - c0} V${top - c1} M${cx},${bottom + c0} V${bottom + c1}`);

      if (layout === 'side') {
        a.div.style.textAlign = 'left';
        b.div.style.textAlign = 'right';

        // A: from the upper right of the cube, out to the right
        const ax = right - w * 0.18, ay = top + h * 0.3;
        const ex = right + 52, ey = ay - 30;
        const lx = clampX(ex + 6, a.w, W);
        leadA.setAttribute('d', `M${ax},${ay} L${ex},${ey} L${lx + a.w},${ey}`);
        dotA.setAttribute('cx', ax); dotA.setAttribute('cy', ay);
        place(a, lx, ey - a.h - 6);

        // B: from the lower left of the cube, out to the left
        const bx = left + w * 0.18, by = bottom - h * 0.3;
        const fx = left - 52, fy = by + 30;
        const mx = clampX(fx - 6 - b.w, b.w, W);
        leadB.setAttribute('d', `M${bx},${by} L${fx},${fy} L${mx},${fy}`);
        dotB.setAttribute('cx', bx); dotB.setAttribute('cy', by);
        place(b, mx, fy + 6);

        // View label over the top-left bracket
        place(view, bl, bt - view.h - 6);

        // Height dimension down the left side, with extension lines from the outline
        const vx = left - gap - 22;
        dimV.setAttribute('d', dimPath(vx, top, vx, bottom, left - 4));
        place(dimVLabel, vx - dimVLabel.w / 2, cy - dimVLabel.h / 2);
        dimH.setAttribute('d', '');
        show(dimHLabel, false);
        show(dimVLabel, true);

        // Reference leader: from the status label down the left, to the title block
        // It drops from under the label, jogging left first if the block starts further left
        const x1 = mx + 10, y0 = fy + 6 + b.h + 8;
        const x0 = target ? Math.min(x1, target.left - 26) : 0;
        const ref = target && x0 > 16 && target.top > y0 + 20 ? target : null;
        if (ref) {
          const ty = ref.top + Math.min(ref.height / 2, 28), tx = ref.left - 6;
          const jog = x0 < x1 ? ` V${y0 + 10} H${x0}` : '';
          leadC.setAttribute('d',
            `M${x1},${y0}${jog} V${ty} H${tx} M${tx - 7},${ty - 3.5} L${tx},${ty} L${tx - 7},${ty + 3.5}`);
        }
        if (!!ref !== refShown) {
          refShown = !!ref;
          if (!ref) leadC.setAttribute('d', '');
          // A frame later, so the line draws in from nothing
          requestAnimationFrame(() => leadC.classList.toggle('is-drawn', refShown));
        }
        return;
      }

      if (refShown) { refShown = false; leadC.classList.remove('is-drawn'); leadC.setAttribute('d', ''); }

      // 'stack': A above the cube, B below it, both reaching toward the screen edge on the outer side
      const s = outer;
      a.div.style.textAlign = b.div.style.textAlign = s > 0 ? 'left' : 'right';

      const ax = s > 0 ? right - w * 0.26 : left + w * 0.26, ay = top + h * 0.1;
      const ex = ax + s * 30, ey = top - 30;
      const lx = clampX(s > 0 ? ex + 6 : ex - 6 - a.w, a.w, W);
      leadA.setAttribute('d', `M${ax},${ay} L${ex},${ey} L${s > 0 ? lx + a.w : lx},${ey}`);
      dotA.setAttribute('cx', ax); dotA.setAttribute('cy', ay);
      place(a, lx, ey - a.h - 6);

      // View label over the bracket on the inner side (A sits on the outer side)
      place(view, s > 0 ? bl : br - view.w, bt - view.h - 6);

      // Width dimension under the cube, with extension lines down from the outline
      const hy = bottom + gap + 16;
      dimH.setAttribute('d', dimPath(left, hy, right, hy, bottom + 4));
      place(dimHLabel, cx - dimHLabel.w / 2, hy - dimHLabel.h / 2);
      show(dimHLabel, true);

      const bx = s > 0 ? right - w * 0.2 : left + w * 0.2, by = bottom - h * 0.1;
      const fx = bx + s * 30, fy = hy + 34;
      const mx = clampX(s > 0 ? fx + 6 : fx - 6 - b.w, b.w, W);
      leadB.setAttribute('d', `M${bx},${by} L${fx},${fy} L${s > 0 ? mx + b.w : mx},${fy}`);
      dotB.setAttribute('cx', bx); dotB.setAttribute('cy', by);
      place(b, mx, Math.min(fy + 6, H - b.h - 12));

      // Height dimension on the outer side, if there is room for it
      const vx = s > 0 ? right + gap + 22 : left - gap - 22;
      const room = vx > 24 && vx < W - 24;
      dimV.setAttribute('d', room ? dimPath(vx, top, vx, bottom, s > 0 ? right + 4 : left - 4) : '');
      show(dimVLabel, room);
      if (room) place(dimVLabel, vx - dimVLabel.w / 2, cy - dimVLabel.h / 2);
    },
  };
}

// A dimension line between two points: extension lines from the object (starting at `from`,
// measured across the line), the line itself with a tick and an arrowhead at each end
function dimPath(x1, y1, x2, y2, from) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len; // along
  const nx = -uy, ny = ux;                          // across
  const t = 5, ah = 7, aw = 3;
  const horizontal = Math.abs(uy) < 0.5;
  // Extension lines run from the object edge to just past the dimension line
  const ext = (x, y) => {
    if (horizontal) return `M${x},${from} L${x},${y + Math.sign(y - from) * 6}`;
    return `M${from},${y} L${x + Math.sign(x - from) * 6},${y}`;
  };
  const tick = (x, y) => `M${x - nx * t},${y - ny * t} L${x + nx * t},${y + ny * t}`;
  const arrow = (x, y, dir) => {
    const bx = x + ux * ah * dir, by = y + uy * ah * dir;
    return `M${bx + nx * aw},${by + ny * aw} L${x},${y} L${bx - nx * aw},${by - ny * aw}`;
  };
  return `${ext(x1, y1)} ${ext(x2, y2)} M${x1},${y1} L${x2},${y2} ` +
    `${tick(x1, y1)} ${tick(x2, y2)} ${arrow(x1, y1, 1)} ${arrow(x2, y2, -1)}`;
}
