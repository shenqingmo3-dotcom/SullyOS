from __future__ import annotations

import http.client
import json
import threading
import unittest

from server import HealthBackend, HealthHttpServer


INGEST_TOKEN = "ingest-token-for-tests-123456789"
MCP_TOKEN = "mcp-token-for-tests-123456789012"


class FakeHealthStore:
    ALLOWED_TYPES = ["heart_rate", "sleep_analysis"]

    def __init__(self):
        self.stored = []

    def normalize_payload(self, body):
        return body.get("samples", [])

    def store_samples(self, samples):
        self.stored.extend(samples)
        return len(samples), 0

    def health_now(self):
        return {"heart_rate": "72 bpm, just now"}

    async def execute_health_detail(self, args):
        return json.dumps({"ok": True, "args": args})


class HealthHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.store = FakeHealthStore()
        cls.server = HealthHttpServer(
            ("127.0.0.1", 0),
            HealthBackend(cls.store),
            ingest_token=INGEST_TOKEN,
            mcp_token=MCP_TOKEN,
            allow_origin="https://sully.example",
        )
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.port = cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        payload = None if body is None else json.dumps(body)
        all_headers = dict(headers or {})
        if payload is not None:
            all_headers["Content-Type"] = "application/json"
        conn.request(method, path, body=payload, headers=all_headers)
        response = conn.getresponse()
        raw = response.read().decode("utf-8")
        result = (
            response.status,
            dict(response.getheaders()),
            json.loads(raw) if raw else None,
        )
        conn.close()
        return result

    def mcp(self, method, params=None, request_id=1):
        return self.request(
            "POST",
            "/mcp",
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "method": method,
                "params": params or {},
            },
            {"Authorization": f"Bearer {MCP_TOKEN}"},
        )

    def test_readiness_contains_no_health_data(self):
        status, _, body = self.request("GET", "/healthz")
        self.assertEqual(status, 200)
        self.assertEqual(body["mcp"], "/mcp")
        self.assertNotIn("heart_rate", json.dumps(body))

    def test_cors_preflight(self):
        status, headers, _ = self.request("OPTIONS", "/mcp")
        self.assertEqual(status, 204)
        self.assertEqual(
            headers.get("Access-Control-Allow-Origin"),
            "https://sully.example",
        )
        self.assertIn("Authorization", headers["Access-Control-Allow-Headers"])

    def test_mcp_requires_bearer_token(self):
        status, _, body = self.request(
            "POST",
            "/mcp",
            {"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        )
        self.assertEqual(status, 401)
        self.assertEqual(body["error"]["code"], -32001)

    def test_initialize_and_list_tools(self):
        status, _, body = self.mcp("initialize")
        self.assertEqual(status, 200)
        self.assertEqual(body["result"]["serverInfo"]["name"], "health-collar-sullyos")

        status, _, body = self.mcp("tools/list", request_id=2)
        self.assertEqual(status, 200)
        self.assertEqual(
            [tool["name"] for tool in body["result"]["tools"]],
            ["health_now", "health_detail"],
        )

    def test_health_now_tool(self):
        status, _, body = self.mcp(
            "tools/call",
            {"name": "health_now", "arguments": {}},
        )
        self.assertEqual(status, 200)
        text = body["result"]["content"][0]["text"]
        self.assertEqual(json.loads(text)["heart_rate"], "72 bpm, just now")

    def test_health_detail_maps_argument_names(self):
        status, _, body = self.mcp(
            "tools/call",
            {
                "name": "health_detail",
                "arguments": {
                    "metric": "heart_rate",
                    "start": "2026-07-25T08:00:00+12:00",
                    "end": "2026-07-25T09:00:00+12:00",
                },
            },
        )
        self.assertEqual(status, 200)
        result = json.loads(body["result"]["content"][0]["text"])
        self.assertEqual(result["args"]["from"], "2026-07-25T08:00:00+12:00")
        self.assertEqual(result["args"]["to"], "2026-07-25T09:00:00+12:00")

    def test_ingest_requires_separate_token_and_filters_types(self):
        payload = {
            "samples": [
                {"type": "heart_rate", "at": "2026-07-25T08:00:00Z", "value": 70},
                {"type": "unknown", "at": "2026-07-25T08:00:00Z", "value": 1},
            ]
        }
        status, _, _ = self.request("POST", "/api/health", payload)
        self.assertEqual(status, 401)

        status, _, body = self.request(
            "POST",
            "/api/health",
            payload,
            {"X-Health-Token": INGEST_TOKEN},
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["received"], 2)
        self.assertEqual(body["accepted"], 1)
        self.assertEqual(body["stored"], 1)


if __name__ == "__main__":
    unittest.main()
