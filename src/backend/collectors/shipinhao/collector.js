import { collectPublicPage } from "../shared/browserCollector.js";

export async function collectShipinhao(account) {
  return collectPublicPage(account, { limit: Number(process.env.CAPTURE_VIDEO_LIMIT || 20) });
}
