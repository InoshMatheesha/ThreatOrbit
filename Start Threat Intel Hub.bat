@echo off
setlocal EnableExtensions
title Threat Intel Hub
cd /d "%~dp0"

rem The UI and API are served together on this port (loopback only).
set "APP_PORT=4000"
set "PORT=%APP_PORT%"
set "APP_URL=http://127.0.0.1:%APP_PORT%"

echo.
echo   Threat Intel Hub
echo   ================
echo.

rem --- 1. Node.js -----------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo   [!] Node.js is not installed.
  echo       Install the LTS version from https://nodejs.org, then run this file again.
  start "" "https://nodejs.org/en/download"
  goto :fail
)
for /f "tokens=1 delims=v." %%v in ('node -v') do set "NODE_MAJOR=%%v"
if %NODE_MAJOR% LSS 20 (
  echo   [!] Node.js 20 or newer is required. You have:
  node -v
  goto :fail
)

rem --- 2. Already running? Just open the browser ---------------------------
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 '%APP_URL%/api/health' | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 (
  echo   Already running. Opening %APP_URL%
  start "" "%APP_URL%"
  exit /b 0
)

rem --- 3. First run: API keys -> backend\.env (gitignored, stays on this PC) -
if not exist "backend\.env" (
  call :setup_env
  if errorlevel 1 goto :fail
)

rem --- 4. Install, build, start ----------------------------------------------
echo   [1/3] Installing dependencies (the first run takes a minute)...
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 goto :fail

echo   [2/3] Building...
call npm run build --silent
if errorlevel 1 goto :fail

echo   [3/3] Starting on %APP_URL%
echo.
echo   The browser opens automatically once the server is ready.
echo   Keep this window open. Close it (or press Ctrl+C) to stop the app.
echo.
start "" /b powershell -NoProfile -Command "for ($i = 0; $i -lt 60; $i++) { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 '%APP_URL%/api/health' | Out-Null; Start-Process '%APP_URL%'; break } catch { Start-Sleep -Seconds 1 } }"
call npm start
exit /b %errorlevel%


:setup_env
echo   First run: add your threat intel API keys.
echo   They are saved only to backend\.env on this PC and are never committed to git.
echo   Press Enter to skip a provider; it will show as "unconfigured".
echo.
set "TIH_VIRUSTOTAL_API_KEY="
set "TIH_ABUSEIPDB_API_KEY="
set "TIH_OTX_API_KEY="
set "TIH_URLHAUS_AUTH_KEY="
set "TIH_GREYNOISE_API_KEY="
set /p "TIH_VIRUSTOTAL_API_KEY=  VirusTotal API key        : "
set /p "TIH_ABUSEIPDB_API_KEY=  AbuseIPDB API key         : "
set /p "TIH_OTX_API_KEY=  AlienVault OTX API key    : "
set /p "TIH_URLHAUS_AUTH_KEY=  URLhaus (abuse.ch) key    : "
set /p "TIH_GREYNOISE_API_KEY=  GreyNoise Community key   : "
echo.
copy /y "backend\.env.example" "backend\.env" >nul
if errorlevel 1 exit /b 1
powershell -NoProfile -Command "$p = 'backend\.env'; $c = Get-Content -Raw $p; foreach ($k in 'VIRUSTOTAL_API_KEY','ABUSEIPDB_API_KEY','OTX_API_KEY','URLHAUS_AUTH_KEY','GREYNOISE_API_KEY') { $v = [Environment]::GetEnvironmentVariable('TIH_' + $k); if ($v) { $c = $c -replace ('(?m)^' + $k + '=.*$'), ($k + '=' + $v.Trim()) } }; [IO.File]::WriteAllText((Resolve-Path $p), $c)"
if errorlevel 1 exit /b 1
echo   Saved backend\.env  (edit it any time to change keys)
echo.
exit /b 0


:fail
echo.
echo   [!] Something went wrong. Scroll up for the error message.
pause
exit /b 1
