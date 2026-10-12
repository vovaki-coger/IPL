@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo [ImperialsBot] Node.js not found. Install Node 18+ from https://nodejs.org/
    pause
    exit /b 1
)

if not exist node_modules (
    echo [ImperialsBot] Installing dependencies, this can take a few minutes...
    call npm install
    if errorlevel 1 (
        echo [ImperialsBot] npm install failed.
        pause
        exit /b 1
    )
)

start "" /b cmd /c "timeout /t 3 /nobreak >nul & start "" http://localhost:3000"

echo [ImperialsBot] Starting server on http://localhost:3000
echo [ImperialsBot] Press Ctrl+C to stop.
node index.js
pause