// Sets up the 3D scene and connects the cube to the page:
//   scroll       → the cube solves itself, and bursts into an exploded view between sections
//   drag a face  → twist that layer yourself (free play); scrolling again undoes your moves
//   drag around  → spin the whole cube
//   double-click → pull the cube apart / put it back together
//   cursor       → the cube leans toward it and the reflections slide across the mirror plates
//   projects     → a piece flies out of the cube for each project card and the card unfolds from it
//
// The canvas covers the whole window (so pieces can fly over the text), but the camera is
// shifted so the cube itself sits in the right-hand part of the screen.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { MirrorCube, LAUNCH_AT, notation } from './cube.js';

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

  // tilt: leans toward the cursor.  spin: what the visitor drags around.
  const tilt = new THREE.Group();
  const spin = new THREE.Group();
  spin.add(cube.object);
  tilt.add(spin);
  scene.add(tilt);
  spin.rotation.set(0.05, -0.35, 0);

  const satellites = makeSatellites(cube.mirrorMat);
  tilt.add(satellites.mesh);

  // Gold in the dark theme, silver in the light theme, following the page's theme toggle
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
  // On wide screens the cube lives in the right 54% of the window; on narrow ones it is centred.
  const wide = matchMedia('(min-width: 901px)');
  function resize() {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    const area = wide.matches ? 0.54 : 1;
    const centreX = width - (width * area) / 2;
    // Render a wider, imaginary image centred on the cube, and show only its left part
    const fullWidth = 2 * centreX;
    camera.aspect = fullWidth / height;
    // Move the camera back when the cube's area is narrow, so the whole cube fits
    const areaAspect = (width * area) / height;
    const fit = Math.max(1, 2.9 / (Math.tan(THREE.MathUtils.degToRad(16)) * baseCameraPos.length() * areaAspect));
    camera.position.copy(baseCameraPos).multiplyScalar(fit);
    camera.lookAt(0, 0, 0);
    camera.setViewOffset(fullWidth, height, 0, 0, width, height);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  // ---- Scroll → solve progress, plus the exploded-view beats between sections ----
  const sections = [...document.querySelectorAll('main section')];
  let boundaries = []; // page y of each section's top edge (after the first)
  const measure = () => {
    boundaries = sections.slice(1).map((s) => s.getBoundingClientRect().top + window.scrollY);
  };
  let target = 0;
  let current = 0;
  let scrollBurst = 0;  // 0..1: how close the viewport centre is to a section boundary
  let stageName = sections[0]?.dataset.stage || '';
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
    // The section under the middle of the screen names the stage
    let name = stageName;
    sections.forEach((s, i) => { if (i === 0 || mid >= boundaries[i - 1]) name = s.dataset.stage; });
    stageName = name;
  }
  window.addEventListener('scroll', readScroll, { passive: true });
  window.addEventListener('resize', () => { measure(); readScroll(); });
  new ResizeObserver(() => { measure(); readScroll(); }).observe(document.body);
  measure();
  readScroll();

  // ---- Pointer: parallax, hover, twisting layers, spinning the cube ----
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 }; // -1..1 over the window, and a smoothed copy
  window.addEventListener('pointermove', (e) => {
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
  stage.querySelector('.hud-reset').addEventListener('click', () => {
    if (!cube.twist && !undoing && !cube.anims.length && cube.userMoves.length) {
      undoing = true;
      cube.undoUserMoves();
    }
  });

  // Direction from the cube to the camera, flattened to horizontal (world coordinates)
  function viewerDirection() {
    const centre = new THREE.Vector3();
    cube.object.getWorldPosition(centre);
    const d = camera.position.clone().sub(centre);
    d.y = 0;
    return { centre, d: d.normalize() };
  }

  // The gap under the open lid, in page (screen) coordinates
  const launchPoint = () => {
    const { centre, d } = viewerDirection();
    const p = centre.add(new THREE.Vector3(0, 1.05, 0)).addScaledVector(d, 1.2).project(camera);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
  };

  // ---- The HUD: the solve written out in cube notation ----
  const hud = {
    stage: stage.querySelector('.hud-stage'),
    move: stage.querySelector('.hud-move'),
    total: stage.querySelector('.hud-total'),
    moves: stage.querySelector('.hud-moves'),
    hint: stage.querySelector('.hud-hint'),
    freeText: stage.querySelector('.hud-free-text'),
  };
  const pad = (n) => String(n).padStart(2, '0');
  hud.total.textContent = pad(cube.total);
  const moveItems = cube.solution.map((m) => {
    const li = document.createElement('li');
    li.textContent = notation(m);
    hud.moves.appendChild(li);
    return li;
  });
  const defaultHint = hud.hint.textContent;
  let hudKey = '';
  function updateHud() {
    const intro = !cube.introDone;
    const free = cube.freePlay;
    const done = cube.applied;
    const turning = !free && cube.progress > done && done < cube.total;
    const key = [intro, done, turning, free, cube.userMoves.length, stageName, undoing].join('|');
    if (key === hudKey) return;
    hudKey = key;

    hud.stage.textContent = intro ? 'Assembling' : stageName;
    hud.move.textContent = pad(done);
    moveItems.forEach((li, i) => {
      li.classList.toggle('is-done', i < done);
      li.classList.toggle('is-now', i === done && turning);
    });
    root.classList.toggle('cube-free', free);
    const n = cube.userMoves.length;
    hud.freeText.textContent = undoing ? 'Rewinding…'
      : n ? `Free play · ${n} move${n === 1 ? '' : 's'} · scroll resets` : 'Free play';
    const left = cube.total - done;
    hud.hint.textContent = !free && left > 0 && left <= 3 && cube.introDone
      ? `${left} move${left === 1 ? '' : 's'} from solved. Try finishing it by hand.`
      : defaultHint;
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

  // ---- Animation loop ----
  const clock = new THREE.Clock();
  let wasSolved = false;
  let explode = 0;
  let satScale = 0;

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const time = clock.elapsedTime;
    cube.tick(dt);

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
      // Open the lid on the side facing the viewer
      const toCube = cube.object.matrixWorld.clone().invert();
      cube.celebrate(viewerDirection().d.transformDirection(toCube));
      // Once the lid is open, tell the page where the gap is so it can launch the email sticker
      setTimeout(() => window.dispatchEvent(new CustomEvent('cube:solved', { detail: launchPoint() })),
        reducedMotion ? 0 : LAUNCH_AT * 1000);
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
    satScale += ((cube.introDone ? 1 : 0) - satScale) * (1 - Math.exp(-dt * 2.5));
    const satSpeed = reducedMotion ? 0.3 : 1 + Math.min(scrollSpeed / 300, 6) + satBoost * 10;
    satellites.update(dt, reducedMotion ? 0 : time, satSpeed, satScale, explode * 0.35);
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

    updateHud();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
