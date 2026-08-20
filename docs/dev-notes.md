# 开发说明

## 当前实现状态

当前第一版已经进入开发，技术方向为：

- Node.js 本地 API 服务
- React + Vite 前端管理台
- SQLite 本地数据库
- Playwright 浏览器辅助采集公开页面
- 本机访问，不开放局域网

默认地址：

- Web：`http://127.0.0.1:3102/`（以 `.env.development` 的 `FRONTEND_PORT` 为准）
- API：`http://127.0.0.1:8102/`（以 `.env.development` 的 `BACKEND_PORT` 为准）

## 启动方式

```bash
npm install
npm run dev:safe
```

构建检查：

```bash
npm run build
npm audit --omit=dev
```

第一次使用 Playwright 采集或截图前，需要安装浏览器运行环境：

```bash
npx playwright install chromium
```

## 环境变量

示例见 `.env.example`。

当前支持：

- `APP_URL`
- `API_PORT`
- `DATA_DIR`
- `SQLITE_PATH`
- `CAPTURE_HEADLESS`
- `CAPTURE_TIMEOUT_MS`
- `CAPTURE_SETTLE_MS`
- `CAPTURE_VIDEO_LIMIT`
- `CAPTURE_PROFILE_READY_TIMEOUT_MS`：主页在判定渲染不完整前的最长等待时间。
- `CAPTURE_DETAIL_SETTLE_MS` / `CAPTURE_DETAIL_JITTER_MS`：视频详情访问的基础间隔与随机抖动。
- `CAPTURE_ACCOUNT_COOLDOWN_MS`：连续账号或重试尝试之间的最小冷却时间。
- `CAPTURE_RETRY_DELAYS_MS`：可恢复失败的重试退避时间，默认 1 分钟、5 分钟、20 分钟。
- `CAPTURE_CIRCUIT_THRESHOLD` / `CAPTURE_CIRCUIT_BREAK_MS`：连续最终失败达到阈值后的平台保护暂停时间。

## 本地数据

SQLite 默认保存到：

```text
data/app.sqlite
```

日志默认保存到：

```text
logs/
```

这些本地运行文件不应提交到 GitHub。

## 采集器实现口径

采集器使用 Playwright 打开账号主页公开链接。

当前采集器会：

- 打开公开页面。
- 等待页面加载。
- 读取页面文本。
- 检测登录、验证码、访问限制。
- 尝试从公开文本中识别粉丝量。
- 从抖音账号主页识别最近 30 条公开视频链接。
- 逐条打开视频详情页，读取标题、发布时间、点赞量、评论数、收藏数。
- 保存原始文本和标准化状态。

默认采集模式是可视化浏览器模式：用户点击“立即更新”后会弹出 Chromium 窗口。如果页面要求登录，系统不会绕过登录，而是保留窗口给用户手动登录。登录状态保存在本地 `data/browser-profile`，该目录不得提交到 GitHub。

如果后续需要后台无窗口采集，可以在 `.env` 中设置：

```bash
CAPTURE_HEADLESS=true
```

当前采集器不会：

- 绕过登录。
- 绕过验证码。
- 使用 Cookie、Token 或平台账号登录态。
- 采集评论正文。
- 采集评论用户。
- 采集粉丝列表。
- 下载视频。

## 平台差异

抖音和视频号的公开页面结构可能变化，且公开字段不完全一致。

处理原则：

- 能公开读到就保存。
- 页面不公开就标记 `not_public`。
- 页面打不开、验证码、登录限制、结构变化就标记失败。
- 不把缺失值当成 0。

## 后续开发优先级

1. 完善真实平台页面字段识别。
2. 增加账号详情页。
3. 增加 CSV/Excel 导入导出。
4. 增加定时任务常驻调度。
5. 增加截图或原始证据留存选项。
6. 增加 SQLite 自动备份。
7. 增加本地页面密码保护。

## 当前默认口径

- 最近视频数量：20 条。
- 每日采集时间：上午 9 点。
- 周起始日：周一。
- 第一版仅本机访问。
- 失败自动重试 1 次。
- 字段不可见显示“平台未公开”。
- 数据不足显示“数据不足”。
- 支持账号标签/分组。
- 抖音和视频号都纳入第一版，但允许视频号字段不完整。
