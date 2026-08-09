import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip
} from "chart.js";
import { Line } from "react-chartjs-2";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarClock,
  CircleAlert,
  Database,
  Download,
  FileClock,
  Filter,
  ListVideo,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  Trash2,
  TrendingUp,
  Users
} from "lucide-react";
import { api } from "./api/client.js";
import "./styles.css";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

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
  const [accountDashboardRows, setAccountDashboardRows] = useState([]);
  const [overview, setOverview] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [videos, setVideos] = useState([]);
  const [hotVideos, setHotVideos] = useState([]);
  const [topLikedVideos, setTopLikedVideos] = useState([]);
  const [dailyChanges, setDailyChanges] = useState([]);
  const [weekly, setWeekly] = useState([]);
  const [health, setHealth] = useState(null);
  const [browserCache, setBrowserCache] = useState(null);
  const [cacheCleaning, setCacheCleaning] = useState(false);
  const [cacheMessage, setCacheMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [captureId, setCaptureId] = useState(null);
  const [videoFilters, setVideoFilters] = useState({ account_id: "", range: "all", limit: "120" });
  const [dailyFilters, setDailyFilters] = useState({ account_id: "", limit: "120" });
  const [hotFilters, setHotFilters] = useState({ range: "3", customMonths: "3" });
  const hotRequestIdRef = useRef(0);

  const resolvedVideoFilters = useMemo(() => resolveVideoFilters(videoFilters), [videoFilters]);
  const resolvedHotFilters = useMemo(() => resolveHotVideoFilters(hotFilters), [hotFilters]);
  const latestDataTime = useMemo(
    () => getLatestDataTime([...jobs, ...accountDashboardRows, ...topLikedVideos, ...dailyChanges]),
    [jobs, accountDashboardRows, topLikedVideos, dailyChanges]
  );

  async function refresh({
    videoQuery = resolvedVideoFilters,
    dailyQuery = dailyFilters,
    hotQuery = resolvedHotFilters
  } = {}) {
    const hotRequestId = ++hotRequestIdRef.current;
    setLoading(true);
    setError("");
    try {
      const [healthData, overviewData, accountsData, accountRowsData, jobsData, videosData, hotData, topLikedData, dailyData, weeklyData] = await Promise.all([
        api.health(),
        api.overview(),
        api.accounts(),
        api.accountDashboardRows(),
        api.jobs(),
        api.videos(videoQuery),
        api.hotVideos(hotQuery),
        api.topLikedVideos({ limit: 5 }),
        api.dailyChanges(dailyQuery),
        api.weekly()
      ]);
      setHealth(healthData);
      setOverview(overviewData);
      setAccounts(accountsData);
      setAccountDashboardRows(accountRowsData);
      setJobs(jobsData);
      setVideos(videosData);
      if (hotRequestId === hotRequestIdRef.current) setHotVideos(hotData);
      setTopLikedVideos(topLikedData);
      setDailyChanges(dailyData);
      setWeekly(weeklyData);
    } catch (err) {
      if (hotRequestId === hotRequestIdRef.current) setError(err.message);
    } finally {
      if (hotRequestId === hotRequestIdRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (active !== "settings") return;
    api.browserCacheStatus().then(setBrowserCache).catch((err) => setError(err.message));
  }, [active]);

  async function applyVideoFilters(nextFilters) {
    setVideoFilters(nextFilters);
    await refresh({ videoQuery: resolveVideoFilters(nextFilters) });
  }

  async function applyDailyFilters(nextFilters) {
    setDailyFilters(nextFilters);
    await refresh({ dailyQuery: nextFilters });
  }

  async function applyHotFilters(nextFilters) {
    const hotRequestId = ++hotRequestIdRef.current;
    setLoading(true);
    setError("");
    try {
      const nextVideos = await api.hotVideos(resolveHotVideoFilters(nextFilters));
      if (hotRequestId === hotRequestIdRef.current) {
        setHotVideos(nextVideos);
        setHotFilters(nextFilters);
      }
    } catch (err) {
      if (hotRequestId === hotRequestIdRef.current) setError(err.message);
    } finally {
      if (hotRequestId === hotRequestIdRef.current) setLoading(false);
    }
  }

  async function handleCapture(accountId) {
    setCaptureId(accountId);
    setError("");
    try {
      await api.captureAccount(accountId);
      await refresh();
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
      await refresh();
      setActive("accounts");
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleUpdateAccount(id, payload) {
    setError("");
    try {
      const updatedAccount = await api.updateAccount(id, payload);
      setAccounts((current) => current.map((account) => {
        if (account.id !== id) return account;
        const savedFields = Object.fromEntries(
          Object.keys(payload).map((field) => [field, updatedAccount?.[field] ?? payload[field]])
        );
        return { ...account, ...savedFields };
      }));
      return updatedAccount;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }

  async function handleDeleteAccount(account) {
    const confirmed = window.confirm(`确认删除「${account.display_name}」吗？删除后该账号不再自动采集，历史数据会保留。`);
    if (!confirmed) return;

    setError("");
    try {
      await api.deleteAccount(account.id);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleClearAccountData(account) {
    const confirmed = window.confirm(
      `确认清空「${account.display_name}」的历史采集数据吗？账号不会删除，自动采集设置会保留，清空后需要重新采集才会产生新数据。`
    );
    if (!confirmed) return;

    setError("");
    try {
      await api.clearAccountData(account.id);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCleanBrowserCache() {
    const reclaimable = formatBytes(browserCache?.reclaimableBytes || 0);
    const confirmed = window.confirm(
      `将清理约 ${reclaimable} 的网页、代码和图形缓存。不会删除登录状态、Cookie、采集数据和数据库。是否继续？`
    );
    if (!confirmed) return;

    setCacheCleaning(true);
    setCacheMessage("");
    setError("");
    try {
      const result = await api.cleanBrowserCache();
      setCacheMessage(
        result.success
          ? `清理完成，已释放 ${formatBytes(result.releasedBytes)}。登录状态和采集数据均已保留。`
          : `已释放 ${formatBytes(result.releasedBytes)}，但有 ${result.failedPaths.length} 个缓存项被占用，请关闭采集窗口后重试。`
      );
      setBrowserCache(await api.browserCacheStatus());
    } catch (err) {
      setError(err.message);
    } finally {
      setCacheCleaning(false);
    }
  }

  const stats = useMemo(() => {
    const totals = overview?.totals || {};
    const jobStats = overview?.jobs || {};
    const weeklyTotals = overview?.weeklyTotals || { followers: 0, interactions: 0 };

    return [
      { label: "观察账号", value: totals.active_count || 0, hint: `总计 ${totals.account_count || 0}`, icon: Users },
      { label: "本周采集", value: jobStats.total || 0, hint: `${jobStats.success || 0} 成功`, icon: Database },
      { label: "采集失败", value: totals.failed_count || 0, hint: "需人工查看", icon: CircleAlert },
      { label: "粉丝新增", value: formatNumber(weeklyTotals.followers), hint: "本周汇总", icon: TrendingUp },
      { label: "互动新增", value: formatNumber(weeklyTotals.interactions), hint: "赞评藏合计", icon: Activity }
    ];
  }, [overview]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
          <div className="brand-copy">
            <strong>润美居空间设计</strong>
            <span>对标账号监控</span>
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
          <div>
            <strong>数据合规采集</strong>
            <span>只采集公开可见数据；遇到登录、验证码或权限限制即停止。</span>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>对标账号监控</h1>
            <p>定时采集抖音、视频号公开指标，按天和按周查看变化。</p>
          </div>
          <div className="topbar-actions">
            <div className="topbar-meta" title="数据更新时间来自最近采集、账号或视频记录">
              <span>{formatShortDate(new Date())}</span>
              <em>更新 {formatDate(latestDataTime)}</em>
            </div>
            <button className="ghost-button" onClick={() => refresh()} disabled={loading}>
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

        <section className="stats-grid" aria-label="数据概览">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
            <div className="stat-card" key={stat.label}>
              <div className="stat-icon"><Icon size={20} /></div>
              <div className="stat-content">
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
                <em>{stat.hint}</em>
              </div>
            </div>
            );
          })}
        </section>

        {active === "overview" && (
          <Overview
            accounts={accountDashboardRows}
            jobs={jobs}
            dailyChanges={dailyChanges}
            topLikedVideos={topLikedVideos}
            health={health}
            onGo={setActive}
          />
        )}
        {active === "accounts" && (
          <Accounts
            accounts={accounts}
            onCapture={handleCapture}
            onUpdate={handleUpdateAccount}
            onDelete={handleDeleteAccount}
            onClearData={handleClearAccountData}
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
        {active === "hot" && (
          <HotVideos videos={hotVideos} filters={hotFilters} onApplyFilters={applyHotFilters} />
        )}
        {active === "jobs" && <Jobs jobs={jobs} />}
        {active === "weekly" && <Weekly weekly={weekly} accounts={accounts} />}
        {active === "settings" && (
          <SettingsPanel
            health={health}
            browserCache={browserCache}
            cacheCleaning={cacheCleaning}
            cacheMessage={cacheMessage}
            onCleanBrowserCache={handleCleanBrowserCache}
          />
        )}
      </main>

      {showForm && <AccountForm onClose={() => setShowForm(false)} onSubmit={handleCreateAccount} />}
    </div>
  );
}

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 52 52" role="img" aria-label="润美居空间设计标志">
      <path className="brand-frame" d="M9 43V16L19 7h20v20" />
      <path className="brand-door" d="M20 43V8" />
      <path className="brand-chart" d="m17 37 8-8 6 5 12-13" />
      <path className="brand-arrow" d="M37 21h6v6" />
      <path className="brand-base" d="M8 44h32" />
    </svg>
  );
}

function Overview({ accounts, jobs, dailyChanges, topLikedVideos, health, onGo }) {
  const [trendAccountId, setTrendAccountId] = useState("");
  const trendRows = useMemo(() => buildSevenDayTrend(dailyChanges, trendAccountId), [dailyChanges, trendAccountId]);
  const systemItems = useMemo(() => buildSystemItems({ health, jobs, accounts, dailyChanges, topLikedVideos }), [health, jobs, accounts, dailyChanges, topLikedVideos]);
  const trendAccount = accounts.find((account) => String(account.id) === String(trendAccountId));

  return (
    <div className="overview-layout">
      <div className="overview-main-column">
        <section className="panel dashboard-account-panel">
          <PanelHeader title="对标账号监控" icon={Users} action={<button className="primary-button compact" onClick={() => onGo("accounts")}><Plus size={14} />添加账号</button>} />
          <DashboardAccountTable accounts={accounts} onGo={onGo} />
        </section>

        <section className="panel trend-panel">
          <PanelHeader title="周度数据趋势（最近 7 天）" icon={TrendingUp} />
          <div className="trend-filter-row">
            <div className="inline-select-control">
              <AccountFilter accounts={accounts} value={trendAccountId} onChange={setTrendAccountId} />
            </div>
            <span className="filter-summary">
              {trendAccount ? `正在查看：${trendAccount.display_name}` : `全部账号汇总：${accounts.length} 个`}
            </span>
          </div>
          <TrendChart rows={trendRows} />
        </section>
      </div>

      <aside className="overview-side-column">
        <section className="panel compact-panel">
          <PanelHeader title="最近采集活动" icon={FileClock} action={<button className="link-button" onClick={() => onGo("jobs")}>查看全部</button>} />
          <CaptureActivityList jobs={jobs} />
        </section>

        <section className="panel compact-panel">
          <PanelHeader title="系统状态" icon={ShieldCheck} />
          <SystemStatusGrid items={systemItems} />
        </section>

        <section className="panel compact-panel">
          <PanelHeader title="爆款视频 TOP5" icon={Activity} action={<button className="link-button" onClick={() => onGo("videos")}>查看全部</button>} />
          <TopLikedVideoTable videos={topLikedVideos} />
        </section>
      </aside>
    </div>
  );
}

function DashboardAccountTable({ accounts, onGo }) {
  return (
    <div className="table-wrap dashboard-table-wrap">
      <table className="dashboard-account-table">
        <thead>
          <tr>
            <th>账号信息</th>
            <th>平台</th>
            <th>粉丝数</th>
            <th>视频数</th>
            <th>近 7 日作品</th>
            <th>自动频率</th>
            <th>状态</th>
            <th>最近采集</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {accounts.slice(0, 8).map((account) => (
            <tr key={account.id}>
              <td>
                <div className="cell-title">
                  <strong>{account.display_name}</strong>
                  <span>{account.category || "未分类"}</span>
                </div>
              </td>
              <td><Badge>{account.platform_name}</Badge></td>
              <td>{formatMetric(account.latest_follower_count, account.latest_follower_count == null ? "平台未公开" : "--")}</td>
              <td>{formatNumber(account.video_count || 0)}</td>
              <td>{formatNumber(account.recent_video_count || 0)}</td>
              <td>{frequencyLabels[account.capture_frequency] || account.capture_frequency}</td>
              <td><StatusPill status={account.latest_collect_status} /></td>
              <td>{formatDate(account.last_captured_at)}</td>
              <td><button className="link-button" onClick={() => onGo("accounts")}>查看</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {accounts.length === 0 && <Empty text="暂无观察账号，请先新增对标账号。" />}
    </div>
  );
}

function CaptureActivityList({ jobs }) {
  return (
    <div className="timeline compact-timeline">
      {jobs.slice(0, 5).map((job) => (
        <div className="timeline-item" key={job.id}>
          <StatusDot status={job.status} />
          <div>
            <strong>{job.display_name}</strong>
            <span>{statusLabels[job.status] || job.status} · {formatDate(job.finished_at || job.started_at || job.created_at)}</span>
          </div>
        </div>
      ))}
      {jobs.length === 0 && <Empty text="暂无采集任务" />}
    </div>
  );
}

function SystemStatusGrid({ items }) {
  return (
    <div className="system-status-grid">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div className="system-status-item" key={item.label}>
            <Icon size={18} />
            <span>{item.label}</span>
            <strong className={item.tone || "ok"}>{item.value}</strong>
          </div>
        );
      })}
    </div>
  );
}

function TopLikedVideoTable({ videos }) {
  return (
    <div className="top-video-list">
      {videos.slice(0, 5).map((video) => (
        <div className="top-video-row" key={video.id}>
          <a className="compact-title" href={video.video_url} target="_blank" rel="noreferrer" title={video.title || video.video_url}>
            {video.title || "未命名视频"}
          </a>
          <span className="top-video-account">{video.account_name}</span>
          <div className="top-video-metrics">
            <span>赞 {formatMetric(video.like_count)}</span>
            <span>评 {formatMetric(video.comment_count)}</span>
            <span>藏 {formatMetric(video.favorite_count)}</span>
          </div>
        </div>
      ))}
      {videos.length === 0 && <Empty text="暂无可排行视频数据。" />}
    </div>
  );
}

function TrendChart({ rows }) {
  const missingDays = rows.filter((row) => row.likes == null && row.interactions == null).map((row) => row.label);
  const data = {
    labels: rows.map((row) => row.label),
    datasets: [
      {
        label: "点赞变化",
        data: rows.map((row) => row.likes),
        borderColor: "#c99252",
        backgroundColor: "#c99252",
        tension: 0.28,
        spanGaps: true,
        segment: { borderDash: dashAcrossMissingDays }
      },
      {
        label: "互动变化",
        data: rows.map((row) => row.interactions),
        borderColor: "#66736e",
        backgroundColor: "#66736e",
        tension: 0.28,
        spanGaps: true,
        segment: { borderDash: dashAcrossMissingDays }
      }
    ]
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "top", align: "start", labels: { boxWidth: 20, usePointStyle: true } },
      tooltip: { mode: "index", intersect: false }
    },
    scales: {
      x: { grid: { display: false } },
      y: { beginAtZero: true, ticks: { precision: 0 } }
    },
    elements: { point: { radius: 3, hoverRadius: 5 }, line: { borderWidth: 2 } }
  };

  return (
    <div className="trend-chart-box">
      <Line data={data} options={options} />
      {missingDays.length > 0 && (
        <p className="trend-chart-note">
          <span className="trend-chart-dash" aria-hidden="true" />
          虚线表示中间有数据缺失，未将缺失日期计入日变化：{missingDays.join("、")}
        </p>
      )}
    </div>
  );
}

function dashAcrossMissingDays(context) {
  return context.p1DataIndex - context.p0DataIndex > 1 ? [6, 4] : undefined;
}

function Accounts({ accounts, onCapture, onUpdate, onDelete, onClearData, captureId }) {
  return (
    <section className="panel">
      <PanelHeader title="对标账号管理" icon={Users} />
      <AccountTable accounts={accounts} onCapture={onCapture} onUpdate={onUpdate} onDelete={onDelete} onClearData={onClearData} captureId={captureId} />
    </section>
  );
}

function AccountTable({ accounts, onCapture, onUpdate, onDelete, onClearData, captureId }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>账号</th>
            <th>平台</th>
            <th>自动频率</th>
            <th>更新时间</th>
            <th>更新条数</th>
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
              <AccountSettingsControls account={account} onUpdate={onUpdate} />
              <td>{formatNullable(account.latest_follower_count)}</td>
              <td><StatusPill status={account.latest_collect_status} /></td>
              <td>{formatDate(account.last_captured_at)}</td>
              <td>
                <div className="row-actions">
                  <button className="small-button" onClick={() => onCapture(account.id)} disabled={captureId === account.id}>
                    <RefreshCw size={14} />
                    {captureId === account.id ? "采集中" : "立即更新"}
                  </button>
                  <button
                    className="small-button warning-button"
                    onClick={() => onClearData(account)}
                    title="清空历史采集数据，保留账号和采集设置"
                    aria-label={`清空账号 ${account.display_name} 的历史采集数据`}
                  >
                    <Database size={14} />
                    清空数据
                  </button>
                  <button
                    className="small-button danger-button"
                    onClick={() => onDelete(account)}
                    title="删除账号"
                    aria-label={`删除账号 ${account.display_name}`}
                  >
                    <Trash2 size={14} />
                    删除
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {accounts.length === 0 && <Empty text="还没有账号，先新增一个对标账号。" />}
    </div>
  );
}

