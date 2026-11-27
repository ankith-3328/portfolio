// A light CAD touch around the cube: thin corner brackets framing it, one compact label (stage,
// move count, a short status line) beside the top corner, and, next to text columns, a single
// width measurement underneath. Lines are an SVG over the canvas, the label is plain HTML, and
// both follow the cube's outline on screen every frame.
//
// Two layouts:
//   'stack' (cube beside a text column): label at the top corner on the cube's open side,
//            width measurement under the cube
//   'side'  (cube centred: hero and finale): label at the top right, no measurement (the text
//            sits right under the cube there)

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
  // pathLength="1" lets CSS draw the lines in from nothing, whatever their real length
  const brackets = el('path', { pathLength: 1, class: 'co-bracket' }, svg);
  const measure = el('path', { pathLength: 1, class: 'co-measure-line' }, svg);

  const tag = document.createElement('div');
  tag.className = 'co-tag';
  tag.innerHTML = '<b></b><span></span><em></em>';
  root.appendChild(tag);
  const [title, sub, status] = tag.children;

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
    // alpha: 0..1; texts: { title, sub, status, width }
    update({ box, W, layout, outer, alpha, texts }) {
      root.style.opacity = alpha;
      const visible = alpha > 0.02;
      if (visible !== shown) {
        shown = visible;
        root.classList.toggle('is-on', visible);
      }
      if (!visible) return;

      const key = `${texts.title}|${texts.sub}|${texts.status}`;
      if (key !== tagText) {
        tagText = key;
        title.textContent = texts.title;
        sub.textContent = texts.sub;
        status.textContent = texts.status;
        tagW = tag.offsetWidth;
      }

      const { left, right, top, bottom } = box;
      const o = 14, L = 14; // brackets: offset from the outline, arm length
      const bl = left - o, br = right + o, bt = top - o, bb = bottom + o;
      brackets.setAttribute('d',
        `M${bl},${bt + L} V${bt} H${bl + L} M${br - L},${bt} H${br} V${bt + L} ` +
        `M${br},${bb - L} V${bb} H${br - L} M${bl + L},${bb} H${bl} V${bb - L}`);

      // The label sits just outside the top corner on the open side, aligned to the bracket
      const s = layout === 'side' ? 1 : outer;
      const x = s > 0 ? br + 16 : bl - 16 - tagW;
      tag.style.textAlign = s > 0 ? 'left' : 'right';
      tag.style.transform = `translate(${Math.round(Math.min(Math.max(x, 16), W - tagW - 16))}px, ${Math.round(bt)}px)`;

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
