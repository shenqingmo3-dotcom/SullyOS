from __future__ import annotations

import asyncio
import hmac
import json
import os
import threading
import time
import uuid
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

try:
    from bleak import BleakClient, BleakScanner
except ImportError:  # Allows the offline tests to run before dependencies are installed.
    BleakClient = None
    BleakScanner = None

from galaku_protocol import STOP_COMMAND, control_command
from pattern_engine import (
    BOARD_LABELS,
    SCENE_LABELS,
    STEP_SECONDS,
    ShuffleBag,
    Variant,
    catalog_summary,
    describe_variant,
    generate_round,
    validate_group,
    validate_strength,
)


HOST = os.getenv("GALAKU_MCP_HOST", "127.0.0.1")
PORT = int(os.getenv("GALAKU_MCP_PORT", "8765"))
DEVICE_NAME = os.getenv("GALAKU_DEVICE_NAME", "K134")
DEVICE_ADDRESS = os.getenv("GALAKU_DEVICE_ADDRESS", "DF:49:D6:C2:7E:64")

CONTROL_UUID = "00001001-0000-1000-8000-00805f9b34fb"
NOTIFY_UUID = "00001002-0000-1000-8000-00805f9b34fb"

DEFAULT_DURATION_SECONDS = 30.0
MIN_DURATION_SECONDS = 5.0
MAX_DURATION_SECONDS = 120.0
MAX_VIBRATION = int(os.getenv("GALAKU_MAX_VIBRATION", "85"))
MAX_SUCTION = int(os.getenv("GALAKU_MAX_SUCTION", "85"))
ACCESS_TOKEN = os.getenv("GALAKU_ACCESS_TOKEN", "").strip()


def _validate_environment() -> None:
    if not 1 <= MAX_VIBRATION <= 100:
        raise RuntimeError("GALAKU_MAX_VIBRATION 必须在 1 到 100 之间")
    if not 1 <= MAX_SUCTION <= 100:
        raise RuntimeError("GALAKU_MAX_SUCTION 必须在 1 到 100 之间")


_validate_environment()


def validate_duration(value: Any) -> float:
    if value is None:
        return DEFAULT_DURATION_SECONDS
    try:
        duration = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError("持续时间必须是数字") from error
    if duration < MIN_DURATION_SECONDS or duration > MAX_DURATION_SECONDS:
        raise ValueError(
            f"持续时间必须在 {MIN_DURATION_SECONDS:g} 到 "
            f"{MAX_DURATION_SECONDS:g} 秒之间"
        )
    return duration


def is_authorized(
    authorization_header: str | None,
    access_token: str | None = None,
) -> bool:
    token = ACCESS_TOKEN if access_token is None else access_token
    if not token:
        return True
    supplied = authorization_header or ""
    expected = f"Bearer {token}"
    return hmac.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8"))


async def find_device(timeout: float = 15.0):
    if BleakScanner is None:
        raise RuntimeError("尚未安装蓝牙依赖，请先运行启动脚本")
    if DEVICE_ADDRESS:
        device = await BleakScanner.find_device_by_address(
            DEVICE_ADDRESS,
            timeout=timeout,
        )
        if device is not None:
            return device
    return await BleakScanner.find_device_by_name(DEVICE_NAME, timeout=timeout)


async def write_stop(client: Any) -> None:
    await client.write_gatt_char(CONTROL_UUID, STOP_COMMAND, response=True)


@dataclass(frozen=True)
class PlaybackRequest:
    session_id: str
    board: str
    scene: str
    strength: int
    duration_seconds: float
    initial_variant: Variant