const AccountSettingsControls = React.memo(function AccountSettingsControls({ account, onUpdate }) {
  const [draft, setDraft] = useState({});

  function updateDraft(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function clearDraft(field, expectedValue) {
    setDraft((current) => {
      if (String(current[field]) !== String(expectedValue)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function persistField(field, value, fallback) {
    if (String(value) === String(account[field] ?? fallback)) {
      clearDraft(field, value);
      return;
    }
    try {
      await onUpdate(account.id, { [field]: value });
    } catch {
      // App-level handler displays the save error.
    } finally {
      clearDraft(field, value);
    }
  }

  function changeFrequency(event) {
    const value = event.target.value;
    updateDraft("capture_frequency", value);
    void persistField("capture_frequency", value, "daily");
  }

  function commitCaptureTime() {
    const value = draft.preferred_capture_time ?? account.preferred_capture_time ?? "09:00";
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      clearDraft("preferred_capture_time", value);
      return;
    }
    void persistField("preferred_capture_time", value, "09:00");
  }

  function commitVideoLimit() {
    const rawValue = draft.capture_video_limit ?? account.capture_video_limit ?? 10;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      clearDraft("capture_video_limit", rawValue);
      return;
    }
    const value = Math.min(100, Math.max(1, Math.round(parsed)));
    updateDraft("capture_video_limit", String(value));
    void persistField("capture_video_limit", value, 10);
  }

  function commitLikeThreshold() {
    const rawValue = draft.like_alert_threshold ?? account.like_alert_threshold ?? 0;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      clearDraft("like_alert_threshold", rawValue);
      return;
    }
    const value = Math.max(0, Math.round(parsed));
    updateDraft("like_alert_threshold", String(value));
    void persistField("like_alert_threshold", value, 0);
  }

  function blurOnEnter(event) {
    if (event.key === "Enter") event.currentTarget.blur();
  }

  const frequency = draft.capture_frequency ?? account.capture_frequency ?? "daily";

  return (
    <>
      <td>
        <select className="table-control" value={frequency} onChange={changeFrequency}>
          <FrequencyOptions />
        </select>
      </td>
      <td>
        <input
          className="table-control"
          type="time"
          value={draft.preferred_capture_time ?? account.preferred_capture_time ?? "09:00"}
          disabled={!["daily", "weekly"].includes(frequency)}
          onChange={(event) => updateDraft("preferred_capture_time", event.target.value)}
          onBlur={commitCaptureTime}
          onKeyDown={blurOnEnter}
        />
      </td>
      <td>
        <input
          className="table-control compact-number"
          type="number"
          min="1"
          max="100"
          step="1"
          value={draft.capture_video_limit ?? String(account.capture_video_limit ?? 10)}
          onChange={(event) => updateDraft("capture_video_limit", event.target.value)}
          onBlur={commitVideoLimit}
          onKeyDown={blurOnEnter}
        />
      </td>
      <td>
        <input
          className="table-control"
          type="number"
          min="0"
          step="1"
          value={draft.like_alert_threshold ?? String(account.like_alert_threshold ?? 0)}
          onChange={(event) => updateDraft("like_alert_threshold", event.target.value)}
          onBlur={commitLikeThreshold}
          onKeyDown={blurOnEnter}
        />
      </td>
    </>
  );
});

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
      <table className="video-data-table">
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
              <td className="video-title-cell">
                <a className="video-title-link" title={video.title || video.video_url} href={video.video_url} target="_blank" rel="noreferrer">
                  {video.title || video.video_url}
                </a>
              </td>
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

function HotVideos({ videos, filters, onApplyFilters }) {
  const [draft, setDraft] = useState(filters);
  useEffect(() => setDraft(filters), [filters]);

  function updateRange(range) {
    const next = { ...draft, range };
    setDraft(next);
    if (range !== "custom") onApplyFilters(next);
  }

  function submitFilters(event) {
    event.preventDefault();
    onApplyFilters(draft);
  }

  return (
    <section className="panel">
      <PanelHeader title="爆款视频" icon={Activity} />
      <form className="filter-bar hot-video-filter" onSubmit={submitFilters}>
        <label>
          发布时间
          <select value={draft.range} onChange={(event) => updateRange(event.target.value)}>
            <option value="1">近 1 个月</option>
            <option value="3">近 3 个月</option>
            <option value="6">近 6 个月</option>
            <option value="12">近 12 个月</option>
            <option value="custom">自定义近几个月</option>
            <option value="all">全部时间</option>
          </select>
        </label>
        {draft.range === "custom" && (
          <label>
            近几个月
            <span className="month-input-wrap">
              <input
                type="number"
                min="1"
                max="120"
                step="1"
                required
                value={draft.customMonths}
                onChange={(event) => setDraft({ ...draft, customMonths: event.target.value })}
              />
              <span>个月</span>
            </span>
          </label>
        )}
        <div className="filter-summary">当前显示 {videos.length} 条 · {hotVideoRangeLabel(filters)}</div>
        {draft.range === "custom" && (
          <div className="filter-actions">
            <button className="small-button" type="submit"><Filter size={14} />应用时间范围</button>
          </div>
        )}
      </form>
      <div className="result-note">仅显示所选发布时间内，最新点赞数达到账号“点赞预警线”的视频。预警线为 0 表示不启用。</div>
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
        {videos.length === 0 && <Empty text={`在${hotVideoRangeLabel(filters)}内，暂无超过点赞预警线的视频。`} />}
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

function Weekly({ weekly, accounts }) {
  const [accountId, setAccountId] = useState("");
  const visibleWeekly = useMemo(
    () => (accountId ? weekly.filter((item) => String(item.account_id) === String(accountId)) : weekly),
    [weekly, accountId]
  );
  const selectedAccount = accounts.find((account) => String(account.id) === String(accountId));

  return (
    <section className="panel">
      <PanelHeader title="周汇总：本周 vs 上周" icon={CalendarClock} />
      <div className="filter-bar">
        <AccountFilter accounts={accounts} value={accountId} onChange={setAccountId} />
        <div className="filter-summary">
          {selectedAccount ? `正在查看：${selectedAccount.display_name}` : `全部账号：${accounts.length} 个`}
        </div>
      </div>
      <WeeklyTable weekly={visibleWeekly} />
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

function SettingsPanel({ health, browserCache, cacheCleaning, cacheMessage, onCleanBrowserCache }) {
  return (
    <div className="settings-stack">
      <section className="panel settings-panel">
        <PanelHeader title="设置与边界" icon={Database} />
        <div className="settings-grid">
          <div><span>数据库位置</span><strong>{health?.dbPath || "读取中"}</strong></div>
          <div><span>访问范围</span><strong>仅本机 localhost</strong></div>
          <div><span>自动采集</span><strong>本地服务启动后按账号设置时间自动采集</strong></div>
          <div><span>采集边界</span><strong>只采集公开可见聚合指标，不采集评论用户、粉丝列表、私信、视频文件</strong></div>
        </div>
      </section>

      <section className="panel">
        <PanelHeader title="浏览器缓存管理" icon={Database} />
        <div className="settings-grid cache-summary">
          <div><span>浏览器数据总占用</span><strong>{formatBytes(browserCache?.totalBytes)}</strong></div>
          <div><span>本次可安全清理</span><strong>{formatBytes(browserCache?.reclaimableBytes)}</strong></div>
          <div><span>登录数据</span><strong>保留 Cookie、登录状态和本地存储</strong></div>
        </div>
        <p className="cache-note">只清理网页、代码和图形缓存，不会删除数据库或账号历史数据。</p>
        <div className="cache-actions">
          <button
            className="primary-button"
            onClick={onCleanBrowserCache}
            disabled={cacheCleaning || browserCache?.captureRunning || !browserCache?.reclaimableBytes}
          >
            <Trash2 size={15} />
            {cacheCleaning ? "正在清理…" : "清理浏览器缓存"}
          </button>
          {browserCache?.captureRunning && <span className="cache-warning">当前有采集任务，结束后才能清理。</span>}
          {cacheMessage && <span className="cache-success">{cacheMessage}</span>}
        </div>
      </section>
    </div>
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
        <label>每次更新视频条数<input name="capture_video_limit" type="number" min="1" max="100" step="1" defaultValue="10" /></label>
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

function PanelHeader({ title, icon: Icon, action }) {
  return (
    <div className="panel-header">
      <div><Icon size={18} /><h2>{title}</h2></div>
      {action}
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

function formatMetric(value, fallback = "--") {
  return value == null ? fallback : formatNumber(value);
}

function buildSevenDayTrend(rows, accountId = "") {
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    return dateKey(date);
  });

  return days.map((day) => {
    const dayRows = rows.filter(
      (row) => row.day === day && (!accountId || String(row.account_id) === String(accountId))
    );
    return {
      day,
      label: day.slice(5),
      likes: aggregateDelta(dayRows, "like_delta"),
      interactions: aggregateInteractionDelta(dayRows)
    };
  });
}

function aggregateDelta(rows, key) {
  if (rows.length === 0) return null;
  const values = rows.map((row) => row[key]).filter((value) => value != null);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

function aggregateInteractionDelta(rows) {
  if (rows.length === 0) return null;
  const values = rows.map((row) => {
    const parts = [row.comment_delta, row.favorite_delta].filter((value) => value != null);
    return parts.length ? parts.reduce((sum, value) => sum + value, 0) : null;
  }).filter((value) => value != null);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

function buildSystemItems({ health, jobs, accounts, dailyChanges, topLikedVideos }) {
  const pendingCount = jobs.filter((job) => job.status === "pending").length;
  const runningCount = jobs.filter((job) => job.status === "running").length;
  const latestTime = getLatestDataTime([...jobs, ...accounts, ...dailyChanges, ...topLikedVideos]);

  return [
    { label: "API 服务", value: health?.ok ? "正常" : "异常", tone: health?.ok ? "ok" : "bad", icon: ShieldCheck },
    { label: "数据更新时间", value: formatDate(latestTime), tone: latestTime ? "ok" : "warn", icon: Database },
    { label: "待处理任务", value: `${pendingCount} 个`, tone: pendingCount ? "warn" : "ok", icon: FileClock },
    { label: "当前采集", value: runningCount ? "执行中" : "空闲", tone: runningCount ? "warn" : "ok", icon: Activity }
  ];
}

function getLatestDataTime(items) {
  const fields = ["finished_at", "started_at", "last_captured_at", "captured_at", "updated_at", "created_at"];
  const times = items.flatMap((item) => fields.map((field) => item?.[field]).filter(Boolean))
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  if (times.length === 0) return null;
  return new Date(Math.max(...times)).toISOString();
}

function dateKey(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function resolveHotVideoFilters(filters) {
  if (filters.range === "all") return { months: "all" };
  if (filters.range === "custom") {
    const months = Math.min(Math.max(Math.floor(Number(filters.customMonths) || 3), 1), 120);
    return { months: String(months) };
  }
  return { months: filters.range || "3" };
}

function hotVideoRangeLabel(filters) {
  if (filters.range === "all") return "全部时间";
  const months = filters.range === "custom" ? resolveHotVideoFilters(filters).months : filters.range;
  return `近 ${months || 3} 个月`;
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

function formatBytes(value) {
  if (value == null) return "读取中";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 100 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
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
