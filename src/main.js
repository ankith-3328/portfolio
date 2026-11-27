// Sets up the 3D scene and connects the cube to the page:
//   scroll       → the cube solves itself, and bursts into an exploded view between sections
//   drag a face  → twist that layer yourself (free play); scrolling again undoes your moves
//   drag around  → spin the whole cube
//   double-click → pull the cube apart / put it back together
//   cursor       → the cube leans toward it and the reflections slide across the mirror plates
//   projects     → a piece flies out of the cube for each project card and the card unfolds from it
//   backdrop     → a blueprint grid that bends around the cube, lit by a spotlight on the cursor
//   callouts     → a light CAD layer: the cube's live width, an XYZ axis triad, a hint, and a
//                  wireframe switch
//   cadfx        → a rotation arc on the turning layer, and the wireframe view
//
// The canvas covers the whole window, behind the content. Each section's text sits on one side and
// the cube travels to the other: the camera's view is shifted (and pulled closer or further) as you
// scroll, so the cube glides across the screen between sections.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { MirrorCube, LAUNCH_AT } from './cube.js';
import { makeBackdrop } from './backdrop.js';
import { makeCallouts } from './callouts.js';
import { makeTurnArc, makeWireframe } from './cadfx.js';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

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

const ease = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.min(Math.max(t, 0), 1);
const easeOutBack = (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);

