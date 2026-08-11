"""SullyOS HTTP adapter for KKarsyline/Collar_watch.

This process exposes:

* POST /api/health  - authenticated Apple Watch / Health Auto Export ingest
* POST /mcp         - stateless MCP JSON-RPC for SullyOS
* GET  /healthz     - readiness only; never returns health data

The upstream project deliberately ships its data layer and a stdio MCP server,
but no HTTP ingest application.  This adapter imports the upstream
``server/health_store.py`` in place, so the data format and query behaviour stay
owned by Collar_watch.
"""

from __future__ import annotations

import argparse
import asyncio
import hmac
import importlib.util
import inspect
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import ModuleType
from typing import Any
from urllib.parse import urlsplit


SERVER_NAME = "health-collar-sullyos"
SERVER_VERSION = "0.1.0"
MCP_PROTOCOL_VERSION = "2024-11-05"
MCP_BODY_LIMIT = 1_000_000
INGEST_BODY_LIMIT = 10_000_000

TOOLS: list[dict[str, Any]] = [
    {
        "name": "health_now",
        "description": (
            "读取当前健康状态的紧凑快照。包含最新心率、静息心率、HRV、"
            "呼吸、最近睡眠与今日活动；每项带新鲜度。健康数据仅供日常参考，"
            "不能用于诊断。通常先调用这个工具。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
    },
    {
        "name": "health_detail",
        "description": (
            "继续查询单项健康数据。心率、HRV、呼吸可查最长 2 小时的逐点样本"
            "及 min/max/avg；睡眠可查指定日期的阶段时间轴、睡眠期 vitals 与"
            "最近 7 天平均。健康数据仅供日常参考，不能用于诊断。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "metric": {
                    "type": "string",
                    "enum": [
                        "heart_rate",
                        "heart_rate_variability",
                        "respiratory_rate",
                        "sleep",
                    ],
                    "default": "heart_rate",
                    "description": "要查询的指标。",
                },
                "start": {
                    "type": "string",
                    "description": "ISO 8601 起始时间；数值指标可用。",
                },
                "end": {
                    "type": "string",
                    "description": "ISO 8601 结束时间；数值指标可用。",
                },
                "date": {
                    "type": "string",
                    "description": "睡眠日期，格式 YYYY-MM-DD。",
                },
            },
            "additionalProperties": False,
        },
    },
]