class DevicePlaybackController:
    def __init__(self) -> None:
        self._shuffle_bag = ShuffleBag()
        self._command_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._worker: threading.Thread | None = None
        self._stop_event: threading.Event | None = None
        self._reroll_event: threading.Event | None = None
        self._state: dict[str, Any] = {
            "active": False,
            "phase": "idle",
            "device": DEVICE_NAME,
            "lastError": None,
        }

    def status(self) -> dict[str, Any]:
        with self._state_lock:
            return dict(self._state)

    def _set_state(self, **changes: Any) -> None:
        with self._state_lock:
            self._state.update(changes)

    def _stop_current_worker(self, timeout: float = 4.0) -> bool:
        worker = self._worker
        stop_event = self._stop_event
        if stop_event is not None:
            stop_event.set()
        if worker is not None and worker.is_alive():
            worker.join(timeout=timeout)
        return worker is None or not worker.is_alive()

    def play(
        self,
        board: str,
        scene: str,
        strength: int,
        duration_seconds: float,
    ) -> dict[str, Any]:
        validate_group(board, scene)
        strength = validate_strength(strength)
        duration_seconds = validate_duration(duration_seconds)

        with self._command_lock:
            if not self._stop_current_worker():
                raise RuntimeError("上一条蓝牙任务尚未安全停止，请先使用立即停止")

            session_id = uuid.uuid4().hex
            initial_variant = self._shuffle_bag.roll(board, scene)
            stop_event = threading.Event()
            reroll_event = threading.Event()
            request = PlaybackRequest(
                session_id=session_id,
                board=board,
                scene=scene,
                strength=strength,
                duration_seconds=duration_seconds,
                initial_variant=initial_variant,
            )
            worker = threading.Thread(
                target=self._run_worker,
                args=(request, stop_event, reroll_event),
                name=f"galaku-playback-{session_id[:8]}",
                daemon=True,
            )
            self._worker = worker
            self._stop_event = stop_event
            self._reroll_event = reroll_event
            self._set_state(
                active=True,
                phase="connecting",
                sessionId=session_id,
                board=board,
                boardLabel=BOARD_LABELS[board],
                scene=scene,
                sceneLabel=SCENE_LABELS[scene],
                strength=strength,
                durationSeconds=duration_seconds,
                variant=describe_variant(initial_variant),
                startedAt=time.time(),
                lastError=None,
            )
            worker.start()

        return {
            "ok": True,
            "accepted": True,
            "sessionId": session_id,
            "board": board,
            "boardLabel": BOARD_LABELS[board],
            "scene": scene,
            "sceneLabel": SCENE_LABELS[scene],
            "strength": strength,
            "durationSeconds": duration_seconds,
            "rolledVariant": {
                "id": initial_variant.id,
                "name": initial_variant.name,
                "description": initial_variant.description,
            },
            "message": "已随机抽取变体；后台连接设备后开始执行",
        }

    def reroll(self) -> dict[str, Any]:
        with self._command_lock:
            if (
                self._worker is None
                or not self._worker.is_alive()
                or self._reroll_event is None
            ):
                raise RuntimeError("当前没有正在执行的情景")
            self._reroll_event.set()
            state = self.status()
            return {
                "ok": True,
                "accepted": True,
                "sessionId": state.get("sessionId"),
                "message": "已请求跳过当前变体，将从同一情景抽取下一种",
            }

    def stop(self) -> dict[str, Any]:
        with self._command_lock:
            stopped = self._stop_current_worker(timeout=5.0)
            if stopped:
                self._set_state(active=False, phase="stopped")
            return {
                "ok": stopped,
                "stopped": stopped,
                "message": (
                    "已经停止并发送设备停止指令"
                    if stopped
                    else "已经请求停止，但蓝牙任务仍在退出"
                ),
            }

    def _run_worker(
        self,
        request: PlaybackRequest,
        stop_event: threading.Event,
        reroll_event: threading.Event,
    ) -> None:
        try:
            asyncio.run(self._play_request(request, stop_event, reroll_event))
        except Exception as error:
            self._set_state(
                active=False,
                phase="error",
                lastError=str(error),
                endedAt=time.time(),
            )

    async def _play_request(
        self,
        request: PlaybackRequest,
        stop_event: threading.Event,
        reroll_event: threading.Event,
    ) -> None:
        if BleakClient is None:
            raise RuntimeError("尚未安装蓝牙依赖，请先运行启动脚本")

        device = await find_device()
        if stop_event.is_set():
            self._set_state(active=False, phase="stopped", endedAt=time.time())
            return
        if device is None:
            raise RuntimeError(
                f"没有找到 {DEVICE_NAME}。请确认设备已开机，且手机 GALAKU App "
                "和手机蓝牙已经关闭"
            )

        client = BleakClient(device, timeout=20.0)
        notify_started = False
        started = time.monotonic()
        variant = request.initial_variant
        try:
            await client.connect()
            if stop_event.is_set():
                return
            await client.start_notify(NOTIFY_UUID, lambda _sender, _data: None)
            notify_started = True
            try:
                await client.read_gatt_char(NOTIFY_UUID)
            except Exception:
                pass
            await asyncio.sleep(0.3)
            await write_stop(client)
            await asyncio.sleep(0.15)

            while (
                not stop_event.is_set()
                and time.monotonic() - started < request.duration_seconds
            ):
                reroll_event.clear()
                self._set_state(
                    active=True,
                    phase="playing",
                    variant=describe_variant(variant),
                    elapsedSeconds=round(time.monotonic() - started, 2),
                )
                points = generate_round(variant, request.strength)
                previous: tuple[int, int] | None = None
                next_tick = time.monotonic()
                for point in points:
                    if (
                        stop_event.is_set()
                        or reroll_event.is_set()
                        or time.monotonic() - started >= request.duration_seconds
                    ):
                        break
                    vibration = min(point.vibration, MAX_VIBRATION)
                    suction = min(point.suction, MAX_SUCTION)
                    current = (vibration, suction)
                    if current != previous:
                        await client.write_gatt_char(
                            CONTROL_UUID,
                            control_command(vibration, suction),
                            response=True,
                        )
                        previous = current
                    next_tick += STEP_SECONDS
                    await asyncio.sleep(max(0.0, next_tick - time.monotonic()))
                if stop_event.is_set():
                    break
                variant = self._shuffle_bag.roll(request.board, request.scene)

            self._set_state(active=False, phase="completed", endedAt=time.time())
        finally:
            if client.is_connected:
                for _ in range(2):
                    try:
                        await write_stop(client)
                    except Exception:
                        pass
                if notify_started:
                    try:
                        await client.stop_notify(NOTIFY_UUID)
                    except Exception:
                        pass
                await client.disconnect()
            self._set_state(active=False, phase="stopped", endedAt=time.time())


