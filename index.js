/*
 * ComfyUI 插图 —— SillyTavern / TauriTavern 第三方扩展（单文件构建版）
 * 由 extension/index.js + extension/lib/markup.js 自动拼接生成，不要直接改这个文件。
 */

// ===== lib/markup.js =====
/**
 * 纯逻辑：从消息 HTML 里切出 image###...### 提示词块，替换成按钮组。
 * 不碰 DOM / 网络，方便单独跑测试（node tests/test_markup.mjs）。
 */

function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
    }
    return 'comfy-id-' + Math.abs(hash).toString(36);
}

function htmlFragmentToText(html) {
    return String(html)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h[1-6])>\s*<(p|div|li|h[1-6])[^>]*>/gi, '\n')
        .replace(/<\/?(p|div|li|h[1-6])[^>]*>/gi, '\n')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#0*39;/gi, "'")
        .replace(/&#x27;/gi, "'")
        .replace(/<[^>]*>/g, ' ')
        .replace(/&amp;/gi, '&');
}

function cleanPromptText(raw) {
    let t = htmlFragmentToText(raw);
    t = t.replace(/[\u200B-\u200D\uFEFF]/g, '');
    t = t.replace(/[ \t\u00A0]+/g, ' ');
    t = t.replace(/ *\n */g, '\n');
    t = t.replace(/\n{3,}/g, '\n\n');
    return t.trim();
}

function buildButtonGroupHtml(prompt) {
    const generationId = simpleHash(prompt);
    const encoded = encodeURIComponent(prompt);
    return `<span class="comfy-button-group" data-generation-id="${generationId}" data-prompt="${encoded}">`
        + `<button class="comfy-button comfy-chat-generate-button">开始生成</button>`
        + `</span>`;
}

/**
 * 把 innerHTML 里所有 startTag...endTag 片段换成按钮组。
 *  - 用「下一个 startTag 或结尾」切段，段内取最后一个 endTag
 *  - tolerant=true 时模型漏写收尾标记也出按钮（流式输出中不启用）
 */
function rewriteMessageHtml(html, startTag, endTag, tolerant) {
    const escapedStart = escapeRegex(startTag);
    const segRx = new RegExp(escapedStart + '([\\s\\S]*?)(?=' + escapedStart + '|$)', 'g');

    let out = '';
    let cursor = 0;
    let found = 0;
    let m;
    while ((m = segRx.exec(html)) !== null) {
        const segStart = m.index;
        const body = m[1];
        let endIdx = body.lastIndexOf(endTag);
        let closed = true;
        if (endIdx === -1 && tolerant && !/<imgthink\b/i.test(body)) {
            endIdx = body.length;
            closed = false;
        }
        if (endIdx === -1) continue;
        const prompt = cleanPromptText(body.slice(0, endIdx));
        if (!prompt) continue;
        found++;
        out += html.slice(cursor, segStart);
        out += buildButtonGroupHtml(prompt);
        cursor = segStart + startTag.length + endIdx + (closed ? endTag.length : 0);
    }
    if (!found) return { html, count: 0 };
    out += html.slice(cursor);
    return { html: out, count: found };
}

/** 把按钮组 data-prompt 里 encodeURIComponent 的文本还原 */
function decodePrompt(raw) {
    try {
        return decodeURIComponent(raw);
    } catch (e) {
        return raw;
    }
}

// ===== index.js =====
/**
 * ComfyUI 插图 —— SillyTavern / TauriTavern 第三方前端扩展
 *
 * 移植自油猴脚本《酒馆ComfyUI插图脚本（加固版）v9.0》（作者 soulostar）。
 * 移植差异（为什么不能直接用油猴脚本）：
 *   - iOS 上没有 Tampermonkey，TauriTavern 是原生 WKWebView，无法装用户脚本
 *   - GM_xmlhttpRequest  ->  fetch（跨域由 ComfyUI 的 --enable-cors-header 或本地网关处理）
 *   - GM_getValue/setValue -> localStorage
 *   - GM_addStyle         -> manifest.json 里声明的 style.css
 *   - @require jquery-ui  -> 指针事件自绘拖拽，不依赖 jQuery
 *
 * 其余行为与 9.0 版保持一致：识别 image###...### 块 -> 插入按钮组 -> 调 ComfyUI 出图 -> 内联显示。
 */


