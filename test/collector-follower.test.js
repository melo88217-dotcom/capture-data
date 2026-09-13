import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";

import {
  buildDouyinProfileVideos,
  classifyCollectionStatus,
  extractDouyinProfileVideos,
  extractFollower,
  extractTotalLikes,
  getProfileFollower,
  getProfileTotalLikes
} from "../src/backend/collectors/shared/browserCollector.js";

test("extractFollower reads a follower metric item that keeps its label and value together", () => {
  const result = extractFollower(["1.0万 粉丝"]);

  assert.equal(result.status, "available");
  assert.equal(result.value, 10000);
  assert.equal(result.raw, "1.0万");
});

test("extractFollower does not treat unrelated profile text as a follower metric", () => {
  const result = extractFollower(["抖音号：1386882638"]);

  assert.equal(result.status, "not_public");
  assert.equal(result.value, null);
});

test("extractFollower accepts a metric rendered after the follower label", () => {
  const result = extractFollower(["粉丝 1.0万"]);

  assert.equal(result.status, "available");
  assert.equal(result.value, 10000);
});

test("extractTotalLikes reads the public profile total like metric", () => {
  const result = extractTotalLikes(["获赞 15.7万"]);

  assert.equal(result.status, "available");
  assert.equal(result.value, 157000);
  assert.equal(result.raw, "15.7万");
});

test("extractFollower rejects incomplete header fragments and conflicting metric items", () => {
  assert.equal(extractFollower(["关注 20 粉丝"]).value, null);
  assert.equal(extractFollower(["粉丝 1.1万 获赞"]).value, null);

  const conflicting = extractFollower(["1.0万 粉丝", "5.8万 粉丝"]);
  assert.equal(conflicting.status, "unknown");
  assert.equal(conflicting.value, null);
});

test("getProfileFollower reads only the DOM item paired with the follower label", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`
    <main><span>5</span><span>粉丝</span></main>
    <header>
      <h1>测试账号</h1>
      <div><span>20</span><span>关注</span></div>
      <div><span>粉丝</span><span>1802</span></div>
      <div><span>1.0万</span><span>获赞</span></div>
      <p>关注 20 粉丝 1802 获赞 1.0万</p>
    </header>
  `);

  const result = await getProfileFollower(page);

  assert.equal(result.status, "available");
  assert.equal(result.value, 1802);
  assert.equal(result.raw, "1802");
});

test("getProfileTotalLikes reads only the DOM item paired with the total like label", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`
    <main><span>99</span><span>获赞</span></main>
    <header>
      <h1>测试账号</h1>
      <div><span>粉丝</span><span>1802</span></div>
      <div><span>获赞</span><span>15.7万</span></div>
    </header>
  `);

  const result = await getProfileTotalLikes(page);

  assert.equal(result.status, "available");
  assert.equal(result.value, 157000);
  assert.equal(result.raw, "15.7万");
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

test("pinned profile videos are excluded before the capture limit is applied", () => {
  const videos = buildDouyinProfileVideos(
    [
      {
        href: "https://www.douyin.com/video/7665135526453784677",
        text: "置顶\n置顶作品\n321",
        hasMedia: true,
        visible: true,
        is_pinned: true
      },
      {
        href: "https://www.douyin.com/video/7665135526453784678",
        text: "普通作品\n838",
        hasMedia: true,
        visible: true,
        is_pinned: false
      }
    ],
    1
  );

  assert.equal(videos.length, 1);
  assert.equal(videos[0].platform_video_id, "7665135526453784678");
  assert.equal(videos[0].title, "普通作品");
});

test("profile extraction scrolls past pinned cards to fill the requested non-pinned limit", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const card = (id, title, pinned = false) => `
    <div>
      <a href="https://www.douyin.com/video/${id}" style="display:block;width:100px;height:100px">
        ${pinned ? "<span>置顶</span>" : ""}
        <img alt="${title}" /><span>${title}</span><br /><span>1</span>
      </a>
    </div>`;
  const initialCards = [
    ...Array.from({ length: 3 }, (_, index) => card(`7665135526453784${700 + index}`, `置顶作品 ${index + 1}`, true)),
    ...Array.from({ length: 7 }, (_, index) => card(`7665135526453784${800 + index}`, `普通作品 ${index + 1}`))
  ].join("");
  const lazyCards = Array.from({ length: 3 }, (_, index) => card(`7665135526453784${900 + index}`, `补充作品 ${index + 1}`)).join("");
  await page.setContent(`<main id="videos">${initialCards}</main>`);
  await page.evaluate((cards) => {
    let loaded = false;
    window.addEventListener("wheel", () => {
      if (loaded) return;
      loaded = true;
      document.querySelector("#videos").insertAdjacentHTML("beforeend", cards);
    });
  }, lazyCards);

  const videos = await extractDouyinProfileVideos(page, 10, {
    loadTimeoutMs: 500,
    scrollWaitMs: 20
  });

  assert.equal(videos.length, 10);
  assert.equal(videos.some((video) => video.video_url.endsWith("4700")), false);
  assert.equal(videos.some((video) => video.video_url.endsWith("4900")), true);
});