PLAYBACK = DevicePlaybackController()


TOOLS = [
    {
        "name": "galaku_mode_catalog",
        "description": (
            "查看桃心 Pro 的两个板块、五种情景及每组五个随机变体。"
            "只读取目录，不连接或启动设备。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
    },
    {
        "name": "galaku_play_scene",
        "description": (
            "根据当前对话情景控制 GALAKU 桃心 Pro。设备未运行时，只有用户本人在当前"
            "对话中明确要求开始、继续、启动、试一下或使用玩具，才允许调用。AI或角色"
            "自行提出的话题、角色动作、情景推演、暗示或认为设备反馈合适，都不构成启动"
            "授权；此时只能在对话中询问或提议，并等待用户明确答应。普通聊天、查询状态或"
            "讨论模式时也不要启动设备。用户明确发起且设备正在运行后，AI可在这一轮内"
            "根据情景自主选择和切换，不必逐次询问；若不确定设备是否仍在运行，先调用"
            " galaku_status。设备停止或自然结束后，再次播放必须获得用户新的明确发起。"
            "若用户表达停止、暂停、不要、关闭、疼痛、不舒服或"
            "任何拒绝，停止指令优先级最高：立即调用 galaku_stop，且同一轮不得再调用"
            "本工具或 galaku_reroll。"
            "AI只选择板块、情景、力度和持续时间，不要选择固定变体；服务器会从对应的五个"
            "变体中随机抽取，并在持续时间内每轮自动抽取下一种且避免连续重复。"
            "用户明确要求只吮吸、不要震动时选择 suction_only；未特别说明或要求一起使用时"
            "默认选择 combined。"
            "情景选择：gentle 用于安抚、适应、开始和柔和互动；tease 用于调情、挑逗、"
            "故意停顿和制造期待；reward 用于表扬、完成要求和积极反馈；intense 只用于"
            "对话已经明显升级或明确需要强烈体验；punishment 用于双方约定的角色扮演、"
            "纪律或惩罚语境，重点是不规则和不可预测，并不代表自动使用最高力度。"
            "力度选择：1=刚开始或非常轻，2=轻，3=中等，4=明确强烈或逐步升级，"
            "5=明确要求最高或对话清楚进入最高强度；无法判断时选择较低一级。"
            "时长选择：短暂回应或转场用10至15秒，普通一轮用30秒，持续情景用45至60秒；"
            "只有用户明确要求长时间时才使用90至120秒。"
            "同一情景仍在播放时不要每句话都重新调用；需要同组换节奏时调用 galaku_reroll，"
            "板块、情景、力度或持续时间明显改变时才重新调用本工具。"
            "仅打开本地服务不代表允许启动设备；用户明确发起当前一轮后，运行期间的自动"
            "选择与切换才无需逐次询问确认。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "board": {
                    "type": "string",
                    "enum": list(BOARD_LABELS),
                    "description": "suction_only=仅吮吸；combined=震动＋吮吸。",
                },
                "scene": {
                    "type": "string",
                    "enum": list(SCENE_LABELS),
                    "description": (
                        "gentle=温和，tease=逗弄，reward=奖励，"
                        "intense=强烈，punishment=惩罚。"
                    ),
                },
                "strength": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 5,
                    "description": (
                        "AI根据对话自行选择的相对力度：1=非常轻或刚开始，2=轻，"
                        "3=中等，4=明确强烈，5=明确最高；不确定时降低一级。"
                    ),
                },
                "durationSeconds": {
                    "type": "number",
                    "minimum": MIN_DURATION_SECONDS,
                    "maximum": MAX_DURATION_SECONDS,
                    "default": DEFAULT_DURATION_SECONDS,
                    "description": (
                        "AI根据情景自行选择的持续时间：短暂回应10至15秒，普通一轮30秒，"
                        "持续情景45至60秒，明确要求长时间时90至120秒；期间自动轮换变体。"
                    ),
                },
            },
            "required": ["board", "scene", "strength", "durationSeconds"],
            "additionalProperties": False,
        },
    },
    {
        "name": "galaku_reroll",
        "description": (
            "保持当前板块、情景和力度不变，立即跳过当前节奏并随机抽取同组下一种"
            "变体。仅在设备正在播放、整体情景没有改变但需要增加新鲜感或对话节奏"
            "突然变化时调用；若板块、情景、力度或持续时间需要改变，应改用"
            " galaku_play_scene。用户表达停止或不适时不得调用本工具。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
    },
    {
        "name": "galaku_status",
        "description": "查看当前情景、力度、随机变体和播放状态，不启动设备。",
        "inputSchema": {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
    },
    {
        "name": "galaku_stop",
        "description": (
            "立即终止当前自动控制并向桃心 Pro 发送停止指令。"
            "这是最高优先级安全工具。用户表达停、停止、暂停、等等、不要、算了、关闭、"
            "疼痛、不舒服、不对劲、太强，或英文 stop/pause/no 时应立即调用，不要先追问。"
            "调用后同一轮不得再调用播放或重抽工具；只有用户之后明确恢复互动时才能重新播放。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
    },
]


def text_result(data: dict[str, Any], is_error: bool = False) -> dict[str, Any]:
    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(data, ensure_ascii=False, separators=(",", ":")),
            }
        ],
        "isError": is_error,
    }


