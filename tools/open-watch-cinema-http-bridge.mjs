import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';

const adapterPath = resolve(
  process.argv[2]
    || process.env.OPEN_WATCH_CINEMA_MCP
    || '../open-watch-cinema/mcp/server.mjs',
);
const port = Number(process.env.SULLYOS_CINEMA_MCP_PORT || 4190);

if (!existsSync(adapterPath)) {
  console.error(`找不到 Open Watch Cinema MCP：${adapterPath}`);
  console.error('请把 OPEN_WATCH_CINEMA_MCP 设为 open-watch-cinema/mcp/server.mjs 的绝对路径。');
  process.exit(1);
}

const child = spawn(process.execPath, [adapterPath], {
  env: process.env,
  stdio: ['pipe', 'pipe', 'inherit'],
  windowsHide: true,
});
const pending = new Map();
const sessionId = randomUUID();

readline.createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', line => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const key = JSON.stringify(message.id);
  const waiter = pending.get(key);
  if (!waiter) return;
  pending.delete(key);
  waiter.resolve(message);
});

child.on('exit', code => {
  const error = new Error(`Open Watch Cinema MCP 已退出（code ${code ?? 'unknown'}）`);
  for (const waiter of pending.values()) waiter.reject(error);
  pending.clear();
  process.exitCode = code || 1;
});

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization, mcp-protocol-version, mcp-session-id',
    'access-control-expose-headers': 'mcp-session-id',
    'mcp-session-id': sessionId,
  };
}

function sendJson(response, status, payload) {
  response.writeHead(status, { ...corsHeaders(), 'content-type': 'application/json; charset=utf-8' });
  response.end(payload === undefined ? '' : JSON.stringify(payload));
}

function forward(message) {
  if (!Object.hasOwn(message, 'id')) {
    child.stdin.write(`${JSON.stringify(message)}\n`);
    return Promise.resolve(undefined);
  }
  const key = JSON.stringify(message.id);
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(key);
      reject(new Error('Open Watch Cinema MCP 响应超时'));
    }, 65_000);
    pending.set(key, {
      resolve: value => { clearTimeout(timeout); resolvePromise(value); },
      reject: error => { clearTimeout(timeout); reject(error); },
    });
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

const server = createServer((request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, corsHeaders());
    response.end();
    return;
  }
  if (request.method !== 'POST' || request.url?.split('?')[0] !== '/mcp') {
    sendJson(response, 404, { error: 'not_found' });
    return;
  }
  const chunks = [];
  request.on('data', chunk => chunks.push(chunk));
  request.on('end', async () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const messages = Array.isArray(body) ? body : [body];
      const results = await Promise.all(messages.map(forward));
      const replies = results.filter(Boolean);
      if (replies.length === 0) {
        response.writeHead(202, corsHeaders());
        response.end();
      } else {
        sendJson(response, 200, Array.isArray(body) ? replies : replies[0]);
      }
    } catch (error) {
      sendJson(response, 500, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
      });
    }
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`SullyOS 影院 MCP 桥接已启动：http://127.0.0.1:${port}/mcp`);
  console.log(`stdio adapter：${adapterPath}`);
});

function shutdown() {
  server.close();
  child.kill();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
