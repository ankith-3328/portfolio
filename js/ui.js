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

  // ---------- The solved cube launches the email card ----------
  // A sticker flies out of the cube, lands on the card's mini cube, and the card unfolds.
  const mailCard = document.querySelector('.mail-card');
  const contact = document.querySelector('#contact');
  if (mailCard && !reducedMotion) {
    mailCard.classList.add('is-waiting');
    let delivered = false;

    const showPlainly = () => {
      if (delivered) return;
      delivered = true;
      mailCard.classList.remove('is-waiting');
      mailCard.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }],
        { duration: 600, easing: 'cubic-bezier(.2,.7,.2,1)' });
    };

    const deliver = (from) => {
      if (delivered) return;
      delivered = true;
      const icon = mailCard.querySelector('.mini-cube');
      const card = mailCard.getBoundingClientRect();
      const target = icon.getBoundingClientRect();
      const to = { x: target.left + target.width / 2, y: target.top + target.height / 2 };

      // The flying sticker, plus two fainter echoes as a trail
      const flight = 900;
      const mid = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 140 }; // arc upward
      const path = (scaleEnd, alpha) => [
        { transform: `translate(${from.x}px, ${from.y}px) translate(-50%, -50%) scale(.4) rotate(0deg)`, opacity: 0 },
        { transform: `translate(${from.x}px, ${from.y}px) translate(-50%, -50%) scale(1.25) rotate(-20deg)`, opacity: alpha, offset: 0.12 },
        { transform: `translate(${mid.x}px, ${mid.y}px) translate(-50%, -50%) scale(1) rotate(-200deg)`, opacity: alpha, offset: 0.55 },
        { transform: `translate(${to.x}px, ${to.y}px) translate(-50%, -50%) scale(${scaleEnd}) rotate(-360deg)`, opacity: alpha },
      ];
      const shots = [0, 1, 2].map((i) => {
        const el = document.createElement('div');
        el.className = 'sticker-shot';
        el.style.opacity = 0;
        if (i) el.style.filter = `blur(${i}px)`;
        document.body.appendChild(el);
        const anim = el.animate(path(i ? 0.5 : 0.85, i ? 0.35 / i : 1), {
          duration: flight, delay: i * 55, easing: 'cubic-bezier(.45,.05,.3,1)', fill: 'forwards',
        });
        return { el, anim };
      });

      shots[0].anim.finished.then(() => {
        shots.forEach(({ el }) => el.remove());
        // Unfold the card from the mini cube
        mailCard.classList.remove('is-waiting');
        const originX = to.x - card.left;
        const originY = to.y - card.top;
        mailCard.style.transformOrigin = `${originX}px ${originY}px`;
        mailCard.animate([
          { transform: 'scale(.08)', opacity: 0, filter: 'blur(4px)' },
          { transform: 'scale(1.04)', opacity: 1, filter: 'blur(0)', offset: 0.65 },
          { transform: 'scale(1)', opacity: 1 },
        ], { duration: 650, easing: 'cubic-bezier(.2,.7,.2,1)' });
        icon.animate([{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }],
          { duration: 500, delay: 250, easing: 'cubic-bezier(.3,1.6,.5,1)' });
      });
    };

    window.addEventListener('cube:solved', (e) => {
      if (!root.classList.contains('cube-ready') || root.classList.contains('no-webgl')) showPlainly();
      else deliver(e.detail);
    });

    // Safety net: never leave the email hidden (no 3D, or the solve never fires)
    if ('IntersectionObserver' in window) {
      let timer = null;
      new IntersectionObserver(([entry]) => {
        clearTimeout(timer);
        if (!entry.isIntersecting) return;
        const noCube = !root.classList.contains('cube-ready') || root.classList.contains('no-webgl');
        timer = setTimeout(showPlainly, noCube ? 300 : 4500);
      }, { threshold: 0.4 }).observe(contact);
    } else {
      showPlainly();
    }
  }

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
