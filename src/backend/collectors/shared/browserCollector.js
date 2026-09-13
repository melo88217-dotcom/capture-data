import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFirstMetric } from "./metricParser.js";
import { FOLLOWER_ONLY_CAPTURE_RESULT } from "../../utils/captureStatus.js";
import { readNonNegativeNumber } from "../../utils/captureConfig.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../../../..");
const browserProfileDir = path.join(rootDir, "data", "browser-profile");
const captureFailureDir = path.join(rootDir, "logs", "capture-failures");
const maxCanonicalProfileUrls = 1_000;

let persistentContext = null;
let persistentPage = null;
let activeCapturePage = null;
const canonicalProfileUrls = new Map();

export async function closePersistentBrowser() {
  if (!persistentContext) return false;
  const context = persistentContext;
  await context.close();
  return true;
}

export async function resetPersistentPage() {
  const page = activeCapturePage || persistentPage;
  if (!page) return false;
  if (activeCapturePage === page) activeCapturePage = null;
  if (persistentPage === page) persistentPage = null;
  if (!page.isClosed()) await page.close().catch(() => {});
  return true;
}

const messages = {
  captcha: "\u9875\u9762\u51fa\u73b0\u9a8c\u8bc1\u7801\u6216\u5b89\u5168\u9a8c\u8bc1\uff0c\u7cfb\u7edf\u5df2\u505c\u6b62\u91c7\u96c6\u3002",
  login:
    "\u9875\u9762\u8981\u6c42\u767b\u5f55\u540e\u67e5\u770b\u3002\u5df2\u6253\u5f00\u6d4f\u89c8\u5668\u7a97\u53e3\uff0c\u8bf7\u5728\u7a97\u53e3\u91cc\u767b\u5f55\u540e\u518d\u70b9\u4e00\u6b21\u7acb\u5373\u66f4\u65b0\u3002",
  accessDenied: "\u9875\u9762\u8bbf\u95ee\u53d7\u9650\uff0c\u7cfb\u7edf\u4e0d\u4f1a\u7ed5\u8fc7\u6743\u9650\u9650\u5236\u3002",
  followerMissing:
    "\u5df2\u91c7\u96c6\u5230\u89c6\u9891\u516c\u5f00\u6307\u6807\uff0c\u4f46\u672a\u8bc6\u522b\u5230\u8d26\u53f7\u4e3b\u9875\u7c89\u4e1d\u6570\uff1b\u53ef\u80fd\u662f\u5e73\u53f0\u61d2\u52a0\u8f7d\u3001\u9875\u9762\u672a\u66b4\u9732\u6216\u9700\u8981\u767b\u5f55\u540e\u624d\u663e\u793a\u3002",
  renderIncomplete:
    "\u8d26\u53f7\u9875\u5df2\u6253\u5f00\uff0c\u4f46\u7c89\u4e1d\u548c\u89c6\u9891\u533a\u57df\u672a\u5b8c\u6574\u6e32\u67d3\uff1b\u7cfb\u7edf\u5c06\u81ea\u52a8\u6362\u9875\u5e76\u5ef6\u8fdf\u91cd\u8bd5\u3002",
  videoIncomplete:
    "\u5df2\u8bc6\u522b\u5230\u516c\u5f00\u89c6\u9891\u94fe\u63a5\uff0c\u4f46\u8be6\u60c5\u6307\u6807\u672a\u5b8c\u6574\u6e32\u67d3\uff1b\u7cfb\u7edf\u5c06\u81ea\u52a8\u91cd\u8bd5\u3002"
};

const blockedPatterns = [
  ["CAPTCHA_REQUIRED", messages.captcha, /\u9a8c\u8bc1\u7801|\u5b89\u5168\u9a8c\u8bc1|\u6ed1\u5757|verify|captcha/i],
  ["LOGIN_REQUIRED", messages.login, /\u767b\u5f55\u540e|\u8bf7\u767b\u5f55|\u626b\u7801\u767b\u5f55|login required/i],
  ["ACCESS_DENIED", messages.accessDenied, /\u8bbf\u95ee\u53d7\u9650|\u65e0\u6743\u8bbf\u95ee|\u7981\u6b62\u8bbf\u95ee|access denied|forbidden/i]
];
const blockedCaptureCodes = new Set(blockedPatterns.map(([code]) => code));

