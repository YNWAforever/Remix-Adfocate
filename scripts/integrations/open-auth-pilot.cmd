@echo off
setlocal
title KOCmax approved nine-account Auth pilot
set "KOC_AUTH_SHELL=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe"
if not exist "%KOC_AUTH_SHELL%" (
  echo The installed PowerShell 7 runtime was not found. No client started.
  pause
  exit /b 1
)
"%KOC_AUTH_SHELL%" -NoProfile -STA -File "%~dp0open-auth-pilot.ps1"
set "KOC_AUTH_RESULT=%ERRORLEVEL%"
echo.
echo The local helper stopped. No deployment or Instagram/Drive connection was made.
pause
exit /b %KOC_AUTH_RESULT%
