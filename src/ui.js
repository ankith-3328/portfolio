// Page interactions that don't need the 3D library.
// Kept separate from the cube on purpose: if the cube fails to load,
// the content, theme toggle and everything here still work.
(function () {
  const root = document.documentElement;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

  // ---------- Light / dark theme ----------
  const themeColor = document.querySelector('meta[name="theme-color"]');
  function applyTheme(theme, save) {
    root.dataset.theme = theme;
    if (themeColor) themeColor.content = theme === 'dark' ? '#1C1916' : '#ECEAE5';
    if (save) { try { localStorage.setItem('theme', theme); } catch (e) {} }
  }
  applyTheme(root.dataset.theme || 'light', false);
  document.querySelector('.theme-toggle')?.addEventListener('click', () => {
    applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark', true);
  });

  // ---------- "Copy" button next to the email ----------
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      btn.textContent = 'Copied';
      btn.classList.add('is-copied');
      setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('is-copied'); }, 1800);
    } catch {
      window.location.href = 'mailto:' + btn.dataset.copy;
    }
  });

  // ---------- The contact title block draws itself in when the cube is solved ----------
  // Its ruled lines are generated from where the cells actually sit, so they match any layout:
  // the outer frame first, then each divider, then the text fades in.
  const block = document.querySelector('.title-block');
  const contact = document.querySelector('#contact');
  const SVG = 'http://www.w3.org/2000/svg';

  function ruleBlock() {
    const svg = block.querySelector('.tb-lines');
    const box = block.getBoundingClientRect();
    const W = Math.round(box.width), H = Math.round(box.height);
    const lines = [];
    const seen = new Set();
    for (const cell of block.querySelectorAll('.tb-cell')) {
      const r = cell.getBoundingClientRect();
      const x = Math.round(r.right - box.left), y = Math.round(r.bottom - box.top);
      const x0 = Math.round(r.left - box.left), y0 = Math.round(r.top - box.top);
      // Each cell contributes its right and bottom edges, unless they are the frame itself
      if (x < W - 1 && !seen.has(`v${x},${y0}`)) { seen.add(`v${x},${y0}`); lines.push(`M${x},${y0} V${y}`); }
      if (y < H - 1 && !seen.has(`h${y},${x0}`)) { seen.add(`h${y},${x0}`); lines.push(`M${x0},${y} H${x}`); }
    }
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.replaceChildren();
    const path = (d, cls, delay) => {
      const p = document.createElementNS(SVG, 'path');
      p.setAttribute('d', d);
      p.setAttribute('pathLength', '1');
      p.setAttribute('class', cls);
      p.style.transitionDelay = `${delay}ms`;
      svg.appendChild(p);
    };
    path(`M0.5,0.5 H${W - 0.5} V${H - 0.5} H0.5 Z`, 'tb-frame', 0);
    lines.forEach((d, i) => path(d, 'tb-rule', 420 + i * 90));
    block.style.setProperty('--text-delay', `${520 + lines.length * 90}ms`);
  }

  if (block) {
    let drawn = false;
    const draw = () => {
      if (drawn) return;
      drawn = true;
      block.classList.remove('is-waiting');
      ruleBlock();
      // Next frame, so the lines start from nothing and draw in
      requestAnimationFrame(() => requestAnimationFrame(() => block.classList.add('is-drawn')));
    };
    // Keep the lines on the cells if the layout changes later
    new ResizeObserver(() => { if (drawn) ruleBlock(); }).observe(block);

    if (reducedMotion) {
      draw();
    } else {
      block.classList.add('is-waiting');
      window.addEventListener('cube:solved', draw);
    }

    // Safety net: never leave the email hidden (no 3D, or the solve never fires)
    if ('IntersectionObserver' in window) {
      let timer = null;
      new IntersectionObserver(([entry]) => {
        clearTimeout(timer);
        if (!entry.isIntersecting) return;
        const noCube = !root.classList.contains('cube-ready') || root.classList.contains('no-webgl');
        timer = setTimeout(draw, noCube ? 300 : 4500);
      }, { threshold: 0.4 }).observe(contact);
    } else {
      draw();
    }
  }

  // ---------- Tiles and cards draw themselves like a CAD drawing ----------
  // Faint construction lines run out past the corners, the outline is traced over them, the panel
  // fills in, and then the content appears. Fact tiles also get a numbered balloon in the corner.
  // Experience and project cards are drawn when their cube piece lands (main.js); here they only
  // draw on their own when the pieces aren't flying (phones, no 3D, reduced motion).
  const SVGNS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs, parent) => {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    parent.appendChild(n);
    return n;
  };
  function draft(el, { delay = 0, balloon = null } = {}) {
    el.classList.add('drafted');
    el.classList.remove('reveal');
    el.style.setProperty('--draft-delay', `${delay}ms`);
    const svg = svgEl('svg', { class: 'draft', 'aria-hidden': 'true' }, el);
    const guides = svgEl('path', { class: 'draft-guide', pathLength: 1 }, svg);
    const outline = svgEl('rect', { class: 'draft-outline', pathLength: 1 }, svg);
    let mark = null;
    if (balloon) {
      mark = svgEl('g', { class: 'draft-balloon' }, svg);
      svgEl('circle', { r: 9 }, mark);
      svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, mark).textContent = balloon;
    }
    const fit = () => {
      const w = el.offsetWidth, h = el.offsetHeight;
      const r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      const x = 14; // how far the construction lines run past the corners
      guides.setAttribute('d', `M${-x},0.5 H${w + x} M${-x},${h - 0.5} H${w + x} M0.5,${-x} V${h + x} M${w - 0.5},${-x} V${h + x}`);
      Object.entries({ x: 0.5, y: 0.5, width: w - 1, height: h - 1, rx: r, ry: r })
        .forEach(([k, v]) => outline.setAttribute(k, v));
      mark?.setAttribute('transform', `translate(${w - 22} 22)`);
    };
    fit();
    if ('ResizeObserver' in window) new ResizeObserver(fit).observe(el);
  }
  const drawNow = (el) => el.classList.add('is-drawn');
  // Drawn when a good part of it is on screen, wiped (instantly) once it is fully off screen, so
  // the drawing plays again every time it scrolls back into view
  const drawObserver = 'IntersectionObserver' in window && !reducedMotion
    ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const els = entry.target.matches('.facts') ? [...entry.target.querySelectorAll('.drafted')] : [entry.target];
        // Cards whose cube piece is flying in are handled by main.js
        if (els[0].classList.contains('flies') && root.classList.contains('flights-on')) continue;
        if (!entry.isIntersecting) els.forEach((el) => el.classList.remove('is-drawn'));
        else if (entry.intersectionRatio >= 0.3) els.forEach(drawNow);
      }
    }, { threshold: [0, 0.3] })
    : null;
  document.querySelectorAll('.facts').forEach((group) => {
    group.querySelectorAll('.tile').forEach((tile, i) => draft(tile, { delay: i * 50, balloon: String(i + 1) }));
    drawObserver ? drawObserver.observe(group) : group.querySelectorAll('.drafted').forEach(drawNow);
  });
  document.querySelectorAll('#experience .exp-card, #projects .card').forEach((card) => {
    draft(card);
    drawObserver ? drawObserver.observe(card) : drawNow(card);
  });

  // ---------- Fade content in as it scrolls into view ----------
  const items = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    items.forEach((el) => observer.observe(el));
  } else {
    items.forEach((el) => el.classList.add('is-visible'));
  }

  // ---------- Scroll progress line ----------
  const bar = document.querySelector('.scroll-progress');
  let ticking = false;
  function updateBar() {
    const max = root.scrollHeight - window.innerHeight;
    const ratio = max > 0 ? Math.min(window.scrollY / max, 1) : 0;
    bar.style.transform = `scaleX(${ratio})`;
    ticking = false;
  }
  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(updateBar); }
  }, { passive: true });
  updateBar();

  // ---------- Highlight the nav link for the section on screen ----------
  const links = new Map(
    [...document.querySelectorAll('.nav a[href^="#"]')].map((a) => [a.getAttribute('href').slice(1), a]),
  );
  if ('IntersectionObserver' in window) {
    const sectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        links.forEach((a) => a.classList.remove('is-active'));
        links.get(entry.target.id)?.classList.add('is-active');
      }
    }, { rootMargin: '-45% 0px -50% 0px' });
    document.querySelectorAll('main section').forEach((s) => sectionObserver.observe(s));
  }

  // ---------- Project cards and stat tiles tilt toward the cursor ----------
  if (finePointer && !reducedMotion) {
    document.querySelectorAll('.card, .tile').forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;  // 0..1
        const y = (e.clientY - r.top) / r.height;
        card.style.transition = 'transform .12s ease-out, border-color .3s, box-shadow .3s';
        card.style.transform =
          `perspective(900px) rotateX(${(0.5 - y) * 6}deg) rotateY(${(x - 0.5) * 8}deg) translateY(-3px)`;
      });
      card.addEventListener('pointerleave', () => {
        card.style.transition = 'transform .6s cubic-bezier(.2,.7,.2,1), border-color .3s, box-shadow .3s';
        card.style.transform = '';
      });
    });
  }

  // ---------- Custom cursor: a simple dot (mouse / trackpad only) ----------
  const cursor = document.querySelector('.cursor');
  if (cursor && finePointer) {
    root.classList.add('has-cursor');
    const dot = cursor.querySelector('.cursor-dot');
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      dot.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      cursor.classList.add('is-visible');
    }, { passive: true });
    document.addEventListener('mouseleave', () => cursor.classList.remove('is-visible'));
  }
})();