export async function collectPublicPage(account, options = {}) {
  const capturedAt = new Date().toISOString();
  const headless = process.env.CAPTURE_HEADLESS === "true";
  const limit = Number(options.limit || process.env.CAPTURE_VIDEO_LIMIT || 30);
  let browser = null;
  let context = null;
  let page = null;
  let response = null;
  let requestFailedHandler = null;
  const requestFailures = [];

  try {
    const { chromium } = await import("playwright");

    if (headless) {
      browser = await chromium.launch({ headless: true });
      context = await browser.newContext(browserOptions());
    } else {
      context = await getPersistentContext(chromium);
    }

    page = await getCapturePage(context, headless);
    activeCapturePage = page;
    requestFailedHandler = (request) => {
      if (requestFailures.length >= 12) return;
      requestFailures.push({
        resource_type: request.resourceType(),
        error: request.failure()?.errorText || "request failed"
      });
    };
    page.on("requestfailed", requestFailedHandler);
    response = await page.goto(profileUrlFor(account), {
      waitUntil: "domcontentloaded",
      timeout: Number(process.env.CAPTURE_TIMEOUT_MS || 30000)
    });
    const profileCheck = await checkBlocked(page);
    if (profileCheck) return failedResult(account, capturedAt, profileCheck.code, profileCheck.message);

    const readyCheck = await waitForProfileReady(page, limit);
    if (readyCheck) {
      rememberCanonicalProfileUrl(account, page.url());
      const screenshotPath = await captureFailureScreenshot(page, account, capturedAt, readyCheck.code);
      return failedResult(account, capturedAt, readyCheck.code, readyCheck.message, {
        ...readyCheck.diagnostics,
        http_status: response?.status() || null,
        request_failures: requestFailures,
        screenshot_path: screenshotPath
      });
    }
    const profileText = await getBodyText(page);
    const follower = await getProfileFollower(page);
    const totalLikes = await getProfileTotalLikes(page);
    const profileUrl = page.url();
    rememberCanonicalProfileUrl(account, profileUrl);
    const profileVideos = await extractDouyinProfileVideos(page, limit);
    const profileDiagnostics = {
      final_url: profileUrl,
      page_title: await page.title().catch(() => ""),
      body_text_length: profileText.length,
      video_link_count: profileVideos.length,
      follower_status: follower.status,
      total_like_status: totalLikes.status,
      request_failures: requestFailures
    };
    const videos = [];

    for (const [index, item] of profileVideos.entries()) {
      const detail = await collectVideoDetail(page, item);
      videos.push(detail);
      if (index < profileVideos.length - 1) await page.waitForTimeout(getDetailSettleMs());
    }

    const classification = classifyCollectionStatus({ followerStatus: follower.status, videos });
    const diagnostics = classification.error_code
      ? {
          ...profileDiagnostics,
          screenshot_path: await captureFailureScreenshot(page, account, capturedAt, classification.error_code)
        }
      : null;

    return {
      platform: account.platform_code,
      account: {
        display_name: account.display_name,
        profile_url: profileUrl || account.profile_url,
        follower_count: follower.value,
        follower_count_status: follower.status,
        raw_follower_text: follower.raw,
        total_like_count: totalLikes.value,
        total_like_count_status: totalLikes.status,
        raw_total_like_text: totalLikes.raw
      },
      videos,
      ...classification,
      diagnostics,
      captured_at: capturedAt
    };
  } catch (error) {
    const errorCode = classifyError(error);
    return failedResult(account, capturedAt, errorCode, error.message, {
      final_url: pageUrl(page),
      page_title: page ? await page.title().catch(() => "") : "",
      request_failures: [...requestFailures],
      http_status: response?.status?.() || null,
      error_name: error?.name || "Error",
      error_message: error?.message || String(error),
      screenshot_path: page ? await captureFailureScreenshot(page, account, capturedAt, errorCode) : null
    });
  } finally {
    if (page && requestFailedHandler) page.off("requestfailed", requestFailedHandler);
    if (activeCapturePage === page) activeCapturePage = null;
    if (headless && browser) await browser.close().catch(() => {});
  }
}

