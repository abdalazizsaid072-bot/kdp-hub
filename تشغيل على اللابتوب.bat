@echo off
rem KDP Hub - quick local run on this laptop (keep this window open while using the app)
cd /d "%~dp0"
start "" http://localhost:8765
python -m http.server 8765
