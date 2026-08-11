import { describe, expect, it } from 'vitest';
import { MCP_TOOLS, createHealthWorker, type Env } from './index';

const TOKEN_A = 'ingest-token-abcdefghijklmnopqrstuvwxyz';
const TOKEN_B = 'mcp-token-abcdefghijklmnopqrstuvwxyz123';

const fakeEnv = (): Env => ({
    DB: {
        exec: async () => ({}),
        prepare: () => {
            throw new Error('prepare should not be used in this test');
        },
        batch: async () => [],
    },
    HEALTH_INGEST_TOKEN: TOKEN_A,
    MCP_ACCESS_TOKEN: TOKEN_B,
    HEALTH_TIME_ZONE: 'Pacific/Auckland',
});

describe('Cloudflare health MCP surface', () => {
    it('exposes only the three read-only health tools', () => {
        expect(MCP_TOOLS.map(tool => tool.name)).toEqual([
            'health_now',
            'health_detail',
            'health_trends',
        ]);
    });

    it('keeps healthz free of health data', async () => {
        const response = await createHealthWorker().fetch(
            new Request('https://health.example/healthz'),
            fakeEnv(),
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            ok: true,
            service: 'sullyos-health-mcp-cloudflare',
            version: '0.1.0',
            storage: 'cloudflare-d1',
        });
    });

    it('lists tools through authenticated stateless HTTP MCP', async () => {
        const response = await createHealthWorker().fetch(
            new Request('https://health.example/mcp', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${TOKEN_B}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'tools/list',
                    params: {},
                }),
            }),
            fakeEnv(),
        );
        expect(response.status).toBe(200);
        const body = await response.json() as any;
        expect(body.result.tools).toHaveLength(3);
        expect(body.result.tools[2].name).toBe('health_trends');
    });

    it('rejects MCP without the read token', async () => {
        const response = await createHealthWorker().fetch(
            new Request('https://health.example/mcp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'tools/list',
                }),
            }),
            fakeEnv(),
        );
        expect(response.status).toBe(401);
    });
});