const PANEL_ID = 'comfyui-panel';
const BUTTON_ID = 'comfyui-launcher-button';
const AUTO_TOGGLE_ID = 'comfyui-auto-toggle';
const IMAGES_KEY = 'comfyui:images';
const POLL_INTERVAL_MS = 2000;
const DEFAULT_POLL_TIMEOUT_S = 300;

const K = {
    url: 'comfyui:url',
    workflow: 'comfyui:workflow',
    startTag: 'comfyui:startTag',
    endTag: 'comfyui:endTag',
    auto: 'comfyui:auto',
    timeout: 'comfyui:timeout',
};

// ---------------------------------------------------------------- 小工具

const store = {
    get(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (raw === null) return fallback;
            return JSON.parse(raw);
        } catch (e) {
            return fallback;
        }
    },
    set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            console.warn('[ComfyUI] 本地存储写入失败：', e);
        }
    },
};

function toast(kind, msg) {
    try {
        const t = globalThis.toastr;
        if (t && typeof t[kind] === 'function') {
            t[kind](msg);
            return;
        }
    } catch (e) { /* ignore */ }
    console.log(`[ComfyUI] ${kind}: ${msg}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 设置读写

function getUrl() {
    return String(store.get(K.url, '') || '').trim().replace(/\/+$/, '');
}
function getWorkflow() {
    return String(store.get(K.workflow, '') || '');
}
function getStartTag() {
    return String(store.get(K.startTag, 'image###') || '');
}
function getEndTag() {
    return String(store.get(K.endTag, '###') || '');
}
function isAutoEnabled() {
    return !!store.get(K.auto, false);
}
function getTimeoutMs() {
    const s = Number(store.get(K.timeout, DEFAULT_POLL_TIMEOUT_S));
    return Math.max(10, Number.isFinite(s) ? s : DEFAULT_POLL_TIMEOUT_S) * 1000;
}

// ---------------------------------------------------------------- 网络层

class ComfyError extends Error {}

async function comfyFetch(path, { method = 'GET', body = null, timeout = 20000 } = {}) {
    const base = getUrl();
    if (!base) throw new ComfyError('还没有填写 ComfyUI 地址');

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
        const res = await fetch(base + path, {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
            signal: ctrl.signal,
            mode: 'cors',
            cache: 'no-store',
        });
        return res;
    } catch (e) {
        if (e.name === 'AbortError') throw new ComfyError(`请求超时（${Math.round(timeout / 1000)}s）：${base}${path}`);
        throw new ComfyError(`连不上 ${base}${path}（跨域/网络/防火墙/LAN 权限）`);
    } finally {
        clearTimeout(timer);
    }
}

async function testConnection() {
    const res = await comfyFetch('/system_stats', { timeout: 8000 });
    if (!res.ok) throw new ComfyError(`服务器返回 ${res.status}`);
    const data = await res.json();
    return data;
}

async function submitPrompt(workflow) {
    const res = await comfyFetch('/prompt', {
        method: 'POST',
        body: { prompt: workflow, client_id: 'tavern-' + Math.random().toString(36).slice(2) },
        timeout: 30000,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* ignore */ }

    if (!res.ok) {
        const nodeErr = json?.node_errors && Object.values(json.node_errors)
            .flatMap((n) => (n.errors || []).map((e) => e.message || e.type))
            .filter(Boolean)
            .slice(0, 3)
            .join('；');
        throw new ComfyError(`ComfyUI 拒绝了工作流（${res.status}）${nodeErr ? '：' + nodeErr : ''}`);
    }
    if (!json?.prompt_id) throw new ComfyError('ComfyUI 没有返回 prompt_id');
    return json.prompt_id;
}

async function waitForHistory(promptId) {
    const deadline = Date.now() + getTimeoutMs();
    let lastError = null;
    while (Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);
        let res;
        try {
            res = await comfyFetch(`/history/${encodeURIComponent(promptId)}`, { timeout: 15000 });
        } catch (e) {
            lastError = e;
            continue;
        }
        if (!res.ok) {
            lastError = new ComfyError(`轮询失败：HTTP ${res.status}`);
            continue;
        }
        const history = await res.json();
        const entry = history?.[promptId];
        if (!entry) continue;
        const status = entry.status || {};
        if (status.status_str === 'error') {
            const msg = (status.messages || [])
                .map((m) => (Array.isArray(m) ? m[1]?.message || m[0] : ''))
                .filter(Boolean)
                .slice(-2)
                .join('；');
            throw new ComfyError('生成失败：' + (msg || 'ComfyUI 报错'));
        }
        if (entry.outputs && Object.keys(entry.outputs).length) return entry;
    }
    throw lastError || new ComfyError(`等了 ${Math.round(getTimeoutMs() / 1000)} 秒还没出图，可以调大超时或换更小的步数`);
}

function pickImageUrl(entry) {
    const outputs = entry?.outputs || {};
    for (const nodeId of Object.keys(outputs)) {
        const images = outputs[nodeId]?.images;
        if (Array.isArray(images) && images.length) {
            const img = images[0];
            const q = new URLSearchParams({
                filename: img.filename || '',
                subfolder: img.subfolder || '',
                type: img.type || 'output',
            });
            // 加一个随机参数，避免 iOS WebView 复用旧缓存
            return `${getUrl()}/view?${q.toString()}&t=${Date.now()}`;
        }
    }
    return null;
}

// ---------------------------------------------------------------- 提示词解析

function getPromptFromGroup(group) {
    return decodePrompt(group.dataset.prompt || '');
}

function getSourceSignature(mesText) {
    const clone = mesText.cloneNode(true);
    clone.querySelectorAll('.comfy-button-group, .comfy-image-container').forEach((n) => n.remove());
    return simpleHash(clone.innerHTML);
}

function isStreaming() {
    const stop = document.getElementById('mes_stop');
    if (!stop) return false;
    const style = window.getComputedStyle(stop);
    return style.display !== 'none' && style.visibility !== 'hidden';
}

// ---------------------------------------------------------------- 图片缓存

function loadImages() {
    const v = store.get(IMAGES_KEY, {});
    return v && typeof v === 'object' ? v : {};
}

function saveImage(groupId, url) {
    const all = loadImages();
    all[groupId] = url;
    store.set(IMAGES_KEY, all);
}

function removeImage(groupId) {
    const all = loadImages();
    delete all[groupId];
    store.set(IMAGES_KEY, all);
}

// ---------------------------------------------------------------- 控制面板

let panelInited = false;

function createPanel() {
    if (document.getElementById(PANEL_ID)) return;

    const html = `
        <div id="${PANEL_ID}">
            <div class="panel-control-bar">
                <i class="fa-fw fa-solid fa-grip drag-grabber"></i>
                <b>ComfyUI 生图设置</b>
                <i class="fa-fw fa-solid fa-circle-xmark floating_panel_close"></i>
            </div>
            <div class="comfyui-panel-content">
                <label for="comfyui-url">ComfyUI 地址（手机能访问的局域网地址）</label>
                <div class="comfy-url-container">
                    <input id="comfyui-url" type="url" inputmode="url" placeholder="例如 http://192.168.0.105:8189">
                    <button id="comfyui-test-conn" class="comfy-button">测试</button>
                </div>
                <p class="hint">推荐填网关地址（端口 8189），网关会顺手解决 CORS；直连 ComfyUI 时用 8188 且需加 <code>--enable-cors-header</code>。</p>

                <div class="comfy-tags-container">
                    <div>
                        <label for="comfyui-start-tag">开始标记</label>
                        <input id="comfyui-start-tag" type="text">
                    </div>
                    <div>
                        <label for="comfyui-end-tag">结束标记</label>
                        <input id="comfyui-end-tag" type="text">
                    </div>
                </div>

                <label for="comfyui-timeout">出图超时（秒）</label>
                <input id="comfyui-timeout" type="number" min="10" max="3600" step="10">

                <label for="comfyui-workflow">工作流（API 格式 JSON，含 %prompt% / %seed%）</label>
                <p class="workflow-info">直接粘贴电脑上那份能用的工作流 JSON，<b>%prompt%</b> 必需，<b>%seed%</b> 可选。</p>
                <textarea id="comfyui-workflow" placeholder="在此粘贴 ComfyUI 的 API 格式工作流 JSON..."></textarea>

                <button id="comfyui-clear-cache" class="comfy-button error" style="margin-top:12px;width:100%;">清除所有图片缓存</button>
                <p class="hint" id="comfyui-status"></p>
            </div>
        </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    initPanelLogic();
}

function initPanelLogic() {
    if (panelInited) return;
    panelInited = true;

    const panel = document.getElementById(PANEL_ID);
    const closeButton = panel.querySelector('.floating_panel_close');
    const testButton = document.getElementById('comfyui-test-conn');
    const clearCacheButton = document.getElementById('comfyui-clear-cache');
    const urlInput = document.getElementById('comfyui-url');
    const workflowInput = document.getElementById('comfyui-workflow');
    const startTagInput = document.getElementById('comfyui-start-tag');
    const endTagInput = document.getElementById('comfyui-end-tag');
    const timeoutInput = document.getElementById('comfyui-timeout');
    const statusEl = document.getElementById('comfyui-status');

    closeButton.addEventListener('click', () => { panel.style.display = 'none'; });

    // 拖拽（移动端也吃 pointer 事件，不依赖 jQuery UI）
    const bar = panel.querySelector('.panel-control-bar');
    let drag = null;
    bar.addEventListener('pointerdown', (ev) => {
        if (ev.target.closest('.floating_panel_close')) return;
        const rect = panel.getBoundingClientRect();
        panel.style.transform = 'none';
        panel.style.left = rect.left + 'px';
        panel.style.top = rect.top + 'px';
        drag = { dx: ev.clientX - rect.left, dy: ev.clientY - rect.top };
        bar.setPointerCapture(ev.pointerId);
    });
    bar.addEventListener('pointermove', (ev) => {
        if (!drag) return;
        const x = Math.min(Math.max(0, ev.clientX - drag.dx), window.innerWidth - 60);
        const y = Math.min(Math.max(0, ev.clientY - drag.dy), window.innerHeight - 40);
        panel.style.left = x + 'px';
        panel.style.top = y + 'px';
    });
    const stopDrag = () => { drag = null; };
    bar.addEventListener('pointerup', stopDrag);
    bar.addEventListener('pointercancel', stopDrag);

    // 回填设置
    urlInput.value = getUrl();
    workflowInput.value = getWorkflow();
    startTagInput.value = getStartTag();
    endTagInput.value = getEndTag();
    timeoutInput.value = String(store.get(K.timeout, DEFAULT_POLL_TIMEOUT_S));

    const persist = () => {
        store.set(K.url, urlInput.value.trim().replace(/\/+$/, ''));
        store.set(K.workflow, workflowInput.value);
        store.set(K.startTag, startTagInput.value);
        store.set(K.endTag, endTagInput.value);
        store.set(K.timeout, Number(timeoutInput.value) || DEFAULT_POLL_TIMEOUT_S);
    };
    [urlInput, workflowInput, startTagInput, endTagInput, timeoutInput].forEach((el) => {
        el.addEventListener('input', () => {
            persist();
            if (el === urlInput) testButton.classList.remove('success', 'error', 'testing');
        });
    });

    testButton.addEventListener('click', async () => {
        persist();
        testButton.classList.remove('success', 'error');
        testButton.classList.add('testing');
        testButton.disabled = true;
        statusEl.textContent = '正在连接…';
        try {
            const data = await testConnection();
            const dev = data?.devices?.[0];
            testButton.classList.add('success');
            statusEl.textContent = dev
                ? `已连接：${dev.name || 'GPU'} / VRAM ${(Number(dev.vram_total || 0) / 1073741824).toFixed(1)} GB`
                : '已连接 ComfyUI';
            toast('success', 'ComfyUI 连接成功');
        } catch (e) {
            testButton.classList.add('error');
            statusEl.textContent = e.message;
            toast('error', e.message);
        } finally {
            testButton.classList.remove('testing');
            testButton.disabled = false;
        }
    });

    clearCacheButton.addEventListener('click', () => {
        if (!confirm('确定删除所有已生成的图片缓存吗？\n（不会删除 ComfyUI 输出目录里的文件）')) return;
        store.set(IMAGES_KEY, {});
        document.querySelectorAll('.comfy-image-container').forEach((n) => n.remove());
        document.querySelectorAll('.comfy-chat-generate-button').forEach((b) => {
            b.textContent = '开始生成';
            b.disabled = false;
            b.classList.remove('success', 'error', 'testing');
        });
        document.querySelectorAll('.comfy-delete-button').forEach((n) => n.remove());
        toast('success', '图片缓存已清空');
    });
}

function openPanel() {
    createPanel();
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.style.display = 'flex';
    const options = document.getElementById('options');
    if (options) options.style.display = 'none';
}

// ---------------------------------------------------------------- 菜单入口

let addBtnTimer = null;

function addMainButton() {
    if (addBtnTimer) return;
    addBtnTimer = setTimeout(() => {
        addBtnTimer = null;
        doAddMainButton();
    }, 200);
}

function doAddMainButton() {
    const menu = document.querySelector('#options .options-content');
    if (!menu) return;
    const anchor = menu.querySelector('#option_continue');
    if (!anchor) return;
    if (document.getElementById(BUTTON_ID)) return;

    const comfyButton = document.createElement('a');
    comfyButton.id = BUTTON_ID;
    comfyButton.className = 'interactable';
    comfyButton.innerHTML = '<i class="fa-lg fa-solid fa-image"></i><span>ComfyUI生图</span>';
    comfyButton.style.cursor = 'pointer';
    comfyButton.addEventListener('click', (ev) => {
        ev.preventDefault();
        openPanel();
    });
    anchor.parentNode.insertBefore(comfyButton, anchor.nextSibling);

    const auto = document.createElement('a');
    auto.id = AUTO_TOGGLE_ID;
    auto.className = 'interactable';
    auto.innerHTML = '<i class="fa-lg fa-solid fa-bolt"></i><span>自动出图：关</span>';
    auto.style.cursor = 'pointer';
    auto.addEventListener('click', async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const next = !isAutoEnabled();
        store.set(K.auto, next);
        paintAutoToggle(auto, next);
        if (next) setTimeout(clickLastPendingButton, 400);
    });
    comfyButton.insertAdjacentElement('afterend', auto);
    paintAutoToggle(auto, isAutoEnabled());
}

