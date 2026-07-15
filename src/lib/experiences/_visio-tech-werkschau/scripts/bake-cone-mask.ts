import { Buffer } from "node:buffer";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { WERKSCHAU_COLLISION } from "../collision/config";
import type { WerkschauConeVolume } from "../collision/types";
import { isVertexInsideCone } from "../collision/vertex-cone-test";

const DEFAULT_CONE_DATA_DIR =
  "static/experiences/_visio-tech-werkschau/cone-data/generated";
const BAKE_VERSION = 1;
const bakeDate = new Date().toISOString();
const scratchPosition = new THREE.Vector3();
const scratchTriangleCenter = new THREE.Vector3();
const scratchTriangleSample = new THREE.Vector3();
const scratchTriangleVertexA = new THREE.Vector3();
const scratchTriangleVertexB = new THREE.Vector3();
const scratchTriangleVertexC = new THREE.Vector3();
const scratchSphere = new THREE.Sphere();
const scratchConeBoundsCenter = new THREE.Vector3();
let worldPositions = new Float32Array(0);

interface BakeStats {
  meshesProcessed: number;
  meshesWithIntersections: number;
  meshesWithoutIntersections: number;
  verticesProcessed: number;
  verticesMasked: number;
  conesLoaded: number;
}

interface BatchBakeReport extends BakeStats {
  filesProcessed: number;
  filesCopied: number;
  filesFailed: number;
  skippedFiles: string[];
  failedFiles: { path: string; error: string }[];
}

interface ConeChunkJson {
  chunkKey: string;
  positions: readonly number[];
  scalars: readonly number[];
  coneIndex: readonly number[];
}

class NodeFileReader {
  public result: string | ArrayBuffer | null = null;
  public onloadend: ((this: FileReader, event: ProgressEvent<FileReader>) => void) | null =
    null;

  public readAsArrayBuffer(blob: Blob): void {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.emitLoadEnd();
    });
  }

  public readAsDataURL(blob: Blob): void {
    blob.arrayBuffer().then((buffer) => {
      const mimeType = blob.type || "application/octet-stream";
      this.result = `data:${mimeType};base64,${Buffer.from(buffer).toString("base64")}`;
      this.emitLoadEnd();
    });
  }

  private emitLoadEnd(): void {
    this.onloadend?.call(
      this as unknown as FileReader,
      new Event("loadend") as ProgressEvent<FileReader>,
    );
  }
}

