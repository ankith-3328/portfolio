// A light CAD touch around the cube: a width measurement, an X/Y/Z axis triad at its bottom-left
// that turns with the cube (like the orientation widget in CAD apps), and a short hint line beside the top
// corner when there is something worth saying. The line is an SVG over the canvas, the text
// is plain HTML, and both follow the cube's outline on screen every frame.
//
// Two layouts:
//   'stack' (cube beside a text column): hint at the top corner on the cube's open side,
//            width measurement under the cube
//   'side'  (cube centred: hero and finale): hint at the top right with the width as a small
//            reading under it (the text sits right under the cube there)

const SVG = 'http://www.w3.org/2000/svg';

function el(tag, attrs, parent) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent.appendChild(node);
  return node;
}

// onWireframe(on): called when the visitor flips the wireframe switch under the hint
export function makeCallouts(container, { onWireframe } = {}) {
  const root = document.createElement('div');
  root.className = 'callouts';
  root.setAttribute('aria-hidden', 'true');
  container.appendChild(root);

  const svg = el('svg', { class: 'co-lines' }, root);
  // pathLength="1" lets CSS draw the lines in from nothing, whatever their real length
  const measure = el('path', { pathLength: 1, class: 'co-measure-line' }, svg);

  // Axis triad: a line and a letter per axis, plus a small hub where they meet
  const triad = el('g', { class: 'co-triad' }, svg);
  const axisEls = {};
  for (const name of ['x', 'y', 'z']) {
    const g = el('g', { class: `co-axis co-axis-${name}` }, triad);
    axisEls[name] = {
      g,
      line: el('line', {}, g),
      text: Object.assign(el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g),
        { textContent: name.toUpperCase() }),
    };
  }
  const hub = el('circle', { r: 2.2, class: 'co-hub' }, triad);

  const tag = document.createElement('div');
  tag.className = 'co-tag';
  tag.innerHTML = '<em></em><span></span>' +
    '<button class="co-switch" type="button" tabindex="-1" aria-pressed="false"><i></i>Wireframe</button>';
  root.appendChild(tag);
  const [status, reading, toggle] = tag.children;
  toggle.addEventListener('click', () => {
    const on = toggle.getAttribute('aria-pressed') !== 'true';
    toggle.setAttribute('aria-pressed', String(on));
    onWireframe?.(on);
  });

  const size = document.createElement('div');
  size.className = 'co-size';
  root.appendChild(size);

  let tagText = '';
  let tagW = 0;
  let sizeW = 0;
  let shown = false;

  return {
    // box: the cube's outline on screen {left, right, top, bottom}; W: window width
    // layout: 'stack' or 'side'; outer: +1 (the cube's open side is to the right) or -1
    // alpha: 0..1; texts: { status, width } (status may be empty)
    // axes: the cube's x, y, z axes in camera space [{ name, x, y, z }]
    update({ box, W, layout, outer, alpha, texts, axes }) {
      root.style.opacity = alpha;
      const visible = alpha > 0.02;
      if (visible !== shown) {
        shown = visible;
        root.classList.toggle('is-on', visible);
        root.style.visibility = visible ? '' : 'hidden'; // nothing clickable while faded out
      }
      if (!visible) return;

      const readingText = layout === 'side' ? texts.width : '';
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

      // The hint sits just outside the top corner on the cube's open side
      const s = layout === 'side' ? 1 : outer;
      const x = s > 0 ? br + 16 : bl - 16 - tagW;
      tag.style.textAlign = s > 0 ? 'left' : 'right';
      tag.classList.toggle('is-left', s < 0);
      tag.style.transform = `translate(${Math.round(Math.min(Math.max(x, 16), W - tagW - 16))}px, ${Math.round(bt)}px)`;

      // Axis triad, always at the cube's bottom-left corner, drawn as the camera sees the cube's own axes:
      // longer when an axis lies across the screen, shorter when it points at you or away,
      // and fainter when it points away. Drawn back to front.
      if (axes) {
        const R = 38;
        const cx = bl - 40;
        const cy = bottom - 8;
        hub.setAttribute('cx', cx);
        hub.setAttribute('cy', cy);
        for (const a of [...axes].sort((p, q) => p.z - q.z)) {
          const e = axisEls[a.name];
          const x2 = cx + a.x * R, y2 = cy - a.y * R;
          e.line.setAttribute('x1', cx); e.line.setAttribute('y1', cy);
          e.line.setAttribute('x2', x2); e.line.setAttribute('y2', y2);
          // Letters sit just past the tip, along the axis
          const len = Math.hypot(a.x, a.y) || 1;
          e.text.setAttribute('x', x2 + (a.x / len) * 8);
          e.text.setAttribute('y', y2 - (a.y / len) * 8);
          e.g.style.opacity = a.z < 0 ? 0.4 + 0.6 * (1 + a.z) : 1;
          triad.appendChild(e.g); // re-append in depth order
        }
        triad.appendChild(hub);
      }

      // Width measurement: one hairline under the cube with end ticks, the reading in the middle
      if (layout === 'stack') {
        const y = bb + 18;
        measure.setAttribute('d', `M${left},${y} H${right} M${left},${y - 4} V${y + 4} M${right},${y - 4} V${y + 4}`);
        if (size.textContent !== texts.width) {
          size.textContent = texts.width;
          sizeW = size.offsetWidth;
        }
        size.style.visibility = '';
        size.style.transform = `translate(${Math.round((left + right) / 2 - sizeW / 2)}px, ${Math.round(y - 8)}px)`;
      } else {
        measure.setAttribute('d', '');
        size.style.visibility = 'hidden';
      }
    },
  };
}
