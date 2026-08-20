# 对标账号公开数据自动采集系统：技术方案

## 1. 技术形态

第一版采用本地 Web 应用：

- 前端：浏览器页面，用来管理账号、查看数据、看采集任务和周汇总
- 后端：本地服务，负责接口、采集任务、数据计算
- 数据库：SQLite，本地保存数据
- 定时任务：本地任务调度器
- 采集器：Playwright 浏览器自动化采集公开页面
- 导入导出：CSV/Excel 作为辅助能力

项目在本机运行，访问地址由 `.env.development` 的 `FRONTEND_PORT` 决定；当前为 `http://localhost:3102`。对外发送本地地址前，必须先确认服务已经启动、页面能打开。

## 2. 推荐技术栈

建议使用：

- Node.js
- React + Vite
- SQLite
- Playwright
- 本地任务调度器

选择原因：

- Playwright 适合控制浏览器打开公开页面。
- Node.js 和 Playwright 配合更顺。
- SQLite 适合本地小团队工具，不需要额外部署数据库。
- React/Vite 适合快速构建本地管理后台。

## 3. 系统模块

Web 页面模块负责首页概览、账号管理、账号详情、视频数据、采集任务、周汇总、合规提示。

API 服务模块负责添加账号、修改账号、设置采集周期、查询账号数据、查询视频数据、查询采集任务、手动触发立即更新、查询周汇总。

数据库模块统一读写 SQLite，包含账号表、账号快照表、视频表、视频快照表、采集任务表、采集日志表、周汇总表。

任务调度模块负责每日采集、每周采集、仅手动采集、立即更新、失败重试、防止同一个账号重复采集。

采集器模块包括抖音采集器、视频号采集器、通用采集结果格式。

数据标准化模块负责把页面上的文字数字转成统一格式，例如 `1.2万` 转为 `12000`。无法确定时保存原始文本并标记状态。

周汇总模块负责计算粉丝新增、点赞新增、评论新增、收藏新增、数据不足、平台未公开说明。

合规提示模块负责提醒和记录：不采集非公开数据、不绕过登录/验证码、不采集评论用户、不下载视频、采集失败原因。

## 4. 建议目录结构

```text
project-root/
  docs/
    prd.md
    architecture.md
    dev-notes.md
  data/
    app.sqlite
    backups/
    exports/
  logs/
    app.log
    capture.log
  src/
    backend/
      api/
      collectors/
        douyin/
        shipinhao/
        shared/
      db/
      jobs/
      services/
      utils/
    frontend/
      src/
        components/
        pages/
        api/
        styles/
  scripts/
```

`data/`、`logs/`、本地配置文件必须加入 `.gitignore`，不能提交到 GitHub。

## 5. 数据库表设计

### platforms

保存平台信息：

- `id`
- `code`：`douyin` / `shipinhao`
- `name`：抖音 / 视频号
- `enabled`
- `created_at`
- `updated_at`

### accounts

保存对标账号：

- `id`
- `platform_id`
- `display_name`
- `profile_url`
- `platform_account_id`
- `avatar_url`
- `bio`
- `category`
- `tags`
- `notes`
- `capture_frequency`：`daily` / `weekly` / `manual`
- `is_active`
- `last_captured_at`
- `created_at`
- `updated_at`

### account_snapshots

保存每次采集到的账号数据：

- `id`
- `account_id`
- `captured_at`
- `follower_count`
- `follower_count_status`
- `raw_follower_text`
- `source_url`
- `capture_job_id`
- `created_at`

状态值：

- `available`：已采集
- `not_public`：平台未公开
- `failed`：采集失败
- `unknown`：无法判断

### videos

保存公开视频基础信息：

- `id`
- `account_id`
- `platform_video_id`
- `video_url`
- `title`
- `description`
- `cover_url`
- `published_at`
- `created_at`
- `updated_at`

### video_snapshots

保存每次采集到的视频指标：

- `id`
- `video_id`
- `captured_at`
- `like_count`
- `comment_count`
- `favorite_count`
- `like_count_status`
- `comment_count_status`
- `favorite_count_status`
- `raw_metric_text`
- `capture_job_id`
- `created_at`

### capture_jobs

保存采集任务：

- `id`
- `account_id`
- `platform_id`
- `job_type`：`scheduled` / `manual`
- `trigger_type`：`daily` / `weekly` / `manual_now`
- `status`：`pending` / `running` / `success` / `partial_success` / `failed` / `skipped`
- `scheduled_at`
- `started_at`
- `finished_at`
- `retry_count`
- `error_code`
- `error_message`
- `created_at`
- `updated_at`

### capture_logs

保存采集过程日志：

- `id`
- `job_id`
- `level`：`info` / `warning` / `error`
- `message`
- `context_json`
- `created_at`

### weekly_summaries

保存每周汇总：

- `id`
- `account_id`
- `week_start`
- `week_end`
- `follower_delta`
- `video_like_delta`
- `video_comment_delta`
- `video_favorite_delta`
- `data_status`：`complete` / `partial` / `insufficient`
- `notes`
- `created_at`
- `updated_at`

## 6. 采集器设计

采集器统一输出 `CaptureResult`，不管是抖音还是视频号，都先变成同一套数据格式：

