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
  applyTheme(root.dataset.theme || 'dark', false);
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

  // ---------- Project cards tilt toward the cursor ----------
  if (finePointer && !reducedMotion) {
    document.querySelectorAll('.card').forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;  // 0..1
        const y = (e.clientY - r.top) / r.height;
        card.style.transition = 'transform .12s ease-out, border-color .3s, box-shadow .3s';
        card.style.transform =
          `perspective(900px) rotateX(${(0.5 - y) * 6}deg) rotateY(${(x - 0.5) * 8}deg) translateY(-3px)`;
        card.style.setProperty('--gx', `${x * 100}%`);
        card.style.setProperty('--gy', `${y * 100}%`);
      });
      card.addEventListener('pointerleave', () => {
        card.style.transition = 'transform .6s cubic-bezier(.2,.7,.2,1), border-color .3s, box-shadow .3s';
        card.style.transform = '';
      });
    });
  }

  // ---------- Custom cursor (mouse / trackpad only) ----------
  const cursor = document.querySelector('.cursor');
  if (cursor && finePointer) {
    root.classList.add('has-cursor');
    const dot = cursor.querySelector('.cursor-dot');
    const ring = cursor.querySelector('.cursor-ring');
    let mx = -100, my = -100, rx = -100, ry = -100;
    let visible = false;

    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      mx = e.clientX;
      my = e.clientY;
      if (!visible) { rx = mx; ry = my; visible = true; cursor.classList.add('is-visible'); }
      dot.style.transform = `translate(${mx}px, ${my}px)`;

      const t = e.target;
      cursor.classList.toggle('is-link', !!t.closest('a, button, .card'));
      cursor.classList.toggle('is-cube', !!t.closest('.stage canvas'));
    }, { passive: true });

    document.addEventListener('pointerdown', () => cursor.classList.add('is-down'));
    document.addEventListener('pointerup', () => cursor.classList.remove('is-down'));
    document.addEventListener('mouseleave', () => { visible = false; cursor.classList.remove('is-visible'); });

    // The ring trails slightly behind the dot
    (function follow() {
      const k = reducedMotion ? 1 : 0.2;
      rx += (mx - rx) * k;
      ry += (my - ry) * k;
      ring.style.transform = `translate(${rx}px, ${ry}px)`;
      requestAnimationFrame(follow);
    })();
  }
})();
