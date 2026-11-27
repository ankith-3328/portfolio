// The blueprint backdrop: a full-screen layer drawn behind the cube, in one fragment shader.
//   - a fine engineering grid with heavier major lines, drifting a little with scroll
//   - the grid bends inward around the cube, like a lens
//   - a warm spotlight follows the cursor and lights the grid up where it shines
//   - a soft pool of light under the cube, and a touch of film grain everywhere

import * as THREE from 'three';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec2 uRes;        // canvas size in CSS px
  uniform vec2 uMouse;      // cursor, px (y down)
  uniform float uMouseOn;   // 0..1: fades the spotlight in and out
  uniform vec2 uCube;       // cube centre on screen, px
  uniform float uCubeR;     // cube radius on screen, px
  uniform float uScroll;    // page scroll, px
  uniform float uGrainSeed; // changes a few times a second
  uniform vec3 uInk;        // grid line colour
  uniform vec3 uWarm;       // light colour
  uniform vec3 uGrain;      // grain colour
  uniform float uStrength;  // overall opacity of the grid (lighter on the light theme)
  varying vec2 vUv;

  // 1 on a grid line of the given cell size and width (px), 0 elsewhere, anti-aliased
  float gridLine(vec2 p, float cell, float width) {
    vec2 g = abs(fract(p / cell - 0.5) - 0.5) * cell;
    float d = min(g.x, g.y);
    return 1.0 - smoothstep(width - 0.5, width + 0.6, d);
  }

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec2 p = vec2(vUv.x * uRes.x, (1.0 - vUv.y) * uRes.y);

    // Lens: pull the grid toward the cube
    vec2 d = p - uCube;
    float r = max(length(d), 1e-3);
    float lens = exp(-pow(r / (uCubeR * 1.7), 2.0));
    vec2 q = p - d / r * lens * uCubeR * 0.22;
    q.y += uScroll * 0.3;

    float lines = gridLine(q, 24.0, 0.5) * 0.35 + gridLine(q, 120.0, 0.6) * 0.85;

    // Cursor spotlight, and the pool of light under the cube
    float spot = exp(-pow(length(p - uMouse) / 280.0, 2.0)) * uMouseOn;
    vec2 under = (p - uCube - vec2(0.0, uCubeR * 0.6)) / vec2(1.4, 0.5);
    float pool = exp(-pow(length(under) / (uCubeR * 1.05), 2.0));

    float gridA = lines * (0.055 + 0.2 * spot + 0.05 * pool) * (1.0 - 0.75 * lens) * uStrength;
    float glowA = spot * 0.05 + pool * 0.09;
    float grainA = max(hash(floor(p) + uGrainSeed) - 0.5, 0.0) * 0.05;

    // Premultiplied: colour already multiplied by its alpha
    vec3 col = uInk * gridA + uWarm * glowA + uGrain * grainA;
    gl_FragColor = vec4(col, clamp(gridA + glowA + grainA, 0.0, 1.0));
  }
`;

const THEMES = {
  dark: { ink: 0xECE5DA, warm: 0xE8A766, grain: 0xFFFFFF, strength: 1 },
  light: { ink: 0x3A3530, warm: 0xD08A52, grain: 0x000000, strength: 0.85 },
};

export function makeBackdrop() {
  const uniforms = {
    uRes: { value: new THREE.Vector2(1, 1) },
    uMouse: { value: new THREE.Vector2(-1e4, -1e4) },
    uMouseOn: { value: 0 },
    uCube: { value: new THREE.Vector2(0, 0) },
    uCubeR: { value: 200 },
    uScroll: { value: 0 },
    uGrainSeed: { value: 0 },
    uInk: { value: new THREE.Color() },
    uWarm: { value: new THREE.Color() },
    uGrain: { value: new THREE.Color() },
    uStrength: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader,
    transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false,
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  return {
    scene, camera, uniforms,
    setTheme(name) {
      const t = THEMES[name] || THEMES.dark;
      uniforms.uInk.value.set(t.ink);
      uniforms.uWarm.value.set(t.warm);
      uniforms.uGrain.value.set(t.grain);
      uniforms.uStrength.value = t.strength;
    },
  };
}
