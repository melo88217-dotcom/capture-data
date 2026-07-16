import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFirstMetric } from "./metricParser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../../../..");
const browserProfileDir = path.join(rootDir, "data", "browser-profile");

let persistentContext = null;
let persistentPage = null;

export async function closePersistentBrowser() {
  if (!persistentContext) return false;
  const context = persistentContext;
  await context.close();
  return true;
}

const messages = {
  captcha: "\u9875\u9762\u51fa\u73b0\u9a8c\u8bc1\u7801\u6216\u5b89\u5168\u9a8c\u8bc1\uff0c\u7cfb\u7edf\u5df2\u505c\u6b62\u91c7\u96c6\u3002",
  login:
    "\u9875\u9762\u8981\u6c42\u767b\u5f55\u540e\u67e5\u770b\u3002\u5df2\u6253\u5f00\u6d4f\u89c8\u5668\u7a97\u53e3\uff0c\u8bf7\u5728\u7a97\u53e3\u91cc\u767b\u5f55\u540e\u518d\u70b9\u4e00\u6b21\u7acb\u5373\u66f4\u65b0\u3002",
  accessDenied: "\u9875\u9762\u8bbf\u95ee\u53d7\u9650\uff0c\u7cfb\u7edf\u4e0d\u4f1a\u7ed5\u8fc7\u6743\u9650\u9650\u5236\u3002",
  noMetrics:
    "\u516c\u5f00\u9875\u9762\u53ef\u8bbf\u95ee\uff0c\u4f46\u672a\u8bc6\u522b\u5230\u7c89\u4e1d\u91cf\u6216\u516c\u5f00\u89c6\u9891\u6307\u6807\u3002",
  linksOnly:
    "\u53ea\u8bc6\u522b\u5230\u516c\u5f00\u94fe\u63a5\uff0c\u672a\u8bc6\u522b\u5230\u7c89\u4e1d\u91cf\u3001\u70b9\u8d5e\u3001\u8bc4\u8bba\u3001\u6536\u85cf\u7b49\u6838\u5fc3\u6307\u6807\u3002",
  followerMissing:
    "\u5df2\u91c7\u96c6\u5230\u89c6\u9891\u516c\u5f00\u6307\u6807\uff0c\u4f46\u672a\u8bc6\u522b\u5230\u8d26\u53f7\u4e3b\u9875\u7c89\u4e1d\u6570\uff1b\u53ef\u80fd\u662f\u5e73\u53f0\u61d2\u52a0\u8f7d\u3001\u9875\u9762\u672a\u66b4\u9732\u6216\u9700\u8981\u767b\u5f55\u540e\u624d\u663e\u793a\u3002"
};

const blockedPatterns = [
  ["CAPTCHA_REQUIRED", messages.captcha, /\u9a8c\u8bc1\u7801|\u5b89\u5168\u9a8c\u8bc1|\u6ed1\u5757|verify|captcha/i],
  ["LOGIN_REQUIRED", messages.login, /\u767b\u5f55\u540e|\u8bf7\u767b\u5f55|\u626b\u7801\u767b\u5f55|login required/i],
  ["ACCESS_DENIED", messages.accessDenied, /\u8bbf\u95ee\u53d7\u9650|\u65e0\u6743\u8bbf\u95ee|\u7981\u6b62\u8bbf\u95ee|access denied|forbidden/i]
];

