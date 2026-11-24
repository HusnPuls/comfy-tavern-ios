#!/usr/bin/env python3
"""
ComfyUI 局域网网关（给 iOS / TauriTavern 用）

作用：
  1) 把只监听 127.0.0.1 的 ComfyUI 暴露到局域网（手机能访问）
  2) 给所有响应加 CORS 头，解决 WKWebView 里 fetch 被跨域拦住的问题
  3) 顺便把 /view 的图片原样透传，手机上能直接 <img src>

用法（Windows 双击 start_gateway.bat 或命令行）：
    python comfy_gateway.py
    python comfy_gateway.py --port 8189 --target http://127.0.0.1:8188
    python comfy_gateway.py --allow-origin http://tauri.localhost

只依赖 Python 标准库，Python 3.8+ 即可。
"""

import argparse
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TARGET = "http://127.0.0.1:8188"
ALLOW_ORIGIN = "*"
HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}
DEFAULT_TIMEOUT = 900  # 长任务：提交/轮询可能很慢，给足


class GatewayHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "ComfyGateway/1.0"

    # ---------- 公共 ----------

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", ALLOW_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Expose-Headers", "*")
        self.send_header("Access-Control-Max-Age", "86400")
        if ALLOW_ORIGIN != "*":
            self.send_header("Vary", "Origin")

    def _send_simple(self, status, body=b"", content_type="text/plain; charset=utf-8"):
        self.send_response(status)
        self._cors_headers()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD" and body:
            self.wfile.write(body)

    # ---------- 方法 ----------

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self):
        self._proxy("HEAD")

    def do_GET(self):
        self._proxy("GET")

    def do_POST(self):
        self._proxy("POST")

    # ---------- 核心转发 ----------

    def _proxy(self, method):
        target_url = TARGET.rstrip("/") + self.path
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None

        headers = {}
        for key, value in self.headers.items():
            if key.lower() in HOP_BY_HOP or key.lower() in ("host", "content-length"):
                continue
            headers[key] = value

        req = urllib.request.Request(target_url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=DEFAULT_TIMEOUT) as upstream:
                self.send_response(upstream.status)
                self._cors_headers()
                for key, value in upstream.getheaders():
                    if key.lower() in HOP_BY_HOP or key.lower() == "content-length":
                        continue
                    self.send_header(key, value)
                content_length = upstream.getheader("Content-Length")
                if content_length is not None:
                    self.send_header("Content-Length", content_length)
                    self.end_headers()
                    if method != "HEAD":
                        self._stream(upstream)
                else:
                    # 上游没有长度：自己算不出来，用连接关闭语义发送
                    self.send_header("Connection", "close")
                    self.send_header("Transfer-Encoding", "chunked")
                    self.end_headers()
                    if method != "HEAD":
                        self._stream_chunked(upstream)
                    self.close_connection = True
        except urllib.error.HTTPError as e:
            payload = e.read() if hasattr(e, "read") else b""
            self._send_simple(e.code, payload, e.headers.get("Content-Type", "application/json"))
        except Exception as e:  # 上游没开 / 超时 / 拒绝
            msg = f'{{"error":"gateway: {type(e).__name__}: {e}"}}'.encode("utf-8")
            self._send_simple(502, msg, "application/json")

    def _stream(self, upstream):
        try:
            while True:
                chunk = upstream.read(64 * 1024)
                if not chunk:
                    break
                self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _stream_chunked(self, upstream):
        try:
            while True:
                chunk = upstream.read(64 * 1024)
                if not chunk:
                    break
                self.wfile.write(f"{len(chunk):X}\r\n".encode("ascii"))
                self.wfile.write(chunk)
                self.wfile.write(b"\r\n")
            self.wfile.write(b"0\r\n\r\n")
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, fmt, *args):
        sys.stdout.write("  %s - %s\n" % (self.address_string(), fmt % args))


def lan_ips():
    ips = []
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if ip not in ips and not ip.startswith("127."):
                ips.append(ip)
    except Exception:
        pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        if ip not in ips:
            ips.append(ip)
        s.close()
    except Exception:
        pass
    return ips


def main():
    global TARGET, ALLOW_ORIGIN

    parser = argparse.ArgumentParser(description="ComfyUI LAN gateway (CORS friendly)")
    parser.add_argument("--host", default="0.0.0.0", help="监听地址，默认 0.0.0.0")
    parser.add_argument("--port", type=int, default=8189, help="监听端口，默认 8189")
    parser.add_argument("--target", default="http://127.0.0.1:8188", help="ComfyUI 实际地址")
    parser.add_argument("--allow-origin", default="*", help="Access-Control-Allow-Origin，默认 *")
    args = parser.parse_args()

    TARGET = args.target.rstrip("/")
    ALLOW_ORIGIN = args.allow_origin

    server = ThreadingHTTPServer((args.host, args.port), GatewayHandler)
    server.daemon_threads = True

    print("=" * 52)
    print(" ComfyUI 网关已启动")
    print(f" 上游 ComfyUI : {TARGET}")
    print(f" 监听         : http://{args.host}:{args.port}")
    print(" 手机上填（酒馆扩展里的地址）：")
    for ip in lan_ips():
        print(f"   http://{ip}:{args.port}")
    print(" 自检：浏览器打开  http://<上面的地址>/system_stats")
    print(" 停止：Ctrl+C")
    print("=" * 52)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
