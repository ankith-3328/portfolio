// A 3x3 Rubik's cube driven by scrolling.
// The scroll position decides how many solution moves are done:
// progress 7.4 = "7 moves done, the 8th is 40% through". Scrolling up undoes moves.
//
// Plus two bits of theatre: the cube builds itself on load, and does a victory flourish when solved.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Earth-tone stickers to fit the warm, minimal theme
const STICKER_COLORS = {
  U: 0xF4EDE1, // cream
  D: 0xD9A441, // ochre
  F: 0xC96442, // terracotta
  B: 0x8B5E3C, // brown
  R: 0x7D8C6A, // sage
  L: 0x6F7F8C, // slate
};
const BODY_COLOR = 0x2A211B;

const AXES = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};
const FACE_AT = { x: ['L', 'R'], y: ['D', 'U'], z: ['B', 'F'] };

const CUBIE_SIZE = 0.94;
const STICKER_SIZE = 0.78;

// A move: { axis: 'x'|'y'|'z', layer: -1|0|1, q: +1|-1 } = turn that layer by q·90° about +axis
const invert = (m) => ({ ...m, q: -m.q });
const angleOf = (m) => m.q * (Math.PI / 2);

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

function roundedSquare(size, radius) {
  const h = size / 2;
  const s = new THREE.Shape();
  s.moveTo(-h + radius, -h);
  s.lineTo(h - radius, -h);
  s.quadraticCurveTo(h, -h, h, -h + radius);
  s.lineTo(h, h - radius);
  s.quadraticCurveTo(h, h, h - radius, h);
  s.lineTo(-h + radius, h);
  s.quadraticCurveTo(-h, h, -h, h - radius);
  s.lineTo(-h, -h + radius);
  s.quadraticCurveTo(-h, -h, -h + radius, -h);
  return new THREE.ShapeGeometry(s, 6);
}

const clamp01 = (t) => Math.min(Math.max(t, 0), 1);
const smooth = (t) => t * t * (3 - 2 * t);
const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
const easeInCubic = (t) => t * t * t;
const easeOutBack = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);

// How open the lid is (0 = shut, 1 = open) at time t of the flourish
function lidOpen(t) {
  if (t < OPEN_END) return easeOutBack(t / OPEN_END);
  if (t < CLOSE_START) return 1;
  if (t < CLOSE_END) return 1 - easeInCubic((t - CLOSE_START) / (CLOSE_END - CLOSE_START));
  if (t < SETTLE_END) {
    const k = (t - CLOSE_END) / (SETTLE_END - CLOSE_END);
    return 0.07 * Math.sin(Math.PI * k) * (1 - k); // small bounce as it lands
  }
  return 0;
}

// Intro timing: layers build bottom → middle → top, pieces go around each layer
const INTRO_LAYER_GAP = 0.42;  // seconds between layers
const INTRO_PIECE_GAP = 0.045; // seconds between pieces within a layer
const INTRO_FLIGHT = 0.75;     // seconds for one piece to drop into place
const INTRO_DROP = 4.5;        // how far above its spot a piece starts

// Victory flourish: the top layer hinges open like a lid, the email pops out, the lid closes
const OPEN_END = 0.32;          // lid fully open
export const LAUNCH_AT = 0.26;  // the email leaves through the gap (seconds after solving)
const CLOSE_START = 0.85;       // lid starts closing
const CLOSE_END = 1.12;         // lid shut
const SETTLE_END = 1.35;        // tiny bounce after it shuts
const LID_ANGLE = 0.6;          // how far the lid tips open (radians, ~34°)
const LID_LIFT = 0.12;          // and how much it rises
const CELEBRATION_LENGTH = 1.4;
// Scroll turns: smooth each quarter-turn and leave a short pause between moves
const scrollEase = (t) => smooth(clamp01((t - 0.12) / 0.76));

export class RubiksCube {
  constructor({ scrambleLength = 20, intro = true } = {}) {
    this.object = new THREE.Group();
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

    this.setProgress(0);
  }