```text
CaptureResult
  platform
  account
    display_name
    profile_url
    follower_count
    follower_count_status
    raw_follower_text
  videos[]
    platform_video_id
    video_url
    title
    published_at
    like_count
    comment_count
    favorite_count
    like_count_status
    comment_count_status
    favorite_count_status
    raw_metric_text
  status
  error_code
  error_message
  captured_at
```

### 抖音采集器

职责：

- 打开抖音账号公开主页。
- 读取粉丝量。
- 读取公开作品列表。
- 读取公开视频点赞量、评论数、收藏数。
- 遇到登录、验证码、访问限制时停止。

边界：

- 不绕过验证码。
- 不绕过登录。
- 不下载视频。
- 不采评论正文。
- 不采评论用户。
- 第一版限制只采集最近 N 条公开视频。

### 视频号采集器

职责：

- 打开视频号可公开访问页面。
- 读取账号公开粉丝量，如果可见。
- 读取公开视频指标，如果可见。
- 不公开字段标记为 `not_public`。

风险：

- 视频号公开页面能力可能比抖音弱。
- 有些字段可能需要微信环境。
- 第一版接受“部分字段不可采集”。

## 7. 定时任务设计

每日采集：每天固定时间执行，扫描 `capture_frequency = daily` 的活跃账号，为每个账号创建采集任务并进入任务队列。

每周采集：每周固定一天执行，扫描 `capture_frequency = weekly` 的活跃账号并创建采集任务。

仅手动采集：不自动生成任务，用户点击“立即更新”才创建任务。

立即更新：用户在账号列表或账号详情点击，创建 `manual` 任务，进入同一套任务队列，不改变原来的采集周期。

失败重试：

- 默认最多重试 1 次。
- 网络失败可以重试。
- 验证码、登录限制、权限限制不自动重试。
- 页面结构变化不频繁重试，只记录日志。

错误类型：

- `NETWORK_ERROR`
- `LOGIN_REQUIRED`
- `CAPTCHA_REQUIRED`
- `ACCESS_DENIED`
- `PAGE_STRUCTURE_CHANGED`
- `FIELD_NOT_PUBLIC`
- `UNKNOWN_ERROR`

## 8. 状态处理

平台未公开：页面正常打开，但收藏数等字段没显示。数值字段存空，状态字段存 `not_public`，页面显示“平台未公开”，周汇总不按 0 计算。

采集失败：页面打不开、网络失败、验证码、页面结构变了。任务状态为 `failed` 或 `partial_success`，不覆盖上一次成功数据，写入采集日志，页面显示失败原因，用户可以稍后手动重试。

数据不足：本周只有一次采集、没有可对比数据或字段长期未公开。周汇总字段为空，状态为 `insufficient`，页面显示“数据不足”，不强行推断增长。

## 9. 页面实现顺序

1. 合规提示页
2. 对标账号管理页
3. 采集任务页
4. 账号详情页
5. 视频数据页
6. 周汇总页
7. 首页 / 概览页

## 10. 第一版验收标准

- 可以添加抖音、视频号账号。
- 每个账号可以配置每日、每周、仅手动。
- 默认每日采集。
- 可以点击立即更新。
- 系统能按周期生成采集任务。
- 采集任务有状态和日志。
- 成功采集后保存粉丝量快照。
- 成功采集后保存视频点赞、评论、收藏快照。
- 收藏数或其他字段不公开时显示“平台未公开”。
- 采集失败不覆盖历史成功数据。
- 周汇总展示粉丝、点赞、评论、收藏新增。
- 数据不足显示“数据不足”。
- 不采集评论正文、评论用户、粉丝列表、私信。
- 不下载视频。
- 不绕过登录、验证码、风控、权限限制。
- SQLite 数据能本地保存和备份。
- 本地日志能查看采集失败原因。

## 11. 主要技术风险

平台页面结构变化可能导致采集失败。规避方式是采集器独立封装、保存原始文本、解析失败时记录 `PAGE_STRUCTURE_CHANGED`、不影响历史数据。

验证码、登录、风控限制可能导致无法采集。规避方式是遇到就停止、不自动绕过、页面提示用户、限制采集频率、保留手动采集模式。

视频号字段不稳定。规避方式是字段状态化，不公开就标记 `not_public`，周汇总跳过不可用字段，第一版接受平台差异。

数字格式不统一。规避方式是保存原始文本，同时保存标准化数值，无法标准化就显示“无法解析”。

定时任务重复。规避方式是同账号同时间只允许一个任务，有 `pending/running` 任务时不重复创建，状态变化写日志。

本地数据丢失。规避方式是 SQLite 定期备份、快照数据只追加、采集失败不覆盖历史数据、支持 CSV/Excel 导出。

## 12. 当前默认口径

- 最近视频数量：20 条
- 每日采集时间：上午 9 点
- 周起始日：周一
- 第一版仅本机访问
- 失败自动重试 1 次
- 字段不可见显示“平台未公开”
- 数据不足显示“数据不足”
- 支持 CSV/Excel 导出
- 支持账号标签/分组
- 抖音和视频号都纳入第一版，但允许视频号字段不完整
