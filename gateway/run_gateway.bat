@echo off
rem ComfyUI gateway launcher used by the "ComfyUI Gateway" scheduled task.
rem Logs go to gateway.log next to this file.
cd /d "%~dp0"
"C:\Python312\python.exe" -u "%~dp0comfy_gateway.py" --port 8189 --target http://127.0.0.1:8188 >> "%~dp0gateway.log" 2>&1
