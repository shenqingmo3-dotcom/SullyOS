@echo off
chcp 65001 >nul
title GALAKU Peach Pro MCP
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-k134-mcp.ps1"
echo.
echo The MCP server has stopped. Press any key to close this window.
pause >nul
