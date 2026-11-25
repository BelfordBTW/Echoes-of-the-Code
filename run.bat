@echo off
rem Echoes of the Code - starts a local web server and opens the game in the browser.
rem Close this window to stop the server.
setlocal
cd /d "%~dp0"
set PORT=8199
where python >nul 2>nul || (echo Python 3 not found. Install it from https://www.python.org and tick "Add to PATH". & pause & exit /b 1)
echo Game:  http://127.0.0.1:%PORT%/
echo Tests: http://127.0.0.1:%PORT%/tests/
echo Close this window to stop the server.
start "" "http://127.0.0.1:%PORT%/"
python -m http.server %PORT% --bind 127.0.0.1