export async function collectPublicPage(account, options = {}) {
  const capturedAt = new Date().toISOString();
  const headless = process.env.CAPTURE_HEADLESS === "true";
  const limit = Number(options.limit || process.env.CAPTURE_VIDEO_LIMIT || 30);
  let browser = null;
  let context = null;

  try {
    const { chromium } = await import("playwright");

    if (headless) {
      browser = await chromium.launch({ headless: true });
      context = await browser.newContext(browserOptions());
    } else {
      context = await getPersistentContext(chromium);
    }

    const page = await getCapturePage(context, headless);
    await page.goto(account.profile_url, {
      waitUntil: "domcontentloaded",
      timeout: Number(process.env.CAPTURE_TIMEOUT_MS || 30000)
    });
    const profileCheck = await checkBlocked(page);
    if (profileCheck) return failedResult(account, capturedAt, profileCheck.code, profileCheck.message);

    const readyCheck = await waitForProfileReady(page, limit);
    if (readyCheck) return failedResult(account, capturedAt, readyCheck.code, readyCheck.message);
    const profileText = await getProfileText(page);
    const follower = extractFollower(profileText);
    const profileUrl = page.url();
    const profileVideos = await extractDouyinProfileVideos(page, limit);
    const videos = [];

    for (const item of profileVideos) {
      const detail = await collectVideoDetail(page, item);
      videos.push(detail);
      await page.waitForTimeout(Number(process.env.CAPTURE_DETAIL_SETTLE_MS || 600));
    }

    const hasFollower = follower.status === "available";
    const hasVideoMetric = videos.some(
      (video) =>
        video.like_count_status === "available" ||
        video.comment_count_status === "available" ||
        video.favorite_count_status === "available"
    );
    const hasFailedVideoMetric = videos.some(
      (video) =>
        video.like_count_status === "failed" ||
        video.comment_count_status === "failed" ||
        video.favorite_count_status === "failed"
    );
    const hasOnlyLinks = videos.length > 0 && !hasFollower && !hasVideoMetric;
    const status =
      hasVideoMetric || (hasFollower && videos.length === 0)
        ? "success"
        : hasFollower || hasOnlyLinks || hasFailedVideoMetric
          ? "partial_success"
          : "failed";
    const warningMessage =
      status === "success" && hasVideoMetric && !hasFollower ? messages.followerMissing : null;

    return {
      platform: account.platform_code,
      account: {
        display_name: inferAccountName(profileText, account.display_name),
        profile_url: profileUrl || account.profile_url,
        follower_count: follower.value,
        follower_count_status: follower.status,
        raw_follower_text: follower.raw
      },
      videos,
      status,
      error_code: status === "success" ? null : "FIELD_NOT_PUBLIC",
      error_message: warningMessage || (status === "success" ? null : hasOnlyLinks ? messages.linksOnly : messages.noMetrics),
      captured_at: capturedAt
    };
  } catch (error) {
    return failedResult(account, capturedAt, classifyError(error), error.message);
  } finally {
    if (headless && browser) await browser.close().catch(() => {});
  }
}

async function collectVideoDetail(page, item) {
  try {
    await page.goto(item.video_url, {
      waitUntil: "domcontentloaded",
      timeout: Number(process.env.CAPTURE_TIMEOUT_MS || 30000)
    });
    await waitForVideoDetailContent(page, item.title);

    const blocked = await checkBlocked(page);
    if (blocked) return { ...item, ...emptyVideoMetrics("failed"), raw_metric_text: blocked.message };

    const title = (await page.title()).replace(/\s*-\s*\u6296\u97f3\s*$/, "").trim() || item.title;
    const text = await getBodyText(page);
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const metrics = parseDetailMetrics(lines, title);
    const publishedAt = extractPublishedAt(text);
    const likeCount = metrics.like_count ?? item.like_count;

    return {
      ...item,
      title: title || item.title,
      published_at: publishedAt,
      like_count: likeCount,
      comment_count: metrics.comment_count,
      favorite_count: metrics.favorite_count,
      like_count_status: likeCount == null ? item.like_count_status : "available",
      comment_count_status: metrics.comment_count == null ? "not_public" : "available",
      favorite_count_status: metrics.favorite_count == null ? "not_public" : "available",
      raw_metric_text: metrics.raw_metric_text || item.raw_metric_text
    };
  } catch (error) {
    return { ...item, ...emptyVideoMetrics("failed"), raw_metric_text: error.message };
  }
}

