@echo off
chcp 65001 >nul
title 豆包 AI 创作 - Photon 插件一键安装
cd /d "%~dp0"
echo.
echo 正在安装豆包 AI 创作插件到 Photon Studio…
echo 请确认已完全退出 Photon Studio，然后按任意键继续。
pause >nul
python install_plugin.py
if errorlevel 1 (
  echo.
  echo 安装未完成，请查看上方提示。
  pause
)
