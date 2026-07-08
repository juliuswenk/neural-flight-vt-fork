import { BERLIN_DEBUG_FPS_COUNTER_UPDATE_SECONDS } from "./config";

export interface BerlinFpsCounter {
  update(delta: number): void;
  dispose(): void;
}

export function createBerlinFpsCounter(): BerlinFpsCounter {
  return new DomFpsCounter();
}

class DomFpsCounter implements BerlinFpsCounter {
  private readonly element: HTMLDivElement;
  private frameCount = 0;
  private elapsedSinceUpdate = 0;
  private disposed = false;

  constructor() {
    this.element = document.createElement("div");
    this.element.textContent = "FPS --";
    Object.assign(this.element.style, {
      position: "fixed",
      top: "12px",
      right: "12px",
      zIndex: "10000",
      padding: "6px 8px",
      color: "#b9fbc0",
      background: "rgba(8, 12, 18, 0.72)",
      border: "1px solid rgba(185, 251, 192, 0.45)",
      borderRadius: "4px",
      font: "12px monospace",
      pointerEvents: "none",
    });
    document.body.appendChild(this.element);
  }

  public update(delta: number): void {
    if (this.disposed) return;

    this.frameCount += 1;
    this.elapsedSinceUpdate += delta;
    if (this.elapsedSinceUpdate < BERLIN_DEBUG_FPS_COUNTER_UPDATE_SECONDS) {
      return;
    }

    const fps = this.frameCount / this.elapsedSinceUpdate;
    this.element.textContent = `FPS ${fps.toFixed(0)}`;
    this.frameCount = 0;
    this.elapsedSinceUpdate = 0;
  }

  public dispose(): void {
    if (this.disposed) return;

    this.disposed = true;
    this.element.remove();
  }
}
