@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install || goto :error
)
if not exist .env copy .env.example .env >nul
start "" http://localhost:3000
node server.js
pause
exit /b

:error
echo.
echo Setup failed. Make sure Node.js is installed: https://nodejs.org
pause
