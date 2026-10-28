@echo off
REM ============================================================
REM  PV-Sistema - old "prepare" step - REDIRECT
REM
REM  A separate preparation step is no longer needed: the current
REM  build desktop\csharp\build.bat checks the environment, copies
REM  the calc core and builds everything in one run.
REM  (Pure ASCII on purpose.)
REM ============================================================
echo.
echo  NOTE: desktop\prepare.bat is outdated (old Tauri build).
echo        A separate preparation step is no longer needed.
echo        Starting the current build: desktop\csharp\build.bat
echo.
call "%~dp0csharp\build.bat" %*
exit /b %errorlevel%
