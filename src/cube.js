// A 3x3 mirror cube driven by scrolling.
// Same mechanism as a Rubik's cube, but every piece is one polished-gold colour and the layers have
// different thicknesses, so a scrambled cube is a lumpy shape and "solved" means "a perfect box again".
// The scroll position decides how many solution moves are done:
// progress 7.4 = "7 moves done, the 8th is 40% through". Scrolling up undoes moves.
//
// Plus two bits of theatre: the cube is drafted as a blueprint on load (wire outlines, then a scanner
// turns them into metal, then it scrambles itself), and it does a victory flourish when solved.
//
// It is also playable: grab a face and twist a layer yourself (free play). While you are playing,
// the scroll solve waits; main.js undoes your moves when you scroll again.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Mirror plates on a dark body: warm gold in the dark theme, polished silver in the light one.
// Each plate sits on a slightly larger, satin "brushed" rim that catches light along its edges.
const FINISHES = {
  gold: { plate: new THREE.Color(0xE8BE78), rim: new THREE.Color(0xB0803C), wire: new THREE.Color(0xE89A72) },
  silver: { plate: new THREE.Color(0xEEF0F4), rim: new THREE.Color(0x9EA3AC), wire: new THREE.Color(0xC96442) },
};
const BODY_COLOR = 0x1E1814;

// The cuts sit at ±0.5 around the core on every axis (that is what lets the layers turn),
// but the outer box is shifted, so the two outer layers on each axis are different thicknesses.
// e.g. x: left layer 0.62 thick, middle 1, right layer 1.38.
const OFFSET = new THREE.Vector3(0.38, 0.26, -0.2);

const AXES = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

const GAP = 0.035;        // dark seam between pieces
const PLATE_INSET = 0.07; // how far the mirror plate stops short of a piece's edges
const RIM = 0.028;        // width of the brushed rim showing around each plate

// The slab of space a layer occupies along one axis: [min, max]
function slab(axis, layer) {
  if (layer === 0) return [-0.5, 0.5];
  return layer < 0 ? [-1.5 + OFFSET[axis], -0.5] : [0.5, 1.5 + OFFSET[axis]];
}

// A move: { axis: 'x'|'y'|'z', layer: -1|0|1, q: +1|-1 } = turn that layer by q·90° about +axis
const invert = (m) => ({ ...m, q: -m.q });
const angleOf = (m) => m.q * (Math.PI / 2);
const QUARTER = Math.PI / 2;

// Standard cube notation for a move: R, U' and so on (clockwise as seen looking at that face)
const FACE = { x: ['L', 'R'], y: ['D', 'U'], z: ['B', 'F'] };
export function notation(m) {
  const clockwise = m.q === -m.layer;
  return FACE[m.axis][m.layer > 0 ? 1 : 0] + (clockwise ? '' : '′');
}

function randomMoves(length, random = Math.random, lastAxis = null) {
  const axes = ['x', 'y', 'z'];
  const moves = [];
  while (moves.length < length) {
    const axis = axes[Math.floor(random() * 3)];
    if (axis === lastAxis) continue; // avoid moves that cancel or merge
    moves.push({ axis, layer: random() < 0.5 ? -1 : 1, q: random() < 0.5 ? -1 : 1 });
    lastAxis = axis;
  }
  return moves;
}

function roundedRect(w, h, radius) {
  const x = w / 2;
  const y = h / 2;
  const s = new THREE.Shape();
  s.moveTo(-x + radius, -y);
  s.lineTo(x - radius, -y);
  s.quadraticCurveTo(x, -y, x, -y + radius);
  s.lineTo(x, y - radius);
  s.quadraticCurveTo(x, y, x - radius, y);
  s.lineTo(-x + radius, y);
  s.quadraticCurveTo(-x, y, -x, y - radius);
  s.lineTo(-x, -y + radius);
  s.quadraticCurveTo(-x, -y, -x + radius, -y);
  return new THREE.ShapeGeometry(s, 6);
}

const clamp01 = (t) => Math.min(Math.max(t, 0), 1);
const smooth = (t) => t * t * (3 - 2 * t);
const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
const easeInCubic = (t) => t * t * t;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);