export function classifyCollectionStatus({ followerStatus, videos = [] }) {
  const blockedVideo = videos.find((video) => blockedCaptureCodes.has(video.error_code));
  if (blockedVideo) {
    return {
      status: "failed",
      error_code: blockedVideo.error_code,
      error_message: blockedVideo.error_message || blockedVideo.raw_metric_text || null
    };
  }

  const hasFollower = followerStatus === "available";
  const hasVideoMetric = videos.some(
    (video) =>
      video.like_count_status === "available" ||
      video.comment_count_status === "available" ||
      video.favorite_count_status === "available"
  );
  const hasOnlyLinks = videos.length > 0 && !hasFollower && !hasVideoMetric;
  if (hasFollower && videos.length === 0) return { ...FOLLOWER_ONLY_CAPTURE_RESULT };
  if (hasVideoMetric) {
    return {
      status: "success",
      error_code: null,
      error_message: hasFollower ? null : messages.followerMissing
    };
  }
  if (videos.length === 0) {
    return {
      status: "failed",
      error_code: "PAGE_RENDER_INCOMPLETE",
      error_message: messages.renderIncomplete
    };
  }
  return {
    status: hasFollower || hasOnlyLinks ? "partial_success" : "failed",
    error_code: "VIDEO_DETAIL_INCOMPLETE",
    error_message: messages.videoIncomplete
  };
}

