import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('SharkOS second-edition feature closure wiring', () => {
    it('starts backend event and cinema runtimes and removes backend character state', () => {
        const source = read('../context/OSContext.tsx');
        expect(source).toContain('startBackendEventRuntime()');
        expect(source).toContain('startCinemaAgentRuntime({ characters, user: userProfile, groups, apiConfig, realtimeConfig })');
        expect(source).toContain('deleteBackendCharacter(backendConfig, id)');
        expect(source).toContain("window.addEventListener('backend-card-received'");
    });

    it('keeps chat deletion, mode and schedule changes synchronized with the backend', () => {
        const source = read('../apps/Chat.tsx');
        expect(source).toContain('await DB.deleteMessages(targets.map(message => message.id))');
        const db = read('../utils/db.ts');
        expect(db).toContain('queueBackendMessageDeletion(queue, request.result as Message | undefined)');
        expect(source).toContain('flushBackendMemorySyncQueue({');
        expect(source).toContain("console.warn('[interaction-mode] backend sync failed'");
        expect(source).toContain("console.warn('[Schedule] backend snapshot sync failed'");
        expect(source.match(/syncScheduleSnapshot\(targetChar\)/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
        expect(source).toContain('syncScheduleSnapshot(updatedChar)');
        expect(source.match(/deleteMessagesEverywhere\(/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    });

    it('keeps the first chat tool page at eight items on small screens', () => {
        const source = read('../components/chat/ChatInputArea.tsx');
        const firstPage = source.slice(source.indexOf("actionsPage === 0"), source.indexOf('Page 1: 外部服务'));
        const secondPage = source.slice(source.indexOf('Page 1: 外部服务'), source.indexOf('Page 2: 更多'));
        expect(firstPage).not.toContain("onPanelAction('schedule')");
        expect(secondPage).toContain("onPanelAction('schedule')");
    });

    it('keeps memory-palace destructive actions synchronized with the backend', () => {
        const source = read('../apps/MemoryPalaceApp.tsx');
        expect(source).toContain('const flushMemoryDeletesToBackend = useCallback');
        expect(source).toContain('deleteBackendMemoryPalace(backendConfig)');
        expect(source.match(/flushMemoryDeletesToBackend\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    });

    it('persists frontend MCP results as cards and observes cinema calls', () => {
        const source = read('../hooks/useChatAI.ts');
        expect(source).toContain('const persistMcpResultCard = async');
        expect(source).toContain("type: 'mcp_activity_card'");
        expect(source.match(/persistMcpResultCard\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
        expect(source).toContain('observeCinemaMcpCall({');
        expect(source).toContain('flushBackendMemorySyncQueue({');
        expect(source).toContain('syncBackendContext({');
    });

    it('injects the active external cinema session into ordinary chat context', () => {
        const source = read('./chatRequestPayload.ts');
        expect(source).toContain("import { buildActiveCinemaContext } from './cinemaMemory'");
        expect(source).toContain('volatileTail += await buildActiveCinemaContext(char.id, char.name)');
    });

    it('syncs the same timezone-aware daily schedule used by the app', () => {
        const source = read('./backendClient.ts');
        expect(source).toContain("import { getDailyScheduleForChar } from './dailySchedule'");
        expect(source).toContain("import { resolveCharTimeZone } from './timezone'");
        expect(source).toContain('await getDailyScheduleForChar(character)');
        expect(source).toContain('timezone: resolveCharTimeZone(character)');
        expect(source).not.toContain("new Date().toISOString().split('T')[0]");
    });

    it('keeps the diary, reading, NPC and backend tool feature entrances connected', () => {
        const journal = read('../apps/JournalApp.tsx');
        expect(journal).toContain('syncBackendDiary(config');
        expect(journal).toContain('deleteBackendDiary(config');
        expect(journal).toContain("window.addEventListener('backend-event-received'");

        const together = read('../apps/TogetherApp.tsx');
        expect(together).toContain('TogetherStore.saveSession');
        expect(together).toContain('flushBackendMemorySyncQueue');

        const character = read('../apps/Character.tsx');
        expect(character).toContain('npcNetwork');
        expect(character).toContain('syncBackendContext({');

        const tools = read('../components/settings/BackendToolSettings.tsx');
        expect(tools).toContain("['x.read', 'xhs.read', 'web.read', 'mcp.read', 'phone.read']");
    });

    it('does not render developer overlays in production', () => {
        const source = read('../App.tsx');
        expect(source).toContain('import.meta.env.DEV && <BuildBadge />');
        expect(source).toContain('import.meta.env.DEV && <DevDebugPanel />');
        const settings = read('../apps/Settings.tsx');
        expect(settings).toContain('import.meta.env.DEV && <VersionInfo />');
    });
});