// How open the lid is (0 = shut, 1 = open) at time t of the flourish
function lidOpen(t) {
  if (t <= 0) return 0;
  if (t < OPEN_END) return easeOutBack(t / OPEN_END);
  if (t < CLOSE_START) return 1;
  if (t < CLOSE_END) return 1 - easeInCubic((t - CLOSE_START) / (CLOSE_END - CLOSE_START));
  if (t < SETTLE_END) {
    const k = (t - CLOSE_END) / (SETTLE_END - CLOSE_END);
    return 0.07 * Math.sin(Math.PI * k) * (1 - k); // small bounce as it lands
  }
  return 0;
}

// Intro, in seconds from page load:
// 1. Blueprint: each piece's outline is drawn in thin lines, top layer first
// 2. Scan: a plane of light sweeps down; above it the lines have become polished metal
// 3. Speed scramble: the solved cube scrambles itself, one fast quarter turn after another
const IN_WIRE = 0.1;            // first outline starts drawing
const IN_WIRE_LEN = 0.7;        // how long one piece's outline takes
const IN_WIRE_STAGGER = 0.5;    // spread of start times, top to bottom
const IN_SCAN = 1.05;           // scanner starts at the top
const IN_SCAN_LEN = 1.0;        // and reaches the bottom this much later
const IN_SCRAMBLE = 2.15;       // first scramble move
const IN_MOVE = 0.072;          // per scramble move
const IN_SETTLE = 0.3;          // the cube squashes a little as the last move lands
const SCAN_TOP = 2.9;           // world heights the scanner travels between
const SCAN_BOTTOM = -2.9;

// Victory flourish: a glint of light sweeps across the now-perfect box, then the top layer
// hinges open like a lid, the email pops out, and the lid closes.
const GLINT = 0.55;             // the glint's sweep; the lid waits for it (times below are after it)
const OPEN_END = 0.32;          // lid fully open
export const LAUNCH_AT = GLINT + 0.26;  // the email leaves through the gap (seconds after solving)
const CLOSE_START = 0.85;       // lid starts closing
const CLOSE_END = 1.12;         // lid shut
const SETTLE_END = 1.35;        // tiny bounce after it shuts
const LID_ANGLE = 0.6;          // how far the lid tips open (radians, ~34°)
const LID_LIFT = 0.12;          // and how much it rises
const CELEBRATION_LENGTH = GLINT + 1.4;
// Scroll turns: smooth each quarter-turn and leave a short pause between moves
const scrollEase = (t) => smooth(clamp01((t - 0.12) / 0.76));

export class MirrorCube {
  constructor({ scrambleLength = 20, intro = true } = {}) {
    this.object = new THREE.Group();
    // The pieces turn about the core, but the solved box is off-centre from it: shift them back
    // so the cube sits in the middle of the scene
    this.core = new THREE.Group();
    this.core.position.copy(OFFSET).negate();
    this.object.add(this.core);
    this.cubies = [];
    this.#build();

    this.scramble = randomMoves(scrambleLength);
    this.solution = this.scramble.slice().reverse().map(invert);
    // With the intro, the cube starts solved and scrambles itself on screen
    this.scrambled = 0;
    if (!intro) while (this.scrambled < this.scramble.length) this.#apply(this.scramble[this.scrambled++], 1);

    this.applied = 0;      // solution moves fully done
    this.progress = 0;

    this.introTime = intro ? 0 : Infinity;
    this.introLength = IN_SCRAMBLE + this.scramble.length * IN_MOVE + IN_SETTLE;
    if (intro) this.#buildBlueprint();
    this.celebration = Infinity; // seconds since the last "solved" flourish
    this.lidToward = new THREE.Vector3(0, 0, 1); // which side of the lid opens (faces the viewer)
    this.calm = !intro;          // reduced motion: keep only the gentle parts

    // Free play
    this.userMoves = [];  // quarter turns the visitor made on top of the scroll position
    this.twist = null;    // { axis, layer, angle }: a layer the visitor is turning right now
    this.anims = [];      // queued layer animations: snapping a twist, or undoing one
    this.explode = 0;     // 0 = assembled, 1 = fully pulled apart (exploded view)

    // Light that sweeps across the faces when the cube is solved
    this.glintLight = new THREE.PointLight(0xFFFFFF, 0, 9, 1.4);
    this.object.add(this.glintLight);

    this.setProgress(0);
  }

