# ComfyUI 插图 —— 酒馆 / TauriTavern 扩展

在 SillyTavern（含 iOS 的 TauriTavern）里，把 AI 回复中的 `image###提示词###` 原地换成「开始生成」按钮，点一下调用局域网里的 ComfyUI 出图，图片直接内联在那一层楼下面。

移植自油猴脚本《酒馆ComfyUI插图脚本（加固版）9.0》（作者 soulostar）：把 `GM_xmlhttpRequest` 换成 `fetch`、`GM_getValue/setValue` 换成 `localStorage`、`GM_addStyle` 换成 `style.css`、jQuery UI 拖拽换成 Pointer Events，其余行为保持一致。

## 安装

SillyTavern / TauriTavern →「扩展」→「安装扩展」，填：

```
https://github.com/<你的账号>/comfy-tavern-ios
```

装完到「管理扩展」里勾选 **ComfyUI 插图（移动端 / TauriTavern 版）**，刷新前端。

## 配置

选项菜单 →「ComfyUI生图」：

| 项 | 值 |
|---|---|
| ComfyUI 地址 | `http://<电脑局域网IP>:8189`（网关），或 `http://<IP>:8188`（ComfyUI 需加 `--enable-cors-header`） |
| 开始 / 结束标记 | `image###` / `###` |
| 工作流 | ComfyUI **API 格式** 工作流 JSON，保留 `%prompt%`（必需）与 `%seed%`（可选） |

iOS 上还需要一个局域网网关来补 CORS，见 <https://github.com/> 配套的 `comfy_gateway.py`：`python comfy_gateway.py --port 8189 --target http://127.0.0.1:8188`。

## 注意

- 手机端地址不要填 `127.0.0.1`。
- 工作流末端要有 `SaveImage`，否则拿不到图。
- TauriTavern 公开 TestFlight 包默认禁用第三方扩展，需要在 `default-user/tauritavern-settings.json` 里加 `"ios_policy": {"version": 1, "profile": "full"}` 后重新导入。