def _load_health_store(collar_root: Path) -> ModuleType:
    module_path = collar_root.resolve() / "server" / "health_store.py"
    if not module_path.is_file():
        raise RuntimeError(
            "找不到 Collar_watch 数据层："
            f"{module_path}。请把 HEALTH_COLLAR_ROOT 指向 Collar_watch 仓库根目录。"
        )
    spec = importlib.util.spec_from_file_location("collar_watch_health_store", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载 {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _secret_matches(actual: str | None, expected: str) -> bool:
    return bool(actual) and hmac.compare_digest(actual, expected)


def _bearer_matches(header: str | None, expected: str) -> bool:
    if not header or not header.lower().startswith("bearer "):
        return False
    return _secret_matches(header[7:].strip(), expected)


def _text_result(value: Any, *, is_error: bool = False) -> dict[str, Any]:
    if isinstance(value, str):
        text = value
    else:
        text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    result: dict[str, Any] = {"content": [{"type": "text", "text": text}]}
    if is_error:
        result["isError"] = True
    return result


class HealthBackend:
    def __init__(self, module: ModuleType):
        self.module = module

    def ingest(self, body: Any) -> dict[str, Any]:
        samples = self.module.normalize_payload(body)
        allowed = set(self.module.ALLOWED_TYPES)
        accepted = [sample for sample in samples if sample.get("type") in allowed]
        stored, deduplicated = self.module.store_samples(accepted)
        return {
            "ok": True,
            "received": len(samples),
            "accepted": len(accepted),
            "stored": stored,
            "deduplicated": deduplicated,
        }

    def health_now(self) -> Any:
        return self.module.health_now()

    def health_detail(self, arguments: dict[str, Any]) -> Any:
        upstream_args: dict[str, Any] = {
            "metric": arguments.get("metric") or "heart_rate",
        }
        if arguments.get("start"):
            upstream_args["from"] = arguments["start"]
        if arguments.get("end"):
            upstream_args["to"] = arguments["end"]
        if arguments.get("date"):
            upstream_args["date"] = arguments["date"]
        value = self.module.execute_health_detail(upstream_args)
        if inspect.isawaitable(value):
            return asyncio.run(value)
        return value


class HealthHttpServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(
        self,
        address: tuple[str, int],
        backend: HealthBackend,
        *,
        ingest_token: str,
        mcp_token: str,
        allow_origin: str,
    ):
        super().__init__(address, HealthHandler)
        self.backend = backend
        self.ingest_token = ingest_token
        self.mcp_token = mcp_token
        self.allow_origin = allow_origin


class HealthHandler(BaseHTTPRequestHandler):
    server_version = "HealthCollarSullyOS/0.1"

    @property
    def app(self) -> HealthHttpServer:
        return self.server  # type: ignore[return-value]

    def _add_common_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", self.app.allow_origin)
        self.send_header(
            "Access-Control-Allow-Headers",
            (
                "Content-Type, Accept, Authorization, X-Health-Token, "
                "Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID"
            ),
        )
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Expose-Headers", "Mcp-Session-Id")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")

    def _send_json(self, status: int, value: Any) -> None:
        encoded = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self._add_common_headers()
        self.end_headers()
        self.wfile.write(encoded)

    def _read_json(self, limit: int) -> Any:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Content-Length 无效") from exc
        if length <= 0:
            raise ValueError("请求体为空")
        if length > limit:
            raise ValueError(f"请求体超过 {limit} 字节限制")
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._add_common_headers()
        self.end_headers()

    def do_GET(self) -> None:
        path = urlsplit(self.path).path.rstrip("/") or "/"
        if path == "/healthz":
            self._send_json(
                200,
                {
                    "ok": True,
                    "server": SERVER_NAME,
                    "version": SERVER_VERSION,
                    "mcp": "/mcp",
                    "ingest": "/api/health",
                },
            )
            return
        if path == "/mcp":
            self._send_json(
                405,
                {
                    "ok": False,
                    "message": "此无状态 MCP 不提供服务端事件流，请使用 POST。",
                },
            )
            return
        self._send_json(404, {"ok": False, "message": "Not found"})

    def do_DELETE(self) -> None:
        path = urlsplit(self.path).path.rstrip("/") or "/"
        if path == "/mcp":
            self.send_response(204)
            self._add_common_headers()
            self.end_headers()
            return
        self._send_json(404, {"ok": False, "message": "Not found"})

    def do_POST(self) -> None:
        path = urlsplit(self.path).path.rstrip("/") or "/"
        if path == "/api/health":
            self._handle_ingest()
            return
        if path == "/mcp":
            self._handle_mcp()
            return
        self._send_json(404, {"ok": False, "message": "Not found"})

    def _handle_ingest(self) -> None:
        if not _secret_matches(self.headers.get("X-Health-Token"), self.app.ingest_token):
            self._send_json(401, {"ok": False, "message": "X-Health-Token 无效"})
            return
        try:
            body = self._read_json(INGEST_BODY_LIMIT)
            self._send_json(200, self.app.backend.ingest(body))
        except (ValueError, json.JSONDecodeError) as exc:
            self._send_json(400, {"ok": False, "message": str(exc)})
        except Exception as exc:
            self._send_json(500, {"ok": False, "message": f"ingest 失败: {exc}"})

    def _handle_mcp(self) -> None:
        if not _bearer_matches(self.headers.get("Authorization"), self.app.mcp_token):
            self._send_json(
                401,
                {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {"code": -32001, "message": "Bearer Token 无效"},
                },
            )
            return

        request_id: Any = None
        try:
            request = self._read_json(MCP_BODY_LIMIT)
            if not isinstance(request, dict):
                raise ValueError("JSON-RPC 请求必须是对象")
            request_id = request.get("id")
            method = request.get("method")

            if request_id is None:
                self.send_response(202)
                self._add_common_headers()
                self.end_headers()
                return

            if method == "initialize":
                result = {
                    "protocolVersion": MCP_PROTOCOL_VERSION,
                    "capabilities": {"tools": {"listChanged": False}},
                    "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
                }
            elif method == "ping":
                result = {}
            elif method == "tools/list":
                result = {"tools": TOOLS}
            elif method == "tools/call":
                params = request.get("params") or {}
                if not isinstance(params, dict):
                    raise ValueError("tools/call params 必须是对象")
                result = self._call_tool(
                    str(params.get("name") or ""),
                    params.get("arguments") or {},
                )
            else:
                self._send_json(
                    200,
                    {
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "error": {
                            "code": -32601,
                            "message": f"Method not found: {method}",
                        },
                    },
                )
                return

            self._send_json(
                200,
                {"jsonrpc": "2.0", "id": request_id, "result": result},
            )
        except (ValueError, json.JSONDecodeError) as exc:
            self._send_json(
                400,
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {"code": -32700, "message": str(exc)},
                },
            )
        except Exception as exc:
            self._send_json(
                200,
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {"code": -32603, "message": str(exc)},
                },
            )

    def _call_tool(self, name: str, arguments: Any) -> dict[str, Any]:
        if not isinstance(arguments, dict):
            return _text_result(
                {"ok": False, "message": "工具参数必须是对象"},
                is_error=True,
            )
        if name == "health_now":
            return _text_result(self.app.backend.health_now())
        if name == "health_detail":
            return _text_result(self.app.backend.health_detail(arguments))
        return _text_result(
            {"ok": False, "message": f"未知工具：{name}"},
            is_error=True,
        )

    def log_message(self, format: str, *args: Any) -> None:
        if os.environ.get("HEALTH_HTTP_LOG", "").strip() == "1":
            super().log_message(format, *args)


def _required_secret(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if len(value) < 24:
        raise RuntimeError(f"{name} 必须设置为至少 24 个字符的随机密钥")
    return value


def build_server(host: str, port: int) -> HealthHttpServer:
    collar_root = Path(os.environ.get("HEALTH_COLLAR_ROOT", "../Collar_watch"))
    module = _load_health_store(collar_root)
    return HealthHttpServer(
        (host, port),
        HealthBackend(module),
        ingest_token=_required_secret("HEALTH_INGEST_TOKEN"),
        mcp_token=_required_secret("MCP_ACCESS_TOKEN"),
        allow_origin=os.environ.get("MCP_ALLOW_ORIGIN", "*").strip() or "*",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Collar_watch → SullyOS HTTP MCP adapter")
    parser.add_argument("--host", default=os.environ.get("HEALTH_HOST", "127.0.0.1"))
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("HEALTH_PORT", "8766")),
    )
    args = parser.parse_args()
    server = build_server(args.host, args.port)
    print(f"{SERVER_NAME} {SERVER_VERSION}")
    print(f"MCP:    http://{args.host}:{args.port}/mcp")
    print(f"Ingest: http://{args.host}:{args.port}/api/health")
    print("健康数据不会从 /healthz 返回；MCP 与 ingest 使用两把独立密钥。")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
