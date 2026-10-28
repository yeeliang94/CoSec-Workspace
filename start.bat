@echo off
rem Starts CoSec on Windows. See scripts\start.mjs.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node 24 LTS from https://nodejs.org, then run this again.
  pause
  exit /b 1
)
node scripts\start.mjs
if errorlevel 1 pause
