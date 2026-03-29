@echo off
chcp 65001 >nul 2>&1
title SillyTavern Preset Translator

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ERROR] Node.js not found!
    echo.
    echo   Please install Node.js from:
    echo   https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: Run the translator
cd /d "%~dp0"
node preset-translate.js %*

echo.
pause
