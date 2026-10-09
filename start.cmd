@echo off
setlocal
cd /d "%~dp0"
where rtk >nul 2>&1
if %errorlevel%==0 (
  rtk node server.js --port 4988
) else (
  node server.js --port 4988
)

