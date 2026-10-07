/**
 * Fixed-timestep game loop: simulation always advances in equal steps,
 * rendering happens once per animation frame.
 */
export class FixedLoop {
  private acc = 0;
  private last = 0;
  private rafId = 0;
  private running = false;

  constructor(
    private readonly step: number,
    private readonly update: (dt: number) => void,
    private readonly render: (frameDt: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      // Clamp long frames (tab switch, breakpoint) to avoid a spiral of death.
      const frameDt = Math.min((now - this.last) / 1000, 0.25);
      this.last = now;
      this.acc += frameDt;
      while (this.acc >= this.step) {
        this.update(this.step);
        this.acc -= this.step;
      }
      this.render(frameDt);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }
}