installFileReaderPolyfill();
await main();

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  const coneDataDir = process.argv[4] ?? DEFAULT_CONE_DATA_DIR;
  const bakeSource = process.argv[5] ?? outputPath;

  if (!inputPath || !outputPath) {
    throw new Error(
      "Usage: bun run src/lib/experiences/_visio-tech-werkschau/scripts/bake-cone-mask.ts <input.glb|input.gltf> <output.glb|output.gltf> [cone-data-dir] [runtime-source-url]",
    );
  }

  const input = path.resolve(inputPath);
  const output = path.resolve(outputPath);
  const cones = await loadCones(path.resolve(coneDataDir));
  const inputStats = await stat(input);

  if (inputStats.isDirectory()) {
    const report = await bakeDirectory(input, output, cones, bakeSource);
    await writeFile(
      path.join(output, "cone-mask-bake-report.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify({ input, output, report }, null, 2));
    return;
  }

  const stats = await bakeFile(input, output, cones, bakeSource);
  console.log(JSON.stringify({ input, output, ...stats }, null, 2));
}

async function bakeDirectory(
  inputDir: string,
  outputDir: string,
  cones: readonly WerkschauConeVolume[],
  bakeSourceBase: string,
): Promise<BatchBakeReport> {
  if (isPathInside(outputDir, inputDir)) {
    throw new Error("Output directory must not be inside the input directory.");
  }

  const report = createBatchBakeReport(cones.length);
  const files = await collectFiles(inputDir);

  for (const inputFile of files) {
    const relativePath = path.relative(inputDir, inputFile);
    const outputFile = path.join(outputDir, relativePath);
    await mkdir(path.dirname(outputFile), { recursive: true });

    if (!isSupportedMeshFile(inputFile)) {
      await copyFile(inputFile, outputFile);
      report.filesCopied += 1;
      report.skippedFiles.push(relativePath);
      continue;
    }

    try {
      const fileStats = await bakeFile(
        inputFile,
        outputFile,
        cones,
        getRuntimeBakeSource(bakeSourceBase, relativePath),
      );
      report.filesProcessed += 1;
      report.meshesProcessed += fileStats.meshesProcessed;
      report.meshesWithIntersections += fileStats.meshesWithIntersections;
      report.meshesWithoutIntersections += fileStats.meshesWithoutIntersections;
      report.verticesProcessed += fileStats.verticesProcessed;
      report.verticesMasked += fileStats.verticesMasked;
    } catch (error: unknown) {
      await copyFile(inputFile, outputFile);
      report.filesFailed += 1;
      report.failedFiles.push({
        path: relativePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return report;
}

async function bakeFile(
  input: string,
  output: string,
  cones: readonly WerkschauConeVolume[],
  bakeSource: string,
): Promise<BakeStats> {
  const scene = await loadGltfScene(input);
  const stats = bakeScene(scene, cones, bakeSource);

  await mkdir(path.dirname(output), { recursive: true });
  await writeGltf(scene, output);
  return stats;
}

function bakeScene(
  scene: THREE.Object3D,
  cones: readonly WerkschauConeVolume[],
  bakeSource: string,
): BakeStats {
  const stats: BakeStats = {
    meshesProcessed: 0,
    meshesWithIntersections: 0,
    meshesWithoutIntersections: 0,
    verticesProcessed: 0,
    verticesMasked: 0,
    conesLoaded: cones.length,
  };

  scene.updateMatrixWorld(true);
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (!(object.geometry instanceof THREE.BufferGeometry)) return;

    const result = bakeMesh(object, cones, bakeSource);
    if (!result) return;

    stats.meshesProcessed += 1;
    stats.verticesProcessed += result.vertexCount;
    stats.verticesMasked += result.maskedVertices;
    if (result.maskedVertices > 0) {
      stats.meshesWithIntersections += 1;
    } else {
      stats.meshesWithoutIntersections += 1;
    }
  });

  return stats;
}

function bakeMesh(
  mesh: THREE.Mesh,
  cones: readonly WerkschauConeVolume[],
  bakeSource: string,
): { vertexCount: number; maskedVertices: number } | null {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position");
  if (!(position instanceof THREE.BufferAttribute) || position.itemSize < 3) {
    return null;
  }

  const nearbyCones = getNearbyCones(mesh, cones);
  const vertexCount = position.count;
  const mask = new Float32Array(vertexCount);

  if (nearbyCones.length > 0) {
    maskVertices(mesh, position, nearbyCones, mask);
    maskTriangles(geometry, nearbyCones, mask);
  }

  const maskedVertices = countMaskedVertices(mask);
  geometry.setAttribute("coneMask", new THREE.BufferAttribute(mask, 1));
  geometry.userData.werkschauConeMaskVersion = BAKE_VERSION;
  geometry.userData.werkschauHasConeIntersection = maskedVertices > 0;
  geometry.userData.werkschauBakeDate = bakeDate;
  geometry.userData.werkschauBakeSource = bakeSource;
  mesh.userData.werkschauConeMaskVersion = BAKE_VERSION;
  mesh.userData.werkschauHasConeIntersection = maskedVertices > 0;
  mesh.userData.werkschauBakeDate = bakeDate;
  mesh.userData.werkschauBakeSource = bakeSource;

  return { vertexCount, maskedVertices };
}

function maskVertices(
  mesh: THREE.Mesh,
  position: THREE.BufferAttribute,
  cones: readonly WerkschauConeVolume[],
  mask: Float32Array,
): void {
  worldPositions = new Float32Array(position.count * 3);

  for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
    scratchPosition.fromBufferAttribute(position, vertexIndex);
    mesh.localToWorld(scratchPosition);
    scratchPosition.toArray(worldPositions, vertexIndex * 3);

    for (const cone of cones) {
      if (!isVertexInsideCone(scratchPosition, cone)) continue;

      mask[vertexIndex] = 1;
      break;
    }
  }
}

function maskTriangles(
  geometry: THREE.BufferGeometry,
  cones: readonly WerkschauConeVolume[],
  mask: Float32Array,
): void {
  const index = geometry.index;
  const triangleCount = index ? index.count / 3 : mask.length / 3;

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const vertexA = index ? index.getX(triangleIndex * 3) : triangleIndex * 3;
    const vertexB = index ? index.getX(triangleIndex * 3 + 1) : vertexA + 1;
    const vertexC = index ? index.getX(triangleIndex * 3 + 2) : vertexA + 2;

    if (mask[vertexA] === 1 && mask[vertexB] === 1 && mask[vertexC] === 1) {
      continue;
    }

    if (isTriangleInsideAnyCone(vertexA, vertexB, vertexC, cones)) {
      mask[vertexA] = 1;
      mask[vertexB] = 1;
      mask[vertexC] = 1;
    }
  }
}

function isTriangleInsideAnyCone(
  vertexA: number,
  vertexB: number,
  vertexC: number,
  cones: readonly WerkschauConeVolume[],
): boolean {
  scratchTriangleVertexA.fromArray(worldPositions, vertexA * 3);
  scratchTriangleVertexB.fromArray(worldPositions, vertexB * 3);
  scratchTriangleVertexC.fromArray(worldPositions, vertexC * 3);
  scratchTriangleCenter
    .copy(scratchTriangleVertexA)
    .add(scratchTriangleVertexB)
    .add(scratchTriangleVertexC)
    .multiplyScalar(1 / 3);

  for (const cone of cones) {
    if (isVertexInsideCone(scratchTriangleCenter, cone)) return true;
    if (isSampledTriangleInsideCone(cone)) return true;
  }

  return false;
}

function isSampledTriangleInsideCone(cone: WerkschauConeVolume): boolean {
  const steps = getTriangleSampleSubdivisions();
  if (steps <= 1) return false;

  for (let aStep = 0; aStep <= steps; aStep += 1) {
    for (let bStep = 0; bStep <= steps - aStep; bStep += 1) {
      const cStep = steps - aStep - bStep;
      if (aStep === steps || bStep === steps || cStep === steps) continue;

      scratchTriangleSample
        .copy(scratchTriangleVertexA)
        .multiplyScalar(aStep / steps)
        .addScaledVector(scratchTriangleVertexB, bStep / steps)
        .addScaledVector(scratchTriangleVertexC, cStep / steps);

      if (isVertexInsideCone(scratchTriangleSample, cone)) return true;
    }
  }

  return false;
}

function getTriangleSampleSubdivisions(): number {
  const longestEdge = Math.max(
    scratchTriangleVertexA.distanceTo(scratchTriangleVertexB),
    scratchTriangleVertexB.distanceTo(scratchTriangleVertexC),
    scratchTriangleVertexC.distanceTo(scratchTriangleVertexA),
  );

  return Math.min(
    WERKSCHAU_COLLISION.MAX_TRIANGLE_MASK_SUBDIVISIONS,
    Math.ceil(longestEdge / WERKSCHAU_COLLISION.TRIANGLE_MASK_SAMPLE_SPACING_METERS),
  );
}

function getNearbyCones(
  mesh: THREE.Mesh,
  cones: readonly WerkschauConeVolume[],
): readonly WerkschauConeVolume[] {
  mesh.geometry.computeBoundingSphere();
  const localSphere = mesh.geometry.boundingSphere;
  if (!localSphere) return [];

  scratchSphere.copy(localSphere).applyMatrix4(mesh.matrixWorld);

  return cones.filter((cone) => {
    scratchConeBoundsCenter
      .copy(cone.tip)
      .addScaledVector(cone.axisDirection, cone.height * 0.5);

    const coneBoundsRadius = Math.hypot(cone.height * 0.5, cone.radius);
    const radiusSum = scratchSphere.radius + coneBoundsRadius;
    return (
      scratchSphere.center.distanceToSquared(scratchConeBoundsCenter) <=
      radiusSum * radiusSum
    );
  });
}

function countMaskedVertices(mask: Float32Array): number {
  let count = 0;
  for (const value of mask) {
    if (value > 0) count += 1;
  }
  return count;
}

async function loadCones(coneDataDir: string): Promise<WerkschauConeVolume[]> {
  const chunksDir = path.join(coneDataDir, "chunks");
  const fileNames = (await readdir(chunksDir)).filter((fileName) =>
    fileName.endsWith(".json"),
  );
  const cones: WerkschauConeVolume[] = [];

  for (const fileName of fileNames) {
    const chunk = parseConeChunkJson(
      JSON.parse(await readText(path.join(chunksDir, fileName))),
    );

    for (let index = 0; index < chunk.coneIndex.length; index += 1) {
      const positionOffset = index * 6;
      const scalarOffset = index * 2;
      const tip = new THREE.Vector3(
        chunk.positions[positionOffset],
        chunk.positions[positionOffset + 1],
        chunk.positions[positionOffset + 2],
      );
      const axisDirection = new THREE.Vector3(
        chunk.positions[positionOffset + 3],
        chunk.positions[positionOffset + 4],
        chunk.positions[positionOffset + 5],
      ).normalize();
      const height = chunk.scalars[scalarOffset + 1];

      cones.push({
        tip,
        axisDirection,
        radius: chunk.scalars[scalarOffset],
        height,
        baseCenter: tip.clone().addScaledVector(axisDirection, height),
        placementPointId: `${chunk.chunkKey}:${chunk.coneIndex[index]}`,
        sourceBuildingId: chunk.chunkKey,
        chunkKey: chunk.chunkKey,
        coneIndex: chunk.coneIndex[index],
      });
    }
  }

  return cones;
}

function parseConeChunkJson(value: unknown): ConeChunkJson {
  if (!isRecord(value) || typeof value.chunkKey !== "string") {
    throw new Error("Malformed cone chunk.");
  }

  return {
    chunkKey: value.chunkKey,
    positions: getFiniteNumberArray(value.positions, "positions"),
    scalars: getFiniteNumberArray(value.scalars, "scalars"),
    coneIndex: getFiniteNumberArray(value.coneIndex, "coneIndex"),
  };
}

function getFiniteNumberArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) {
    throw new Error(`Expected numeric array for ${label}.`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      throw new Error(`Expected finite number for ${label}[${index}].`);
    }
    return entry;
  });
}

