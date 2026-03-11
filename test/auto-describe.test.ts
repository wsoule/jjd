import { describe, it, expect } from "bun:test";
import { AutoDescriber } from "../src/engine/auto-describe";

describe("AutoDescriber", () => {
  it("returns empty change message for empty diff", async () => {
    // Use a dummy key — this won't hit the API
    const describer = new AutoDescriber("test-key", "claude-haiku-4-5-20251001");
    const message = await describer.generateMessage("");
    expect(message).toBe("(empty change)");
  });

  // Integration test — requires ANTHROPIC_API_KEY
  it.skipIf(!process.env.ANTHROPIC_API_KEY)(
    "generates a message from a real diff",
    async () => {
      const describer = new AutoDescriber(
        process.env.ANTHROPIC_API_KEY!,
        "claude-haiku-4-5-20251001"
      );

      const diff = `Summary:
M src/index.ts

Full diff:
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,5 +1,7 @@
 import express from 'express';
+import { rateLimit } from 'express-rate-limit';

 const app = express();
+app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
 app.listen(3000);`;

      const message = await describer.generateMessage(diff);
      expect(message.length).toBeGreaterThan(5);
      // Should be a conventional commit format
      expect(message).toMatch(/^(feat|fix|refactor|chore|docs|style|test|perf|ci|build)/);
    }
  );
});
