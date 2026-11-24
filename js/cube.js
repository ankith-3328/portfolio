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
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// Intro timing: layers build bottom → middle → top, pieces go around each layer
const INTRO_LAYER_GAP = 0.42;  // seconds between layers
const INTRO_PIECE_GAP = 0.045; // seconds between pieces within a layer
const INTRO_FLIGHT = 0.75;     // seconds for one piece to drop into place
const INTRO_DROP = 4.5;        // how far above its spot a piece starts

// Victory flourish timing
const WAVE_DELAY = 0.16;       // seconds between the top, middle and bottom layer spins
const WAVE_SPIN = 0.95;        // seconds for one layer's full turn
const RIPPLE_START = 0.62;     // when the first ring leaves the base (after the hop lands)
const RIPPLE_TIME = 1.5;       // how long a ring takes to expand and fade
const GLINT_START = 1.05;      // when the stickers catch the light
const CELEBRATION_LENGTH = 2.6;
const ACCENT = 0xC96442;
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
    this.calm = !intro;          // reduced motion: keep only the gentle parts
    this.#buildRipples();

    this.setProgress(0);
  }

  #build() {
    const bodyGeo = new RoundedBoxGeometry(CUBIE_SIZE, CUBIE_SIZE, CUBIE_SIZE, 4, 0.09);
    const bodyMat = new THREE.MeshStandardMaterial({ color: BODY_COLOR, roughness: 0.6, metalness: 0.05 });
    const stickerGeo = roundedSquare(STICKER_SIZE, 0.13);
    const stickerMats = this.stickerMats = Object.fromEntries(
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
  celebrate() { this.celebration = 0; }

  // Two thin rings under the cube that ripple outward when it's solved
  #buildRipples() {
    const geo = new THREE.RingGeometry(1, 1.035, 128);
    this.ripples = [0, 0.28].map((offset) => {
      const mat = new THREE.MeshBasicMaterial({
        color: ACCENT, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(geo, mat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -1.62;
      ring.visible = false;
      ring.userData.offset = offset;
      this.object.add(ring);
      return ring;
    });
  }

  #updateFlourish() {
    const t = this.celebration;

    // Ripples
    for (const ring of this.ripples) {
      const k = (t - RIPPLE_START - ring.userData.offset) / RIPPLE_TIME;
      ring.visible = !this.calm && k > 0 && k < 1;
      if (!ring.visible) continue;
      ring.scale.setScalar(1.6 + 3.4 * easeOutQuart(k));
      ring.material.opacity = 0.55 * (1 - k) * (1 - k);
    }

    // Glint: stickers briefly light up
    const g = (t - (this.calm ? 0 : GLINT_START)) / 0.7;
    const glow = g > 0 && g < 1 ? Math.sin(Math.PI * g) * 0.07 : 0;
    for (const mat of Object.values(this.stickerMats)) {
      mat.emissive.setRGB(glow, glow * 0.93, glow * 0.85);
    }
  }

  tick(dt) {
    if (this.introTime !== Infinity) this.introTime += dt;
    if (this.celebration !== Infinity) {
      this.celebration += dt;
      this.#updateFlourish();
      if (this.celebration > CELEBRATION_LENGTH) this.celebration = Infinity;
    }
  }

  // Draw every piece: its settled place, plus the layer that's mid-turn
  #render(moving, amount) {
    const partial = moving
      ? new THREE.Quaternion().setFromAxisAngle(AXES[moving.axis], angleOf(moving) * amount)
      : null;

    // "Breathing" apart when solved: up to 18% wider gaps, for ~1 second
    // Victory flourish: a small hop, and each layer (top → bottom) spins a full turn
    const t = this.celebration;
    const flourish = !this.calm && t < CELEBRATION_LENGTH;
    this.object.position.y = flourish && t < 0.7 ? 0.22 * Math.sin(Math.PI * (t / 0.7)) : 0;

    for (const c of this.cubies) {
      c.group.position.copy(c.pos);
      c.group.quaternion.copy(c.quat);
      if (moving && Math.round(c.pos[moving.axis]) === moving.layer) {
        c.group.position.applyQuaternion(partial);
        c.group.quaternion.premultiply(partial);
      }

      if (flourish) {
        const layer = Math.round(c.pos.y);               // 1 top, 0 middle, -1 bottom
        const k = clamp01((t - (1 - layer) * WAVE_DELAY) / WAVE_SPIN);
        if (k > 0 && k < 1) {
          const dir = layer === 0 ? -1 : 1;              // middle layer turns the other way
          const spinQ = new THREE.Quaternion().setFromAxisAngle(AXES.y, dir * 2 * Math.PI * easeInOutCubic(k));
          c.group.position.applyQuaternion(spinQ);
          c.group.quaternion.premultiply(spinQ);
        }
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
