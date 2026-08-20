import assert from "node:assert/strict";
import test from "node:test";

import viteConfig from "../vite.config.js";

test("Vite ignores runtime data written by the capture browser", () => {
  const ignored = viteConfig.server?.watch?.ignored || [];

  assert.ok(ignored.includes("**/data/**"));
  assert.ok(ignored.includes("**/logs/**"));
});
