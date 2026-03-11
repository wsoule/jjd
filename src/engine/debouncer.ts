/**
 * Simple debouncer that resets its timer on every call to `trigger()`.
 * Fires the callback only after `delayMs` of silence.
 */
export class Debouncer {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private delayMs: number,
    private callback: () => void
  ) {}

  trigger() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.callback();
    }, this.delayMs);
  }

  cancel() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  get isPending(): boolean {
    return this.timer !== null;
  }
}
