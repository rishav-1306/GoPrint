@echo off
title GoPrint Industrial Sticker Printing System (Port 2026)
echo ============================================================
echo   GoPrint Sticker Printing ^& Packing System — Production Server
echo ============================================================
echo.

:: Check if .env exists
if not exist "backend\.env" (
    echo [SETUP] .env file not found. Creating from template...
    copy "backend\.env.example" "backend\.env" >nul
)

:: Check if node_modules exists
if not exist "backend\node_modules" (
    echo [SETUP] Installing Node.js dependencies...
    cd backend
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed. Make sure Node.js is installed.
        pause
        exit /b 1
    )
    cd ..
    echo [SETUP] Running database migration...
    cd backend
    call npm run migrate
    if errorlevel 1 (
        echo [WARNING] Migration had issues.
    )
    cd ..
)

echo.
echo [START] Starting GoPrint Production Server on Port 2026...
echo [INFO]  Local Access:   http://localhost:2026
echo [INFO]  Plant Network:  http://192.168.166.45:2026
echo.
echo [NOTE]  If other devices cannot connect, right-click and run:
echo         "allow-firewall-port-2026.bat" as Administrator.
echo.
set NODE_ENV=production
set PORT=2026
cd backend
node src/server.js
pause
