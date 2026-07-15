import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import droneModelUrl from "../drone-M30-240517.fbx?url";
import { WERKSCHAU_EXHIBITION_BOUNDS, WERKSCHAU_PLAYER_HEIGHT_LIMITS } from "../constants";
import { disposeObjectTree } from "../runtime/cleanup";

const DRONE_COUNT = 16;
const DRONE_SCALE = 0.04;
const DRONE_SPEED = 14;
const DRONE_MIN_ALTITUDE = 200;
const DRONE_MAX_ALTITUDE = WERKSCHAU_PLAYER_HEIGHT_LIMITS.MAX;
const DRONE_NEIGHBOR_RADIUS = 150;
const DRONE_SEPARATION_RADIUS = 45;
const DRONE_ALIGNMENT_WEIGHT = 0.6;
const DRONE_COHESION_WEIGHT = 0.4;
const DRONE_SEPARATION_WEIGHT = 1.5;

interface Boid {
  mesh: THREE.Object3D;
  velocity: THREE.Vector3;
}

const scratchDiff = new THREE.Vector3();
const scratchAlignment = new THREE.Vector3();
const scratchCohesion = new THREE.Vector3();
const scratchSeparation = new THREE.Vector3();
const scratchLookTarget = new THREE.Vector3();

export class WerkschauDroneBoidSystem {
  readonly group = new THREE.Group();
  private boids: Boid[] = [];

  constructor() {
    this.group.name = "VisioTechWerkschauDroneBoids";
    void this.load();
  }

  private async load(): Promise<void> {
    const template = await new Promise<THREE.Group>((resolve, reject) => {
      new FBXLoader().load(droneModelUrl, resolve, undefined, reject);
    });
    template.scale.setScalar(DRONE_SCALE);

    const bounds = WERKSCHAU_EXHIBITION_BOUNDS;
    for (let i = 0; i < DRONE_COUNT; i++) {
      const mesh = template.clone(true);
      mesh.position.set(
        THREE.MathUtils.randFloat(bounds.minX, bounds.maxX),
        THREE.MathUtils.randFloat(DRONE_MIN_ALTITUDE, DRONE_MAX_ALTITUDE),
        THREE.MathUtils.randFloat(bounds.minZ, bounds.maxZ),
      );
      const velocity = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5,
      )
        .normalize()
        .multiplyScalar(DRONE_SPEED);
      this.group.add(mesh);
      this.boids.push({ mesh, velocity });
    }
  }

  update(delta: number): void {
    if (this.boids.length === 0) return;

    const bounds = WERKSCHAU_EXHIBITION_BOUNDS;
    for (const boid of this.boids) {
      scratchAlignment.set(0, 0, 0);
      scratchCohesion.set(0, 0, 0);
      scratchSeparation.set(0, 0, 0);
      let neighborCount = 0;

      for (const other of this.boids) {
        if (other === boid) continue;
        const distance = boid.mesh.position.distanceTo(other.mesh.position);
        if (distance === 0 || distance > DRONE_NEIGHBOR_RADIUS) continue;

        neighborCount++;
        scratchAlignment.add(other.velocity);
        scratchCohesion.add(other.mesh.position);
        if (distance < DRONE_SEPARATION_RADIUS) {
          scratchDiff
            .subVectors(boid.mesh.position, other.mesh.position)
            .divideScalar(distance);
          scratchSeparation.add(scratchDiff);
        }
      }

      if (neighborCount > 0) {
        scratchAlignment.divideScalar(neighborCount);
        scratchCohesion.divideScalar(neighborCount).sub(boid.mesh.position);
        boid.velocity
          .addScaledVector(scratchAlignment, DRONE_ALIGNMENT_WEIGHT * delta)
          .addScaledVector(scratchCohesion, DRONE_COHESION_WEIGHT * delta)
          .addScaledVector(scratchSeparation, DRONE_SEPARATION_WEIGHT * delta);
      }

      boid.velocity.clampLength(0, DRONE_SPEED);
      boid.mesh.position.addScaledVector(boid.velocity, delta);
      this.keepInBounds(boid, bounds);

      if (boid.velocity.lengthSq() > 1e-6) {
        scratchLookTarget.copy(boid.mesh.position).add(boid.velocity);
        boid.mesh.lookAt(scratchLookTarget);
      }
    }
  }

  private keepInBounds(
    boid: Boid,
    bounds: typeof WERKSCHAU_EXHIBITION_BOUNDS,
  ): void {
    const position = boid.mesh.position;
    if (position.x < bounds.minX || position.x > bounds.maxX) {
      position.x = THREE.MathUtils.clamp(position.x, bounds.minX, bounds.maxX);
      boid.velocity.x *= -1;
    }
    if (position.y < DRONE_MIN_ALTITUDE || position.y > DRONE_MAX_ALTITUDE) {
      position.y = THREE.MathUtils.clamp(
        position.y,
        DRONE_MIN_ALTITUDE,
        DRONE_MAX_ALTITUDE,
      );
      boid.velocity.y *= -1;
    }
    if (position.z < bounds.minZ || position.z > bounds.maxZ) {
      position.z = THREE.MathUtils.clamp(position.z, bounds.minZ, bounds.maxZ);
      boid.velocity.z *= -1;
    }
  }

  dispose(): void {
    for (const boid of this.boids) {
      boid.mesh.removeFromParent();
      disposeObjectTree(boid.mesh);
    }
    this.boids = [];
    this.group.clear();
  }
}
