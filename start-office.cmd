@echo off
if not exist "%~dp0data" mkdir "%~dp0data"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-office.ps1"
