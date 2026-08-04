@echo off
echo ============================================================
echo   GoPrint System — Firewall Configuration for Port 2026
echo ============================================================
echo.
echo Requesting administrator privileges to open port 2026 in Windows Firewall...
echo.

:: Check for administrative permissions
net session >nul 2>&1
if %errorLevel% == 0 (
    echo [OK] Admin privileges detected. Adding firewall rule...
    netsh advfirewall firewall delete rule name="GoPrint Sticker System (Port 2026)" >nul 2>&1
    netsh advfirewall firewall add rule name="GoPrint Sticker System (Port 2026)" dir=in action=allow protocol=TCP localport=2026
    if %errorLevel% == 0 (
        echo.
        echo [SUCCESS] Port 2026 is now open in Windows Firewall!
        echo Other computers on the network can now connect to http://192.168.166.45:2026
        echo.
    ) else (
        echo [ERROR] Failed to add firewall rule. Please run as Administrator.
    )
) else (
    echo [ERROR] Administrative privileges required.
    echo Please right-click this file and select "Run as administrator".
)

echo.
pause
