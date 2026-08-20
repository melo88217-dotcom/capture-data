@echo off
setlocal

cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js / npm was not found. Please install Node.js first.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing project dependencies...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

if not exist ".env.development" (
  echo Missing .env.development. Allocate project ports in Local Project Launcher first.
  pause
  exit /b 1
)

set "FRONTEND_PORT="
for /f "usebackq tokens=1,* delims==" %%A in (".env.development") do (
  if /I "%%A"=="FRONTEND_PORT" set "FRONTEND_PORT=%%B"
)

if not defined FRONTEND_PORT (
  echo FRONTEND_PORT is missing from .env.development.
  pause
  exit /b 1
)

set "APP_URL=http://127.0.0.1:%FRONTEND_PORT%/"

echo Checking Playwright Chromium for this computer...
node scripts\ensure-playwright-browser.mjs
if errorlevel 1 (
  echo Playwright Chromium installation failed.
  echo Check the network, then run this launcher again.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -UseBasicParsing '%APP_URL%' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; exit 1"
if not errorlevel 1 (
  start "" "%APP_URL%"
  echo Site is already running. Opened %APP_URL%
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ip=(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '192.168.*' -or $_.IPAddress -like '10.*' -or $_.IPAddress -like '172.16.*' -or $_.IPAddress -like '172.17.*' -or $_.IPAddress -like '172.18.*' -or $_.IPAddress -like '172.19.*' -or $_.IPAddress -like '172.2?.*' -or $_.IPAddress -like '172.30.*' -or $_.IPAddress -like '172.31.*' } | Select-Object -First 1 -ExpandProperty IPAddress); if ($ip) { Write-Host ('Team access URL: http://' + $ip + ':%FRONTEND_PORT%/') }"
  exit /b 0
)

echo Starting local server...
start "Public Account Capture Server" cmd /k "cd /d ""%~dp0"" && npm run dev:safe"

echo Waiting for %APP_URL% ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline=(Get-Date).AddSeconds(40); do { try { $r=Invoke-WebRequest -UseBasicParsing '%APP_URL%' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; Start-Sleep -Seconds 1 } while ((Get-Date) -lt $deadline); exit 1"

if errorlevel 1 (
  echo The site did not respond in time.
  echo Keep the server window open, then visit:
  echo %APP_URL%
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ip=(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '192.168.*' -or $_.IPAddress -like '10.*' -or $_.IPAddress -like '172.16.*' -or $_.IPAddress -like '172.17.*' -or $_.IPAddress -like '172.18.*' -or $_.IPAddress -like '172.19.*' -or $_.IPAddress -like '172.2?.*' -or $_.IPAddress -like '172.30.*' -or $_.IPAddress -like '172.31.*' } | Select-Object -First 1 -ExpandProperty IPAddress); if ($ip) { Write-Host ('Team access URL: http://' + $ip + ':%FRONTEND_PORT%/') }"
start "" "%APP_URL%"
echo Opened %APP_URL%
exit /b 0
