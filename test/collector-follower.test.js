import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDouyinProfileVideos,
  classifyCollectionStatus,
  extractFollower
} from "../src/backend/collectors/shared/browserCollector.js";

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

test("extractFollower accepts a metric rendered before the follower label", () => {
  const result = extractFollower("81 关注 1.0万 粉丝 5.8万 获赞");

  assert.equal(result.status, "available");
  assert.equal(result.value, 10000);
});

test("a follower-only capture is partial instead of a successful zero-video capture", () => {
  const result = classifyCollectionStatus({
    followerStatus: "available",
    videos: []
  });

  assert.equal(result.status, "partial_success");
  assert.equal(result.error_code, "VIDEO_DATA_MISSING");
});

test("an empty rendered profile is retryable instead of being declared not public", () => {
  const result = classifyCollectionStatus({
    followerStatus: "not_public",
    videos: []
  });

  assert.equal(result.status, "failed");
  assert.equal(result.error_code, "PAGE_RENDER_INCOMPLETE");
});

test("detail-page access blockers remain terminal top-level failures", () => {
  for (const errorCode of ["LOGIN_REQUIRED", "CAPTCHA_REQUIRED", "ACCESS_DENIED"]) {
    const errorMessage = `blocked by ${errorCode}`;
    const result = classifyCollectionStatus({
      followerStatus: "available",
      videos: [
        {
          like_count_status: "available",
          comment_count_status: "not_public",
          favorite_count_status: "not_public"
        },
        {
          like_count_status: "failed",
          comment_count_status: "failed",
          favorite_count_status: "failed",
          error_code: errorCode,
          error_message: errorMessage
        }
      ]
    });

    assert.equal(result.status, "failed");
    assert.equal(result.error_code, errorCode);
    assert.equal(result.error_message, errorMessage);
  }
});

test("visible media links survive when lazy text has not rendered yet", () => {
  const videos = buildDouyinProfileVideos(
    [
      {
        href: "https://www.douyin.com/video/7665135526453784677",
        text: "",
        label: "",
        hasMedia: true,
        visible: true
      }
    ],
    10
  );

  assert.equal(videos.length, 1);
  assert.equal(videos[0].platform_video_id, "7665135526453784677");
  assert.equal(videos[0].like_count, null);
  assert.equal(videos[0].like_count_status, "not_public");
});