def call_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    try:
        if name == "galaku_mode_catalog":
            return text_result({"ok": True, **catalog_summary()})
        if name == "galaku_status":
            return text_result({"ok": True, **PLAYBACK.status()})
        if name == "galaku_play_scene":
            result = PLAYBACK.play(
                board=str(arguments.get("board") or ""),
                scene=str(arguments.get("scene") or ""),
                strength=arguments.get("strength"),
                duration_seconds=arguments.get(
                    "durationSeconds",
                    DEFAULT_DURATION_SECONDS,
                ),
            )
            return text_result(result)
        if name == "galaku_reroll":
            return text_result(PLAYBACK.reroll())
        if name == "galaku_stop":
            return text_result(PLAYBACK.stop())
        return text_result(
            {"ok": False, "message": f"未知工具：{name}"},
            is_error=True,
        )
    except Exception as error:
        return text_result({"ok": False, "message": str(error)}, is_error=True)


class McpHandler(BaseHTTPRequestHandler):
    server_version = "GalakuK134MCP/2.0"

    def add_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type, Accept, Authorization, Mcp-Session-Id",
        )
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Expose-Headers", "Mcp-Session-Id")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-store")

    def send_json(self, status: int, body: Any) -> None:
        encoded = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.add_cors_headers()
        self.end_headers()
        self.wfile.write(encoded)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.add_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        if self.path == "/health":
            self.send_json(
                200,
                {
                    "ok": True,
                    "server": "GALAKU 桃心 Pro MCP",
                    "mcpUrl": f"http://{HOST}:{PORT}/mcp",
                    "authRequired": bool(ACCESS_TOKEN),
                    "playback": PLAYBACK.status(),
                },
            )
            return
        self.send_json(404, {"ok": False, "message": "Not found"})

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/mcp":
            self.send_json(404, {"ok": False, "message": "Not found"})
            return
        if not is_authorized(self.headers.get("Authorization")):
            self.send_json(
                401,
                {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {
                        "code": -32001,
                        "message": "Unauthorized: invalid or missing Bearer token",
                    },
                },
            )
            return
        request_id: Any = None
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 1_000_000:
                raise ValueError("Invalid request length")
            request = json.loads(self.rfile.read(length).decode("utf-8"))
            method = request.get("method")
            request_id = request.get("id")

            if request_id is None:
                self.send_response(202)
                self.add_cors_headers()
                self.end_headers()
                return

            if method == "initialize":
                result = {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {"listChanged": False}},
                    "serverInfo": {
                        "name": "galaku-k134-mcp",
                        "version": "2.0.0",
                    },
                }
            elif method == "ping":
                result = {}
            elif method == "tools/list":
                result = {"tools": TOOLS}
            elif method == "tools/call":
                params = request.get("params") or {}
                result = call_tool(
                    str(params.get("name") or ""),
                    params.get("arguments") or {},
                )
            else:
                self.send_json(
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

            self.send_json(
                200,
                {"jsonrpc": "2.0", "id": request_id, "result": result},
            )
        except Exception as error:
            self.send_json(
                400,
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {"code": -32700, "message": str(error)},
                },
            )

    def log_message(self, _format: str, *_args: Any) -> None:
        return


def main() -> None:
    if BleakClient is None:
        raise RuntimeError("缺少 bleak，请先运行启动脚本安装依赖")
    server = ThreadingHTTPServer((HOST, PORT), McpHandler)
    print("GALAKU 桃心 Pro MCP 已启动")
    print(f"MCP URL: http://{HOST}:{PORT}/mcp")
    print(f"设备: {DEVICE_NAME} ({DEVICE_ADDRESS or '按名称扫描'})")
    print(f"访问密钥: {'已配置' if ACCESS_TOKEN else '未配置（仅建议离线开发使用）'}")
    print("启动此窗口即允许本次会话中的 AI 自动选择情景和随机变体")
    print("关闭窗口或按 Ctrl+C 可停止服务")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        PLAYBACK.stop()
        server.server_close()


if __name__ == "__main__":
    main()