function paintAutoToggle(el, on) {
    const span = el.querySelector('span');
    if (span) span.textContent = on ? '自动出图：开' : '自动出图：关';
    el.style.opacity = on ? '1' : '0.55';
    el.style.color = on ? '#4caf50' : '';
    el.title = on ? 'AI 回复里出现提示词后自动出图，点击关闭' : '需要手动点「开始生成」，点击开启';
}

function clickLastPendingButton() {
    if (!isAutoEnabled()) return;
    const list = document.querySelectorAll('.mes');
    for (let i = list.length - 1; i >= 0; i--) {
        const btn = list[i].querySelector('.comfy-chat-generate-button');
        if (!btn) continue;
        if (btn.disabled) return;
        if (btn.textContent !== '开始生成') return;
        btn.click();
        return;
    }
}

// ---------------------------------------------------------------- 生成流程

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (e) {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            return ok;
        } catch (e2) {
            return false;
        }
    }
}

function displayImage(group, imageUrl) {
    let container = group.nextElementSibling;
    if (!container || !container.classList.contains('comfy-image-container')) {
        container = document.createElement('div');
        container.className = 'comfy-image-container';
        const img = document.createElement('img');
        img.alt = 'ComfyUI 生成';
        img.loading = 'lazy';
        container.appendChild(img);
        group.insertAdjacentElement('afterend', container);
    }
    container.querySelector('img').src = imageUrl;
}

