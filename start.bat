@echo off
echo ============================================================
echo   GoPrint Sticker Printing ^& Packing System — Windows Launcher
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
        echo [WARNING] Migration had issues. Check your DATABASE_URL in .env
    )
    cd ..
)

echo.
echo [START] Starting GoPrint System...
echo [INFO]  App URL: http://localhost:3000
echo [INFO]  Press Ctrl+C to stop
echo.
cd backend
call npm start
pause