async function extractDouyinProfileVideos(page, limit) {
  const links = await page
    .locator("a")
    .evaluateAll((nodes) =>
      nodes
        .map((node) => ({
          href: node.href,
          text: (node.innerText || node.textContent || "").trim()
        }))
        .filter((item) => item.href)
    )
    .catch(() => []);

  const seen = new Set();
  const videos = [];

  for (const item of links) {
    const cleanUrl = normalizeDouyinVideoUrl(item.href);
    if (!cleanUrl || seen.has(cleanUrl)) continue;
    const parsed = parseProfileVideoText(item.text);
    if (!parsed.title || parsed.like_count == null) continue;

    seen.add(cleanUrl);
    videos.push({
      platform_video_id: inferVideoId(cleanUrl),
      video_url: cleanUrl,
      title: parsed.title,
      published_at: null,
      like_count: parsed.like_count,
      comment_count: null,
      favorite_count: null,
      like_count_status: "available",
      comment_count_status: "not_public",
      favorite_count_status: "not_public",
      raw_metric_text: item.text
    });

    if (videos.length >= limit) break;
  }

  return videos;
}

async function waitForProfileReady(page, limit) {
  const settle = Number(process.env.CAPTURE_SETTLE_MS || 2500);
  const timeout = Number(process.env.CAPTURE_PROFILE_READY_TIMEOUT_MS || 15000);
  const targetVideoCount = Math.min(Math.max(1, Number(limit) || 10), 30);
  const started = Date.now();
  let bestVideoCount = 0;

  await page.waitForTimeout(settle);

  while (Date.now() - started < timeout) {
    const blocked = await checkBlocked(page);
    if (blocked) return blocked;

    const text = await getProfileText(page);
    const follower = extractFollower(text);
    const videoCount = await page.locator('a[href*="/video/"]').count().catch(() => 0);
    bestVideoCount = Math.max(bestVideoCount, videoCount);

    if (follower.status === "available" && videoCount >= targetVideoCount) return null;
    if (follower.status === "available" && bestVideoCount > 0 && Date.now() - started >= Math.max(settle, 6000)) return null;
    if (videoCount >= targetVideoCount && hasProfileIdentityText(text) && Date.now() - started >= Math.max(settle, 6000)) {
      return null;
    }

    await page.mouse.wheel(0, 900).catch(() => {});
    await page.waitForTimeout(1000);
  }

  if (bestVideoCount === 0) await page.waitForTimeout(1000);
  return null;
}

async function waitForVideoDetailContent(page, title) {
  const titleFragment = normalizeText(title).slice(0, 16);
  await page
    .waitForFunction(
      (fragment) => {
        const text = document.body?.innerText || "";
        const compact = text.replace(/\s+/g, "");
        return text.includes("\u53d1\u5e03\u65f6\u95f4") || (fragment && compact.includes(fragment));
      },
      titleFragment,
      { timeout: Number(process.env.CAPTURE_DETAIL_READY_TIMEOUT_MS || 8000) }
    )
    .catch(() => {});

  const timeout = Number(process.env.CAPTURE_DETAIL_METRIC_TIMEOUT_MS || 8000);
  const minWait = Number(process.env.CAPTURE_DETAIL_WAIT_MS || 800);
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const text = await getBodyText(page);
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const metrics = parseDetailMetrics(lines, title);
    if (
      metrics.like_count != null ||
      metrics.comment_count != null ||
      metrics.favorite_count != null ||
      (Date.now() - started >= minWait && /\u53d1\u5e03\u65f6\u95f4/.test(text))
    ) {
      return;
    }
    await page.waitForTimeout(800);
  }
}

function parseProfileVideoText(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line !== "\u7f6e\u9876");

  const metricIndex = lines.findIndex(isMetricLine);
  const likeLine = metricIndex >= 0 ? lines[metricIndex] : "";
  const titleLines = lines.filter((_, index) => index !== metricIndex);
  const likeMetric = parseMetricLine(likeLine);

  return {
    like_count: likeMetric.value,
    title: titleLines.join(" ").trim()
  };
}

