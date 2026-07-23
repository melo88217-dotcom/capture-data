export const FOLLOWER_ONLY_CAPTURE_RESULT = Object.freeze({
  status: "partial_success",
  error_code: "VIDEO_DATA_MISSING",
  error_message:
    "已采集到粉丝数，但本次未识别到任何视频数据；系统已保留历史视频指标，不会将未采到误记为 0。"
});
