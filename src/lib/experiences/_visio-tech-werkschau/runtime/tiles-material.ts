import * as THREE from "three";
import { WERKSCHAU_COLLISION } from "../collision/config";
import type { WerkschauConeVolume } from "../collision/types";
import { WERKSCHAU_EXHIBITION_BOUNDS, WERKSCHAU_TILE_LOOK } from "../constants";

type ShaderCompileParameters = Parameters<THREE.Material["onBeforeCompile"]>[0];

type MaterialWithTextureMaps = THREE.Material & {
  alphaMap?: THREE.Texture | null;
  aoMap?: THREE.Texture | null;
  bumpMap?: THREE.Texture | null;
  displacementMap?: THREE.Texture | null;
  emissiveMap?: THREE.Texture | null;
  lightMap?: THREE.Texture | null;
  map?: THREE.Texture | null;
  metalnessMap?: THREE.Texture | null;
  normalMap?: THREE.Texture | null;
  roughnessMap?: THREE.Texture | null;
  specularMap?: THREE.Texture | null;
};

interface FragmentConeUniforms {
  axisHeight: { value: THREE.Vector4[] };
  count: { value: number };
  tipRadius: { value: THREE.Vector4[] };
}

const emptyVector4 = new THREE.Vector4();
const shaderNeutralColor = new THREE.Color(WERKSCHAU_TILE_LOOK.NEUTRAL_COLOR);
const shaderNeutralLightDirection = new THREE.Vector3(
  WERKSCHAU_TILE_LOOK.NEUTRAL_SHADE_LIGHT_DIRECTION.x,
  WERKSCHAU_TILE_LOOK.NEUTRAL_SHADE_LIGHT_DIRECTION.y,
  WERKSCHAU_TILE_LOOK.NEUTRAL_SHADE_LIGHT_DIRECTION.z,
).normalize();
const fragmentConeMaskShader = createFragmentConeMaskShader();
const fragmentConeUniformsByMaterial = new WeakMap<
  THREE.Material,
  FragmentConeUniforms
>();

export function createWerkschauNeutralTileMaterial(
  sourceMaterial: THREE.Material | THREE.Material[],
): THREE.Material | THREE.Material[] {
  if (Array.isArray(sourceMaterial)) {
    return sourceMaterial.map((material) => cloneNeutralTileMaterial(material));
  }

  return cloneNeutralTileMaterial(sourceMaterial);
}

export function createWerkschauTileMaterial(
  sourceMaterial: THREE.Material | THREE.Material[],
): THREE.Material | THREE.Material[] {
  if (Array.isArray(sourceMaterial)) {
    return sourceMaterial.map((material) => cloneConeTileMaterial(material));
  }

  return cloneConeTileMaterial(sourceMaterial);
}

export function syncWerkschauTileMaterialSourceMaps(
  sourceMaterial: THREE.Material | THREE.Material[],
  targetMaterial: THREE.Material | THREE.Material[],
): void {
  if (Array.isArray(sourceMaterial) || Array.isArray(targetMaterial)) {
    if (!Array.isArray(sourceMaterial) || !Array.isArray(targetMaterial)) return;

    for (
      let index = 0;
      index < sourceMaterial.length && index < targetMaterial.length;
      index += 1
    ) {
      syncSingleTileMaterialSourceMaps(sourceMaterial[index], targetMaterial[index]);
    }
    return;
  }

  syncSingleTileMaterialSourceMaps(sourceMaterial, targetMaterial);
}

export function setWerkschauTileMaterialFragmentCones(
  targetMaterial: THREE.Material | THREE.Material[],
  cones: readonly WerkschauConeVolume[],
): void {
  if (Array.isArray(targetMaterial)) {
    for (const material of targetMaterial) {
      setSingleTileMaterialFragmentCones(material, cones);
    }
    return;
  }

  setSingleTileMaterialFragmentCones(targetMaterial, cones);
}

export function disposeClonedMaterial(
  material: THREE.Material | THREE.Material[],
  disposedMaterials?: WeakSet<THREE.Material>,
): void {
  if (Array.isArray(material)) {
    for (const entry of material) {
      disposeClonedSingleMaterial(entry, disposedMaterials);
    }
    return;
  }

  disposeClonedSingleMaterial(material, disposedMaterials);
}