function parseDetailMetrics(lines, title) {
  const titleIndex = findTitleIndex(lines, title);
  const publishIndex = lines.findIndex((line) => /^\u53d1\u5e03\u65f6\u95f4/.test(line));
  const reportIndex = lines.findIndex((line) => line === "\u4e3e\u62a5");
  const anchorIndex = publishIndex >= 0 ? publishIndex : reportIndex;

  if (titleIndex < 0 && anchorIndex < 0) {
    return {
      like_count: null,
      comment_count: null,
      favorite_count: null,
      raw_metric_text: ""
    };
  }

  const start = titleIndex >= 0 ? titleIndex + 1 : Math.max(0, anchorIndex - 8);
  const end = anchorIndex >= 0 ? anchorIndex : titleIndex + 12;
  const windowLines = lines.slice(start, end).slice(-12);
  const firstMetricIndex = windowLines.findIndex(isMetricLine);
  const like = firstMetricIndex >= 0 ? parseMetricLine(windowLines[firstMetricIndex]) : { value: null };

  let comment = { value: null };
  const afterLike = firstMetricIndex >= 0 ? windowLines.slice(firstMetricIndex + 1) : [];
  const firstAfterLikeMetricIndex = afterLike.findIndex(isMetricLine);
  const zeroCommentIndex = afterLike.findIndex((line) => line === "\u62a2\u9996\u8bc4");
  if (zeroCommentIndex >= 0 && (firstAfterLikeMetricIndex < 0 || zeroCommentIndex < firstAfterLikeMetricIndex)) {
    comment = { value: 0 };
  } else if (firstAfterLikeMetricIndex >= 0) {
    comment = parseMetricLine(afterLike[firstAfterLikeMetricIndex]);
  }

  let favorite = { value: null };
  const favoriteIndex = windowLines.findIndex((line) => line === "\u6536\u85cf");
  if (favoriteIndex >= 0 && windowLines[favoriteIndex + 1]) {
    favorite = parseMetricLine(windowLines[favoriteIndex + 1]);
  } else {
    const afterComment =
      comment.value === 0
        ? afterLike.slice(Math.max(0, zeroCommentIndex + 1))
        : afterLike.slice(firstAfterLikeMetricIndex + 1);
    const favoriteMetric = afterComment.find(isMetricLine);
    if (favoriteMetric) favorite = parseMetricLine(favoriteMetric);
  }

  return {
    like_count: like.value,
    comment_count: comment.value,
    favorite_count: favorite.value,
    raw_metric_text: windowLines.join("\n")
  };
}

function parseMetricLine(line) {
  if (!isMetricLine(line)) return { value: null };
  return extractFirstMetric(line, [""]);
}

function isMetricLine(line) {
  return /^\d+(?:\.\d+)?\s*(?:\u4e07|w|W|\u4ebf)?\+?$/.test(String(line || ""));
}

function findTitleIndex(lines, title) {
  if (!title) return -1;
  const normalizedTitle = normalizeText(title);
  return lines.findIndex((line) => {
    const normalizedLine = normalizeText(line);
    return normalizedLine === normalizedTitle || normalizedLine.includes(normalizedTitle.slice(0, 24));
  });
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, "");
}

function hasProfileIdentityText(text) {
  return /\u6296\u97f3\u53f7|\u4f5c\u54c1|\u7c89\u4e1d|\u83b7\u8d5e|followers/i.test(String(text || ""));
}

function extractPublishedAt(text) {
  const match = String(text || "").match(/\u53d1\u5e03\u65f6\u95f4[\uff1a:\s]*([0-9]{4}-[0-9]{2}-[0-9]{2}\s+[0-9:]{5,8})/);
  return match ? match[1] : null;
}

export function extractFollower(text) {
  const compact = String(text || "").replace(/\s+/g, "");
  const metricPattern = "([0-9]+(?:\\.[0-9]+)?(?:\\u4e07|w|W|\\u4ebf)?\\+?)";
  const anchoredPatterns = [
    new RegExp(`\\u5173\\u6ce8${metricPattern}\\u7c89\\u4e1d${metricPattern}\\u83b7\\u8d5e`),
    new RegExp(`\\u7c89\\u4e1d${metricPattern}\\u83b7\\u8d5e`),
    new RegExp(`followers${metricPattern}`, "i")
  ];

  for (const pattern of anchoredPatterns) {
    const match = compact.match(pattern);
    if (!match) continue;
    const candidate = pattern === anchoredPatterns[0] ? match[2] : match[1];
    const parsed = parseMetricLine(candidate);
    if (parsed.status === "available") return parsed;
  }

  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (!/\u7c89\u4e1d|followers/i.test(line) || /\u6296\u97f3\u53f7/.test(line)) continue;
    const match = line.match(new RegExp(`(?:\\u7c89\\u4e1d|followers)\\s*${metricPattern}`, "i"));
    if (!match) continue;
    const parsed = parseMetricLine(match[1]);
    if (parsed.status === "available") return parsed;
  }

  return { value: null, status: "not_public", raw: "" };
}

