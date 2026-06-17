import { collectDouyin } from "./douyin/collector.js";
import { collectShipinhao } from "./shipinhao/collector.js";

export function getCollector(platformCode) {
  if (platformCode === "douyin") return collectDouyin;
  if (platformCode === "shipinhao") return collectShipinhao;
  throw new Error(`Unsupported platform: ${platformCode}`);
}
