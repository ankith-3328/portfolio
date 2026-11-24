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
const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
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

// Intro: a bomb's fuse burns down, it blows apart into the cube's pieces, and they pull back together
const IN_FUSE = 1.0;      // bomb appears and its fuse burns
const IN_SWELL = 0.35;    // last part of the fuse: the bomb swells and trembles
const IN_BOOM = 0.55;     // pieces blast outward
const IN_HANG = 0.3;      // pieces drift in mid-air
const IN_STAGGER = 0.3;   // pieces start their return at slightly different moments
const IN_RETURN = 0.6;    // each piece's pull back into its slot
const IN_SNAP = 0.3;      // the whole cube squashes as it locks
const IN_FIREBALL = 0.42; // the flash of fire at the explosion

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
      this.object.localToWorld(p).project(this.camera);
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
      this.bomb.scale.setScalar(1.35 * Math.max(0, grow) * (1 + 0.16 * swell * swell));
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
      this.fireball.scale.setScalar(0.7 + 2.6 * easeOutCubic(f));
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
      if (moving && Math.round(c.pos[moving.axis]) === moving.layer) {
        c.group.position.applyQuaternion(partial);
        c.group.quaternion.premultiply(partial);
      }

      if (lid && Math.round(c.pos.y) === 1) {
        c.group.position.sub(lid.pivot).applyQuaternion(lid.turn).add(lid.pivot);
        c.group.position.y += lid.lift;
        c.group.quaternion.premultiply(lid.turn);
      }

      // Intro: the big bang
      if (!this.introDone) {
        this.#introPiece(c, this.introTime);
      } else if (c.group.scale.x !== 1) {
        c.group.scale.setScalar(1);
      }
    }
  }
}