function inferAccountName(text, fallback) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const index = lines.findIndex((line) => line === "\u6296\u97f3\u53f7\uff1a" || line.startsWith("\u6296\u97f3\u53f7"));
  if (index > 0) return lines[index - 1];
  return fallback;
}

async function checkBlocked(page) {
  const title = await page.title().catch(() => "");
  const text = await getBodyText(page);
  for (const [code, message, pattern] of blockedPatterns) {
    if (pattern.test(text) || pattern.test(title)) return { code, message };
  }
  return null;
}

async function getProfileText(page) {
  const bodyText = await getBodyText(page);
  const domText = await page
    .evaluate(() => {
      const texts = new Set();
      const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const bodyContent = clean(document.body?.textContent || "");
      if (bodyContent) texts.add(bodyContent);

      for (const node of document.querySelectorAll("*")) {
        const text = clean(node.textContent || "");
        if (!text || !/粉丝|获赞|关注|followers/i.test(text)) continue;

        const parentText = clean(node.parentElement?.textContent || "");
        const grandText = clean(node.parentElement?.parentElement?.textContent || "");
        texts.add(text);
        if (parentText) texts.add(parentText);
        if (grandText) texts.add(grandText);
      }

      return Array.from(texts).join("\n");
    })
    .catch(() => "");

  return [bodyText, domText].filter(Boolean).join("\n");
}

async function getBodyText(page) {
  return page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
}

async function getPersistentContext(chromium) {
  if (persistentContext) return persistentContext;

  mkdirSync(browserProfileDir, { recursive: true });
  persistentContext = await chromium.launchPersistentContext(browserProfileDir, {
    ...browserOptions(),
    headless: false
  });

  persistentContext.on("close", () => {
    persistentContext = null;
    persistentPage = null;
  });

  return persistentContext;
}

async function getCapturePage(context, headless) {
  if (!headless && persistentPage && !persistentPage.isClosed()) return persistentPage;

  const existing = context.pages()[0];
  const page = existing || (await context.newPage());
  if (!headless) persistentPage = page;
  return page;
}

function browserOptions() {
  return {
    viewport: { width: 1365, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
  };
}

function normalizeDouyinVideoUrl(url) {
  const match = String(url || "").match(/^https:\/\/www\.douyin\.com\/video\/(\d+)/);
  return match ? `https://www.douyin.com/video/${match[1]}` : null;
}

function inferVideoId(url) {
  const match = String(url || "").match(/\/video\/(\d+)/);
  return match ? match[1] : null;
}

function emptyVideoMetrics(status) {
  return {
    like_count: null,
    comment_count: null,
    favorite_count: null,
    like_count_status: status,
    comment_count_status: status,
    favorite_count_status: status
  };
}

function classifyError(error) {
  const message = error?.message || "";
  if (/timeout/i.test(message)) return "NETWORK_ERROR";
  if (/Executable doesn't exist|browserType.launch/i.test(message)) return "PLAYWRIGHT_BROWSER_MISSING";
  return "UNKNOWN_ERROR";
}

function failedResult(account, capturedAt, code, message) {
  return {
    platform: account.platform_code,
    account: {
      display_name: account.display_name,
      profile_url: account.profile_url,
      follower_count: null,
      follower_count_status: "failed",
      raw_follower_text: ""
    },
    videos: [],
    status: "failed",
    error_code: code,
    error_message: message,
    captured_at: capturedAt
  };
}
