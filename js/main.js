// Sets up the 3D scene and connects the cube to scrolling and dragging.

import * as THREE from 'three';
import { RubiksCube, LAUNCH_AT } from './cube.js';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

if (webglAvailable()) {
  try {
    init();
  } catch (err) {
    console.error(err);
    document.documentElement.classList.add('no-webgl');
  }
} else {
  document.documentElement.classList.add('no-webgl');
}

function init() {
  const stage = document.querySelector('.stage');
  const canvas = stage.querySelector('canvas');

  // ---- Renderer, scene, camera, lights ----
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  const baseCameraPos = new THREE.Vector3(7.2, 5.8, 8.6);

  scene.add(new THREE.HemisphereLight(0xFFF6EA, 0x3B2A20, 1.7));
  const key = new THREE.DirectionalLight(0xFFFFFF, 2.0);
  key.position.set(5, 8, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xFFE2C8, 0.9);
  rim.position.set(-6, -2, -5);
  scene.add(rim);

  // ---- The cube ----
  const cube = new RubiksCube({ scrambleLength: 20, intro: !reducedMotion });
  document.documentElement.classList.add('cube-ready'); // the email card waits for the cube
  const spin = new THREE.Group(); // wrapper we rotate when the user drags
  spin.add(cube.object);
  scene.add(spin);
  spin.rotation.set(0.05, -0.35, 0);

  // ---- Keep the canvas sharp at any size ----
  function resize() {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Move the camera back on narrow screens so the whole cube fits
    const fit = Math.max(1, 2.9 / (Math.tan(THREE.MathUtils.degToRad(16)) * baseCameraPos.length() * camera.aspect));
    camera.position.copy(baseCameraPos).multiplyScalar(fit);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  // ---- Scroll → solve progress ----
  let target = 0;
  let current = 0;
  function readScroll() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = max > 0 ? Math.min(window.scrollY / (max - 2), 1) : 0;
    target = ratio * cube.total;
  }
  window.addEventListener('scroll', readScroll, { passive: true });
  window.addEventListener('resize', readScroll);
  readScroll();

  // ---- Drag to spin the whole cube ----
  let gesture = null;
  let velX = 0;
  let velY = 0;

  canvas.addEventListener('pointerdown', (e) => {
    gesture = { lastX: e.clientX, lastY: e.clientY };
    canvas.setPointerCapture(e.pointerId);
    stage.classList.add('is-dragging');
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!gesture) return;
    velY = (e.clientX - gesture.lastX) * 0.01;
    velX = (e.clientY - gesture.lastY) * 0.01;
    spin.rotation.y += velY;
    spin.rotation.x = THREE.MathUtils.clamp(spin.rotation.x + velX, -1.1, 1.1);
    gesture.lastX = e.clientX;
    gesture.lastY = e.clientY;
  });

  const endGesture = () => {
    gesture = null;
    stage.classList.remove('is-dragging');
  };
  canvas.addEventListener('pointerup', endGesture);
  canvas.addEventListener('pointercancel', endGesture);

  // Direction from the cube to the camera, flattened to horizontal (world coordinates)
  const viewerDirection = () => {
    const centre = new THREE.Vector3();
    cube.object.getWorldPosition(centre);
    const d = camera.position.clone().sub(centre);
    d.y = 0;
    return { centre, d: d.normalize() };
  };

  // The gap under the open lid, in page (screen) coordinates
  const launchPoint = () => {
    const { centre, d } = viewerDirection();
    const p = centre.add(new THREE.Vector3(0, 1.05, 0)).addScaledVector(d, 1.2).project(camera);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
  };

  // ---- Animation loop ----
  const clock = new THREE.Clock();
  let wasSolved = false;

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    cube.tick(dt);

    // Ease the cube toward the scroll position instead of jumping
    current = reducedMotion ? target : current + (target - current) * (1 - Math.exp(-dt * 5));
    if (Math.abs(target - current) < 0.0005) current = target;
    // The last turn looks finished slightly before the maths says so: count it as done right then
    if (target === cube.total && cube.total - current < 0.12) current = target;
    cube.setProgress(current);

    // Celebrate the moment the cube becomes solved
    const solved = cube.isSolved;
    if (solved && !wasSolved && cube.introDone) {
      // Open the lid on the side facing the viewer
      const toCube = cube.object.matrixWorld.clone().invert();
      cube.celebrate(viewerDirection().d.transformDirection(toCube));
      // Once the lid is open, tell the page where the gap is so it can launch the email sticker
      setTimeout(() => window.dispatchEvent(new CustomEvent('cube:solved', { detail: launchPoint() })),
        reducedMotion ? 0 : LAUNCH_AT * 1000);
    }
    wasSolved = solved;

    if (!gesture) {
      spin.rotation.y += velY;
      spin.rotation.x = THREE.MathUtils.clamp(spin.rotation.x + velX, -1.1, 1.1);
      velY *= 0.94;
      velX *= 0.94;
      spin.rotation.x += (0.05 - spin.rotation.x) * dt * 1.2; // drift back to a nice angle
      if (!reducedMotion) spin.rotation.y += dt * 0.12;             // slow idle turn
    }

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
