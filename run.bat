@echo off
chcp 65001 >nul
cd /d "%~dp0"
node webapp\server.cjs
pause
