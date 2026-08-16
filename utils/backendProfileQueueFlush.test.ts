import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile, UserProfile } from '../types';
import {
    BackendContextValidationError,
    flushBackendMemorySyncQueue,
    type BackendChatConfig,
} from './backendClient';
import { DB } from './db';
import { calendarDateKey } from './sharedCalendarContext';
import {
    enqueueBackendCalendarContextChanges,
    enqueueBackendCharacterProfileChange,
    getBackendMemoryChanges,
} from './backendSyncQueue';

const config: BackendChatConfig = {
    enabled: true,
    serverContextEnabled: true,
    baseUrl: 'https://backend.example',
    token: 'token',
};

const character = (description: string, updatedAt: number): CharacterProfile => ({
    id: 'char-1', name: '小冰', avatar: '', description, systemPrompt: '核心', memories: [],
    backendContextUpdatedAt: updatedAt,
});

const user = (name: string, updatedAt: number): UserProfile => ({
    name, avatar: '', bio: '简介', backendContextUpdatedAt: updatedAt,
});

describe('backend character profile queue flush', () => {
    beforeEach(async () => {
        await DB.deleteDB();
        vi.restoreAllMocks();
        vi.stubGlobal('window', {
            setTimeout: globalThis.setTimeout.bind(globalThis),
            clearTimeout: globalThis.clearTimeout.bind(globalThis),
        });
    });

    it('forces a request for a profile-only marker and reads the latest IndexedDB snapshot', async () => {
        const latestCharacter = character('最新人设', 200);
        const latestUser = user('最新用户', 200);
        await DB.saveCharacter(latestCharacter);
        await DB.saveUserProfile(latestUser);
        await enqueueBackendCharacterProfileChange(latestCharacter.id, 200);
        let requestBody: any;
        vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
            requestBody = JSON.parse(String(init?.body));
            return new Response(JSON.stringify({ data: { profileApplied: true } }), { status: 200 });
        }));

        await flushBackendMemorySyncQueue({
            config,
            character: character('闭包旧人设', 100),
            user: user('闭包旧用户', 100),
        });

        expect(requestBody.character.description).toBe('最新人设');
        expect(requestBody.user.name).toBe('最新用户');
        expect(await getBackendMemoryChanges(latestCharacter.id)).toEqual([]);
    });

    it('calendar-only marker syncs current user schedule and only this character anniversaries', async () => {
        const latestCharacter = character('人设', 200);
        await DB.saveCharacter(latestCharacter);
        await DB.saveUserProfile(user('用户', 200));
        await DB.saveTask({
            id: 'task-1', title: '复诊', supervisorId: latestCharacter.id, tone: 'gentle', isCompleted: false,
            createdAt: 1, scheduleDate: calendarDateKey(new Date()), startTime: '10:00',
        });
        await DB.saveAnniversary({ id: 'a', title: '我们的纪念日', date: '2030-01-01', charId: latestCharacter.id });
        await DB.saveAnniversary({ id: 'b', title: '别人的纪念日', date: '2030-01-01', charId: 'char-2' });
        await enqueueBackendCalendarContextChanges([latestCharacter.id]);
        let requestBody: any;
        vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
            requestBody = JSON.parse(String(init?.body));
            return new Response(JSON.stringify({ data: {} }), { status: 200 });
        }));

        await flushBackendMemorySyncQueue({ config, character: latestCharacter, user: user('用户', 200) });

        expect(requestBody.character.metadata.currentUserSchedule.entries[0].title).toBe('复诊');
        expect(requestBody.character.metadata.relationshipAnniversaries.map((item: any) => item.title))
            .toEqual(['我们的纪念日']);
        expect(await getBackendMemoryChanges(latestCharacter.id)).toEqual([]);
    });

    it('keeps a newer marker written while the older request is in flight', async () => {
        const latestCharacter = character('第一版', 100);
        await DB.saveCharacter(latestCharacter);
        await DB.saveUserProfile(user('用户', 100));
        await enqueueBackendCharacterProfileChange(latestCharacter.id, 100);
        let resolveFetch!: (response: Response) => void;
        vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; })));

        const flushing = flushBackendMemorySyncQueue({ config, character: latestCharacter, user: user('用户', 100) });
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        await enqueueBackendCharacterProfileChange(latestCharacter.id, 200);
        resolveFetch(new Response(JSON.stringify({ data: { profileApplied: true } }), { status: 200 }));
        await flushing;

        expect(await getBackendMemoryChanges(latestCharacter.id)).toEqual([
            expect.objectContaining({ updatedAt: 200 }),
        ]);
    });

    it('keeps the marker when the server does not confirm a profile version', async () => {
        const latestCharacter = character('待确认', 300);
        await DB.saveCharacter(latestCharacter);
        await DB.saveUserProfile(user('用户', 300));
        await enqueueBackendCharacterProfileChange(latestCharacter.id, 300);
        vi.stubGlobal('fetch', vi.fn(async () => (
            new Response(JSON.stringify({ data: {} }), { status: 200 })
        )));

        await expect(flushBackendMemorySyncQueue({
            config,
            character: latestCharacter,
            user: user('用户', 300),
        })).rejects.toThrow('后端未确认角色资料快照版本');
        expect(await getBackendMemoryChanges(latestCharacter.id)).toEqual([
            expect.objectContaining({ updatedAt: 300 }),
        ]);
    });

    it('keeps the marker and local snapshot when validation rejects an oversized worldbook', async () => {
        const oversizedCharacter: CharacterProfile = {
            ...character('本地已保存的新人设', 400),
            mountedWorldbooks: [{
                id: 'book-over-limit', title: '超限世界书', content: 'x'.repeat(200_001),
            }],
        };
        await DB.saveCharacter(oversizedCharacter);
        await DB.saveUserProfile(user('用户', 400));
        await enqueueBackendCharacterProfileChange(oversizedCharacter.id, 400);
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(flushBackendMemorySyncQueue({
            config,
            character: oversizedCharacter,
            user: user('用户', 400),
        })).rejects.toBeInstanceOf(BackendContextValidationError);
        expect(fetchMock).not.toHaveBeenCalled();
        expect((await DB.getAllCharacters()).find(item => item.id === oversizedCharacter.id)
            ?.mountedWorldbooks?.[0]?.content)
            .toHaveLength(200_001);
        expect(await getBackendMemoryChanges(oversizedCharacter.id)).toEqual([
            expect.objectContaining({ updatedAt: 400 }),
        ]);
    });
});
