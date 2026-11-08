@echo off
setlocal
title KOCmax local database backup v3
echo KOCmax backup v3 - verified TLS and native read-only backup tools
set "KOC_BACKUP_SHELL=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe"
if not exist "%KOC_BACKUP_SHELL%" (
  echo PowerShell 7 was not found. No database connection was opened.
  pause
  exit /b 1
)
"%KOC_BACKUP_SHELL%" -NoProfile -STA -File "%~dp0backup-shared-db.ps1" -GuiPrompt -UseStoredCredential
set "KOC_BACKUP_RESULT=%ERRORLEVEL%"
echo.
if "%KOC_BACKUP_RESULT%"=="0" (
  echo CAPTURE COMPLETE - archive restore verification is still required.
) else (
  echo BACKUP FAILED - no verified backup was created. Keep this window open.
)
echo No migration or deployment was performed.
pause
exit /b %KOC_BACKUP_RESULT%