export function disposeMaterial(
  material: THREE.Material | THREE.Material[],
  disposedMaterials?: WeakSet<THREE.Material>,
): void {
  if (Array.isArray(material)) {
    for (const entry of material) {
      disposeSingleMaterial(entry, disposedMaterials);
    }
    return;
  }

  disposeSingleMaterial(material, disposedMaterials);
}

function cloneNeutralTileMaterial(sourceMaterial: THREE.Material): THREE.Material {
  const material = new THREE.MeshLambertMaterial({
    color: WERKSCHAU_TILE_LOOK.NEUTRAL_COLOR,
    flatShading: WERKSCHAU_TILE_LOOK.FLAT_SHADING,
    side: sourceMaterial.side,
  });

  material.depthTest = true;
  material.depthWrite = true;
  material.needsUpdate = true;
  return material;
}

function cloneConeTileMaterial(sourceMaterial: THREE.Material): THREE.Material {
  const material = cloneBaseTileMaterial(sourceMaterial);
  const fragmentConeUniforms = createFragmentConeUniforms();
  fragmentConeUniformsByMaterial.set(material, fragmentConeUniforms);
  const previousOnBeforeCompile = material.onBeforeCompile;
  const previousProgramCacheKey =
    typeof material.customProgramCacheKey === "function"
      ? material.customProgramCacheKey.bind(material)
      : null;

  material.onBeforeCompile = (shader: ShaderCompileParameters, renderer) => {
    previousOnBeforeCompile(shader, renderer);
    shader.uniforms.uWerkschauNeutralColor = { value: shaderNeutralColor };
    shader.uniforms.uWerkschauOutsideOpacity = {
      value: WERKSCHAU_TILE_LOOK.OPACITY,
    };
    shader.uniforms.uWerkschauNeutralLightDirection = {
      value: shaderNeutralLightDirection,
    };
    shader.uniforms.uWerkschauNeutralShadeAmbient = {
      value: WERKSCHAU_TILE_LOOK.NEUTRAL_SHADE_AMBIENT,
    };
    shader.uniforms.uWerkschauNeutralShadeHemisphere = {
      value: WERKSCHAU_TILE_LOOK.NEUTRAL_SHADE_HEMISPHERE,
    };
    shader.uniforms.uWerkschauNeutralShadeDirectional = {
      value: WERKSCHAU_TILE_LOOK.NEUTRAL_SHADE_DIRECTIONAL,
    };
    shader.uniforms.uWerkschauExhibitionBounds = {
      value: new THREE.Vector4(
        WERKSCHAU_EXHIBITION_BOUNDS.minX,
        WERKSCHAU_EXHIBITION_BOUNDS.maxX,
        WERKSCHAU_EXHIBITION_BOUNDS.minZ,
        WERKSCHAU_EXHIBITION_BOUNDS.maxZ,
      ),
    };
    shader.uniforms.uWerkschauFragmentConeCount = fragmentConeUniforms.count;
    shader.uniforms.uWerkschauFragmentConeTipRadius =
      fragmentConeUniforms.tipRadius;
    shader.uniforms.uWerkschauFragmentConeAxisHeight =
      fragmentConeUniforms.axisHeight;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float coneMask;\nvarying float vWerkschauConeMask;\nvarying vec3 vWerkschauWorldPosition;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvWerkschauConeMask = coneMask;\nvWerkschauWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nuniform vec3 uWerkschauNeutralColor;\nuniform float uWerkschauOutsideOpacity;\nuniform vec3 uWerkschauNeutralLightDirection;\nuniform float uWerkschauNeutralShadeAmbient;\nuniform float uWerkschauNeutralShadeHemisphere;\nuniform float uWerkschauNeutralShadeDirectional;\nuniform vec4 uWerkschauExhibitionBounds;\nuniform float uWerkschauFragmentConeCount;\nuniform vec4 uWerkschauFragmentConeTipRadius[${WERKSCHAU_COLLISION.FRAGMENT_MASK_MAX_CONES}];\nuniform vec4 uWerkschauFragmentConeAxisHeight[${WERKSCHAU_COLLISION.FRAGMENT_MASK_MAX_CONES}];\nvarying float vWerkschauConeMask;\nvarying vec3 vWerkschauWorldPosition;\n${fragmentConeMaskShader}`,
      )
      .replace(
        "#include <normal_fragment_begin>",
        "#include <normal_fragment_begin>\nfloat werkschauConeMaskForNormal = clamp(vWerkschauConeMask, 0.0, 1.0);\nvec3 werkschauFlatNormal = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));\nnormal = normalize(mix(werkschauFlatNormal, normal, werkschauConeMaskForNormal));",
      )
      .replace(
        "#include <map_fragment>",
        "float werkschauConeMask = 0.0;\n#ifdef USE_MAP\nwerkschauConeMask = max(\n  step(0.5, vWerkschauConeMask),\n  werkschauFragmentConeMask(vWerkschauWorldPosition)\n);\n#endif\nfloat werkschauInsideBounds = step(uWerkschauExhibitionBounds.x, vWerkschauWorldPosition.x) * step(vWerkschauWorldPosition.x, uWerkschauExhibitionBounds.y) * step(uWerkschauExhibitionBounds.z, vWerkschauWorldPosition.z) * step(vWerkschauWorldPosition.z, uWerkschauExhibitionBounds.w);\nwerkschauConeMask *= werkschauInsideBounds;\nvec3 werkschauFlatColor = uWerkschauNeutralColor;\nvec3 werkschauWorldNormal = normalize(cross(dFdx(vWerkschauWorldPosition), dFdy(vWerkschauWorldPosition)));\nfloat werkschauDirectional = max(dot(werkschauWorldNormal, normalize(uWerkschauNeutralLightDirection)), 0.0);\nfloat werkschauHemisphere = werkschauWorldNormal.y * 0.5 + 0.5;\nfloat werkschauShade = clamp(\n  uWerkschauNeutralShadeAmbient +\n    werkschauHemisphere * uWerkschauNeutralShadeHemisphere +\n    werkschauDirectional * uWerkschauNeutralShadeDirectional,\n  0.0,\n  1.0\n);\nvec3 werkschauShadedFlatColor = werkschauFlatColor * werkschauShade;\n#include <map_fragment>\ndiffuseColor.rgb = mix(werkschauShadedFlatColor, diffuseColor.rgb, werkschauConeMask);\ndiffuseColor.a = mix(uWerkschauOutsideOpacity, 1.0, werkschauConeMask);",
      );
  };
  material.customProgramCacheKey = () =>
    `${previousProgramCacheKey?.() ?? material.type}:werkschau-cone-texture-reveal-v5`;

  return material;
}

function createFragmentConeMaskShader(): string {
  const body = Array.from(
    { length: WERKSCHAU_COLLISION.FRAGMENT_MASK_MAX_CONES },
    (_, index) =>
      `  {
    float coneActive = step(${index.toFixed(1)} + 0.5, uWerkschauFragmentConeCount);
    vec4 tipRadius = uWerkschauFragmentConeTipRadius[${index}];
    vec4 axisHeight = uWerkschauFragmentConeAxisHeight[${index}];
    float height = max(axisHeight.w, 0.0001);
    vec3 tipToPosition = worldPosition - tipRadius.xyz;
    float projectedDistance = dot(tipToPosition, axisHeight.xyz);
    float insideHeight = step(0.0, projectedDistance) * step(projectedDistance, height);
    vec3 radialVector = axisHeight.xyz * projectedDistance - tipToPosition;
    float allowedRadius = tipRadius.w * projectedDistance / height;
    float insideRadius = step(dot(radialVector, radialVector), allowedRadius * allowedRadius);
    result = max(result, coneActive * insideHeight * insideRadius);
  }`,
  ).join("\n");

  return `float werkschauFragmentConeMask(vec3 worldPosition) {
  float result = 0.0;
${body}
  return result;
}`;
}

function createFragmentConeUniforms(): FragmentConeUniforms {
  return {
    axisHeight: {
      value: Array.from(
        { length: WERKSCHAU_COLLISION.FRAGMENT_MASK_MAX_CONES },
        () => new THREE.Vector4(),
      ),
    },
    count: { value: 0 },
    tipRadius: {
      value: Array.from(
        { length: WERKSCHAU_COLLISION.FRAGMENT_MASK_MAX_CONES },
        () => new THREE.Vector4(),
      ),
    },
  };
}

function cloneBaseTileMaterial(sourceMaterial: THREE.Material): THREE.Material {
  const material = sourceMaterial.clone();

  material.depthTest = true;
  material.depthWrite = true;
  material.needsUpdate = true;
  if ("metalness" in material) {
    (material as THREE.MeshStandardMaterial).metalness =
      WERKSCHAU_TILE_LOOK.METALNESS;
  }
  if ("roughness" in material) {
    (material as THREE.MeshStandardMaterial).roughness =
      WERKSCHAU_TILE_LOOK.ROUGHNESS;
  }
  if ("opacity" in material) {
    material.opacity = WERKSCHAU_TILE_LOOK.OPACITY;
  }
  if ("transparent" in material) {
    material.transparent = false;
  }

  return material;
}

function setSingleTileMaterialFragmentCones(
  targetMaterial: THREE.Material,
  cones: readonly WerkschauConeVolume[],
): void {
  const uniforms = fragmentConeUniformsByMaterial.get(targetMaterial);
  if (!uniforms) return;

  const count = Math.min(
    WERKSCHAU_COLLISION.FRAGMENT_MASK_MAX_CONES,
    cones.length,
  );
  uniforms.count.value = count;

  for (let index = 0; index < WERKSCHAU_COLLISION.FRAGMENT_MASK_MAX_CONES; index += 1) {
    const cone = cones[index];
    if (index >= count || !cone) {
      uniforms.tipRadius.value[index].copy(emptyVector4);
      uniforms.axisHeight.value[index].copy(emptyVector4);
      continue;
    }

    uniforms.tipRadius.value[index].set(
      cone.tip.x,
      cone.tip.y,
      cone.tip.z,
      cone.radius,
    );
    uniforms.axisHeight.value[index].set(
      cone.axisDirection.x,
      cone.axisDirection.y,
      cone.axisDirection.z,
      cone.height,
    );
  }
}

function syncSingleTileMaterialSourceMaps(
  sourceMaterial: THREE.Material,
  targetMaterial: THREE.Material,
): void {
  const source = sourceMaterial as MaterialWithTextureMaps;
  const target = targetMaterial as MaterialWithTextureMaps;
  let changed = false;

  if (target.map !== source.map) {
    target.map = source.map ?? null;
    changed = true;
  }
  if (target.alphaMap !== source.alphaMap) {
    target.alphaMap = source.alphaMap ?? null;
    changed = true;
  }
  if (target.aoMap !== source.aoMap) {
    target.aoMap = source.aoMap ?? null;
    changed = true;
  }
  if (target.bumpMap !== source.bumpMap) {
    target.bumpMap = source.bumpMap ?? null;
    changed = true;
  }
  if (target.displacementMap !== source.displacementMap) {
    target.displacementMap = source.displacementMap ?? null;
    changed = true;
  }
  if (target.emissiveMap !== source.emissiveMap) {
    target.emissiveMap = source.emissiveMap ?? null;
    changed = true;
  }
  if (target.lightMap !== source.lightMap) {
    target.lightMap = source.lightMap ?? null;
    changed = true;
  }
  if (target.metalnessMap !== source.metalnessMap) {
    target.metalnessMap = source.metalnessMap ?? null;
    changed = true;
  }
  if (target.normalMap !== source.normalMap) {
    target.normalMap = source.normalMap ?? null;
    changed = true;
  }
  if (target.roughnessMap !== source.roughnessMap) {
    target.roughnessMap = source.roughnessMap ?? null;
    changed = true;
  }
  if (target.specularMap !== source.specularMap) {
    target.specularMap = source.specularMap ?? null;
    changed = true;
  }

  if (changed) {
    targetMaterial.needsUpdate = true;
  }
}

function disposeClonedSingleMaterial(
  material: THREE.Material,
  disposedMaterials?: WeakSet<THREE.Material>,
): void {
  if (disposedMaterials?.has(material)) return;

  disposedMaterials?.add(material);
  material.dispose();
}

function disposeSingleMaterial(
  material: THREE.Material,
  disposedMaterials?: WeakSet<THREE.Material>,
): void {
  if (disposedMaterials?.has(material)) return;

  disposedMaterials?.add(material);

  const materialWithMaps = material as MaterialWithTextureMaps;
  materialWithMaps.map?.dispose();
  materialWithMaps.alphaMap?.dispose();
  materialWithMaps.aoMap?.dispose();
  materialWithMaps.bumpMap?.dispose();
  materialWithMaps.displacementMap?.dispose();
  materialWithMaps.emissiveMap?.dispose();
  materialWithMaps.lightMap?.dispose();
  materialWithMaps.metalnessMap?.dispose();
  materialWithMaps.normalMap?.dispose();
  materialWithMaps.roughnessMap?.dispose();
  materialWithMaps.specularMap?.dispose();
  material.dispose();
}
