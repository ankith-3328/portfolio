// Three small CAD effects on the cube itself, all drawn in 3D so they turn with it:
//   - rotation arc: while a layer turns, a thin arc with an arrowhead sweeps around that layer,
//     showing the direction and how far it has gone; it fades once the turn has landed
//   - wireframe: a switchable drafting view; every piece becomes crisp edge lines, solid where
//     visible and dashed where hidden behind other pieces
//   - assembly lines: while the cube is pulled apart (exploded view), dashed lines trace each
//     piece back to the slot it came from

import * as THREE from 'three';
import { EXPLODE_SPREAD, layerCentre } from './cube.js';

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
export function makeWireframe(cube, extraSolids = []) {
  const visibleMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0 });
  // Hidden edges: drawn only where something nearer is in front of them, dashed and faint
  const hiddenMat = new THREE.LineDashedMaterial({
    transparent: true, opacity: 0, dashSize: 0.07, gapSize: 0.06,
    depthFunc: THREE.GreaterDepth, depthWrite: false,
  });
  const lines = [];
  for (const c of cube.cubies) {
    const box = new THREE.BoxGeometry(c.size.x, c.size.y, c.size.z);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    const front = new THREE.LineSegments(edges, visibleMat);
    const behind = new THREE.LineSegments(edges, hiddenMat);
    behind.computeLineDistances();
    for (const l of [front, behind]) {
      l.position.copy(c.centre);
      l.visible = false;
      c.group.add(l);
      lines.push(l);
    }
  }
  // The solid surfaces stop drawing colour in wireframe mode, but still fill the depth buffer,
  // which is what lets the hidden edges know they are hidden
  const solids = [cube.bodyMat, cube.mirrorMat, cube.rimMat, cube.mechMat, ...extraSolids];
  let on = false;

  return {
    get on() { return on; },
    setTheme(name) {
      visibleMat.color.set(THEME_INK[name] || THEME_INK.dark);
      hiddenMat.color.set(THEME_INK[name] || THEME_INK.dark);
    },
    toggle(value = !on) {
      on = value;
      for (const m of solids) { m.colorWrite = !on; m.needsUpdate = true; }
      if (on) lines.forEach((l) => { l.visible = true; });
    },
    update(dt) {
      const k = 1 - Math.exp(-dt * 8);
      visibleMat.opacity += ((on ? 0.9 : 0) - visibleMat.opacity) * k;
      hiddenMat.opacity += ((on ? 0.16 : 0) - hiddenMat.opacity) * k;
      if (!on && visibleMat.opacity < 0.01) lines.forEach((l) => { l.visible = false; });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Assembly lines in the exploded view
export function makeAssemblyLines(cube) {
  const count = cube.cubies.length;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 2 * 3), 3));
  const material = new THREE.LineDashedMaterial({
    transparent: true, opacity: 0, dashSize: 0.045, gapSize: 0.035, depthWrite: false, depthTest: false,
  });
  const lines = new THREE.LineSegments(geo, material);
  lines.frustumCulled = false;
  lines.renderOrder = 10;
  lines.visible = false;
  cube.core.add(lines);
  const offset = new THREE.Vector3();

  return {
    setTheme(name) { material.color.set(THEME_ACCENT[name] || THEME_ACCENT.dark); },
    update() {
      const e = cube.explode;
      material.opacity = Math.min(1, e * 2.2) * 0.95;
      lines.visible = e > 0.02;
      if (!lines.visible) return;
      const pos = geo.attributes.position;
      const spread = 1 + EXPLODE_SPREAD * e;
      cube.cubies.forEach((c, i) => {
        // From where the piece's centre would be when assembled to where it is now
        offset.copy(c.centre).applyQuaternion(c.group.quaternion);
        const g = c.group.position;
        const hide = c.flying || !c.group.visible;
        pos.setXYZ(i * 2, g.x / spread + offset.x, g.y / spread + offset.y, g.z / spread + offset.z);
        if (hide) pos.setXYZ(i * 2 + 1, g.x / spread + offset.x, g.y / spread + offset.y, g.z / spread + offset.z);
        else pos.setXYZ(i * 2 + 1, g.x + offset.x, g.y + offset.y, g.z + offset.z);
      });
      pos.needsUpdate = true;
      lines.computeLineDistances();
    },
  };
}
