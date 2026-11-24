@echo off
chcp 65001 >nul
setlocal
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo 需要管理员权限，正在弹出 UAC 授权窗口...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo 正在为 ComfyUI 网关放行 TCP 8189（专用/域网络）...
netsh advfirewall firewall delete rule name="ComfyUI Gateway 8189" >nul 2>&1
netsh advfirewall firewall add rule name="ComfyUI Gateway 8189" dir=in action=allow protocol=TCP localport=8189 profile=any
if %errorlevel%==0 (
    echo.
    echo 完成：手机现在应该能访问 http://电脑IP:8189/system_stats
) else (
    echo.
    echo 添加失败，请手动在「Windows 安全中心 → 防火墙 → 高级设置」里放行 TCP 8189。
)
echo.
pause