  #build() {
    const bodyMat = this.bodyMat = new THREE.MeshStandardMaterial({ color: BODY_COLOR, roughness: 0.55, metalness: 0.1 });
    const mirrorMat = this.mirrorMat = new THREE.MeshStandardMaterial({ color: FINISHES.gold.plate.clone(), roughness: 0.07, metalness: 1 });
    const rimMat = this.rimMat = new THREE.MeshStandardMaterial({ color: FINISHES.gold.rim.clone(), roughness: 0.32, metalness: 1 });
    this.finish = FINISHES.gold;
    const zUp = new THREE.Vector3(0, 0, 1);
    const others = { x: ['y', 'z'], y: ['x', 'z'], z: ['x', 'y'] };

    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          if (x === 0 && y === 0 && z === 0) continue; // hidden core

          const pos = new THREE.Vector3(x, y, z);
          // This piece's box, in its own coordinates (the group sits on the lattice point it turns with)
          const size = new THREE.Vector3();
          const centre = new THREE.Vector3();
          for (const axis of ['x', 'y', 'z']) {
            const [lo, hi] = slab(axis, pos[axis]);
            size[axis] = hi - lo - GAP;
            centre[axis] = (lo + hi) / 2 - pos[axis];
          }

          const group = new THREE.Group();
          const body = new THREE.Mesh(
            new RoundedBoxGeometry(size.x, size.y, size.z, 3, Math.min(0.07, Math.min(size.x, size.y, size.z) * 0.12)),
            bodyMat,
          );
          body.position.copy(centre);
          group.add(body);

          // A mirror plate on each outward face, sized to that face
          for (const axis of ['x', 'y', 'z']) {
            const side = pos[axis];
            if (side === 0) continue;
            const [a, b] = others[axis];
            const w = size[a] - 2 * PLATE_INSET;
            const h = size[b] - 2 * PLATE_INSET;
            const normal = AXES[axis].clone().multiplyScalar(side);
            const plate = new THREE.Mesh(roundedRect(w, h, Math.min(0.1, Math.min(w, h) * 0.2)), mirrorMat);
            plate.quaternion.setFromUnitVectors(zUp, normal);
            // Line the plate's local x/y up with the face's two axes (setFromUnitVectors may leave it twisted)
            const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(plate.quaternion);
            if (Math.abs(localX[a]) < 0.5) plate.rotateZ(Math.PI / 2);
            plate.position.copy(centre).addScaledVector(normal, size[axis] / 2 + 0.003);
            group.add(plate);

            // The brushed rim: a slightly bigger plate just underneath
            const rim = new THREE.Mesh(
              roundedRect(w + 2 * RIM, h + 2 * RIM, Math.min(0.12, Math.min(w, h) * 0.22) + RIM), rimMat);
            rim.quaternion.copy(plate.quaternion);
            rim.position.copy(centre).addScaledVector(normal, size[axis] / 2 + 0.0015);
            group.add(rim);
          }

