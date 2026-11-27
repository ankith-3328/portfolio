// The blueprint backdrop: a full-screen layer drawn behind the cube, in one fragment shader.
//   - a mirror-cube grid: each block is cut into three uneven strips both ways (the cube's own
//     layer proportions), neighbouring blocks are mirrored, and block corners carry a small dot;
//     it drifts a little with scroll
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

  const float BLOCK = 132.0; // one 'face' of the grid, px

  // Along one axis: distance (px) to the nearest cut inside a block and to the block's own edge.
  // The two inner cuts split the block unevenly (like a mirror cube's layers), and every other
  // block is mirrored so the pattern doesn't read as a plain repeat.
  vec2 cuts(float x, float a, float b) {
    float i = floor(x / BLOCK);
    float u = x - i * BLOCK;
    if (mod(i, 2.0) > 0.5) u = BLOCK - u;
    float edge = min(u, BLOCK - u);
    float inner = min(abs(u - a * BLOCK), abs(u - b * BLOCK));
    return vec2(inner, edge);
  }

  float line(float d, float width) {
    return 1.0 - smoothstep(width - 0.5, width + 0.6, d);
  }

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec2 p = vec2(vUv.x * uRes.x, (1.0 - vUv.y) * uRes.y);

    vec2 q = p + vec2(0.0, uScroll * 0.3);

    // Columns cut at 0.62 / 1.62 of 3 (x layers 0.62 : 1 : 1.38); rows at 0.74 / 1.74 of 3
    vec2 cx = cuts(q.x, 0.62 / 3.0, 1.62 / 3.0);
    vec2 cy = cuts(q.y, 0.74 / 3.0, 1.74 / 3.0);
    float inner = max(line(cx.x, 0.5), line(cy.x, 0.5));
    float edge = max(line(cx.y, 0.6), line(cy.y, 0.6));
    float corner = 1.0 - smoothstep(1.2, 2.2, length(vec2(cx.y, cy.y)));
    float lines = max(max(inner * 0.4, edge * 0.85), corner * 2.2);

    // Cursor spotlight, and the pool of light under the cube
    float spot = exp(-pow(length(p - uMouse) / 280.0, 2.0)) * uMouseOn;
    vec2 under = (p - uCube - vec2(0.0, uCubeR * 0.6)) / vec2(1.4, 0.5);
    float pool = exp(-pow(length(under) / (uCubeR * 1.05), 2.0));

    float gridA = lines * (0.055 + 0.2 * spot + 0.05 * pool) * uStrength;
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
