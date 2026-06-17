import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarClock,
  Database,
  Download,
  FileClock,
  Filter,
  ListVideo,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  Users
} from "lucide-react";
import { api } from "./api/client.js";
import "./styles.css";

const navItems = [
  { key: "overview", label: "概览", icon: BarChart3 },
  { key: "accounts", label: "对标账号", icon: Users },
  { key: "videos", label: "视频数据", icon: ListVideo },
  { key: "daily", label: "每日变化", icon: Activity },
  { key: "hot", label: "爆款视频", icon: Activity },
  { key: "jobs", label: "采集任务", icon: FileClock },
  { key: "weekly", label: "周汇总", icon: CalendarClock },
  { key: "settings", label: "设置", icon: Settings }
];

const frequencyLabels = {
  hourly: "每 1 小时",
  six_hours: "每 6 小时",
  daily: "每天",
  weekly: "每周",
  manual: "手动"
};

const statusLabels = {
  success: "成功",
  partial_success: "部分成功",
  failed: "失败",
  pending: "待执行",
  running: "执行中",
  skipped: "跳过",
  unknown: "未采集"
};

function App() {
  const [active, setActive] = useState("overview");
  const [accounts, setAccounts] = useState([]);
  const [overview, setOverview] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [videos, setVideos] = useState([]);
  const [hotVideos, setHotVideos] = useState([]);
  const [dailyChanges, setDailyChanges] = useState([]);
  const [weekly, setWeekly] = useState([]);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [captureId, setCaptureId] = useState(null);
  const [videoFilters, setVideoFilters] = useState({ account_id: "", range: "all", limit: "120" });
  const [dailyFilters, setDailyFilters] = useState({ account_id: "", limit: "120" });

  const resolvedVideoFilters = useMemo(() => resolveVideoFilters(videoFilters), [videoFilters]);

  async function refresh(videoQuery = resolvedVideoFilters, dailyQuery = dailyFilters) {
    setLoading(true);
    setError("");
    try {
      const [healthData, overviewData, accountsData, jobsData, videosData, hotData, dailyData, weeklyData] = await Promise.all([
        api.health(),
        api.overview(),
        api.accounts(),
        api.jobs(),
        api.videos(videoQuery),
        api.hotVideos(),
        api.dailyChanges(dailyQuery),
        api.weekly()
      ]);
      setHealth(healthData);
      setOverview(overviewData);
      setAccounts(accountsData);
      setJobs(jobsData);
      setVideos(videosData);
      setHotVideos(hotData);
      setDailyChanges(dailyData);
      setWeekly(weeklyData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh(resolvedVideoFilters, dailyFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function applyVideoFilters(nextFilters) {
    setVideoFilters(nextFilters);
    await refresh(resolveVideoFilters(nextFilters), dailyFilters);
  }

  async function applyDailyFilters(nextFilters) {
    setDailyFilters(nextFilters);
    await refresh(resolvedVideoFilters, nextFilters);
  }

  async function handleCapture(accountId) {
    setCaptureId(accountId);
    setError("");
    try {
      await api.captureAccount(accountId);
      await refresh(resolvedVideoFilters, dailyFilters);
      setActive("jobs");
    } catch (err) {
      setError(err.message);
    } finally {
      setCaptureId(null);
    }
  }

  async function handleCreateAccount(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      await api.createAccount(payload);
      setShowForm(false);
      await refresh(resolvedVideoFilters, dailyFilters);
      setActive("accounts");
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleUpdateAccount(id, payload) {
    setError("");
    try {
      await api.updateAccount(id, payload);
      await refresh(resolvedVideoFilters, dailyFilters);
    } catch (err) {
      setError(err.message);
    }
  }

  const stats = useMemo(() => {
    const totals = overview?.totals || {};
    const jobStats = overview?.jobs || {};
    const weeklyTotals = weekly.reduce(
      (acc, item) => {
        acc.followers += item.follower_delta || 0;
        acc.interactions +=
          (item.video_like_delta || 0) + (item.video_comment_delta || 0) + (item.video_favorite_delta || 0);
        return acc;
      },
      { followers: 0, interactions: 0 }
    );

    return [
      { label: "观察账号", value: totals.active_count || 0, hint: `总计 ${totals.account_count || 0}` },
      { label: "本周采集", value: jobStats.total || 0, hint: `${jobStats.success || 0} 成功` },
      { label: "采集失败", value: totals.failed_count || 0, hint: "需人工查看" },
      { label: "粉丝新增", value: formatNumber(weeklyTotals.followers), hint: "本周汇总" },
      { label: "互动新增", value: formatNumber(weeklyTotals.interactions), hint: "赞评藏合计" }
    ];
  }, [overview, weekly]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">数</div>
          <div>
            <strong>对标监控</strong>
            <span>公开数据采集</span>
          </div>
        </div>
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={active === item.key ? "nav-item active" : "nav-item"}
                onClick={() => setActive(item.key)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="compliance-note">
          <ShieldCheck size={18} />
          <span>只采集公开可见数据；遇到登录、验证码或权限限制即停止。</span>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>对标账号监控</h1>
            <p>定时采集抖音、视频号公开指标，按天和按周查看变化。</p>
          </div>
          <div className="topbar-actions">
            <button className="ghost-button" onClick={() => refresh(resolvedVideoFilters, dailyFilters)} disabled={loading}>
              <RefreshCw size={16} />
              刷新
            </button>
            <button className="primary-button" onClick={() => setShowForm(true)}>
              <Plus size={16} />
              新增账号
            </button>
          </div>
        </header>

        {error && (
          <div className="alert">
            <AlertTriangle size={16} />
            {error}
          </div>
        )}

        <section className="stats-grid">
          {stats.map((stat) => (
            <div className="stat-card" key={stat.label}>
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
              <em>{stat.hint}</em>
            </div>
          ))}
        </section>

        {active === "overview" && <Overview accounts={accounts} jobs={jobs} weekly={weekly} onGo={setActive} />}
        {active === "accounts" && (
          <Accounts
            accounts={accounts}
            onCapture={handleCapture}
            onUpdate={handleUpdateAccount}
            captureId={captureId}
          />
        )}
        {active === "videos" && (
          <Videos
            videos={videos}
            accounts={accounts}
            filters={videoFilters}
            resolvedFilters={resolvedVideoFilters}
            onApplyFilters={applyVideoFilters}
          />
        )}
        {active === "daily" && (
          <DailyChanges
            rows={dailyChanges}
            accounts={accounts}
            filters={dailyFilters}
            onApplyFilters={applyDailyFilters}
          />
        )}
        {active === "hot" && <HotVideos videos={hotVideos} />}
        {active === "jobs" && <Jobs jobs={jobs} />}
        {active === "weekly" && <Weekly weekly={weekly} />}
        {active === "settings" && <SettingsPanel health={health} />}
      </main>

      {showForm && <AccountForm onClose={() => setShowForm(false)} onSubmit={handleCreateAccount} />}
    </div>
  );
}

function Overview({ accounts, jobs, weekly, onGo }) {
  const latestSuccess = jobs.find((job) => job.status === "success");
  const failedJobs = jobs.filter((job) => job.status === "failed").slice(0, 5);
  const topWeekly = [...weekly].sort((a, b) => totalInteractionDelta(b) - totalInteractionDelta(a)).slice(0, 5);

  return (
    <div className="dashboard-grid">
      <section className="panel wide">
        <PanelHeader title="今日看板" icon={Activity} />
        <div className="insight-grid">
          <InsightCard label="最近成功采集" value={latestSuccess?.display_name || "-"} hint={formatDate(latestSuccess?.finished_at)} />
          <InsightCard label="待关注失败" value={failedJobs.length} hint={failedJobs.length ? "采集任务页查看原因" : "暂无失败任务"} />
          <InsightCard label="账号数量" value={accounts.length} hint="在对标账号页维护账号" />
        </div>
        <div className="panel-actions">
          <button className="small-button" onClick={() => onGo("videos")}>查看视频数据</button>
          <button className="small-button" onClick={() => onGo("daily")}>查看每日变化</button>
          <button className="small-button" onClick={() => onGo("accounts")}>管理账号</button>
        </div>
      </section>
      <section className="panel">
        <PanelHeader title="最近采集日志" icon={FileClock} />
        <div className="timeline">
          {jobs.slice(0, 8).map((job) => (
            <div className="timeline-item" key={job.id}>
              <StatusDot status={job.status} />
              <div>
                <strong>{job.display_name}</strong>
                <span>{statusLabels[job.status] || job.status} · {formatDate(job.finished_at || job.created_at)}</span>
              </div>
            </div>
          ))}
          {jobs.length === 0 && <Empty text="暂无采集任务" />}
        </div>
      </section>
      <section className="panel wide">
        <PanelHeader title="本周互动增量排行" icon={CalendarClock} />
        <WeeklyTable weekly={topWeekly} compact />
      </section>
    </div>
  );
}

function InsightCard({ label, value, hint }) {
  return (
    <div className="insight-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{hint || "-"}</em>
    </div>
  );
}

function Accounts({ accounts, onCapture, onUpdate, captureId }) {
  return (
    <section className="panel">
      <PanelHeader title="对标账号管理" icon={Users} />
      <AccountTable accounts={accounts} onCapture={onCapture} onUpdate={onUpdate} captureId={captureId} />
    </section>
  );
}

function AccountTable({ accounts, onCapture, onUpdate, captureId }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>账号</th>
            <th>平台</th>
            <th>自动频率</th>
            <th>更新时间</th>
            <th>点赞预警</th>
            <th>最新粉丝</th>
            <th>状态</th>
            <th>最近采集</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.id}>
              <td>
                <div className="cell-title">
                  <strong>{account.display_name}</strong>
                  <span>{account.category || "未分类"}</span>
                </div>
              </td>
              <td><Badge>{account.platform_name}</Badge></td>
              <td>
                <select
                  className="table-control"
                  value={account.capture_frequency}
                  onChange={(event) => onUpdate(account.id, { capture_frequency: event.target.value })}
                >
                  <FrequencyOptions />
                </select>
              </td>
              <td>
                <input
                  className="table-control"
                  type="time"
                  value={account.preferred_capture_time || "09:00"}
                  disabled={!["daily", "weekly"].includes(account.capture_frequency)}
                  onChange={(event) => onUpdate(account.id, { preferred_capture_time: event.target.value })}
                />
              </td>
              <td>
                <input
                  className="table-control"
                  type="number"
                  min="0"
                  step="1"
                  value={account.like_alert_threshold || 0}
                  onChange={(event) => onUpdate(account.id, { like_alert_threshold: event.target.value })}
                />
              </td>
              <td>{formatNullable(account.latest_follower_count)}</td>
              <td><StatusPill status={account.latest_collect_status} /></td>
              <td>{formatDate(account.last_captured_at)}</td>
              <td>
                <button className="small-button" onClick={() => onCapture(account.id)} disabled={captureId === account.id}>
                  <RefreshCw size={14} />
                  {captureId === account.id ? "采集中" : "立即更新"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {accounts.length === 0 && <Empty text="还没有账号，先新增一个对标账号。" />}
    </div>
  );
}

function Videos({ videos, accounts, filters, resolvedFilters, onApplyFilters }) {
  const [draft, setDraft] = useState(filters);
  useEffect(() => setDraft(filters), [filters]);

  const exportUrl = api.videoExportUrl(resolvedFilters);
  const excelExportUrl = api.videoExcelExportUrl(resolvedFilters);

  function updateDraft(key, value) {
    const next = { ...draft, [key]: value };
    if (key === "range" && value !== "custom") {
      next.from = "";
      next.to = "";
    }
    setDraft(next);
    if (next.range !== "custom" || key === "from" || key === "to") onApplyFilters(next);
  }

  return (
    <section className="panel">
      <PanelHeader title="视频数据" icon={ListVideo} />
      <div className="filter-bar">
        <AccountFilter accounts={accounts} value={draft.account_id} onChange={(value) => updateDraft("account_id", value)} />
        <label>
          时间范围
          <select value={draft.range} onChange={(event) => updateDraft("range", event.target.value)}>
            <option value="all">全部公开视频</option>
            <option value="7">最近 7 天</option>
            <option value="30">最近 30 天</option>
            <option value="90">最近 90 天</option>
            <option value="custom">自定义</option>
          </select>
        </label>
        {draft.range === "custom" && (
          <>
            <label>开始日期<input type="date" value={draft.from || ""} onChange={(event) => updateDraft("from", event.target.value)} /></label>
            <label>结束日期<input type="date" value={draft.to || ""} onChange={(event) => updateDraft("to", event.target.value)} /></label>
          </>
        )}
        <label>
          显示条数
          <select value={draft.limit} onChange={(event) => updateDraft("limit", event.target.value)}>
            <option value="30">30 条</option>
            <option value="60">60 条</option>
            <option value="120">120 条</option>
            <option value="all">全部</option>
          </select>
        </label>
        <div className="filter-actions">
          <button className="small-button" onClick={() => onApplyFilters(draft)}><Filter size={14} />刷新筛选</button>
          <a className="small-button" href={exportUrl} download><Download size={14} />下载 CSV</a>
          <a className="small-button" href={excelExportUrl} download><Download size={14} />下载 Excel</a>
        </div>
      </div>
      <div className="result-note">当前显示 {videos.length} 条；筛选和下载都会按当前账号、时间范围、显示条数生效。</div>
      <VideoTable videos={videos} />
    </section>
  );
}

function VideoTable({ videos }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>发布时间</th>
            <th>视频</th>
            <th>账号</th>
            <th>点赞</th>
            <th>评论</th>
            <th>收藏</th>
            <th>采集时间</th>
          </tr>
        </thead>
        <tbody>
          {videos.map((video) => (
            <tr key={video.id}>
              <td>{formatDate(video.published_at)}</td>
              <td><a href={video.video_url} target="_blank" rel="noreferrer">{video.title || video.video_url}</a></td>
              <td>{video.account_name}</td>
              <td>{metricCell(video.like_count, video.like_count_status)}</td>
              <td>{metricCell(video.comment_count, video.comment_count_status)}</td>
              <td>{metricCell(video.favorite_count, video.favorite_count_status)}</td>
              <td>{formatDate(video.captured_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {videos.length === 0 && <Empty text="当前筛选条件下没有视频数据。" />}
    </div>
  );
}

function DailyChanges({ rows, accounts, filters, onApplyFilters }) {
  const [draft, setDraft] = useState(filters);
  useEffect(() => setDraft(filters), [filters]);

  function updateDraft(key, value) {
    const next = { ...draft, [key]: value };
    setDraft(next);
    onApplyFilters(next);
  }

  return (
    <section className="panel">
      <PanelHeader title="每日变化" icon={Activity} />
      <div className="filter-bar">
        <AccountFilter accounts={accounts} value={draft.account_id} onChange={(value) => updateDraft("account_id", value)} />
        <label>
          显示天数
          <select value={draft.limit} onChange={(event) => updateDraft("limit", event.target.value)}>
            <option value="30">30 天</option>
            <option value="60">60 天</option>
            <option value="120">120 天</option>
            <option value="all">全部</option>
          </select>
        </label>
        <div className="filter-actions">
          <a className="small-button" href={api.dailyChangesExportUrl(draft)} download><Download size={14} />下载 CSV</a>
          <a className="small-button" href={api.dailyChangesExcelExportUrl(draft)} download><Download size={14} />下载 Excel</a>
        </div>
      </div>
      <div className="result-note">这里按每天最后一次采集快照汇总，“数据时间”就是这一天实际使用的采集时间。</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>日期</th>
              <th>数据时间</th>
              <th>账号</th>
              <th>粉丝</th>
              <th>粉丝变化</th>
              <th>视频数</th>
              <th>点赞合计</th>
              <th>点赞变化</th>
              <th>评论合计</th>
              <th>评论变化</th>
              <th>收藏合计</th>
              <th>收藏变化</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.account_id}-${row.day}`}>
                <td>{row.day}</td>
                <td>{formatDate(row.captured_at)}</td>
                <td>{row.account_name}</td>
                <td>{formatNullable(row.follower_count)}</td>
                <td>{signedNumber(row.follower_delta)}</td>
                <td>{formatNullable(row.video_count)}</td>
                <td>{formatNullable(row.like_total)}</td>
                <td>{signedNumber(row.like_delta)}</td>
                <td>{formatNullable(row.comment_total)}</td>
                <td>{signedNumber(row.comment_delta)}</td>
                <td>{formatNullable(row.favorite_total)}</td>
                <td>{signedNumber(row.favorite_delta)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty text="暂无每日变化数据。采集成功后会自动记录。" />}
      </div>
    </section>
  );
}

function HotVideos({ videos }) {
  return (
    <section className="panel">
      <PanelHeader title="爆款视频" icon={Activity} />
      <div className="result-note">当单条视频最新点赞数达到账号设置的“点赞预警线”时，会出现在这里。预警线为 0 表示不启用。</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>账号</th>
              <th>发布时间</th>
              <th>视频</th>
              <th>点赞</th>
              <th>预警线</th>
              <th>评论</th>
              <th>收藏</th>
              <th>采集时间</th>
            </tr>
          </thead>
          <tbody>
            {videos.map((video) => (
              <tr key={video.id}>
                <td>{video.account_name}</td>
                <td>{formatDate(video.published_at)}</td>
                <td><a href={video.video_url} target="_blank" rel="noreferrer">{video.title || video.video_url}</a></td>
                <td>{formatNullable(video.like_count)}</td>
                <td>{formatNullable(video.like_alert_threshold)}</td>
                <td>{metricCell(video.comment_count, video.comment_count_status)}</td>
                <td>{metricCell(video.favorite_count, video.favorite_count_status)}</td>
                <td>{formatDate(video.captured_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {videos.length === 0 && <Empty text="暂无超过点赞预警线的视频。" />}
      </div>
    </section>
  );
}

function Jobs({ jobs }) {
  return (
    <section className="panel">
      <PanelHeader title="采集任务" icon={FileClock} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>账号</th>
              <th>平台</th>
              <th>触发方式</th>
              <th>状态</th>
              <th>结果说明</th>
              <th>开始</th>
              <th>结束</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>{job.display_name}</td>
                <td>{job.platform_name}</td>
                <td>{job.trigger_type}</td>
                <td><StatusPill status={job.status} /></td>
                <td>{job.error_message || explainJob(job)}</td>
                <td>{formatDate(job.started_at)}</td>
                <td>{formatDate(job.finished_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {jobs.length === 0 && <Empty text="暂无采集任务。" />}
      </div>
    </section>
  );
}

function Weekly({ weekly }) {
  return (
    <section className="panel">
      <PanelHeader title="周汇总：本周 vs 上周" icon={CalendarClock} />
      <WeeklyTable weekly={weekly} />
    </section>
  );
}

function WeeklyTable({ weekly, compact = false }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>账号</th>
            {!compact && <th>平台</th>}
            <th>周期</th>
            <th>本周作品</th>
            <th>上周作品</th>
            <th>作品变化</th>
            <th>本周点赞</th>
            <th>上周点赞</th>
            <th>点赞变化</th>
            {!compact && <th>本周评论</th>}
            {!compact && <th>评论变化</th>}
            {!compact && <th>本周收藏</th>}
            {!compact && <th>收藏变化</th>}
            {!compact && <th>粉丝新增</th>}
            {!compact && <th>粉丝较上周</th>}
            {!compact && <th>状态</th>}
          </tr>
        </thead>
        <tbody>
          {weekly.map((item) => (
            <tr key={item.id}>
              <td>{item.display_name}</td>
              {!compact && <td>{item.platform_name}</td>}
              <td>{formatShortDate(item.week_start)} - {formatShortDate(item.week_end)}</td>
              <td>{formatNullable(item.current_published_video_count)}</td>
              <td>{formatNullable(item.previous_published_video_count)}</td>
              <td>{signedNumber((item.current_published_video_count || 0) - (item.previous_published_video_count || 0))}</td>
              <td>{formatNullable(item.current_published_like_total)}</td>
              <td>{formatNullable(item.previous_published_like_total)}</td>
              <td>{signedNumber((item.current_published_like_total || 0) - (item.previous_published_like_total || 0))}</td>
              {!compact && <td>{formatNullable(item.current_published_comment_total)}</td>}
              {!compact && <td>{signedNumber((item.current_published_comment_total || 0) - (item.previous_published_comment_total || 0))}</td>}
              {!compact && <td>{formatNullable(item.current_published_favorite_total)}</td>}
              {!compact && <td>{signedNumber((item.current_published_favorite_total || 0) - (item.previous_published_favorite_total || 0))}</td>}
              {!compact && <td>{formatNullable(item.follower_delta)}</td>}
              {!compact && <td>{item.follower_delta_change == null ? "暂无上周粉丝快照" : signedNumber(item.follower_delta_change)}</td>}
              {!compact && <td><StatusPill status={item.data_status} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
      {weekly.length === 0 && <Empty text="暂无周汇总数据。" />}
    </div>
  );
}

function SettingsPanel({ health }) {
  return (
    <section className="panel settings-panel">
      <PanelHeader title="设置与边界" icon={Database} />
      <div className="settings-grid">
        <div><span>数据库位置</span><strong>{health?.dbPath || "读取中"}</strong></div>
        <div><span>访问范围</span><strong>仅本机 localhost</strong></div>
        <div><span>自动采集</span><strong>本地服务启动后每 1 小时检查一次，到期账号自动采集</strong></div>
        <div><span>采集边界</span><strong>只采集公开可见聚合指标，不采集评论用户、粉丝列表、私信、视频文件</strong></div>
      </div>
    </section>
  );
}

function AccountForm({ onClose, onSubmit }) {
  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={onSubmit}>
        <h2>新增对标账号</h2>
        <label>
          平台
          <select name="platform" defaultValue="douyin">
            <option value="douyin">抖音</option>
            <option value="shipinhao">视频号</option>
          </select>
        </label>
        <label>账号名称<input name="display_name" required placeholder="例如：某某品牌号" /></label>
        <label>主页链接<input name="profile_url" required placeholder="https://..." /></label>
        <label>
          自动采集频率
          <select name="capture_frequency" defaultValue="daily">
            <FrequencyOptions />
          </select>
        </label>
        <label>每天/每周更新时间<input name="preferred_capture_time" type="time" defaultValue="09:00" /></label>
        <label>点赞预警线<input name="like_alert_threshold" type="number" min="0" step="1" defaultValue="0" placeholder="例如：1000" /></label>
        <label>分类<input name="category" placeholder="同行 / 达人 / 品牌号" /></label>
        <label>标签<input name="tags" placeholder="短视频 本地生活" /></label>
        <label>备注<textarea name="notes" rows="3" placeholder="为什么对标它" /></label>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>取消</button>
          <button type="submit" className="primary-button">保存账号</button>
        </div>
      </form>
    </div>
  );
}

function AccountFilter({ accounts, value, onChange }) {
  return (
    <label>
      对标账号
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">全部账号</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>{account.display_name}</option>
        ))}
      </select>
    </label>
  );
}

function FrequencyOptions() {
  return (
    <>
      <option value="hourly">每 1 小时</option>
      <option value="six_hours">每 6 小时</option>
      <option value="daily">每天</option>
      <option value="weekly">每周</option>
      <option value="manual">手动</option>
    </>
  );
}

function PanelHeader({ title, icon: Icon }) {
  return (
    <div className="panel-header">
      <div><Icon size={18} /><h2>{title}</h2></div>
    </div>
  );
}

function Badge({ children }) {
  return <span className="badge">{children}</span>;
}

function StatusDot({ status }) {
  return <span className={`status-dot ${status || "unknown"}`} />;
}

function StatusPill({ status }) {
  return <span className={`status-pill ${status || "unknown"}`}>{statusLabels[status] || translateDataStatus(status)}</span>;
}

function Empty({ text }) {
  return <div className="empty">{text}</div>;
}

function translateDataStatus(status) {
  const map = { complete: "完整", partial: "部分", insufficient: "数据不足", not_public: "平台未公开" };
  return map[status] || status || "未知";
}

function metricCell(value, status) {
  if (status === "not_public") return "平台未公开";
  if (status === "failed") return "采集失败";
  return formatNullable(value);
}

function explainJob(job) {
  if (job.status === "success") return "采集到核心公开指标。";
  if (job.status === "partial_success") return "只采到部分公开信息，核心指标可能未公开。";
  if (job.status === "failed") return "未采到可用数据。";
  return "-";
}

function resolveVideoFilters(filters) {
  const result = { account_id: filters.account_id, limit: filters.limit || "120" };
  if (filters.range === "custom") {
    if (filters.from) result.from = `${filters.from} 00:00:00`;
    if (filters.to) result.to = `${filters.to} 23:59:59`;
  } else if (filters.range && filters.range !== "all") {
    const days = Number(filters.range);
    const from = new Date();
    from.setDate(from.getDate() - days);
    result.from = `${from.toISOString().slice(0, 10)} 00:00:00`;
  }
  return result;
}

function totalInteractionDelta(item) {
  return (item.video_like_delta || 0) + (item.video_comment_delta || 0) + (item.video_favorite_delta || 0);
}

function signedNumber(value) {
  if (value == null) return "-";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatNumber(value)}`;
}

function formatNumber(value) {
  if (value == null) return "-";
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatNullable(value) {
  return value == null ? "-" : formatNumber(value);
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function formatShortDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("zh-CN");
}

createRoot(document.getElementById("root")).render(<App />);