async function loadGltfScene(inputPath: string): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  const input = await readFile(inputPath);
  const data = inputPath.endsWith(".gltf")
    ? input.toString("utf8")
    : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  const gltf = await loader.parseAsync(
    data,
    pathToFileURL(`${path.dirname(inputPath)}/`).href,
  );

  return gltf.scene;
}

async function writeGltf(scene: THREE.Object3D, outputPath: string): Promise<void> {
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(scene, {
    binary: outputPath.endsWith(".glb"),
  });

  if (result instanceof ArrayBuffer) {
    await writeFile(outputPath, Buffer.from(result));
    return;
  }

  await writeFile(outputPath, JSON.stringify(result, null, 2));
}

async function readText(filePath: string): Promise<string> {
  return await readFile(filePath, "utf8");
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function createBatchBakeReport(conesLoaded: number): BatchBakeReport {
  return {
    filesProcessed: 0,
    filesCopied: 0,
    filesFailed: 0,
    meshesProcessed: 0,
    meshesWithIntersections: 0,
    meshesWithoutIntersections: 0,
    verticesProcessed: 0,
    verticesMasked: 0,
    conesLoaded,
    skippedFiles: [],
    failedFiles: [],
  };
}

function isSupportedMeshFile(filePath: string): boolean {
  return filePath.endsWith(".glb") || filePath.endsWith(".gltf");
}

function getRuntimeBakeSource(base: string, relativePath: string): string {
  if (!base) return relativePath;

  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${normalizedBase}/${relativePath.split(path.sep).join("/")}`;
}

function isPathInside(child: string, parent: string): boolean {
  const relativePath = path.relative(parent, child);
  return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function installFileReaderPolyfill(): void {
  const target = globalThis as typeof globalThis & { FileReader: typeof FileReader };
  if (typeof target.FileReader === "function") return;

  target.FileReader = NodeFileReader as unknown as typeof FileReader;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