          const cubie = { group, pos, size, centre, home: pos.clone(), quat: new THREE.Quaternion(), center: Math.abs(x) + Math.abs(y) + Math.abs(z) === 1 };
          group.userData.cubie = cubie; // lets a raycast hit find its piece
          this.core.add(group);
          this.cubies.push(cubie);
        }
      }
    }

    // The mechanism inside: a hub with three axles. Hidden until the cube is pulled apart.
    const mech = this.mechMat = new THREE.MeshStandardMaterial({ color: 0x3A302A, roughness: 0.4, metalness: 0.6 });
    const hub = new THREE.Group();
    hub.add(new THREE.Mesh(new THREE.SphereGeometry(0.36, 32, 20), mech));
    for (const axis of ['x', 'y', 'z']) {
      const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 2.1, 20), mech);
      if (axis === 'x') axle.rotation.z = Math.PI / 2;
      if (axis === 'z') axle.rotation.x = Math.PI / 2;
      hub.add(axle);
      for (const side of [-1, 1]) {
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 24), this.rimMat);
        cap.rotation.copy(axle.rotation);
        cap.position[axis] = side * 1.06;
        hub.add(cap);
      }
    }
    this.hub = hub;
    this.core.add(hub);
  }

  // Permanently turn one layer. sign = -1 undoes the move.
  #apply(move, sign) {
    const q = new THREE.Quaternion().setFromAxisAngle(AXES[move.axis], angleOf(move) * sign);
    for (const c of this.cubies) {
      if (Math.round(c.pos[move.axis]) !== move.layer) continue;
      c.pos.applyQuaternion(q).round();
      c.quat.premultiply(q).normalize();
    }
  }

  // Thin outlines around every piece (the blueprint), and clipping planes for the scan:
  // metal shows above the scanner, outlines below it
  #buildBlueprint() {
    this.metalClip = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SCAN_TOP);
    this.wireClip = new THREE.Plane(new THREE.Vector3(0, -1, 0), SCAN_TOP);
    this.solidMats = [this.bodyMat, this.mirrorMat, this.rimMat, this.mechMat];
    for (const m of this.solidMats) m.clippingPlanes = [this.metalClip];

    for (const c of this.cubies) {
      const mat = new THREE.LineDashedMaterial({
        color: this.finish.wire, transparent: true, opacity: 0.95, depthWrite: false,
        dashSize: 0, gapSize: 10, clippingPlanes: [this.wireClip],
      });
      const box = new THREE.BoxGeometry(c.size.x, c.size.y, c.size.z);
      const wire = new THREE.LineSegments(new THREE.EdgesGeometry(box), mat);
      box.dispose();
      wire.computeLineDistances(); // each edge draws from one end to the other
      wire.position.copy(c.centre);
      c.group.add(wire);
      c.wire = wire;
      // Top layer first, with a little randomness so it reads as hand-drafted
      c.wireDelay = IN_WIRE + ((1 - c.home.y) / 2 * 0.65 + Math.random() * 0.35) * IN_WIRE_STAGGER;
    }
  }

  // Where the scanner is (world height), or null when it is not running
  get scanY() {
    const k = (this.introTime - IN_SCAN) / IN_SCAN_LEN;
    return k < 0 || k > 1 || this.calm ? null : SCAN_TOP + (SCAN_BOTTOM - SCAN_TOP) * smooth(k);
  }

  // Seconds into the speed scramble, or -1 before it starts / after the intro
  get #scrambleClock() {
    return this.introDone ? -1 : this.introTime - IN_SCRAMBLE;
  }

  // One step of the intro: outlines, scanner, scramble moves, and the squash at the end
  #introStep(t) {
    // Outlines draw edge by edge, then fade once the metal has replaced them
    const scanK = clamp01((t - IN_SCAN) / IN_SCAN_LEN);
    for (const c of this.cubies) {
      const k = easeOutCubic(clamp01((t - c.wireDelay) / IN_WIRE_LEN));
      c.wire.material.dashSize = k * 1.6;
      c.wire.material.opacity = 0.95 * (1 - scanK * scanK);
    }
    const y = SCAN_TOP + (SCAN_BOTTOM - SCAN_TOP) * smooth(scanK);
    this.metalClip.constant = -y;
    this.wireClip.constant = y;

    // Speed scramble: apply each move as it finishes
    const st = t - IN_SCRAMBLE;
    const done = Math.min(this.scramble.length, Math.max(0, Math.floor(st / IN_MOVE)));
    while (this.scrambled < done) this.#apply(this.scramble[this.scrambled++], 1);

    // Squash as the last move lands
    const k = (st - this.scramble.length * IN_MOVE) / IN_SETTLE;
    const squash = k > 0 && k < 1 ? 0.05 * Math.sin(Math.PI * k) * (1 - k) : 0;
    this.object.scale.set(1 + squash, 1 - squash, 1 + squash);
  }

  // Intro over: drop the outlines and clipping, and make sure the scramble is complete
  #endIntro() {
    this.introCleaned = true;
    while (this.scrambled < this.scramble.length) this.#apply(this.scramble[this.scrambled++], 1);
    this.object.scale.setScalar(1);
    if (!this.solidMats) return;
    for (const m of this.solidMats) { m.clippingPlanes = null; m.needsUpdate = true; }
    for (const c of this.cubies) {
      c.group.remove(c.wire);
      c.wire.geometry.dispose();
      c.wire.material.dispose();
      c.wire = null;
    }
  }

  get introDone() { return this.introTime >= this.introLength; }
  get total() { return this.solution.length; }
  get isSolved() { return this.applied === this.total; }

  // Pieces that would turn with a move on this layer
  #inLayer(c, axis, layer) {
    return Math.round(c.pos[axis]) === layer;
  }

  // Free play is anything the visitor did that the scroll solve does not know about
  get freePlay() { return this.userMoves.length > 0 || this.twist !== null || this.anims.length > 0; }
  get canTwist() { return this.introDone && this.celebration === Infinity && this.anims.length === 0; }

  // Mid-way through a scroll move? Then layers are not lined up and nothing else may turn.
  get atRest() {
    const frac = this.progress - Math.floor(this.progress);
    return frac === 0 || this.applied >= this.total || scrollEase(frac) === 0;
  }

  // The visitor drags a layer: angle in radians about +axis
  setTwist(axis, layer, angle) {
    this.twist = { axis, layer, angle };
    this.draw();
  }

  // The visitor let go: settle on the nearest quarter turn, then make it permanent
  releaseTwist(spin = 0) {
    const t = this.twist;
    if (!t) return;
    const quarters = THREE.MathUtils.clamp(Math.round((t.angle + spin) / QUARTER), -2, 2);
    this.twist = null;
    this.anims.push({
      axis: t.axis, layer: t.layer, from: t.angle, to: quarters * QUARTER, time: 0,
      duration: 0.12 + 0.1 * Math.min(1, Math.abs(quarters * QUARTER - t.angle) / QUARTER),
      done: () => {
        for (let i = 0; i < Math.abs(quarters); i++) {
          const move = { axis: t.axis, layer: t.layer, q: Math.sign(quarters) };
          this.#apply(move, 1);
          this.#recordUserMove(move);
        }
        if (quarters !== 0) this.onUserMove?.(this.userMoves.length, this.shapeSolved);
      },
    });
  }

  // Remember a free-play move, cancelling it against the last one if it undoes it
  #recordUserMove(m) {
    const last = this.userMoves[this.userMoves.length - 1];
    if (last && last.axis === m.axis && last.layer === m.layer && last.q === -m.q) this.userMoves.pop();
    else this.userMoves.push(m);
  }

  // Play the visitor's moves backwards, quickly, until the cube is where the scroll left it
  undoUserMoves(each = 0.13) {
    if (this.anims.length) return;
    const step = () => {
      const m = this.userMoves.pop();
      if (!m) return this.onUndone?.();
      this.anims.push({
        axis: m.axis, layer: m.layer, from: 0, to: -angleOf(m), time: 0, duration: each,
        done: () => { this.#apply(m, -1); step(); },
      });
    };
    step();
  }

  // Every piece back home and facing the right way: a perfect box again
  get shapeSolved() {
    const eps = 1e-3;
    return this.cubies.every((c) => c.pos.distanceToSquared(c.home) < eps &&
      (c.center || Math.abs(c.quat.w) > 1 - eps));
  }

  setProgress(p) {
    // The scroll solve waits while the visitor plays, and until the intro has scrambled the cube
    if (this.freePlay || !this.introDone) return this.draw();
    p = Math.min(Math.max(p, 0), this.total);
    this.progress = p;
    const whole = Math.floor(p);

    while (this.applied < whole) this.#apply(this.solution[this.applied++], 1);
    while (this.applied > whole) this.#apply(this.solution[--this.applied], -1);

    this.draw();
  }

  // The layer that is turning right now, if any: { axis, layer, angle }
  get #turning() {
    const st = this.#scrambleClock;
    if (st >= 0 && this.scrambled < this.scramble.length) {
      const m = this.scramble[this.scrambled];
      const frac = st / IN_MOVE - this.scrambled;
      return { axis: m.axis, layer: m.layer, angle: angleOf(m) * smooth(clamp01(frac / 0.85)) };
    }
    if (this.twist) return this.twist;
    const a = this.anims[0];
    if (a) {
      const k = clamp01(a.time / a.duration);
      return { axis: a.axis, layer: a.layer, angle: a.from + (a.to - a.from) * easeOutCubic(k) };
    }
    const frac = this.progress - Math.floor(this.progress);
    if (frac > 0 && this.applied < this.total) {
      const m = this.solution[this.applied];
      return { axis: m.axis, layer: m.layer, angle: angleOf(m) * scrollEase(frac) };
    }
    return null;
  }

  // ---------- Theatre ----------
  // towardViewer: direction from the cube to the camera, in the cube's own coordinates
  celebrate(towardViewer) {
    this.celebration = 0;
    if (towardViewer) this.lidToward.set(towardViewer.x, 0, towardViewer.z).normalize();
  }

  // 'gold' or 'silver'. The colours blend over a moment unless instant.
  setFinish(name, instant = false) {
    this.finish = FINISHES[name] || FINISHES.gold;
    if (instant) {
      this.mirrorMat.color.copy(this.finish.plate);
      this.rimMat.color.copy(this.finish.rim);
    }
    for (const c of this.cubies) c.wire?.material.color.copy(this.finish.wire);
  }

  // How far through the solve glint we are (0..1), or null when there is none
  get glint() {
    const t = this.celebration;
    return !this.calm && t < GLINT ? t / GLINT : null;
  }

  tick(dt) {
    const blend = 1 - Math.exp(-dt * 6);
    this.mirrorMat.color.lerp(this.finish.plate, blend);
    this.rimMat.color.lerp(this.finish.rim, blend);
    if (this.introTime !== Infinity) this.introTime += dt;
    if (this.celebration !== Infinity) {
      this.celebration += dt;
      if (this.celebration > CELEBRATION_LENGTH) this.celebration = Infinity;
    }
    const a = this.anims[0];
    if (a) {
      a.time += dt;
      if (a.time >= a.duration) {
        this.anims.shift();
        a.done(); // may queue the next one
      }
    }
  }

  // Draw every piece: its settled place, plus the layer that's mid-turn
  draw() {
    if (!this.introDone) this.#introStep(this.introTime);
    else if (!this.introCleaned) this.#endIntro();
    const moving = this.#turning;
    const partial = moving
      ? new THREE.Quaternion().setFromAxisAngle(AXES[moving.axis], moving.angle)
      : null;

    // Victory flourish: the top layer tips open on a hinge along its far edge
    const t = this.celebration;
    const open = !this.calm && t < CELEBRATION_LENGTH ? lidOpen(t - GLINT) : 0;

    // The glint: a bright light passes diagonally across the faces toward the viewer
    const g = this.glint;
    this.glintLight.intensity = g === null ? 0 : 70 * Math.sin(Math.PI * g) ** 2;
    if (g !== null) {
      const d = this.lidToward;
      const across = new THREE.Vector3().crossVectors(AXES.y, d).normalize();
      const s = -1 + 2 * smooth(g);
      this.glintLight.position.copy(d).multiplyScalar(2.4)
        .addScaledVector(across, 2.6 * s).addScaledVector(AXES.y, 2.2 - 3.2 * smooth(g));
    }
    let lid = null;
    if (open !== 0) {
      const d = this.lidToward;
      lid = {
        // far bottom edge of the top layer
        pivot: new THREE.Vector3(-d.x * 1.5 + OFFSET.x, 0.5, -d.z * 1.5 + OFFSET.z),
        turn: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3().crossVectors(d, AXES.y).normalize(), LID_ANGLE * open),
        lift: LID_LIFT * open,
      };
    }

    for (const c of this.cubies) {
      c.group.position.copy(c.pos);
      c.group.quaternion.copy(c.quat);
      if (moving && this.#inLayer(c, moving.axis, moving.layer)) {
        c.group.position.applyQuaternion(partial);
        c.group.quaternion.premultiply(partial);
      }

      if (lid && Math.round(c.pos.y) === 1) {
        c.group.position.sub(lid.pivot).applyQuaternion(lid.turn).add(lid.pivot);
        c.group.position.y += lid.lift;
        c.group.quaternion.premultiply(lid.turn);
      }

      // Exploded view: every piece slides straight out from the core
      if (this.explode > 0) c.group.position.multiplyScalar(1 + 0.42 * this.explode);
      c.group.scale.setScalar(1);
    }
  }
}