async function onGenerateClick(ev) {
    const button = ev.currentTarget;
    const group = button.closest('.comfy-button-group');
    if (!group) return;
    const prompt = getPromptFromGroup(group);
    const generationId = group.dataset.generationId;

    if (!prompt) {
        toast('error', '这条消息里没有解析到提示词');
        return;
    }

    if (button.disabled) return;
    button.textContent = '生成中…';
    button.disabled = true;
    button.classList.remove('success', 'error');
    button.classList.add('testing');

    const oldDelete = group.querySelector('.comfy-delete-button');
    if (oldDelete) oldDelete.style.display = 'none';
    const oldImage = group.nextElementSibling;
    if (oldImage && oldImage.classList.contains('comfy-image-container')) oldImage.remove();

    try {
        const url = getUrl();
        if (!url) throw new ComfyError('还没有填写 ComfyUI 地址');
        let workflowText = getWorkflow();
        if (!workflowText) throw new ComfyError('还没有粘贴工作流 JSON');
        if (!workflowText.includes('%prompt%')) throw new ComfyError('工作流里没有 %prompt% 占位符');

        const seed = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
        workflowText = workflowText.replace(/%prompt%/g, JSON.stringify(prompt).slice(1, -1));
        workflowText = workflowText.replace(/%seed%/g, String(seed));

        let workflow;
        try {
            workflow = JSON.parse(workflowText);
        } catch (e) {
            throw new ComfyError('工作流 JSON 解析失败：' + e.message);
        }

        const promptId = await submitPrompt(workflow);
        toast('info', '已提交给 ComfyUI，排队中…');
        const entry = await waitForHistory(promptId);
        const imageUrl = pickImageUrl(entry);
        if (!imageUrl) throw new ComfyError('ComfyUI 返回里没有找到图片（检查工作流是否接 SaveImage）');

        displayImage(group, imageUrl);
        saveImage(generationId, imageUrl);

        button.textContent = '生成成功';
        button.classList.remove('testing');
        button.classList.add('success');
        setTimeout(() => {
            setupGeneratedState(button, generationId);
            const del = group.querySelector('.comfy-delete-button');
            if (del) del.style.display = '';
        }, 1500);
    } catch (e) {
        console.error('[ComfyUI]', e);
        toast('error', e.message || String(e));
        button.textContent = '生成失败';
        button.classList.remove('testing');
        button.classList.add('error');
        setTimeout(() => {
            const del = group.querySelector('.comfy-delete-button');
            if (del) {
                setupGeneratedState(button, generationId);
                del.style.display = '';
            } else {
                button.textContent = '开始生成';
                button.disabled = false;
                button.classList.remove('error');
            }
        }, 2500);
    }
}