  #build() {
    const bodyGeo = new RoundedBoxGeometry(CUBIE_SIZE, CUBIE_SIZE, CUBIE_SIZE, 4, 0.09);
    const bodyMat = new THREE.MeshStandardMaterial({ color: BODY_COLOR, roughness: 0.6, metalness: 0.05 });
    const stickerGeo = roundedSquare(STICKER_SIZE, 0.13);
    const stickerMats = Object.fromEntries(
      Object.entries(STICKER_COLORS).map(([face, color]) => [
        face,
        new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0 }),
      ]),
    );
    const zUp = new THREE.Vector3(0, 0, 1);

    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          if (x === 0 && y === 0 && z === 0) continue; // hidden core

          const group = new THREE.Group();
          group.add(new THREE.Mesh(bodyGeo, bodyMat));

          const pos = new THREE.Vector3(x, y, z);
          for (const axis of ['x', 'y', 'z']) {
            const side = pos[axis];
            if (side === 0) continue;
            const normal = AXES[axis].clone().multiplyScalar(side);
            const sticker = new THREE.Mesh(stickerGeo, stickerMats[FACE_AT[axis][(side + 1) / 2]]);
            sticker.position.copy(normal).multiplyScalar(CUBIE_SIZE / 2 + 0.002);
            sticker.quaternion.setFromUnitVectors(zUp, normal);
            group.add(sticker);
          }

          const cubie = { group, pos, quat: new THREE.Quaternion() };
          this.object.add(group);
          this.cubies.push(cubie);
        }
      }
    }
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

  // Decide when and from where each piece drops in during the intro.
  // Returns how long the whole intro takes.
  #planIntro() {
    let end = 0;
    for (let layer = -1; layer <= 1; layer++) {
      // Pieces of this layer, ordered around the ring, with the centre last
      const pieces = this.cubies
        .filter((c) => c.pos.y === layer)
        .sort((a, b) => this.#ringOrder(a.pos) - this.#ringOrder(b.pos));

      pieces.forEach((c, i) => {
        c.delay = (layer + 1) * INTRO_LAYER_GAP + i * INTRO_PIECE_GAP;
        // Start above its spot, nudged slightly outward, with a gentle tilt
        const outward = new THREE.Vector3(c.pos.x, 0, c.pos.z).multiplyScalar(0.6);
        c.introOffset = outward.add(new THREE.Vector3(0, INTRO_DROP, 0));
        const tiltAxis = new THREE.Vector3(c.pos.z || 1, 0, -c.pos.x).normalize();
        c.introTilt = new THREE.Quaternion().setFromAxisAngle(tiltAxis, 0.55);
        end = Math.max(end, c.delay + INTRO_FLIGHT);
      });
    }
    return end;
  }

  #ringOrder(p) {
    if (p.x === 0 && p.z === 0) return 10; // centre piece goes last
    return Math.atan2(p.z, p.x) + Math.PI; // 0 … 2π around the layer
  }

  get introDone() { return this.introTime >= this.introLength; }
  get total() { return this.solution.length; }
  get isSolved() { return this.applied === this.total; }

  setProgress(p) {
    p = Math.min(Math.max(p, 0), this.total);
    this.progress = p;
    const whole = Math.floor(p);

    while (this.applied < whole) this.#apply(this.solution[this.applied++], 1);
    while (this.applied > whole) this.#apply(this.solution[--this.applied], -1);

    const frac = p - whole;
    const moving = frac > 0 && this.applied < this.total ? this.solution[this.applied] : null;
    this.#render(moving, moving ? scrollEase(frac) : 0);
  }

  // ---------- Theatre ----------
  // towardViewer: direction from the cube to the camera, in the cube's own coordinates
  celebrate(towardViewer) {
    this.celebration = 0;
    if (towardViewer) this.lidToward.set(towardViewer.x, 0, towardViewer.z).normalize();
  }

  tick(dt) {
    if (this.introTime !== Infinity) this.introTime += dt;
    if (this.celebration !== Infinity) {
      this.celebration += dt;
      if (this.celebration > CELEBRATION_LENGTH) this.celebration = Infinity;
    }
  }

  // Draw every piece: its settled place, plus the layer that's mid-turn
  #render(moving, amount) {
    const partial = moving
      ? new THREE.Quaternion().setFromAxisAngle(AXES[moving.axis], angleOf(moving) * amount)
      : null;

    // Victory flourish: the top layer tips open on a hinge along its far edge
    const t = this.celebration;
    const open = !this.calm && t < CELEBRATION_LENGTH ? lidOpen(t) : 0;
    let lid = null;
    if (open !== 0) {
      const d = this.lidToward;
      lid = {
        pivot: new THREE.Vector3(-d.x * 1.5, 0.5, -d.z * 1.5), // far bottom edge of the top layer
        turn: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3().crossVectors(d, AXES.y).normalize(), LID_ANGLE * open),
        lift: LID_LIFT * open,
      };
    }

    for (const c of this.cubies) {
      c.group.position.copy(c.pos);
      c.group.quaternion.copy(c.quat);
      if (moving && Math.round(c.pos[moving.axis]) === moving.layer) {
        c.group.position.applyQuaternion(partial);
        c.group.quaternion.premultiply(partial);
      }

      if (lid && Math.round(c.pos.y) === 1) {
        c.group.position.sub(lid.pivot).applyQuaternion(lid.turn).add(lid.pivot);
        c.group.position.y += lid.lift;
        c.group.quaternion.premultiply(lid.turn);
      }

      // Intro: each piece drops from above into its spot, layer by layer
      if (!this.introDone) {
        const t = clamp01((this.introTime - c.delay) / INTRO_FLIGHT);
        const k = easeOutQuart(t);
        const tilt = new THREE.Quaternion().slerp(c.introTilt, 1 - k);
        c.group.position.addScaledVector(c.introOffset, 1 - k);
        c.group.quaternion.premultiply(tilt);
        c.group.scale.setScalar(smooth(clamp01(t / 0.35))); // fade in by growing, early in the fall
      } else if (c.group.scale.x !== 1) {
        c.group.scale.setScalar(1);
      }
    }
  }
}
