@echo off
REM ============================================================
REM  PV-Sistema desktop build - SHORTCUT
REM
REM  Starts the real build of PVS.exe:
REM      desktop\csharp\build.bat
REM  Instructions: desktop\csharp\BUILD.md
REM  All arguments are passed through (e.g. "noobf").
REM  (Pure ASCII on purpose - national characters turn into
REM  garbage in cmd.exe on some code pages.)
REM ============================================================
echo.
echo  Starting the build: desktop\csharp\build.bat
echo.
call "%~dp0csharp\build.bat" %*
exit /b %errorlevel%
