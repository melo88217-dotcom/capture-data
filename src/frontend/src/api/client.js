const jsonHeaders = { "Content-Type": "application/json" };

function withQuery(path, params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, value);
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

async function request(path, options = {}) {
  const response = await fetch(`/api${path}`, options);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "请求失败");
  return data;
}

export const api = {
  health: () => request("/health"),
  overview: () => request("/overview"),
  platforms: () => request("/platforms"),
  accounts: () => request("/accounts"),
  createAccount: (payload) =>
    request("/accounts", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload)
    }),
  updateAccount: (id, payload) =>
    request(`/accounts/${id}`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify(payload)
    }),
  captureAccount: (id) => request(`/accounts/${id}/capture`, { method: "POST" }),
  runDue: () => request("/scheduler/run-due", { method: "POST" }),
  jobs: () => request("/jobs"),
  videos: (filters = {}) => request(withQuery("/videos", filters)),
  hotVideos: () => request("/hot-videos"),
  videoExportUrl: (filters = {}) => `/api${withQuery("/videos/export.csv", filters)}`,
  videoExcelExportUrl: (filters = {}) => `/api${withQuery("/videos/export.xls", filters)}`,
  weekly: () => request("/weekly-summaries"),
  dailyChanges: (filters = {}) => request(withQuery("/daily-changes", filters)),
  dailyChangesExportUrl: (filters = {}) => `/api${withQuery("/daily-changes/export.csv", filters)}`,
  dailyChangesExcelExportUrl: (filters = {}) => `/api${withQuery("/daily-changes/export.xls", filters)}`
};
