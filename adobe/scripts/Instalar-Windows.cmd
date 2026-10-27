@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1"
if errorlevel 1 (echo Falha na instalacao. Leia a mensagem acima.) else (echo Instalacao concluida.)
pause
