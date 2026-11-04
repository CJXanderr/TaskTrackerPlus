@echo off
setlocal
cd /d "%~dp0"
title Task Tracker+ - local test

where node >nul 2>nul
if errorlevel 1 goto :nonode
for /f "tokens=1 delims=." %%v in ('node -v') do set "NODE_MAJOR=%%v"
set "NODE_MAJOR=%NODE_MAJOR:v=%"
if %NODE_MAJOR% LSS 22 goto :oldnode

set "DEV_TOKEN="
if not exist "server\.env" goto :asktoken
node "%~dp0scripts\dev-token.cjs"
if not errorlevel 1 goto :install

:asktoken
echo.
echo Paste your Root DEV token and press Enter.
echo Get it in the Root Dev Portal: your app, Overview, Generate new dev token.
set "DEV_TOKEN="
set /p "DEV_TOKEN=Dev token: "
if not defined DEV_TOKEN goto :notoken
node "%~dp0scripts\dev-token.cjs"
if not errorlevel 1 goto :tokensaved
set "USE_ANYWAY="
set /p "USE_ANYWAY=Type Y to use it anyway, or press Enter to paste another one: "
if /i not "%USE_ANYWAY%"=="Y" goto :asktoken
node "%~dp0scripts\dev-token.cjs" --force

:tokensaved
set "DEV_TOKEN="

:install
echo.
echo Installing packages. The first time takes a few minutes...
call npm install --no-audit --no-fund
if errorlevel 1 goto :failed
echo.
echo Building...
call npm run build
if errorlevel 1 goto :failed

echo.
echo Starting the app server (DevHost) and the app client in two new windows.
start "Task Tracker+ server" /d "%~dp0server" cmd /k npm run server
timeout /t 5 /nobreak >nul
start "Task Tracker+ client" /d "%~dp0client" cmd /k npm run client
echo.
echo The app opens in your browser. Use the DevBar at the top to switch which member you are.
echo Close the two windows to stop testing.
echo.
pause
exit /b 0

:nonode
echo Node.js is not installed. Install version 22 or newer from https://nodejs.org and run this again.
echo.
pause
exit /b 1

:oldnode
echo Root needs Node.js 22 or newer. Update it from https://nodejs.org and run this again.
echo.
pause
exit /b 1

:notoken
echo No token entered.
echo.
pause
exit /b 1

:failed
echo.
echo Something went wrong. See the messages above.
echo.
pause
exit /b 1
