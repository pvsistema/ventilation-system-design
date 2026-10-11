@echo off
chcp 65001 >nul
py -3 -m pip install --quiet cryptography 2>nul || python -m pip install --quiet cryptography
py -3 "%~dp0make_offline_key.py" 2>nul || python "%~dp0make_offline_key.py"
