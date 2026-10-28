@echo off
REM ============================================================
REM  PV-Sistema desktop build - REDIRECT
REM
REM  The old Tauri build (bun + Rust/cargo + PyInstaller) was
REM  replaced by the C# build of PVS.exe. This file only starts
REM  the current build so that double-clicking it still works:
REM      desktop\csharp\build.bat
REM  All arguments are passed through (e.g. "noobf").
REM  (Pure ASCII on purpose - national characters turn into
REM  garbage in cmd.exe on some code pages.)
REM ============================================================
echo.
echo  NOTE: desktop\build.bat is outdated (old Tauri build).
echo        Starting the current build: desktop\csharp\build.bat
echo.
call "%~dp0csharp\build.bat" %*
exit /b %errorlevel%
