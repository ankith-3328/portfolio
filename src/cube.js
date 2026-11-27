// A 3x3 mirror cube driven by scrolling.
// Same mechanism as a Rubik's cube, but every piece is one polished-gold colour and the layers have
// different thicknesses, so a scrambled cube is a lumpy shape and "solved" means "a perfect box again".
// The scroll position decides how many solution moves are done:
// progress 7.4 = "7 moves done, the 8th is 40% through". Scrolling up undoes moves.
//
// Plus two bits of theatre: the cube builds itself on load, and does a victory flourish when solved.
//
// It is also playable: grab a face and twist a layer yourself (free play). While you are playing,
// the scroll solve waits; main.js undoes your moves when you scroll again.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Mirror plates on a dark body: warm gold in the dark theme, polished silver in the light one.
// Each plate sits on a slightly larger, satin "brushed" rim that catches light along its edges.
const FINISHES = {
  gold: { plate: new THREE.Color(0xE8BE78), rim: new THREE.Color(0xB0803C) },
  silver: { plate: new THREE.Color(0xEEF0F4), rim: new THREE.Color(0x9EA3AC) },
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
const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
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

// Intro: a bomb's fuse burns down, it blows apart into the cube's pieces, and they pull back together
const IN_FUSE = 1.0;      // bomb appears and its fuse burns
const IN_SWELL = 0.35;    // last part of the fuse: the bomb swells and trembles
const IN_BOOM = 0.55;     // pieces blast outward
const IN_HANG = 0.3;      // pieces drift in mid-air
const IN_STAGGER = 0.3;   // pieces start their return at slightly different moments
const IN_RETURN = 0.6;    // each piece's pull back into its slot
const IN_SNAP = 0.3;      // the whole cube squashes as it locks
const IN_FIREBALL = 0.42; // the flash of fire at the explosion

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
    for (const m of this.scramble) this.#apply(m, 1);

    this.applied = 0;      // solution moves fully done
    this.progress = 0;

    this.introTime = intro ? 0 : Infinity;
    this.introLength = this.#planIntro();
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
    const bodyMat = new THREE.MeshStandardMaterial({ color: BODY_COLOR, roughness: 0.55, metalness: 0.1 });
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

          const cubie = { group, pos, home: pos.clone(), quat: new THREE.Quaternion(), center: Math.abs(x) + Math.abs(y) + Math.abs(z) === 1 };
          group.userData.cubie = cubie; // lets a raycast hit find its piece
          this.core.add(group);
          this.cubies.push(cubie);
        }
      }
    }

    // The mechanism inside: a hub with three axles. Hidden until the cube is pulled apart.
    const mech = new THREE.MeshStandardMaterial({ color: 0x3A302A, roughness: 0.4, metalness: 0.6 });
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

  // Give every piece its own explosion: direction, distance, tumble and return delay.
  // Returns how long the whole intro takes.
  #planIntro() {
    const r = () => Math.random() - 0.5;
    for (const c of this.cubies) {
      c.burstDir = c.pos.clone().normalize().add(new THREE.Vector3(r(), r(), r()).multiplyScalar(0.9)).normalize();
      c.burstDist = 2.5 + Math.random() * 1.3;
      c.spinAxis = new THREE.Vector3(r(), r(), r()).normalize();
      c.spinSpeed = (2.5 + Math.random() * 4) * (Math.random() < 0.5 ? -1 : 1);
      c.pullDelay = Math.random() * IN_STAGGER;
      // Each piece starts somewhere inside the bomb
      c.burstStart = new THREE.Vector3(r(), r(), r()).multiplyScalar(0.6);
    }
    this.#buildBomb();

    this.hangEnd = IN_FUSE + IN_BOOM + IN_HANG;
    this.arriveAt = this.hangEnd + IN_STAGGER + IN_RETURN;
    return this.arriveAt + IN_SNAP;
  }

  // A round black bomb with a cap, a rope fuse and a spark, plus the fireball and flash for the blast
  #buildBomb() {
    const bomb = this.bomb = new THREE.Group();
    const shell = new THREE.MeshStandardMaterial({ color: 0x2B2521, roughness: 0.32, metalness: 0.55 });
    bomb.add(new THREE.Mesh(new THREE.SphereGeometry(0.9, 48, 32), shell));

    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.28, 0.22, 24),
      new THREE.MeshStandardMaterial({ color: 0x4A3E35, roughness: 0.5, metalness: 0.4 }),
    );
    cap.position.y = 0.92;
    bomb.add(cap);

    this.fuseCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 1.0, 0),
      new THREE.Vector3(0.08, 1.3, 0.05),
      new THREE.Vector3(0.32, 1.52, 0.1),
      new THREE.Vector3(0.62, 1.5, 0.14),
    ]);
    this.fuseSegments = 48;
    this.fuse = new THREE.Mesh(
      new THREE.TubeGeometry(this.fuseCurve, this.fuseSegments, 0.04, 8),
      new THREE.MeshStandardMaterial({ color: 0xC9A27A, roughness: 0.9 }),
    );
    bomb.add(this.fuse);

    this.spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xFFD08A }),
    );
    this.sparkLight = new THREE.PointLight(0xFF9A50, 0, 6, 2);
    bomb.add(this.spark, this.sparkLight);
    this.object.add(bomb);

    this.fireball = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 24),
      new THREE.MeshBasicMaterial({
        color: 0xFFA868, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    this.fireball.visible = false;
    this.flash = new THREE.PointLight(0xFFB48A, 0, 14, 2);
    this.object.add(this.fireball, this.flash);
  }

  // Where one piece is during the intro, given its settled position/rotation already in c.group
  #introPiece(c, t) {
    // Hidden inside the bomb until it blows
    if (t < IN_FUSE) {
      c.group.scale.setScalar(0);
      return;
    }

    const finalPos = c.group.position.clone();
    const drift = (time) => Math.max(0, time - (IN_FUSE + IN_BOOM)) * 0.35;
    const spin = (time) => c.spinSpeed * (time - IN_FUSE);
    const pullStart = this.hangEnd + c.pullDelay;
    if (!c.fitted) this.#fitBurst(c, drift(pullStart));
    const exploded = c.burstDir.clone().multiplyScalar(c.burstDist);

    // Blast outward from inside the bomb, then drift while tumbling
    if (t < pullStart) {
      const k = easeOutExpo(clamp01((t - IN_FUSE) / IN_BOOM));
      c.group.position.lerpVectors(c.burstStart, exploded, k).addScaledVector(c.burstDir, drift(t));
      c.group.scale.setScalar(0.3 + 0.7 * clamp01(k * 1.4));
      c.group.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(c.spinAxis, spin(t)));
      return;
    }

    // Pulled back like a magnet: slow at first, then faster and faster into its slot
    const e = easeInCubic(clamp01((t - pullStart) / IN_RETURN));
    const from = exploded.addScaledVector(c.burstDir, drift(pullStart));
    c.group.position.lerpVectors(from, finalPos, e);
    c.group.scale.setScalar(1);
    c.group.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(c.spinAxis, spin(pullStart) * (1 - e)));
  }

  // Shorten a piece's flight if its furthest point would leave the canvas
  #fitBurst(c, maxDrift) {
    c.fitted = true;
    if (!this.camera) return;
    const margin = 0.62; // keep piece centres within 62% of the canvas from its centre (pieces have size too)
    const p = new THREE.Vector3();
    for (let dist = c.burstDist; dist > 1.2; dist -= 0.1) {
      p.copy(c.burstDir).multiplyScalar(dist + maxDrift);
      this.core.localToWorld(p).project(this.camera);
      c.burstDist = dist;
      if (Math.abs(p.x) < margin && Math.abs(p.y) < margin) return;
    }
  }

  // The bomb, fireball, flash, shake and final squash
  #introWhole(t) {
    // Bomb: pops in, fuse burns down with a flickering spark, swells and trembles, then vanishes
    const lit = t < IN_FUSE;
    this.bomb.visible = lit;
    if (lit) {
      const grow = easeOutBack(Math.min(1, t / 0.3)); // pops in with a slight overshoot
      const swell = clamp01((t - (IN_FUSE - IN_SWELL)) / IN_SWELL);
      this.bomb.scale.setScalar(0.5 * Math.max(0, grow) * (1 + 0.16 * swell * swell));
      const a = 0.05 * swell * swell;
      this.bomb.position.set(Math.sin(t * 90) * a, Math.cos(t * 77) * a, Math.sin(t * 63) * a);

      const left = 1 - 0.9 * (t / IN_FUSE); // how much fuse remains
      const segs = Math.max(1, Math.round(this.fuseSegments * left));
      this.fuse.geometry.setDrawRange(0, segs * 8 * 6);
      const tip = this.fuseCurve.getPoint(segs / this.fuseSegments);
      this.spark.position.copy(tip);
      this.sparkLight.position.copy(tip);
      const flicker = 0.7 + Math.random() * 0.7;
      this.spark.scale.setScalar(flicker);
      this.sparkLight.intensity = 3 * flicker;
    }

    // Fireball and flash of light
    const sinceBoom = t - IN_FUSE;
    const f = sinceBoom / IN_FIREBALL;
    this.fireball.visible = f > 0 && f < 1;
    if (this.fireball.visible) {
      this.fireball.scale.setScalar(0.3 + 2.4 * easeOutCubic(f));
      this.fireball.material.opacity = 0.85 * (1 - f) * (1 - f);
    }
    this.flash.intensity = sinceBoom > 0 ? 50 * Math.exp(-sinceBoom * 6) : 0;

    // Shake on the blast
    const shake = sinceBoom > 0 ? 0.12 * Math.exp(-sinceBoom * 9) : 0;
    this.object.position.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, 0);

    // Squash as the last piece locks in
    const k = (t - this.arriveAt) / IN_SNAP;
    const squash = k > 0 && k < 1 ? 0.06 * Math.sin(Math.PI * k) * (1 - k) : 0;
    this.object.scale.set(1 + squash, 1 - squash, 1 + squash);
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
    if (this.freePlay) return this.draw(); // the scroll solve waits while the visitor plays
    p = Math.min(Math.max(p, 0), this.total);
    this.progress = p;
    const whole = Math.floor(p);

    while (this.applied < whole) this.#apply(this.solution[this.applied++], 1);
    while (this.applied > whole) this.#apply(this.solution[--this.applied], -1);

    this.draw();
  }

  // The layer that is turning right now, if any: { axis, layer, angle }
  get #turning() {
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

    // The core shows only once the bomb has blown (it would poke out of the bomb)
    this.hub.visible = this.introTime >= IN_FUSE;
    if (!this.introDone) this.#introWhole(this.introTime);
    else if (this.bomb.parent) {
      // Intro finished: reset and remove the bomb and effects for good
      this.object.position.set(0, 0, 0);
      this.object.scale.setScalar(1);
      this.object.remove(this.bomb, this.fireball, this.flash);
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

      // Intro: the big bang
      if (!this.introDone) {
        this.#introPiece(c, this.introTime);
      } else if (c.group.scale.x !== 1) {
        c.group.scale.setScalar(1);
      }
    }
  }
}
