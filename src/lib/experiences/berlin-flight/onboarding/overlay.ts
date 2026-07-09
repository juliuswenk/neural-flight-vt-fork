import * as THREE from "three";

export interface BerlinOnboardingOverlay {
  readonly group: THREE.Group;
  update(progress: number): void;
  dispose(): void;
}

export function createBerlinOnboardingOverlay(
  camera: THREE.PerspectiveCamera,
): BerlinOnboardingOverlay {
  return new PlaneOnboardingOverlay(camera);
}

class PlaneOnboardingOverlay implements BerlinOnboardingOverlay {
  public readonly group = new THREE.Group();
  private readonly panelGeometry = new THREE.PlaneGeometry(1.25, 0.42);
  private readonly barGeometry = new THREE.PlaneGeometry(0.9, 0.025);
  private readonly panelMaterial = new THREE.MeshBasicMaterial({
    color: 0x07111f,
    transparent: true,
    opacity: 0.62,
    depthTest: false,
    depthWrite: false,
  });
  private readonly barMaterial = new THREE.MeshBasicMaterial({
    color: 0x8ad7ff,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    depthWrite: false,
  });
  private disposed = false;

  constructor(camera: THREE.PerspectiveCamera) {
    this.group.name = "BerlinOnboardingOverlay";
    this.group.position.set(0, 0, -1.65);
    this.group.renderOrder = 1000;

    const panel = new THREE.Mesh(this.panelGeometry, this.panelMaterial);
    panel.name = "BerlinOnboardingPanel";
    panel.renderOrder = 1000;
    this.group.add(panel);

    const topBar = new THREE.Mesh(this.barGeometry, this.barMaterial);
    topBar.name = "BerlinOnboardingTopBar";
    topBar.position.y = 0.14;
    topBar.renderOrder = 1001;
    this.group.add(topBar);

    const bottomBar = new THREE.Mesh(this.barGeometry, this.barMaterial);
    bottomBar.name = "BerlinOnboardingBottomBar";
    bottomBar.position.y = -0.14;
    bottomBar.renderOrder = 1001;
    this.group.add(bottomBar);

    camera.add(this.group);
  }

  public update(progress: number): void {
    if (this.disposed) return;

    const introOpacity = 1 - THREE.MathUtils.clamp(progress, 0, 1);
    this.panelMaterial.opacity = 0.62 * introOpacity;
    this.barMaterial.opacity = 0.9 * introOpacity;
    this.group.visible = introOpacity > 0;
  }

  public dispose(): void {
    if (this.disposed) return;

    this.disposed = true;
    this.group.removeFromParent();
    this.group.clear();
    this.panelGeometry.dispose();
    this.barGeometry.dispose();
    this.panelMaterial.dispose();
    this.barMaterial.dispose();
  }
}
