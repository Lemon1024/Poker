@echo off
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "%~dp0tests\android-start-emulator.ps1" -ShowWindow
if not errorlevel 1 exit /b 0
pause
exit /b 1
