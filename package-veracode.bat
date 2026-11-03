@echo off
rem Builds cosec-veracode.zip for a Veracode static scan from the last commit. It
rem holds the app code and library lists only, so secrets, data and tests stay out.
cd /d "%~dp0"
git rev-parse HEAD >nul
if errorlevel 1 (
  echo Git could not read this folder. See the message above. This needs a Git checkout with Git installed.
  pause
  exit /b 1
)
if exist cosec-veracode.zip del /q cosec-veracode.zip
git archive --format=zip -o cosec-veracode.zip HEAD src scripts package.json package-lock.json next.config.ts tsconfig.json postcss.config.mjs ":(exclude)scripts/render_design.py"
if errorlevel 1 (
  if exist cosec-veracode.zip del /q cosec-veracode.zip
  echo The zip could not be created. See the message above.
  pause
  exit /b 1
)
echo.
echo Version in this zip:
git branch --show-current
git log -1 --format="%%h %%s"
echo.
echo Ready to upload to Veracode:
echo %CD%\cosec-veracode.zip
pause
