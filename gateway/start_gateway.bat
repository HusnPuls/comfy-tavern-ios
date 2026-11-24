@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动 ComfyUI 网关（默认 0.0.0.0:8189 -> 127.0.0.1:8188）...
echo 如果 ComfyUI 不在默认端口，请改下面这行里的 --target。
python -u "%~dp0comfy_gateway.py" --port 8189 --target http://127.0.0.1:8188 %*
echo.
echo 网关已退出，按任意键关闭窗口。
pause >nul
