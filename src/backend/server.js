import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDatabase, getDbPath } from "./db/database.js";
import {
  clearAccountCaptureData,
  createAccount,
  deleteAccount,
  getOverview,
  listAccountDashboardRows,
  listHotVideos,
  listTopLikedVideos,
  listAccounts,
  listCaptureJobs,
  listPlatforms,
  listDailyChanges,
  listVideos,
  listWeeklySummaries,
  exportDailyChangesCsv,
  exportDailyChangesExcel,
  exportVideosCsv,
  exportVideosExcel,
  failInterruptedCaptureJobs,
  updateAccount
} from "./services/repository.js";
import { enqueueAndStart, runDueCaptures } from "./services/captureRunner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");

initDatabase();
const interruptedJobs = failInterruptedCaptureJobs();
if (interruptedJobs) console.log(`[startup] closed ${interruptedJobs} interrupted capture job(s)`);

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, dbPath: getDbPath() });
});

app.get("/api/platforms", (req, res) => {
  res.json(listPlatforms());
});

app.get("/api/overview", (req, res) => {
  res.json(getOverview());
});

app.get("/api/accounts", (req, res) => {
  res.json(listAccounts(req.query));
});

app.get("/api/accounts/dashboard", (req, res) => {
  res.json(listAccountDashboardRows());
});

app.post("/api/accounts", (req, res, next) => {
  try {
    res.status(201).json(createAccount(req.body));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/accounts/:id", (req, res, next) => {
  try {
    res.json(updateAccount(Number(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/accounts/:id", (req, res, next) => {
  try {
    res.json(deleteAccount(Number(req.params.id)));
  } catch (error) {
    next(error);
  }
});

app.post("/api/accounts/:id/clear-data", (req, res, next) => {
  try {
    res.json(clearAccountCaptureData(Number(req.params.id)));
  } catch (error) {
    next(error);
  }
});

app.post("/api/accounts/:id/capture", async (req, res, next) => {
  try {
    const job = enqueueAndStart(Number(req.params.id), "manual_now");
    res.json(job);
  } catch (error) {
    next(error);
  }
});

app.post("/api/scheduler/run-due", async (req, res, next) => {
  try {
    const jobs = await runDueCaptures();
    res.json({ queued: jobs.length, jobs });
  } catch (error) {
    next(error);
  }
});

app.get("/api/jobs", (req, res) => {
  res.json(listCaptureJobs());
});

app.get("/api/videos", (req, res) => {
  res.json(listVideos(req.query));
});

app.get("/api/hot-videos", (req, res) => {
  res.json(listHotVideos(req.query.limit));
});

app.get("/api/videos/top-liked", (req, res) => {
  res.json(listTopLikedVideos(req.query.limit));
});

app.get("/api/videos/export.csv", (req, res) => {
  const csv = exportVideosCsv(req.query);
  const fileName = `videos-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.send(csv);
});

app.get("/api/videos/export.xls", (req, res) => {
  const html = exportVideosExcel(req.query);
  const fileName = `videos-${new Date().toISOString().slice(0, 10)}.xls`;
  res.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.send(html);
});

app.get("/api/weekly-summaries", (req, res) => {
  res.json(listWeeklySummaries());
});

app.get("/api/daily-changes", (req, res) => {
  res.json(listDailyChanges(req.query));
});

app.get("/api/daily-changes/export.csv", (req, res) => {
  const csv = exportDailyChangesCsv(req.query);
  const fileName = `daily-changes-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.send(csv);
});

app.get("/api/daily-changes/export.xls", (req, res) => {
  const html = exportDailyChangesExcel(req.query);
  const fileName = `daily-changes-${new Date().toISOString().slice(0, 10)}.xls`;
  res.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.send(html);
});

const distDir = path.join(rootDir, "dist");
app.use(express.static(distDir));
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(400).json({ error: error.message || "请求失败" });
});

const port = Number(process.env.API_PORT || process.env.BACKEND_PORT || 8102);
const host = process.env.API_HOST || process.env.BACKEND_HOST || "0.0.0.0";
app.listen(port, host, () => {
  console.log(`API server listening at http://${host}:${port}`);
  startLocalScheduler();
});

function startLocalScheduler() {
  const intervalMs = Number(process.env.SCHEDULER_INTERVAL_MS || 60 * 60 * 1000);
  const run = async () => {
    try {
      const jobs = await runDueCaptures();
      if (jobs.length) console.log(`[scheduler] finished ${jobs.length} due capture job(s)`);
    } catch (error) {
      console.error("[scheduler] failed", error);
    }
  };

  setTimeout(run, 10 * 1000);
  setInterval(run, intervalMs);
}
