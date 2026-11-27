// CAD effects on the cube itself, all drawn in 3D so they turn with it:
//   - rotation arc: while a layer turns, a thin arc with an arrowhead sweeps around that layer,
//     showing the direction and how far it has gone; it fades once the turn has landed
//   - wireframe: a switchable drafting view; every piece becomes crisp edge lines, solid where
//     visible and dashed where hidden behind other pieces, traced in like a plotter

import * as THREE from 'three';
import { layerCentre } from './cube.js';

const AXES = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};
// Two directions spanning the plane a layer turns in, ordered so that turning by +angle about
// the axis carries the first toward the second
const PLANE = {
  x: [AXES.y, AXES.z],
  y: [AXES.z, AXES.x],
  z: [AXES.x, AXES.y],
};

const THEME_INK = { dark: 0xECE5DA, light: 0x2A2724 };
const THEME_ACCENT = { dark: 0xE8916E, light: 0xC96442 };

// ---------------------------------------------------------------------------------------------
// Rotation arc
export function makeTurnArc(cube) {
  const SEGMENTS = 64;
  const RADIUS = 2.95;
  const arcGeo = new THREE.BufferGeometry();
  arcGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((SEGMENTS + 1) * 3), 3));
  const headGeo = new THREE.BufferGeometry();
  headGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(4 * 3), 3));
  // Drawn over the cube (no depth test), so the whole sweep reads even where it passes behind
  const material = new THREE.LineBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false });
  const arc = new THREE.Line(arcGeo, material);
  const head = new THREE.LineSegments(headGeo, material);
  const group = new THREE.Group();
  group.add(arc, head);
  group.visible = false;
  group.renderOrder = 10;
  arc.renderOrder = head.renderOrder = 10;
  cube.core.add(group);

  let key = '';        // which turn the arc belongs to
  let startAngle = 0;  // where it starts, chosen to face the viewer when the turn begins
  let last = null;     // the most recent turn, kept so the arc can fade out after it lands
  const p = new THREE.Vector3();
  const toCam = new THREE.Vector3();

  const point = (axis, layer, phi, out) => {
    const [u, v] = PLANE[axis];
    return out.copy(AXES[axis]).multiplyScalar(layerCentre(axis, layer))
      .addScaledVector(u, Math.cos(phi) * RADIUS).addScaledVector(v, Math.sin(phi) * RADIUS);
  };

  return {
    setTheme(name) { material.color.set(THEME_ACCENT[name] || THEME_ACCENT.dark); },
    update(dt, camera) {
      const t = cube.turning;
      const live = t && Math.abs(t.angle) > 0.02;
      if (live) {
        const k = `${t.axis}${t.layer}`;
        if (k !== key || !last) {
          // A new turn: centre the arc on the side of the layer facing the camera
          key = k;
          const [u, v] = PLANE[t.axis];
          cube.core.worldToLocal(toCam.copy(camera.position));
          startAngle = Math.atan2(toCam.dot(v), toCam.dot(u)) - t.angle / 2;
        }
        last = { ...t };
      }
      const target = live ? 0.95 : 0;
      material.opacity += (target - material.opacity) * (1 - Math.exp(-dt * (live ? 14 : 5)));
      group.visible = material.opacity > 0.01 && !!last;
      if (!live && material.opacity < 0.01) { last = null; key = ''; }
      if (!group.visible) return;

      const { axis, layer, angle } = last;
      const pos = arcGeo.attributes.position;
      for (let i = 0; i <= SEGMENTS; i++) {
        point(axis, layer, startAngle + angle * (i / SEGMENTS), p);
        pos.setXYZ(i, p.x, p.y, p.z);
      }
      pos.needsUpdate = true;
      arcGeo.computeBoundingSphere();

      // Arrowhead at the moving end, pointing the way it turns
      const end = startAngle + angle;
      const [u, v] = PLANE[axis];
      const tip = point(axis, layer, end, new THREE.Vector3());
      const tangent = new THREE.Vector3().addScaledVector(u, -Math.sin(end)).addScaledVector(v, Math.cos(end))
        .multiplyScalar(Math.sign(angle));
      const radial = tip.clone().sub(AXES[axis].clone().multiplyScalar(layerCentre(axis, layer))).normalize();
      const back = tip.clone().addScaledVector(tangent, -0.2);
      const h = headGeo.attributes.position;
      const a = back.clone().addScaledVector(radial, 0.09);
      const b = back.clone().addScaledVector(radial, -0.09);
      h.setXYZ(0, tip.x, tip.y, tip.z); h.setXYZ(1, a.x, a.y, a.z);
      h.setXYZ(2, tip.x, tip.y, tip.z); h.setXYZ(3, b.x, b.y, b.z);
      h.needsUpdate = true;
      headGeo.computeBoundingSphere();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Wireframe (drafting) view
// Each piece is a box of 12 edges, listed as a pen would draw them (bottom loop, a riser, the top
// loop, the other risers), so they can be traced in one after another like a plotter
const PATH = [[0, 1], [1, 5], [5, 4], [4, 0], [0, 2], [2, 3], [3, 7], [7, 6], [6, 2], [1, 3], [5, 7], [4, 6]];
const TRACE = 0.5; // seconds to trace one piece

export function makeWireframe(cube, { instant = false } = {}) {
  const visibleMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0 });
  // Hidden edges: drawn only where something nearer is in front of them, dashed and faint
  const hiddenMat = new THREE.LineDashedMaterial({
    transparent: true, opacity: 0, dashSize: 0.07, gapSize: 0.06,
    depthFunc: THREE.GreaterDepth, depthWrite: false,
  });
  const pieces = [];
  const lines = [];
  for (const c of cube.cubies) {
    const full = new Float32Array(PATH.length * 6);
    const corner = (i) => [
      c.centre.x + (i & 1 ? 0.5 : -0.5) * c.size.x,
      c.centre.y + (i & 2 ? 0.5 : -0.5) * c.size.y,
      c.centre.z + (i & 4 ? 0.5 : -0.5) * c.size.z,
    ];
    PATH.forEach(([a, b], k) => { full.set(corner(a), k * 6); full.set(corner(b), k * 6 + 3); });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(full.slice(), 3));
    const front = new THREE.LineSegments(geo, visibleMat);
    const behind = new THREE.LineSegments(geo, hiddenMat);
    behind.computeLineDistances(); // on the whole box, before any tracing
    for (const l of [front, behind]) {
      l.visible = false;
      c.group.add(l);
      lines.push(l);
    }
    // When this piece's trace starts after the switch is flipped: inner pieces first
    const gen = Math.abs(Math.round(c.home.x)) + Math.abs(Math.round(c.home.y)) + Math.abs(Math.round(c.home.z));
    pieces.push({ c, geo, full, drawn: -1, delay: gen * 0.09 + Math.random() * 0.06 });
  }

  // Trace a piece up to r (0..1) of its path
  const trace = (p, r) => {
    if (r === p.drawn) return;
    p.drawn = r;
    const pos = p.geo.attributes.position;
    const n = r * PATH.length;
    const whole = Math.floor(n);
    const frac = n - whole;
    pos.array.set(p.full.subarray(0, whole * 6));
    if (frac > 0 && whole < PATH.length) {
      const o = whole * 6;
      for (let i = 0; i < 3; i++) {
        pos.array[o + i] = p.full[o + i];
        pos.array[o + 3 + i] = p.full[o + i] + (p.full[o + 3 + i] - p.full[o + i]) * frac;
      }
    }
    pos.needsUpdate = true;
    p.geo.setDrawRange(0, (whole + (frac > 0 ? 1 : 0)) * 2);
  };

  // The solid surfaces stop drawing colour in wireframe mode, but still fill the depth buffer,
  // which is what lets the hidden edges know they are hidden
  const solids = [cube.bodyMat, cube.mirrorMat, cube.rimMat, cube.mechMat];
  let on = false;
  let since = Infinity; // seconds since the switch was flipped on (after the intro)

  return {
    get on() { return on; },
    setTheme(name) {
      visibleMat.color.set(THEME_INK[name] || THEME_INK.dark);
      hiddenMat.color.set(THEME_INK[name] || THEME_INK.dark);
    },
    toggle(value = !on) {
      if (value && !on) since = 0;
      on = value;
      for (const m of solids) { m.colorWrite = !on; m.needsUpdate = true; }
      if (on) lines.forEach((l) => { l.visible = true; });
    },
    update(dt) {
      const k = 1 - Math.exp(-dt * 8);
      visibleMat.opacity += ((on ? 0.9 : 0) - visibleMat.opacity) * k;
      hiddenMat.opacity += ((on ? 0.16 : 0) - hiddenMat.opacity) * k;
      if (!on && visibleMat.opacity < 0.01) lines.forEach((l) => { l.visible = false; });
      if (!on) return;
      since += dt;
      for (const p of pieces) {
        let r = 1;
        if (!instant) {
          // During the intro each piece is drawn as it splits off; afterwards, inside out
          r = cube.introDone
            ? (since - p.delay) / TRACE
            : (cube.introTime - (p.c.growAt ?? 0) - 0.04) / TRACE;
          r = Math.min(Math.max(r, 0), 1);
          if (r < 1) r = 1 - (1 - r) ** 2; // the pen slows into the last edge
        }
        trace(p, r);
      }
    },
  };
}
