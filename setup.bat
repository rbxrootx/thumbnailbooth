@echo off
REM ThumbnailBooth setup for Windows.
REM Double-click this file, or run it from a terminal. It installs
REM dependencies, builds the app, and starts it.
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo   ThumbnailBooth setup
echo   ====================
echo.

REM --- Node present? -------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo   [X] Node.js is not installed.
  echo.
  echo       Download the LTS version from https://nodejs.org
  echo       Run this file again once it is installed.
  echo.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if !NODE_MAJOR! LSS 20 (
  for /f %%v in ('node -p "process.versions.node"') do set NODE_FULL=%%v
  echo   [X] Node.js !NODE_FULL! is too old. Version 20 or newer is required.
  echo       Update at https://nodejs.org
  echo.
  pause
  exit /b 1
)

for /f %%v in ('node -p "process.versions.node"') do echo   [OK] Node.js %%v

REM --- Dependencies --------------------------------------------------------
echo   [..] Installing dependencies. First run takes a minute.
call npm install --no-fund --no-audit
if errorlevel 1 (
  echo.
  echo   [X] npm install failed. Scroll up for the reason.
  echo       If you are on a restricted network, a proxy or firewall is the usual cause.
  echo.
  pause
  exit /b 1
)
echo   [OK] Dependencies installed

REM --- Build ---------------------------------------------------------------
echo   [..] Building
call npm run build
if errorlevel 1 (
  echo.
  echo   [X] Build failed. Scroll up for the reason.
  echo.
  pause
  exit /b 1
)
echo   [OK] Built

REM --- Run -----------------------------------------------------------------
echo.
echo   Starting ThumbnailBooth. Close this window or press Ctrl+C to stop.
echo.
node bin\thumbnailbooth.js %*

REM Only reached if the server exits; keep the window open so the reason is readable.
if errorlevel 1 pause
endlocal
