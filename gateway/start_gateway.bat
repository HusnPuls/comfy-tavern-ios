@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Starting ComfyUI gateway: 0.0.0.0:8189  ->  http://127.0.0.1:8188
python -u "%~dp0comfy_gateway.py" --port 8189 --target http://127.0.0.1:8188 %*
echo.
echo Gateway stopped.
pause
