import asyncio
import json
import threading
import unittest
from unittest.mock import patch

import pattern_engine
import server


class McpToolDefinitionTests(unittest.TestCase):
    def test_expected_semantic_tools_are_exposed(self) -> None:
        names = {tool["name"] for tool in server.TOOLS}
        self.assertEqual(
            names,
            {
                "galaku_mode_catalog",
                "galaku_play_scene",
                "galaku_reroll",
                "galaku_status",
                "galaku_stop",
            },
        )

    def test_play_tool_has_strict_scene_schema(self) -> None:
        tool = next(
            item for item in server.TOOLS if item["name"] == "galaku_play_scene"
        )
        schema = tool["inputSchema"]
        self.assertEqual(
            set(schema["required"]),
            {"board", "scene", "strength", "durationSeconds"},
        )
        self.assertEqual(
            schema["properties"]["board"]["enum"],
            ["suction_only", "combined"],
        )
        self.assertEqual(
            schema["properties"]["scene"]["enum"],
            ["gentle", "tease", "reward", "intense", "punishment"],
        )
        self.assertFalse(schema["additionalProperties"])

    def test_tool_guidance_contains_autonomy_and_stop_rules(self) -> None:
        tools = {tool["name"]: tool for tool in server.TOOLS}
        play_description = tools["galaku_play_scene"]["description"]
        stop_description = tools["galaku_stop"]["description"]
        self.assertIn("只有用户本人", play_description)
        self.assertIn("只能在对话中询问或提议", play_description)
        self.assertIn("停止或自然结束后", play_description)
        self.assertIn("无需逐次询问确认", play_description)
        self.assertIn("普通聊天", play_description)
        self.assertIn("无法判断时选择较低一级", play_description)
        self.assertIn("最高优先级安全工具", stop_description)
        self.assertIn("同一轮不得再调用播放", stop_description)

    def test_catalog_tool_returns_all_fifty_variants_without_hardware(self) -> None:
        result = server.call_tool("galaku_mode_catalog", {})
        self.assertFalse(result["isError"])
        payload = json.loads(result["content"][0]["text"])
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["variantCount"], 50)
        self.assertEqual(len(payload["groups"]), 10)

    def test_play_tool_delegates_semantic_selection_to_controller(self) -> None:
        expected = {"ok": True, "rolledVariant": {"name": "故意错拍"}}
        with patch.object(server.PLAYBACK, "play", return_value=expected) as play:
            result = server.call_tool(
                "galaku_play_scene",
                {
                    "board": "combined",
                    "scene": "tease",
                    "strength": 3,
                    "durationSeconds": 20,
                },
            )
        self.assertFalse(result["isError"])
        play.assert_called_once_with(
            board="combined",
            scene="tease",
            strength=3,
            duration_seconds=20,
        )

    def test_invalid_duration_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            server.validate_duration(4.9)
        with self.assertRaises(ValueError):
            server.validate_duration(120.1)

    def test_bearer_token_authentication(self) -> None:
        self.assertTrue(server.is_authorized(None, access_token=""))
        self.assertFalse(server.is_authorized(None, access_token="secret"))
        self.assertFalse(
            server.is_authorized("Bearer wrong", access_token="secret")
        )
        self.assertTrue(
            server.is_authorized("Bearer secret", access_token="secret")
        )


class FakeBleakClient:
    last_instance = None

    def __init__(self, _device, timeout: float) -> None:
        self.timeout = timeout
        self.is_connected = False
        self.writes = []
        FakeBleakClient.last_instance = self

    async def connect(self) -> None:
        self.is_connected = True

    async def start_notify(self, _uuid, _callback) -> None:
        return None

    async def read_gatt_char(self, _uuid) -> bytes:
        return b""

    async def write_gatt_char(self, uuid, data, response: bool) -> None:
        self.writes.append((uuid, data, response))

    async def stop_notify(self, _uuid) -> None:
        return None

    async def disconnect(self) -> None:
        self.is_connected = False


class PlaybackLoopTests(unittest.TestCase):
    def test_offline_fake_device_receives_pattern_and_final_stop(self) -> None:
        controller = server.DevicePlaybackController()
        variant = pattern_engine.VARIANTS_BY_GROUP[("combined", "gentle")][0]
        request = server.PlaybackRequest(
            session_id="offline-test",
            board="combined",
            scene="gentle",
            strength=1,
            duration_seconds=0.65,
            initial_variant=variant,
        )

        async def fake_find_device(timeout: float = 15.0):
            return object()

        with (
            patch.object(server, "BleakClient", FakeBleakClient),
            patch.object(server, "find_device", fake_find_device),
        ):
            asyncio.run(
                controller._play_request(
                    request,
                    threading.Event(),
                    threading.Event(),
                )
            )

        writes = FakeBleakClient.last_instance.writes
        payloads = [write[1] for write in writes]
        self.assertTrue(any(payload != server.STOP_COMMAND for payload in payloads))
        self.assertEqual(payloads[-1], server.STOP_COMMAND)
        self.assertEqual(payloads[-2], server.STOP_COMMAND)


if __name__ == "__main__":
    unittest.main()
