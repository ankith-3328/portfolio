// Sets up the 3D scene and connects the cube to scrolling and dragging.

import * as THREE from 'three';
import { MirrorCube, LAUNCH_AT } from './cube.js';

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

// A dark photo studio with bright softbox strips: the high-contrast scene the mirror plates reflect.
// Colours above 1 make the strips brighter than white, which is what gives chrome its punch.
function studioEnvironment() {
  const env = new THREE.Scene();
  // Walls fade from a bright ceiling, through a warm mid-tone horizon, to a dark floor
  const walls = new THREE.SphereGeometry(15, 32, 16);
  const top = new THREE.Color(0xD8CCBA), mid = new THREE.Color(0x8A7662), low = new THREE.Color(0x2A221B);
  const colors = [];
  const pos = walls.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i) / 15; // -1 (floor) .. 1 (ceiling)
    const c = h > 0 ? mid.clone().lerp(top, h ** 0.7) : mid.clone().lerp(low, Math.min(1, -h * 1.2));
    colors.push(c.r, c.g, c.b);
  }
  walls.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  env.add(new THREE.Mesh(walls, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));

  const strip = (w, h, x, y, z, brightness, color = 0xFFFFFF) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(brightness), side: THREE.DoubleSide }),
    );
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  // Bright bands circling the studio: every side face picks up a chrome streak from one of them
  const band = (y, height, brightness, color) => {
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(12, 12, height, 48, 1, true),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(brightness), side: THREE.BackSide }),
    );
    ring.position.y = y;
    env.add(ring);
  };
  band(-6.5, 3.2, 1.25, 0xFFE2BC);
  band(2.5, 0.8, 2.6, 0xFFFFFF);

  strip(14, 2.2, 0.5, 9, 1, 6);              // long overhead softbox
  strip(1.4, 12, 9, 1, 4, 4.5);              // tall strip, right
  strip(1.4, 12, -8, 0, 6, 3, 0xFFE6C8);     // tall warm strip, left
  strip(10, 1.2, -2, 3, -9, 2.5);            // rim light behind
  strip(3, 3, 6, 5, 8, 3.5, 0xFFF2DE);       // key softbox in front
  strip(16, 1, 0, -2, 10, 1.2, 0xFFD9A8);    // faint low band facing the viewer
  return env;
}

// A soft round shadow drawn once onto a small canvas
function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.45, 'rgba(0,0,0,.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function init() {
  const stage = document.querySelector('.stage');
  const canvas = stage.querySelector('canvas');

  // ---- Renderer, scene, camera, lights ----
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  const baseCameraPos = new THREE.Vector3(7.8, 6.3, 9.3);

  // Something for the mirror plates to reflect
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(studioEnvironment(), 0.02).texture;
  const baseEnvIntensity = 1;
  scene.environmentIntensity = baseEnvIntensity;
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight(0xFFF6EA, 0x3B2A20, 1.7));
  const key = new THREE.DirectionalLight(0xFFFFFF, 2.0);
  key.position.set(5, 8, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xFFE2C8, 0.9);
  rim.position.set(-6, -2, -5);
  scene.add(rim);

  // ---- The cube ----
  const cube = new MirrorCube({ scrambleLength: 20, intro: !reducedMotion });
  document.documentElement.classList.add('cube-ready'); // the email card waits for the cube
  cube.camera = camera;            // lets the intro keep exploding pieces inside the canvas
  const spin = new THREE.Group(); // wrapper we rotate when the user drags
  spin.add(cube.object);
  scene.add(spin);
  spin.rotation.set(0.05, -0.35, 0);

  // Gold in the dark theme, silver in the light theme, following the page's theme toggle
  const root = document.documentElement;
  const finishFor = () => (root.dataset.theme === 'light' ? 'silver' : 'gold');
  cube.setFinish(finishFor(), true);
  new MutationObserver(() => cube.setFinish(finishFor()))
    .observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  // Soft shadow on an invisible floor, so the cube feels grounded
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(5.5, 5.5),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, opacity: 0, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -2.7;
  scene.add(shadow);
  let shadowFade = 0;

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

    // Solve glint: the reflections slide once around the plates and brighten for a moment
    const g = cube.glint;
    scene.environmentRotation.y = g === null ? 0 : Math.PI * 2 * (g * g * (3 - 2 * g));
    scene.environmentIntensity = baseEnvIntensity * (g === null ? 1 : 1 + 0.8 * Math.sin(Math.PI * g));

    // Shadow fades in with the cube, a touch lighter on the light theme
    shadowFade += ((cube.introTime > 1.2 ? 1 : 0) - shadowFade) * (1 - Math.exp(-dt * 3));
    shadow.material.opacity = shadowFade * (root.dataset.theme === 'light' ? 0.22 : 0.5);

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