function setupGeneratedState(button, generationId) {
    button.textContent = '重新生成';
    button.disabled = false;
    button.classList.remove('testing', 'success', 'error');

    if (!button.dataset.regenerateListener) {
        button.addEventListener('click', onGenerateClick);
        button.dataset.regenerateListener = 'true';
    }

    const group = button.closest('.comfy-button-group');
    if (!group) return;
    let del = group.querySelector('.comfy-delete-button');
    if (!del) {
        del = document.createElement('button');
        del.textContent = '删除';
        del.className = 'comfy-button error comfy-delete-button';
        button.insertAdjacentElement('afterend', del);
    }
    if (del.dataset.listenerAttached !== '1') {
        del.addEventListener('click', async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            removeImage(generationId);
            const container = group.nextElementSibling;
            if (container && container.classList.contains('comfy-image-container')) container.remove();
            del.remove();
            button.textContent = '开始生成';
            button.disabled = false;
            button.classList.remove('success', 'error', 'testing');
        });
        del.dataset.listenerAttached = '1';
    }
}

// ---------------------------------------------------------------- 消息处理

function ensureCopyButton(group) {
    let btn = group.querySelector('.comfy-copy-button');
    if (!btn) {
        btn = document.createElement('button');
        btn.textContent = '复制';
        btn.className = 'comfy-button comfy-copy-button';
        btn.title = '复制这次生图用的提示词';
        group.appendChild(btn);
    }
    if (btn.dataset.listenerAttached === '1') return;
    btn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const text = getPromptFromGroup(group);
        if (!text) return;
        const ok = await copyToClipboard(text);
        const old = btn.textContent;
        btn.textContent = ok ? '已复制' : '复制失败';
        setTimeout(() => { btn.textContent = old === '复制' ? '复制' : '复制'; }, 1200);
    });
    btn.dataset.listenerAttached = '1';
}

