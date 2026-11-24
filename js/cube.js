// A 3x3 Rubik's cube that can be scrambled and then solved step by step.
//
// Idea: the scroll position decides how many solution moves have been applied.
// Progress 7.4 means "7 moves done, and the 8th move is 40% of the way through".
// Scrolling back up simply undoes moves, so the cube always matches the page.

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

// Which face sits at each end of each axis: [layer -1, layer +1]
const FACE_AT = { x: ['L', 'R'], y: ['D', 'U'], z: ['B', 'F'] };

const SPACING = 1;
const CUBIE_SIZE = 0.94;
const STICKER_SIZE = 0.78;

// A move is { axis, layer (-1 | 1), dir (1 = clockwise, -1 = counter-clockwise) }.
// Clockwise when looking at a face = rotating by -90° around its outward normal.
const moveAngle = (m) => -m.layer * m.dir * (Math.PI / 2);
const invert = (m) => ({ ...m, dir: -m.dir });

export function notation(m) {
  const face = FACE_AT[m.axis][(m.layer + 1) / 2];
  return m.dir === 1 ? face : face + "'";
}

function makeScramble(length, random) {
  const axes = ['x', 'y', 'z'];
  const moves = [];
  let lastAxis = null;
  while (moves.length < length) {
    const axis = axes[Math.floor(random() * 3)];
    if (axis === lastAxis) continue; // avoid moves that cancel or merge
    moves.push({
      axis,
      layer: random() < 0.5 ? -1 : 1,
      dir: random() < 0.5 ? -1 : 1,
    });
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

// Smooth each quarter-turn and leave a short pause between moves
function turnEase(t) {
  const s = Math.min(Math.max((t - 0.12) / 0.76, 0), 1);
  return s * s * (3 - 2 * s);
}

export class RubiksCube {
  constructor({ scrambleLength = 20, random = Math.random } = {}) {
    this.object = new THREE.Group();
    this.cubies = [];
    this.#build();

    this.scramble = makeScramble(scrambleLength, random);
    this.solution = this.scramble.slice().reverse().map(invert);
    for (const m of this.scramble) this.#apply(m, 1);

    this.applied = 0;   // how many solution moves are fully done
    this.progress = 0;
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
            if (side === 0) continue; // inner side, no sticker
            const normal = AXES[axis].clone().multiplyScalar(side);
            const sticker = new THREE.Mesh(stickerGeo, stickerMats[FACE_AT[axis][(side + 1) / 2]]);
            sticker.position.copy(normal).multiplyScalar(CUBIE_SIZE / 2 + 0.002);
            sticker.quaternion.setFromUnitVectors(zUp, normal);
            group.add(sticker);
          }

          this.object.add(group);
          this.cubies.push({ group, pos, quat: new THREE.Quaternion() });
        }
      }
    }
  }

  // Permanently turn one layer. sign = -1 undoes the move.
  #apply(move, sign) {
    const q = new THREE.Quaternion().setFromAxisAngle(AXES[move.axis], moveAngle(move) * sign);
    for (const c of this.cubies) {
      if (Math.round(c.pos[move.axis]) !== move.layer) continue;
      c.pos.applyQuaternion(q).round();
      c.quat.premultiply(q).normalize();
    }
  }

  get total() { return this.solution.length; }
  get isSolved() { return this.applied === this.total; }

  // The move currently in motion (or the last finished one)
  get currentMove() {
    const frac = this.progress - this.applied;
    if (frac > 0 && this.applied < this.total) return this.solution[this.applied];
    return this.applied > 0 ? this.solution[this.applied - 1] : null;
  }

  setProgress(p) {
    p = Math.min(Math.max(p, 0), this.total);
    this.progress = p;
    const whole = Math.floor(p);

    while (this.applied < whole) this.#apply(this.solution[this.applied++], 1);
    while (this.applied > whole) this.#apply(this.solution[--this.applied], -1);

    const frac = p - whole;
    const moving = frac > 0 && this.applied < this.total ? this.solution[this.applied] : null;
    const partial = moving
      ? new THREE.Quaternion().setFromAxisAngle(AXES[moving.axis], moveAngle(moving) * turnEase(frac))
      : null;

    for (const c of this.cubies) {
      c.group.position.copy(c.pos).multiplyScalar(SPACING);
      c.group.quaternion.copy(c.quat);
      if (moving && Math.round(c.pos[moving.axis]) === moving.layer) {
        c.group.position.applyQuaternion(partial);
        c.group.quaternion.premultiply(partial);
      }
    }
  }
}
