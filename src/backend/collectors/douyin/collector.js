import { collectPublicPage } from "../shared/browserCollector.js";

export async function collectDouyin(account) {
  return collectPublicPage(account, { limit: account.capture_video_limit || Number(process.env.CAPTURE_VIDEO_LIMIT || 10) });
}
