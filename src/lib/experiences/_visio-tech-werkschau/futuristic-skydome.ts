/**
 * FuturisticSkydome — Neon hexagonal grid skydome for abstract/sci-fi scenes
 *
 * Sphere with a glowing hex grid overlay in two colors
 * (hot pink + teal, inspired by visio-technologica overlays).
 * Static — no animation. Pair with PostFXPipeline bloom for full glow.
 *
 * @example
 * const sky = createFuturisticSkydome();
 * scene.add(sky);
 */
import * as THREE from "three";

export interface FuturisticSkydomeConfig {
	radius?: number;
	gridColor1?: number;
	gridColor2?: number;
	bgColorTop?: number;
	bgColorBottom?: number;
	gridScale?: number;
	lineWidth?: number;
}

const DEFAULTS: Required<FuturisticSkydomeConfig> = {
	radius: 500,
	gridColor1: 0xff44aa,
	gridColor2: 0x00ffcc,
	bgColorTop: 0x9AADD4,
	bgColorBottom: 0xCBBADB,
	gridScale: 0.03,
	lineWidth: 1.0,
};

const VERT = /* glsl */ `
varying vec3 vWorldPosition;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uGridColor1;
uniform vec3 uGridColor2;
uniform vec3 uBgColorTop;
uniform vec3 uBgColorBottom;
uniform float uLineWidth;
uniform float uGridScale;
uniform vec3 uOrigin;

varying vec3 vWorldPosition;

void main() {
  vec3 worldPos = vWorldPosition - uOrigin;
  vec3 dir = normalize(worldPos);

  // World-space hex grid: three line sets at 0°, 60°, 120°
  vec2 p = worldPos.xz * uGridScale;
  float lw = 0.1 * uLineWidth;

  // Set 1 — 0° (vertical)
  float g1 = p.x;
  float fw1 = max(fwidth(g1), 0.001);
  float line1 = 1.0 - smoothstep(lw - fw1, lw + fw1, abs(fract(g1 - 0.5) - 0.5));

  // Set 2 — 60°
  float g2 = p.x * 0.5 + p.y * 0.866;
  float fw2 = max(fwidth(g2), 0.001);
  float line2 = 1.0 - smoothstep(lw - fw2, lw + fw2, abs(fract(g2 - 0.5) - 0.5));

  // Set 3 — 120°
  float g3 = p.x * -0.5 + p.y * 0.866;
  float fw3 = max(fwidth(g3), 0.001);
  float line3 = 1.0 - smoothstep(lw - fw3, lw + fw3, abs(fract(g3 - 0.5) - 0.5));

  float gridLine = max(max(line1, line2), line3);

  // Pairwise intersections glow brighter
  float intersection = max(max(line1 * line2, line2 * line3), line1 * line3);

  // Soft horizon fade
  float fade = smoothstep(-0.1, 0.3, dir.y);

  // Dark gradient background
  float yNorm = dir.y * 0.5 + 0.5;
  vec3 bg = mix(uBgColorBottom, uBgColorTop, yNorm);

  // Pink for 0°, teal for 60°, blend for 120°
  vec3 gridCol = uGridColor1 * line1 + uGridColor2 * line2
    + mix(uGridColor1, uGridColor2, 0.5) * line3;
  gridCol += (uGridColor1 + uGridColor2) * 0.3 * intersection;

  vec3 col = bg + gridCol * gridLine * fade;

  gl_FragColor = vec4(col, 1.0);
}
`;

export function createFuturisticSkydome(
	config?: FuturisticSkydomeConfig,
): THREE.Mesh {
	const c = { ...DEFAULTS, ...config };

	const geo = new THREE.IcosahedronGeometry(c.radius, 4);

	const mat = new THREE.ShaderMaterial({
		vertexShader: VERT,
		fragmentShader: FRAG,
		uniforms: {
			uGridColor1: { value: new THREE.Color(c.gridColor1) },
			uGridColor2: { value: new THREE.Color(c.gridColor2) },
			uBgColorTop: { value: new THREE.Color(c.bgColorTop) },
			uBgColorBottom: { value: new THREE.Color(c.bgColorBottom) },
			uLineWidth: { value: c.lineWidth },
			uGridScale: { value: c.gridScale },
			uOrigin: { value: new THREE.Vector3() },
		},
		side: THREE.DoubleSide,
		depthWrite: false,
	});

	const mesh = new THREE.Mesh(geo, mat);
	mesh.renderOrder = -1;
	mesh.frustumCulled = false;
	return mesh;
}
