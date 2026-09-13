import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/frontend/src/main.jsx", import.meta.url), "utf8");

test("account setting edits do not refresh the whole application", () => {
  const handler = source.slice(
    source.indexOf("async function handleUpdateAccount"),
    source.indexOf("async function handleDeleteAccount")
  );

  assert.doesNotMatch(handler, /await refresh\(\)/);
  assert.match(handler, /setAccounts/);
});

test("time and numeric account settings save after editing instead of on every keystroke", () => {
  const table = source.slice(
    source.indexOf("function AccountTable"),
    source.indexOf("function Videos")
  );

  assert.match(table, /const AccountSettingsControls = React\.memo/);
  assert.match(table, /const \[draft, setDraft\] = useState/);
  assert.match(table, /onBlur=\{commitCaptureTime\}/);
  assert.match(table, /onBlur=\{commitVideoLimit\}/);
  assert.match(table, /onBlur=\{commitLikeThreshold\}/);
  assert.doesNotMatch(table, /onChange=\{\(event\) => onUpdate\(account\.id/);
});

test("dashboard labels locally collected works instead of implying the platform total", () => {
  const dashboard = source.slice(
    source.indexOf("function DashboardAccountTable"),
    source.indexOf("function TopLikedVideoTable")
  );

  assert.match(dashboard, />已采集作品<\/th>/);
  assert.match(dashboard, /不等于平台主页显示的总作品数/);
});
