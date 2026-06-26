import test from "node:test";
import assert from "node:assert/strict";

import { extractFollower } from "../src/backend/collectors/shared/browserCollector.js";

test("extractFollower reads the account header follower metric", () => {
  const result = extractFollower("关注 81 粉丝 1.0万 获赞 5.8万 抖音号：1386882638");

  assert.equal(result.status, "available");
  assert.equal(result.value, 10000);
  assert.equal(result.raw, "1.0万");
});

test("extractFollower does not treat a Douyin id as follower count", () => {
  const result = extractFollower("关注 粉丝 获赞 抖音号：1386882638");

  assert.equal(result.status, "not_public");
  assert.equal(result.value, null);
});
