# 酒馆 ComfyUI 插图（SillyTavern / TauriTavern / iOS）

在 SillyTavern（包括 iOS 上的原生客户端 **TauriTavern**）里，AI 回复中的 `image###提示词###` 会被原地换成「开始生成」按钮；点一下就会调用局域网里电脑上跑着的 ComfyUI 出图，图片内联显示在这一层楼下面。

移植自油猴脚本《酒馆ComfyUI插图脚本（加固版）9.0》（作者 soulostar）。
iOS 上没有 Tampermonkey，TauriTavern 是原生 WKWebView，装不了用户脚本，所以换成 SillyTavern 第三方前端扩展的形式：

| 原脚本 | 本扩展 |
|---|---|
| `GM_xmlhttpRequest` | `fetch`（配合网关或 ComfyUI 的 `--enable-cors-header`） |
| `GM_getValue` / `GM_setValue` | `localStorage` |
| `GM_addStyle` | `style.css`（manifest 声明） |
| `@require jquery-ui` 拖拽 | Pointer Events 自绘 |
| Tampermonkey 注入 | 酒馆扩展加载器以 ESM 加载 `index.js` |

功能保持一致：标记解析（提示词里含 `###` 也不截断、漏写收尾容错）、逐楼按钮组、开始/重新生成/删除、复制提示词、自动出图开关、生成结果按提示词哈希缓存。

## 安装

酒馆 →「扩展」→「安装扩展」，URL 填：

```
https://github.com/HusnPuls/comfy-tavern-ios.git
```

分支留空（默认主分支）。装完到「管理扩展」里勾选 **ComfyUI 插图（移动端 / TauriTavern 版）**，再刷新前端（TauriTavern：设置 → 开发 → 刷新前端）。

## 电脑端：跑网关（推荐）

ComfyUI 默认只监听 `127.0.0.1`，手机连不上；而且浏览器跨域请求需要 CORS 头。用仓库里的网关一次解决两件事，ComfyUI 一行都不用改：

```bash
python gateway/comfy_gateway.py --port 8189 --target http://127.0.0.1:8188
```

Windows 也可以直接双击 `gateway/start_gateway.bat`。启动后会打印手机该填的地址，例如 `http://192.168.0.105:8189`。

只依赖 Python 标准库（3.8+）。Windows 防火墙要放行 8189。

不想跑网关的话，给 ComfyUI 加参数即可：`--listen 0.0.0.0 --enable-cors-header "*"`，然后扩展里直接填 `http://<电脑IP>:8188`。

## 手机端配置

选项菜单 →「ComfyUI生图」：

| 项 | 填什么 |
|---|---|
| ComfyUI 地址 | `http://<电脑局域网IP>:8189`（**不要填 127.0.0.1**） |
| 开始 / 结束标记 | `image###` / `###` |
| 出图超时 | 默认 300 秒，慢卡可调 600 |
| 工作流 | ComfyUI **API 格式** 工作流 JSON，必须含 `%prompt%`，可选 `%seed%` |

点「测试」，显示 `已连接：显卡名 / VRAM xx GB` 就通了。

## iOS 注意事项

- TauriTavern 公开 TestFlight 包默认禁用第三方扩展。设置里看不到「安装扩展」时，导出数据 → 在 `default-user/tauritavern-settings.json` 里加 `"ios_policy": {"version": 1, "profile": "full"}`（其余字段不动）→ 重新导入并重启。该文件严格校验，改前先备份导出包。
- 首次联网会弹「本地网络」权限，选允许。
- 建议关掉 TauriTavern 设置里的「聊天 DOM 虚拟化」，否则老楼层被卸载重挂时按钮可能不回来。
- 手机 Safari 先打开 `http://<电脑IP>:8189/system_stats`，能看到 JSON 才说明网络通了。

## 排错

| 现象 | 处理 |
|---|---|
| 测试连接报「连不上…」 | 直连 8188 但没开 CORS；改用网关 8189 |
| 测试通过但一直转圈 | 工作流是 UI 格式不是 API 格式；或节点缺模型，看电脑上 ComfyUI 控制台 |
| 出图了但图片空白 | 工作流末端没有 `SaveImage` |
| 消息里没有「开始生成」 | 标记和卡里写的不一致；还在流式输出；或楼层被虚拟化卸载 |
| 面板打不开 | 扩展没在「管理扩展」里勾选，或装完没刷新前端 |

## 目录

```
manifest.json         扩展清单（根目录必须有）
index.js              扩展入口（单文件构建版，由 extension/ 拼接生成）
style.css             面板与按钮样式
gateway/comfy_gateway.py   局域网 + CORS 网关
gateway/start_gateway.bat  Windows 一键启动
```

许可证跟随原脚本：GPL。
