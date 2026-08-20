@echo off
setlocal

echo Stopping local project server...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-dev.ps1"

echo Stopped.
pause