async function processMessage(mes) {
    const mesText = mes.querySelector('.mes_text');
    if (!mesText) return;

    const startTag = getStartTag();
    const endTag = getEndTag();
    if (!startTag || !endTag) return;

    const signature = getSourceSignature(mesText);
    if (mesText.dataset.comfySrcSig !== signature) {
        if (isStreaming()) {
            if (!mesText.dataset.comfyRetry) {
                mesText.dataset.comfyRetry = '1';
                setTimeout(() => {
                    delete mesText.dataset.comfyRetry;
                    scheduleProcess(mes);
                }, 1200);
            }
            return;
        }
        const result = rewriteMessageHtml(mesText.innerHTML, startTag, endTag, true);
        if (result.count > 0) {
            mesText.innerHTML = result.html;
            mesText.querySelectorAll('.comfy-button-group, .comfy-chat-generate-button, .comfy-copy-button, .comfy-delete-button')
                .forEach((el) => {
                    delete el.dataset.listenerAttached;
                    delete el.dataset.autoTriggered;
                    delete el.dataset.regenerateListener;
                });
            mesText.dataset.comfySrcSig = getSourceSignature(mesText);
            console.log(`[ComfyUI] 本楼识别到 ${result.count} 个生图块`);
        } else {
            mesText.dataset.comfySrcSig = signature;
        }
    }

    const saved = loadImages();
    mesText.querySelectorAll('.comfy-button-group').forEach((group) => {
        ensureCopyButton(group);
        const generateButton = group.querySelector('.comfy-chat-generate-button');
        if (!generateButton) return;
        if (group.dataset.listenerAttached) return;

        const generationId = group.dataset.generationId;
        if (saved[generationId]) {
            displayImage(group, saved[generationId]);
            setupGeneratedState(generateButton, generationId);
        } else {
            generateButton.addEventListener('click', onGenerateClick);
            if (!group.dataset.autoTriggered) {
                group.dataset.autoTriggered = 'true';
                if (isAutoEnabled()) {
                    setTimeout(() => {
                        if (!document.body.contains(generateButton)) return;
                        if (generateButton.disabled) return;
                        if (generateButton.textContent !== '开始生成') return;
                        generateButton.click();
                    }, 1200);
                }
            }
        }
        group.dataset.listenerAttached = 'true';
    });
}

