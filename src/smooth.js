// Smooth, inertia-based scrolling (desktop). Phones keep their native scrolling.
// Kept in its own file: if the library fails to load, the page scrolls normally.

import Lenis from 'lenis';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!reducedMotion) {
  const lenis = new Lenis({
    lerp: 0.09,          // lower = floatier
    wheelMultiplier: 0.9,
    anchors: true,       // nav links glide to their section
    autoRaf: true,
  });
  window.lenis = lenis;
}