// Tiny mirror cubelets orbiting the cube on tilted rings. They speed up while the page scrolls.
function makeSatellites(material, count = 26) {
  const mesh = new THREE.InstancedMesh(new RoundedBoxGeometry(1, 1, 1, 2, 0.16), material, count);
  const orbits = [];
  for (let i = 0; i < count; i++) {
    const ring = i % 3; // three rings, each tilted differently
    orbits.push({
      radius: 2.75 + Math.random() * 0.6,
      tilt: new THREE.Euler(0.5 + ring * 0.55 + (Math.random() - 0.5) * 0.25, ring * 1.9, 0.3 * ring),
      phase: Math.random() * Math.PI * 2,
      speed: (0.18 + Math.random() * 0.12) * (ring === 1 ? -1 : 1),
      size: 0.05 + Math.random() * 0.07,
      tumble: new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize(),
      wobble: Math.random() * Math.PI * 2,
    });
  }
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const tq = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  let travel = 0;
  return {
    mesh,
    // speed: how fast they orbit (1 = idle); scale: 0..1 grows them in; spread pushes them out
    update(dt, time, speed, scale, spread) {
      travel += dt * speed;
      orbits.forEach((o, i) => {
        const a = o.phase + travel * o.speed;
        const r = o.radius * (1 + spread) + Math.sin(time * 0.7 + o.wobble) * 0.08;
        p.set(Math.cos(a) * r, Math.sin(time * 0.9 + o.wobble) * 0.06, Math.sin(a) * r).applyEuler(o.tilt);
        q.setFromAxisAngle(o.tumble, time * 0.8 + o.wobble);
        tq.setFromAxisAngle(o.tumble, travel * 0.6);
        q.multiply(tq);
        sc.setScalar(o.size * scale);
        mesh.setMatrixAt(i, m.compose(p, q, sc));
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

function init() {
  const root = document.documentElement;
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
  root.classList.add('cube-ready'); // the email card waits for the cube
  if (import.meta.env.DEV) window.__cube = cube; // for poking at it from the console while developing

  // tilt: leans toward the cursor.  travel: turns as the cube crosses the screen.
  // spin: what the visitor drags around.
  const tilt = new THREE.Group();
  const travel = new THREE.Group();
  const spin = new THREE.Group();
  spin.add(cube.object);
  travel.add(spin);
  tilt.add(travel);
  scene.add(tilt);
  spin.rotation.set(0.05, -0.35, 0);

  const satellites = makeSatellites(cube.mirrorMat);
  tilt.add(satellites.mesh);

  // Gold in the dark theme, silver in the light theme, following the page's theme toggle
  const finishFor = () => (root.dataset.theme === 'light' ? 'silver' : 'gold');
  cube.setFinish(finishFor(), true);

  // CAD effects drawn on the cube itself
  const turnArc = makeTurnArc(cube);
  const wireframe = makeWireframe(cube);
  const cadTheme = () => [turnArc, wireframe].forEach((fx) => fx.setTheme(root.dataset.theme));
  cadTheme();

  // The blueprint grid behind everything, drawn first every frame
  const backdrop = makeBackdrop();
  backdrop.setTheme(root.dataset.theme);
  renderer.autoClear = false;

  new MutationObserver(() => { cube.setFinish(finishFor()); backdrop.setTheme(root.dataset.theme); cadTheme(); })
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

  // ---- Keep the canvas sharp at any size, and put the cube where the layout wants it ----
  const wide = matchMedia('(min-width: 901px)');
  const view = { width: 1, height: 1, fit: 1 };
  function resize() {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // The cube gets about half the screen on wide layouts: back off further when that half is narrow
    const areaAspect = (width * (wide.matches ? 0.5 : 1)) / height;
    view.fit = Math.max(1, 2.9 / (Math.tan(THREE.MathUtils.degToRad(16)) * baseCameraPos.length() * areaAspect));
    view.width = width;
    view.height = height;
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  // Where the cube sits: x, y as fractions of the screen, and its size (1 = normal)
  const anchor = { x: 0.5, y: 0.42, size: 1.1, turn: 0 };
  const camDir = baseCameraPos.clone().normalize();
  function placeCamera() {
    const { width, height, fit } = view;
    camera.position.copy(camDir).multiplyScalar(baseCameraPos.length() * fit / anchor.size);
    camera.lookAt(0, 0, 0);
    // Shift the picture so the point the camera looks at lands at (x, y) on screen
    camera.setViewOffset(width, height, width / 2 - anchor.x * width, height / 2 - anchor.y * height, width, height);
    camera.updateProjectionMatrix();
  }
  placeCamera();

  // ---- Scroll → solve progress, plus the exploded-view beats between sections ----
  const sections = [...document.querySelectorAll('main section')];
  let boundaries = []; // page y of each section's top edge (after the first)
  const measure = () => {
    boundaries = sections.slice(1).map((s) => s.getBoundingClientRect().top + window.scrollY);
  };
  let target = 0;
  let current = 0;
  let scrollBurst = 0;  // 0..1: how close the viewport centre is to a section boundary
  let lastScrollY = window.scrollY;
  let scrollSpeed = 0;  // px per second, smoothed

  function readScroll() {
    const max = root.scrollHeight - window.innerHeight;
    const ratio = max > 0 ? Math.min(window.scrollY / (max - 2), 1) : 0;
    target = ratio * cube.total;

    const mid = window.scrollY + window.innerHeight * 0.5;
    const reach = window.innerHeight * 0.42;
    scrollBurst = 0;
    boundaries.forEach((b) => {
      const d = (mid - b) / reach;
      if (Math.abs(d) < 1) scrollBurst = Math.max(scrollBurst, (1 - d * d) ** 2);
    });
  }
  window.addEventListener('scroll', readScroll, { passive: true });
  window.addEventListener('resize', () => { measure(); readScroll(); });
  new ResizeObserver(() => { measure(); readScroll(); }).observe(document.body);
  measure();
  readScroll();

  // ---- The travelling cube: one resting place per section, glided between as you scroll ----
  // Text on the left puts the cube on the right and the other way round; centred sections
  // (the hero and the finale) put the cube in the middle, larger.
  const restFor = (s) => {
    if (!wide.matches) return { x: 0.5, y: 0.45, size: 0.95 };
    const side = s.dataset.side;
    if (side === 'left') return { x: 0.75, y: 0.5, size: 0.88 };
    if (side === 'right') return { x: 0.25, y: 0.5, size: 0.88 };
    return centred.get(s).rest;
  };
  let sectionMids = [];
  // Centred sections (hero, finale): the cube must sit in the gap between the header and the
  // section's text, with clear space around it for the CAD marks. A first guess comes from the
  // gap's size; then fitCentred() measures the cube's real outline on screen and nudges its size
  // and height until it fits.
  const ROOM_TOP = 108; // below the header
  const centred = new Map(
    sections.filter((s) => s.dataset.side === 'center').map((s) => [s, {
      rest: { x: 0.5, y: 0.38, size: 0.85 },
      eyebrow: s.querySelector('.eyebrow'),
    }]),
  );
  const measureMids = () => {
    sectionMids = sections.map((s) => s.getBoundingClientRect().top + window.scrollY + s.offsetHeight / 2);
    const h = window.innerHeight;
    for (const [s, c] of centred) {
      // Where the text's top sits on screen while the cube rests here (layout position, so it
      // ignores the fade-in slide): the hero rests at the top of the page, the finale at the bottom
      const sectionTop = s === sections[0] ? 0 : h - s.offsetHeight;
      const textTop = c.eyebrow.offsetTop - s.offsetTop + sectionTop;
      const room = Math.max(textTop - 40 - ROOM_TOP, h * 0.25);
      c.rest.size = Math.min(1, room / (0.66 * h));
      c.rest.y = (ROOM_TOP + room / 2) / h;
    }
  };
  window.addEventListener('resize', measureMids);
  new ResizeObserver(measureMids).observe(document.body);
  measureMids();

  // The cube's outline on screen (px): the corners of every piece, projected
  const boxCorner = new THREE.Vector3();
  function cubeScreenBox() {
    let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity;
    for (const c of cube.cubies) {
      if (!c.group.visible || c.flying) continue; // pieces out on the cards don't count
      for (let i = 0; i < 8; i++) {
        boxCorner.set(
          c.centre.x + (i & 1 ? 0.5 : -0.5) * c.size.x,
          c.centre.y + (i & 2 ? 0.5 : -0.5) * c.size.y,
          c.centre.z + (i & 4 ? 0.5 : -0.5) * c.size.z,
        );
        c.group.localToWorld(boxCorner).project(camera);
        const y = (1 - boxCorner.y) / 2 * view.height;
        const x = (boxCorner.x + 1) / 2 * view.width;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
    return { top, bottom, left, right };
  }

  // While resting in a centred section, keep the real outline inside the gap above its text
  function fitCentred(dt) {
    if (!wide.matches || !cube.introDone || cube.celebration !== Infinity) return; // not during the solve glint
    const s = anchorK === 0 ? sections[anchorSection] : anchorK === 1 ? sections[anchorSection + 1] : null;
    const c = s && centred.get(s);
    if (!c) return;
    cube.object.updateWorldMatrix(true, true);
    const box = cubeScreenBox();
    const height = box.bottom - box.top;
    if (!(height > 0)) return;
    const bottom = c.eyebrow.getBoundingClientRect().top - 40;
    const room = Math.max(bottom - ROOM_TOP, view.height * 0.2);
    const rate = 1 - Math.exp(-dt * 5);
    // Shrink quickly if it is too big, grow back slowly (it changes shape as it turns)
    const want = THREE.MathUtils.clamp(room / height, 0.85, 1.15);
    const grow = want < 1 ? rate : rate * 0.3;
    c.rest.size = Math.min(1.05, c.rest.size * (1 + (want - 1) * grow));
    const off = (ROOM_TOP + room / 2) - (box.top + box.bottom) / 2;
    c.rest.y += (off / view.height) * rate;
  }

  let anchorSection = 0;
  let anchorK = 0;
  function updateAnchor() {
    const mid = window.scrollY + window.innerHeight / 2;
    let i = 0;
    while (i < sectionMids.length - 2 && mid > sectionMids[i + 1]) i++;
    const span = sectionMids[i + 1] - sectionMids[i];
    const t = span > 0 ? clamp01((mid - sectionMids[i]) / span) : 0;
    // Rest for a while at each section, then glide: most of the move happens mid-way between them
    const k = reducedMotion ? (t < 0.5 ? 0 : 1) : ease(clamp01((t - 0.22) / 0.56));
    anchorSection = i;
    anchorK = k;
    const a = restFor(sections[i]);
    const b = restFor(sections[i + 1] || sections[i]);
    anchor.x = a.x + (b.x - a.x) * k;
    anchor.y = a.y + (b.y - a.y) * k;
    // A little bigger in the middle of the trip: it swings toward the viewer as it crosses
    anchor.size = (a.size + (b.size - a.size) * k) * (1 + 0.08 * Math.sin(Math.PI * k));
    // Half a turn per crossing, so the cube shows a new side in every section
    anchor.turn = (i + k) * Math.PI * 0.5;
  }

  // ---- Pointer: parallax, hover, twisting layers, spinning the cube ----
  const pointer = { x: 0, y: 0, sx: 0, sy: 0, px: -1e4, py: -1e4, at: -1e9 }; // -1..1, smoothed, and px
  window.addEventListener('pointermove', (e) => {
    pointer.px = e.clientX;
    pointer.py = e.clientY;
    pointer.at = performance.now();
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const cubieOf = (obj) => {
    for (let o = obj; o; o = o.parent) if (o.userData.cubie) return o.userData.cubie;
    return null;
  };
  // What is under the pointer: a piece of the cube (and which face of it), or nothing
  function pick(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    for (const hit of raycaster.intersectObject(cube.core, true)) {
      const cubie = cubieOf(hit.object);
      if (cubie && hit.face) return { cubie, hit };
    }
    return null;
  }

  // Screen position (px) of a world point
  const toScreen = (v) => {
    const p = v.clone().project(camera);
    const r = canvas.getBoundingClientRect();
    return new THREE.Vector2((p.x + 1) / 2 * r.width, (1 - p.y) / 2 * r.height);
  };

  // A drag that started on a face: decide which layer it turns, and which way.
  // The face's two in-plane directions are tried on screen; the one the drag follows best wins.
  // Turning about (normal × direction) moves the grabbed sticker along that direction.
  function planTwist(g, dx, dy) {
    const coreWorld = cube.core.matrixWorld;
    const toCore = coreWorld.clone().invert();
    const nWorld = g.hit.face.normal.clone().transformDirection(g.hit.object.matrixWorld);
    const nLocal = nWorld.transformDirection(toCore);
    const axes = ['x', 'y', 'z'];
    const nAxis = axes.reduce((a, b) => (Math.abs(nLocal[a]) >= Math.abs(nLocal[b]) ? a : b));
    const normal = new THREE.Vector3();
    normal[nAxis] = Math.sign(nLocal[nAxis]);

    const drag = new THREE.Vector2(dx, dy);
    const from = toScreen(g.hit.point);
    let best = null;
    for (const tAxis of axes.filter((a) => a !== nAxis)) {
      const t = new THREE.Vector3();
      t[tAxis] = 1;
      const tWorld = t.clone().transformDirection(coreWorld);
      const screen = toScreen(g.hit.point.clone().addScaledVector(tWorld, 0.5)).sub(from);
      const len = screen.length();
      if (len < 1e-3) continue;
      const score = Math.abs(drag.dot(screen) / (len * drag.length()));
      if (!best || score > best.score) best = { score, t, screen, len };
    }
    if (!best) return null;

    const sign = Math.sign(drag.dot(best.screen)) || 1;
    const t = best.t.multiplyScalar(sign);
    const r = new THREE.Vector3().crossVectors(normal, t);
    const rAxis = axes.reduce((a, b) => (Math.abs(r[a]) >= Math.abs(r[b]) ? a : b));
    const layer = Math.round(g.cubie.pos[rAxis]);
    if (layer === 0) return null; // the middle slice stays put: spin the cube instead

    return {
      axis: rAxis,
      layer,
      dir: best.screen.clone().multiplyScalar(sign / best.len), // screen direction of a positive turn
      perRadian: (best.len / 0.5) * 1.5,                       // px of drag per radian of turn
      sign: Math.sign(r[rAxis]),
    };
  }

  let gesture = null;
  let velX = 0;
  let velY = 0;
  let frozenTarget = null; // scroll target when free play began; scrolling away from it undoes the moves
  let undoing = false;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const hit = pick(e);
    const canTwist = hit && cube.canTwist && cube.atRest && cube.explode < 0.15 && !undoing && !piecesAway();
    gesture = canTwist
      ? { mode: 'pending', ...hit, x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastY: e.clientY }
      : { mode: 'spin', lastX: e.clientX, lastY: e.clientY };
    canvas.setPointerCapture(e.pointerId);
    stage.classList.add('is-dragging');
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!gesture) {
      root.classList.toggle('cube-hover', !!pick(e));
      return;
    }
    const dx = e.clientX - gesture.x0;
    const dy = e.clientY - gesture.y0;

    if (gesture.mode === 'pending' && Math.hypot(dx, dy) > 6) {
      const plan = planTwist(gesture, dx, dy);
      if (plan) {
        Object.assign(gesture, { mode: 'twist', plan, angle: 0, angVel: 0, t: performance.now() });
        if (frozenTarget === null) frozenTarget = target;
      } else {
        gesture.mode = 'spin';
      }
    }

    if (gesture.mode === 'twist') {
      const { plan } = gesture;
      const along = (dx * plan.dir.x + dy * plan.dir.y) / plan.perRadian;
      const angle = plan.sign * along;
      const now = performance.now();
      const dt = Math.max(1, now - gesture.t) / 1000;
      gesture.angVel = gesture.angVel * 0.5 + ((angle - gesture.angle) / dt) * 0.5;
      gesture.angle = angle;
      gesture.t = now;
      cube.setTwist(plan.axis, plan.layer, angle);
    } else if (gesture.mode === 'spin') {
      velY = (e.clientX - gesture.lastX) * 0.01;
      velX = (e.clientY - gesture.lastY) * 0.01;
      spin.rotation.y += velY;
      spin.rotation.x = THREE.MathUtils.clamp(spin.rotation.x + velX, -1.1, 1.1);
    }
    gesture.lastX = e.clientX;
    gesture.lastY = e.clientY;
  });

  const endGesture = () => {
    if (gesture?.mode === 'twist') {
      // A flick carries the turn on: a quick drag past ~25° counts as a full quarter
      const idle = performance.now() - gesture.t > 80;
      cube.releaseTwist(idle ? 0 : THREE.MathUtils.clamp(gesture.angVel * 0.08, -0.6, 0.6));
    }
    gesture = null;
    stage.classList.remove('is-dragging');
  };
  canvas.addEventListener('pointerup', endGesture);
  canvas.addEventListener('pointercancel', endGesture);
  canvas.addEventListener('pointerleave', () => root.classList.remove('cube-hover'));

  // Double-click: an exploded view, so you can see the mechanism inside
  let explodeHeld = false;
  canvas.addEventListener('dblclick', () => {
    if (!cube.introDone || cube.twist) return;
    explodeHeld = !explodeHeld;
  });

  // ---- Free play, undo, and solving it by hand ----
  const toast = stage.querySelector('.toast');
  let toastTimer = null;
  // The toast appears above the cube, wherever it is on screen
  const followCube = () => { toast.style.left = `${anchor.x * view.width}px`; };

  function showToast(text) {
    toast.textContent = text;
    toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-on'), 4200);
  }

  let satBoost = 0; // satellites whirl after a hand solve
  cube.onUserMove = (count, solved) => {
    if (solved && !cube.isSolved) {
      const toCube = cube.object.matrixWorld.clone().invert();
      cube.celebrate(viewerDirection().d.transformDirection(toCube));
      satBoost = 1;
      showToast(count <= 3 ? 'Nice finish. You solved it by hand.' : `Solved by hand in ${count} moves. Respect.`);
    }
  };
  cube.onUndone = () => {
    undoing = false;
    frozenTarget = null;
  };

  // Direction from the cube to the camera, flattened to horizontal (world coordinates)
  function viewerDirection() {
    const centre = new THREE.Vector3();
    cube.object.getWorldPosition(centre);
    const d = camera.position.clone().sub(centre);
    d.y = 0;
    return { centre, d: d.normalize() };
  }

  // ---- Pieces that fly out of the cube and become cards ----
  // About tiles, experience cards, project cards and achievement tiles each own one piece of the cube. As a card
  // scrolls into view its piece pops out, arcs across the page and shrinks into a small tile in the
  // card's corner; the card unfolds from that tile. When the card nears the top of the screen the
  // piece lifts off again and flies home (the card stays open), so the cube is whole for the finale.
  const flyItems = [...document.querySelectorAll('#about .facts .tile, #experience .exp-card, #projects .card, #skills .achievements .tile')];
  // Corners first, then edges: every card gets a different piece
  const pieces = cube.cubies
    .filter((c) => !c.center)
    .sort((a, b) => (Math.abs(b.home.x) + Math.abs(b.home.y) + Math.abs(b.home.z))
      - (Math.abs(a.home.x) + Math.abs(a.home.y) + Math.abs(a.home.z)));
  const flights = flyItems.map((card, i) => {
    const badge = document.createElement('span');
    badge.className = 'card-cubie';
    badge.setAttribute('aria-hidden', 'true');
    card.appendChild(badge);
    card.classList.add('flies');
    // The flight is its entrance instead of the fade (on the card, or the group that holds it)
    card.classList.remove('reveal');
    card.parentElement.closest('.reveal')?.classList.remove('reveal');
    const r = () => Math.random() - 0.5;
    return {
      card, badge,
      cubie: pieces[i % pieces.length],
      spinAxis: new THREE.Vector3(r(), r(), r()).normalize(),
      f: 0, shown: -1, landed: null,
    };
  });

  // Page-space position of an element's top-left (ignores transforms, unlike getBoundingClientRect)
  const pageOffset = (el) => {
    let x = 0, y = 0;
    for (let e = el; e; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; }
    return { x, y };
  };
  const piecesAway = () => flights.some((fl) => fl.f > 0);

  const flyTmp = {
    slot: new THREE.Vector3(), out: new THREE.Vector3(), target: new THREE.Vector3(), p: new THREE.Vector3(),
    coreQ: new THREE.Quaternion(), q: new THREE.Quaternion(), land: new THREE.Quaternion(), spinQ: new THREE.Quaternion(),
    landTilt: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.45, 0.55, 0)),
  };
  const bezier = (a, b, c, d, t, out) => {
    const u = 1 - t;
    return out.set(0, 0, 0).addScaledVector(a, u * u * u).addScaledVector(b, 3 * u * u * t)
      .addScaledVector(c, 3 * u * t * t).addScaledVector(d, t * t * t);
  };

  function updateFlights() {
    const enabled = wide.matches && !reducedMotion && cube.introDone;
    const vh = window.innerHeight;
    const { slot, out, target, p, coreQ, q, land, spinQ, landTilt } = flyTmp;
    cube.object.updateWorldMatrix(true, true);
    cube.core.getWorldQuaternion(coreQ);
    const coreQInv = coreQ.clone().invert();
    const camDist = camera.position.length();

    for (const fl of flights) {
      const { card, badge, cubie } = fl;
      const at = pageOffset(card);
      const top = at.y - window.scrollY;
      const bottom = top + card.offsetHeight;
      // Side-by-side tiles: the right-hand one follows a beat later
      const lag = card.offsetLeft > card.parentElement.firstElementChild.offsetLeft + 4 ? vh * 0.07 : 0;
      // In: the card's top travels from just below the screen to 62% down it
      const arrive = enabled ? ease(clamp01((vh * 1.05 - top - lag) / (vh * 0.43))) : 0;
      // Out: as the card's bottom edge nears the top of the screen, the piece goes home
      const leave = clamp01((vh * 0.3 - bottom) / (vh * 0.3));
      const f = arrive * (1 - ease(leave));
      fl.f = f;
      if (cubie) cubie.flying = f > 0;

      const landed = !enabled || f > 0.95;
      if (landed !== fl.landed) {
        fl.landed = landed;
        badge.classList.toggle('is-landed', landed);
      }

      // The card unfolds from the tile during the last part of the flight in (and stays open after)
      const u = enabled ? clamp01((arrive - 0.86) / 0.14) : 1;
      if (u !== fl.shown) {
        fl.shown = u;
        const ox = badge.offsetLeft + badge.offsetWidth / 2;
        const oy = badge.offsetTop + badge.offsetHeight / 2;
        if (u >= 1) {
          card.style.opacity = card.style.transform = card.style.transformOrigin = '';
        } else {
          card.style.transformOrigin = `${ox}px ${oy}px`;
          card.style.opacity = Math.min(1, u * 2.5);
          card.style.transform = `scale(${0.06 + 0.94 * Math.max(0, easeOutBack(u))})`;
        }
        card.classList.toggle('is-unfolding', u < 1);
      }

      if (!cubie) continue;
      if (f <= 0) { cubie.group.visible = true; continue; }
      cubie.group.visible = f < 0.97;

      // Where the piece sits in the cube right now (world), and a point just outside it
      slot.copy(cubie.group.position);
      out.copy(slot).multiplyScalar(1 + 1.3 / Math.max(slot.length(), 0.5));
      cube.core.localToWorld(slot);
      cube.core.localToWorld(out);

      // Where the tile is on screen, as a point between the camera and the cube
      const bx = at.x + badge.offsetLeft + badge.offsetWidth / 2;
      const by = top + badge.offsetTop + badge.offsetHeight / 2;
      ndc.set((bx / window.innerWidth) * 2 - 1, -(by / vh) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const depth = camDist * 0.72;
      target.copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction, depth);
      const pxPerUnit = vh / (2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      const pieceSize = Math.max(cubie.size.x, cubie.size.y, cubie.size.z);
      const landScale = (badge.offsetWidth * 1.1) / (pieceSize * pxPerUnit);

      // 0 → 0.18: pop out of its slot.  0.18 → 0.9: arc to the tile.  0.9 → 1: settle and shrink in.
      const pop = ease(clamp01(f / 0.18));
      const fly = clamp01((f - 0.18) / 0.72);
      if (fly === 0) {
        p.lerpVectors(slot, out, pop);
      } else {
        const lift = new THREE.Vector3(0, 1.6, 0);
        bezier(out, out.clone().add(lift), target.clone().add(lift), target, ease(fly), p);
      }
      const scale = THREE.MathUtils.lerp(1, landScale, ease(fly)) * (f > 0.9 ? 1 - 0.15 * Math.sin(Math.PI * clamp01((f - 0.9) / 0.1)) : 1);

      // Turn from its place in the cube to face the camera, tumbling once on the way
      q.copy(coreQ).multiply(cubie.group.quaternion);       // world orientation in the cube
      land.copy(camera.quaternion).multiply(landTilt);       // world orientation on landing
      q.slerp(land, ease(fly));
      spinQ.setFromAxisAngle(fl.spinAxis, Math.PI * 2 * ease(fly));
      q.multiply(spinQ);

      cubie.group.position.copy(cube.core.worldToLocal(p.clone()));
      cubie.group.quaternion.copy(coreQInv).multiply(q);
      cubie.group.scale.setScalar(scale);
    }
  }

  // ---- Callouts and the live size readout ----
  const callouts = makeCallouts(stage, { onWireframe: (on) => wireframe.toggle(on) });

  // The cube's real size, from where its pieces actually are (not from the screen). A solved
  // mirror cube is a 57 mm box; scrambled, its lumpy shape is bigger, and it shrinks to 57.0 × 57.0
  // as the solve finishes.
  const corner = new THREE.Vector3();
  function extents(useHome) {
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const c of cube.cubies) {
      for (let i = 0; i < 8; i++) {
        corner.set(
          c.centre.x + (i & 1 ? 0.5 : -0.5) * c.size.x,
          c.centre.y + (i & 2 ? 0.5 : -0.5) * c.size.y,
          c.centre.z + (i & 4 ? 0.5 : -0.5) * c.size.z,
        );
        if (useHome) corner.add(c.home);
        else corner.applyQuaternion(c.quat).add(c.pos);
        min.min(corner);
        max.max(corner);
      }
    }
    return max.sub(min);
  }
  const mmPerUnit = 57 / extents(true).x;

  // Smoothed outline of the cube on screen, shared by the callouts and the backdrop
  const sbox = { left: 0, right: 0, top: 0, bottom: 0, ready: false };
  let calloutAlpha = 0;

  // The cube's own X, Y and Z axes as the camera sees them (x right, y up, z toward the viewer),
  // for the axis triad
  const axisVec = new THREE.Vector3();
  const axisDirections = () => ['x', 'y', 'z'].map((name) => {
    axisVec.set(name === 'x' ? 1 : 0, name === 'y' ? 1 : 0, name === 'z' ? 1 : 0)
      .transformDirection(cube.core.matrixWorld).transformDirection(camera.matrixWorldInverse);
    return { name, x: axisVec.x, y: axisVec.y, z: axisVec.z };
  });

  // One short line on what is going on, or what you can do
  function statusText() {
    const n = cube.userMoves.length;
    if (cube.freePlay) return n ? `free play · ${n} move${n === 1 ? '' : 's'}` : 'free play';
    if (cube.isSolved) return 'every piece home';
    const out = flights.filter((fl) => fl.f > 0).length;
    if (out) return ''; // nothing to do while pieces are out on the cards
    const left = cube.total - cube.applied;
    if (left <= 3) return `${left} to go · finish it by hand`;
    return 'drag a face to twist';
  }

  function updateOverlays(dt, time) {
    const W = view.width, H = view.height;

    // Measure the cube (once it has assembled) and ease the outline toward it
    if (cube.introDone) {
      const box = cubeScreenBox();
      if (Number.isFinite(box.top)) {
        const k = sbox.ready ? 1 - Math.exp(-dt * 8) : 1;
        for (const key of ['left', 'right', 'top', 'bottom']) sbox[key] += (box[key] - sbox[key]) * k;
        sbox.ready = true;
      }
    }

    // Callouts: only while the cube is resting in a section (they fade out while it travels)
    const resting = 1 - clamp01(Math.min(anchorK, 1 - anchorK) * 6);
    const want = wide.matches && cube.introDone && sbox.ready ? resting : 0;
    calloutAlpha += (want - calloutAlpha) * (1 - Math.exp(-dt * (want > calloutAlpha ? 4 : 10)));
    const idx = anchorK > 0.5 ? anchorSection + 1 : anchorSection;
    const section = sections[Math.min(idx, sections.length - 1)];
    const width = extents(false).x * mmPerUnit;
    const layout = section.dataset.side === 'center' ? 'side' : 'stack';
    callouts.update({
      box: sbox, W, layout,
      outer: anchor.x > 0.5 ? 1 : -1,
      alpha: calloutAlpha,
      texts: { status: statusText(), width: `${width.toFixed(1)} mm` },
      axes: axisDirections(),
    });

    // Backdrop: where the cube and the cursor are
    const u = backdrop.uniforms;
    u.uRes.value.set(W, H);
    if (sbox.ready) {
      u.uCube.value.set((sbox.left + sbox.right) / 2, (sbox.top + sbox.bottom) / 2);
      u.uCubeR.value = Math.max(sbox.right - sbox.left, sbox.bottom - sbox.top) / 2;
    } else {
      u.uCube.value.set(anchor.x * W, anchor.y * H);
      u.uCubeR.value = H * 0.25;
    }
    u.uMouse.value.set(pointer.px, pointer.py);
    const mouseOn = finePointer && performance.now() - pointer.at < 3000 ? 1 : 0;
    u.uMouseOn.value += (mouseOn - u.uMouseOn.value) * (1 - Math.exp(-dt * 3));
    u.uScroll.value = window.scrollY;
    u.uGrainSeed.value = reducedMotion ? 0 : (Math.floor(time * 12) * 37.31) % 997;
  }

  // ---- Animation loop ----
  const clock = new THREE.Clock();
  let wasSolved = false;
  let explode = 0;
  let satScale = 0;
  let satKick = 0;      // 1 → 0: satellites flung outward when the intro locks
  let introBurst = false;

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const time = clock.elapsedTime;
    cube.tick(dt);

    // Glide the cube toward this scroll position's place on screen, turning as it travels
    updateAnchor();
    placeCamera();
    fitCentred(dt);
    travel.rotation.y = anchor.turn;

    // Free play holds the scroll solve. Scroll noticeably away and the visitor's moves rewind.
    if (!cube.freePlay && !undoing) frozenTarget = null;
    if (frozenTarget !== null && !undoing && !cube.twist && !cube.anims.length &&
        Math.abs(target - frozenTarget) > 0.35) {
      undoing = true;
      cube.undoUserMoves();
    }

    // Ease the cube toward the scroll position instead of jumping
    if (!cube.freePlay) {
      current = reducedMotion ? target : current + (target - current) * (1 - Math.exp(-dt * 5));
      if (Math.abs(target - current) < 0.0005) current = target;
      // The last turn looks finished slightly before the maths says so: count it as done right then
      if (target === cube.total && cube.total - current < 0.12) current = target;
    }
    cube.setProgress(current);

    // Celebrate the moment the cube becomes solved
    const solved = cube.isSolved && !cube.freePlay;
    if (solved && !wasSolved && cube.introDone) {
      // The glint crosses the side facing the viewer
      const toCube = cube.object.matrixWorld.clone().invert();
      cube.celebrate(viewerDirection().d.transformDirection(toCube));
      // As the glint finishes, tell the page: the contact title block draws itself in
      setTimeout(() => window.dispatchEvent(new CustomEvent('cube:solved')), reducedMotion ? 0 : LAUNCH_AT * 1000);
    }
    if (!cube.freePlay) wasSolved = solved;

    // Exploded view: held by double-click, or a short burst as you cross into a new section
    const burst = reducedMotion || cube.freePlay || !cube.introDone ? 0 : scrollBurst * 0.6;
    const wantExplode = Math.max(explodeHeld ? 1 : 0, burst);
    explode += (wantExplode - explode) * (1 - Math.exp(-dt * (explodeHeld ? 4 : 9)));
    if (explode < 1e-3) explode = 0;
    cube.explode = explode;
    cube.draw();
    updateFlights();
    turnArc.update(dt, camera);
    wireframe.update(dt);

    // Pointer parallax, smoothed: the cube leans toward the cursor
    const follow = 1 - Math.exp(-dt * 3);
    pointer.sx += (pointer.x - pointer.sx) * follow;
    pointer.sy += (pointer.y - pointer.sy) * follow;
    if (!reducedMotion) {
      tilt.rotation.y = pointer.sx * 0.16;
      tilt.rotation.x = pointer.sy * 0.09;
    }

    // Reflections: the solve glint sweeps them once around; otherwise they follow the cursor
    const g = cube.glint;
    const sweep = g === null ? 0 : Math.PI * 2 * (g * g * (3 - 2 * g));
    scene.environmentRotation.y = sweep + (reducedMotion ? 0 : pointer.sx * 0.7);
    scene.environmentRotation.x = reducedMotion ? 0 : pointer.sy * 0.25;
    scene.environmentIntensity = baseEnvIntensity * (g === null ? 1 : 1 + 0.8 * Math.sin(Math.PI * g));

    // Satellites: grow in after the intro, whirl with scroll speed, scatter when the cube explodes
    const sy = window.scrollY;
    scrollSpeed += (Math.abs(sy - lastScrollY) / Math.max(dt, 1e-3) - scrollSpeed) * (1 - Math.exp(-dt * 6));
    lastScrollY = sy;
    satBoost = Math.max(0, satBoost - dt * 0.5);
    // The cube locking together throws the satellites out, and they spin back into orbit
    if (cube.introDone && !introBurst) { introBurst = true; if (!reducedMotion) { satScale = 1; satBoost = 0.7; satKick = 1; } }
    satKick = Math.max(0, satKick - dt * 1.6);
    satScale += ((cube.introDone ? 1 : 0) - satScale) * (1 - Math.exp(-dt * 2.5));
    const satSpeed = reducedMotion ? 0.3 : 1 + Math.min(scrollSpeed / 300, 6) + satBoost * 10;
    satellites.update(dt, reducedMotion ? 0 : time, satSpeed, satScale, explode * 0.35 + 0.9 * satKick * satKick);
    satellites.mesh.visible = satScale > 0.01;

    // Shadow fades in with the cube, a touch lighter on the light theme
    shadowFade += ((cube.introTime > 0.5 ? 1 : 0) - shadowFade) * (1 - Math.exp(-dt * 3));
    shadow.material.opacity = shadowFade * (root.dataset.theme === 'light' ? 0.22 : 0.5) * (1 - explode * 0.4);

    if (!gesture || gesture.mode !== 'spin') {
      spin.rotation.y += velY;
      spin.rotation.x = THREE.MathUtils.clamp(spin.rotation.x + velX, -1.1, 1.1);
      velY *= 0.94;
      velX *= 0.94;
      // Hold still while the visitor is turning layers, so the face they grabbed stays put
      if (!cube.freePlay) {
        spin.rotation.x += (0.05 - spin.rotation.x) * dt * 1.2; // drift back to a nice angle
        if (!reducedMotion) spin.rotation.y += dt * 0.12;      // slow idle turn
      }
    }

    followCube();
    updateOverlays(dt, time);
    renderer.clear();
    // On narrow screens the grid comes from CSS (the canvas is only a faint backdrop there)
    if (wide.matches) renderer.render(backdrop.scene, backdrop.camera);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