const pending = new Set();
let flushTimer = null;

function scheduleProcess(node) {
    if (!node) return;
    pending.add(node);
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
        flushTimer = null;
        const list = [...pending];
        pending.clear();
        list.forEach((n) => {
            if (document.body.contains(n)) processMessage(n);
        });
    }, 300);
}

let chatObserver = null;

function observeChat() {
    const chat = document.getElementById('chat');
    if (!chat) {
        setTimeout(observeChat, 500);
        return;
    }
    chat.querySelectorAll('.mes').forEach(scheduleProcess);

    if (!chatObserver) {
        chatObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType !== Node.ELEMENT_NODE) return;
                    if (node.matches?.('.mes')) scheduleProcess(node);
                    node.querySelectorAll?.('.mes').forEach((mes) => scheduleProcess(mes));
                });
                if (mutation.type === 'characterData') {
                    const mes = mutation.target.parentElement?.closest('.mes');
                    if (mes) scheduleProcess(mes);
                } else if (mutation.target?.closest) {
                    const mes = mutation.target.closest('.mes');
                    if (mes) scheduleProcess(mes);
                }
            }
        });
    }
    chatObserver.observe(chat, { childList: true, subtree: true, characterData: true });
}

let optionsObserver = null;

function observeOptions() {
    if (optionsObserver) return;
    optionsObserver = new MutationObserver(() => {
        const options = document.getElementById('options');
        if (options && options.style.display !== 'none') addMainButton();
    });
    optionsObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style'],
    });
}

// ---------------------------------------------------------------- 启动

let started = false;

function start() {
    if (started) return;
    started = true;
    createPanel();
    observeChat();
    observeOptions();
    console.log('[ComfyUI] 扩展已加载（TauriTavern / 移动端版）');
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
}

// SillyTavern / TauriTavern 扩展加载器可能调用 activate() / onEnable()，这里保持幂等
async function activate() {
    start();
}

function onEnable() {
    start();
}