async function collectVideoDetail(page, item) {
  try {
    await page.goto(item.video_url, {
      waitUntil: "domcontentloaded",
      timeout: Number(process.env.CAPTURE_TIMEOUT_MS || 30000)
    });
    await waitForVideoDetailContent(page, item.title);

    const blocked = await checkBlocked(page);
    if (blocked) {
      return {
        ...item,
        ...emptyVideoMetrics("failed"),
        error_code: blocked.code,
        error_message: blocked.message,
        raw_metric_text: blocked.message
      };
    }

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

export async function extractDouyinProfileVideos(page, limit, options = {}) {
  const targetCount = Math.max(1, Number(limit) || 10);
  const loadTimeoutMs = readNonNegativeNumber(
    options.loadTimeoutMs ?? process.env.CAPTURE_PROFILE_VIDEO_LOAD_TIMEOUT_MS,
    8_000
  );
  const scrollWaitMs = Math.max(
    100,
    readNonNegativeNumber(options.scrollWaitMs ?? process.env.CAPTURE_PROFILE_VIDEO_SCROLL_WAIT_MS, 900)
  );
  const startedAt = Date.now();
  let idleRounds = 0;
  let previousLinkCount = -1;

  while (true) {
    const links = await readDouyinProfileVideoLinks(page);
    const videos = buildDouyinProfileVideos(links, targetCount);
    if (videos.length >= targetCount) return videos;

    const hasTimedOut = Date.now() - startedAt >= loadTimeoutMs;
    idleRounds = links.length === previousLinkCount ? idleRounds + 1 : 0;
    // A short bounded scroll catches lazy-loaded cards after pinned videos without
    // delaying accounts that genuinely have fewer public non-pinned works.
    if (hasTimedOut || idleRounds >= 3) return videos;

    previousLinkCount = links.length;
    await page.mouse.wheel(0, 900).catch(() => {});
    await page.waitForTimeout(scrollWaitMs);
  }
}

async function readDouyinProfileVideoLinks(page) {
  return page
    .locator("a")
    .evaluateAll((nodes) => {
      const textOf = (element) => String(element?.innerText || element?.textContent || "").trim();
      const hasPinnedBadge = (node) => {
        let branch = node;
        // Stop at the card container: checking the shared video grid could incorrectly
        // apply one card's badge to every video link in that grid.
        for (let depth = 0; branch && depth < 2; depth += 1, branch = branch.parentElement) {
          if (textOf(branch).split(/\r?\n/).some((line) => line.trim() === "置顶")) return true;
          if (Array.from(branch.querySelectorAll("*")).some((child) => textOf(child) === "置顶")) return true;
        }
        return false;
      };
      return nodes
        .map((node) => ({
          href: node.href,
          text: textOf(node),
          label: (node.getAttribute("aria-label") || node.querySelector("img")?.getAttribute("alt") || "").trim(),
          hasMedia: Boolean(node.querySelector("img, video, picture")),
          visible: node.getBoundingClientRect().width >= 40 && node.getBoundingClientRect().height >= 40,
          is_pinned: hasPinnedBadge(node)
        }))
        .filter((item) => item.href);
    })
    .catch(() => []);
}

export function buildDouyinProfileVideos(links, limit) {
  const seen = new Set();
  const videos = [];

  for (const item of links) {
    const cleanUrl = normalizeDouyinVideoUrl(item.href);
    if (!cleanUrl || seen.has(cleanUrl)) continue;
    if (item.is_pinned) continue;
    const parsed = parseProfileVideoText([item.text, item.label].filter(Boolean).join("\n"));
    if (!parsed.title && parsed.like_count == null && !(item.hasMedia && item.visible)) continue;

    seen.add(cleanUrl);
    videos.push({
      platform_video_id: inferVideoId(cleanUrl),
      video_url: cleanUrl,
      title: parsed.title || item.label || "",
      published_at: null,
      like_count: parsed.like_count,
      comment_count: null,
      favorite_count: null,
      like_count_status: parsed.like_count == null ? "not_public" : "available",
      comment_count_status: "not_public",
      favorite_count_status: "not_public",
      raw_metric_text: [item.text, item.label].filter(Boolean).join("\n")
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
    const probe = await getProfileReadyProbe(page);
    const blocked = matchBlockedContent(probe.title, probe.text);
    if (blocked) return blocked;

    const follower = await getProfileFollower(page);
    const videoCount = probe.videoCount;
    bestVideoCount = Math.max(bestVideoCount, videoCount);

    if (follower.status === "available" && videoCount >= targetVideoCount) return null;
    if (follower.status === "available" && bestVideoCount > 0 && Date.now() - started >= Math.max(settle, 6000)) return null;
    await page.mouse.wheel(0, 900).catch(() => {});
    await page.waitForTimeout(1000);
  }

  const text = await getBodyText(page);
  const follower = await getProfileFollower(page);
  if (follower.status === "available" || (bestVideoCount > 0 && hasProfileIdentityText(text))) return null;
  return {
    code: "PAGE_RENDER_INCOMPLETE",
    message: messages.renderIncomplete,
    diagnostics: {
      final_url: page.url(),
      page_title: await page.title().catch(() => ""),
      body_text_length: text.length,
      video_link_count: bestVideoCount,
      follower_status: follower.status,
      identity_found: hasProfileIdentityText(text)
    }
  };
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

export function extractFollower(metricItems) {
  return extractProfileMetric(metricItems, "(?:\\u7c89\\u4e1d|followers)");
}

export function extractTotalLikes(metricItems) {
  return extractProfileMetric(metricItems, "(?:\\u83b7\\u8d5e|likes?)");
}

function extractProfileMetric(metricItems, labelPattern) {
  const values = Array.isArray(metricItems) ? metricItems : [metricItems];
  const parsed = values
    .map((value) => extractProfileMetricItem(value, labelPattern))
    .filter((item) => item.status === "available");
  const distinctValues = new Set(parsed.map((item) => item.value));

  if (distinctValues.size === 1) return parsed[0];
  return {
    value: null,
    status: parsed.length ? "unknown" : "not_public",
    raw: ""
  };
}

function extractProfileMetricItem(value, labelPattern) {
  const compact = String(value || "").replace(/\s+/g, "");
  const metricPattern = "([0-9]+(?:\\.[0-9]+)?(?:\\u4e07|w|W|\\u4ebf)?\\+?)";
  const metricBeforeLabel = compact.match(new RegExp(`^${metricPattern}${labelPattern}$`, "i"));
  const labelBeforeMetric = compact.match(new RegExp(`^${labelPattern}${metricPattern}$`, "i"));
  const candidate = metricBeforeLabel?.[1] || labelBeforeMetric?.[1];
  return candidate ? parseMetricLine(candidate) : { value: null, status: "unknown", raw: "" };
}

export async function getProfileFollower(page) {
  return getProfileMetric(page, "(?:粉丝|followers)", "(?:粉丝|followers)");
}

export async function getProfileTotalLikes(page) {
  return getProfileMetric(page, "(?:获赞|likes?)", "(?:获赞|likes?)");
}

async function getProfileMetric(page, labelPattern, extractLabelPattern) {
  const metricItems = await page
    .evaluate((pageLabelPattern) => {
      const labelPattern = pageLabelPattern;
      const metricPattern = "[0-9]+(?:\\.[0-9]+)?(?:万|w|W|亿)?\\+?";
      const directMetric = new RegExp(`^(?:${metricPattern})${labelPattern}$|^${labelPattern}(?:${metricPattern})$`, "i");
      const normalize = (value) => String(value || "").replace(/\s+/g, "").trim();
      const getText = (element) => normalize(element.innerText || element.textContent || "");
      const belongsToProfileHeader = (element) => {
        let ancestor = element.parentElement;
        for (
          let depth = 0;
          ancestor && ancestor !== document.body && ancestor !== document.documentElement && depth < 6;
          depth += 1, ancestor = ancestor.parentElement
        ) {
          if (ancestor.querySelector("h1")) return true;
        }
        return false;
      };
      const items = new Set();
      const elements = Array.from(document.body?.querySelectorAll("*") || []);

      const metricLabels = elements.filter((element) => {
        const text = getText(element);
        return new RegExp(`^${labelPattern}$`, "i").test(text) && belongsToProfileHeader(element);
      });
      for (const label of metricLabels) {
        let branch = label;
        for (let depth = 0; depth < 3 && branch.parentElement; depth += 1) {
          const parent = branch.parentElement;
          const parentText = getText(parent);
          if (parentText.length <= 32 && directMetric.test(parentText)) items.add(parentText);
          branch = parent;
        }
      }

      return Array.from(items);
    }, labelPattern)
    .catch(() => []);
  return extractProfileMetric(metricItems, extractLabelPattern);
}

async function checkBlocked(page) {
  const title = await page.title().catch(() => "");
  const text = await getBodyText(page);
  return matchBlockedContent(title, text);
}

function matchBlockedContent(title, text) {
  for (const [code, message, pattern] of blockedPatterns) {
    if (pattern.test(text) || pattern.test(title)) return { code, message };
  }
  return null;
}

async function getProfileReadyProbe(page) {
  return page
    .evaluate(() => ({
      title: document.title || "",
      text: document.body?.innerText || "",
      videoCount: document.querySelectorAll('a[href*="/video/"]').length
    }))
    .catch(() => ({ title: "", text: "", videoCount: 0 }));
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

function getDetailSettleMs() {
  const base = readNonNegativeNumber(process.env.CAPTURE_DETAIL_SETTLE_MS, 2_000);
  const jitter = readNonNegativeNumber(process.env.CAPTURE_DETAIL_JITTER_MS, 2_000);
  return base + Math.floor(Math.random() * (jitter + 1));
}

function profileUrlFor(account) {
  const sourceUrl = String(account.profile_url || "").trim();
  const cached = canonicalProfileUrls.get(captureAccountId(account));
  return cached?.sourceUrl === sourceUrl ? cached.canonicalUrl : sourceUrl;
}

function rememberCanonicalProfileUrl(account, url) {
  if (!/^https:\/\/www\.douyin\.com\/user\//.test(String(url || ""))) return;
  const accountId = captureAccountId(account);
  canonicalProfileUrls.delete(accountId);
  canonicalProfileUrls.set(accountId, {
    sourceUrl: String(account.profile_url || "").trim(),
    canonicalUrl: String(url).split("?")[0]
  });
  while (canonicalProfileUrls.size > maxCanonicalProfileUrls) {
    canonicalProfileUrls.delete(canonicalProfileUrls.keys().next().value);
  }
}

function captureAccountId(account) {
  return account.account_id || account.id;
}

function pageUrl(page) {
  try {
    return page?.url?.() || null;
  } catch {
    return null;
  }
}

async function captureFailureScreenshot(page, account, capturedAt, code) {
  try {
    mkdirSync(captureFailureDir, { recursive: true });
    const stamp = capturedAt.replace(/[:.]/g, "-");
    const accountId = String(account.account_id || account.id || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
    const filePath = path.join(captureFailureDir, `${stamp}-account-${accountId}-${code}.png`);
    await page.screenshot({ path: filePath, fullPage: false });
    return filePath;
  } catch {
    return null;
  }
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

function failedResult(account, capturedAt, code, message, diagnostics = null) {
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
    diagnostics,
    captured_at: capturedAt
  };
}
