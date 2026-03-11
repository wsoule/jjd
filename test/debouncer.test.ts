import { describe, it, expect, beforeEach } from "bun:test";
import { Debouncer } from "../src/engine/debouncer";

describe("Debouncer", () => {
  it("fires callback after delay", async () => {
    let fired = false;
    const debouncer = new Debouncer(50, () => {
      fired = true;
    });

    debouncer.trigger();
    expect(fired).toBe(false);

    await Bun.sleep(80);
    expect(fired).toBe(true);
  });

  it("resets timer on subsequent triggers", async () => {
    let count = 0;
    const debouncer = new Debouncer(50, () => {
      count++;
    });

    debouncer.trigger();
    await Bun.sleep(30);
    debouncer.trigger(); // reset
    await Bun.sleep(30);
    debouncer.trigger(); // reset again
    await Bun.sleep(80);

    expect(count).toBe(1); // Only fired once
  });

  it("can be cancelled", async () => {
    let fired = false;
    const debouncer = new Debouncer(50, () => {
      fired = true;
    });

    debouncer.trigger();
    debouncer.cancel();

    await Bun.sleep(80);
    expect(fired).toBe(false);
  });

  it("reports pending state", () => {
    const debouncer = new Debouncer(50, () => {});

    expect(debouncer.isPending).toBe(false);
    debouncer.trigger();
    expect(debouncer.isPending).toBe(true);
    debouncer.cancel();
    expect(debouncer.isPending).toBe(false);
  });
});
