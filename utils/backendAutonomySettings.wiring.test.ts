import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('SharkOS backend autonomy settings wiring', () => {
    it('keeps every second-edition backend tool visible', () => {
        const source = read('../components/settings/BackendToolSettings.tsx');
        expect(source).toContain("['x.read', 'xhs.read', 'web.read', 'mcp.read', 'phone.read']");
        expect(source).toContain('导入前端已保存的小红书 Lite 配置');
        expect(source).toContain('导入前端已启用的 MCP 服务器');
        expect(source).toContain('导入浏览器 App 的 Brave Search 配置');
    });

    it('does not hide heartbeat and tool settings before pairing', () => {
        const source = read('../components/settings/SharkBackendSettings.tsx');
        expect(source).toContain('角色 heartbeat');
        expect(source).toContain('苏醒间隔');
        expect(source).toContain('空闲阈值');
        expect(source).toContain('自主活动冷却');
        expect(source).toContain('允许活动时段');
        expect(source).toContain('触发概率');
        expect(source).toContain('允许自主使用的能力');
        expect(source).toContain('<BackendToolSettings config={config}');
        expect(source).not.toContain('config.token.trim() && <BackendToolSettings');
    });

    it('keeps the existing XHS autonomy permissions when importing into the backend', () => {
        const source = read('../components/settings/BackendToolSettings.tsx');
        expect(source).toContain("allowShareToChat: local.autonomyPermissions?.shareToChat !== false");
        expect(source).toContain("allowLike: local.autonomyPermissions?.like !== false");
    });

    it('carries the backend pairing config in full backups', () => {
        const source = read('../context/OSContext.tsx');
        expect(source).toContain('backendChatConfig:');
        expect(source).toContain("localStorage.setItem('sullyos_backend_chat_v1'");
    });
});
