@echo off
setlocal

echo Stopping local project server...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$project='D:\codex\capture data'; Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'node*' -and ($_.CommandLine -like '*capture data*' -or $_.CommandLine -like '*src/backend/server.js*' -or $_.CommandLine -like '*scripts/dev.mjs*' -or $_.CommandLine -like '*vite*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"

echo Stopped.
pause
