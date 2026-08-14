import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile, UserProfile } from '../types';
import { DB } from './db';
import {
    BACKEND_PROFILE_BACKFILL_KEY,
    hasBackendCharacterProfileChanged,
    hasBackendUserProfileChanged,
    registerBackendProfileBackfill,
    reviseBackendCharacterProfile,
    reviseBackendUserProfile,
} from './backendProfileSync';
import {
    enqueueBackendCharacterProfileChange,
    enqueueBackendMemoryChanges,
    getBackendMemoryChanges,
    getBackendMemoryChangesByKeys,
} from './backendSyncQueue';

const character = (id: string, description = '旧人设'): CharacterProfile => ({
    id, name: `角色-${id}`, avatar: '', description, systemPrompt: '核心', memories: [],
});

const user = (name = '用户'): UserProfile => ({ name, avatar: '', bio: '简介', npcNetwork: [] });

describe('Shark backend profile revisions', () => {
    beforeEach(async () => {
        vi.restoreAllMocks();
        localStorage.clear();
        await DB.deleteDB();
    });

    it('bumps only fields that are part of the backend profile projection', () => {
        const before = { ...character('1'), backendContextUpdatedAt: 100 };
        const avatarOnly = { ...before, avatar: 'new-avatar' };
        expect(hasBackendCharacterProfileChanged(before, avatarOnly)).toBe(false);
        expect(reviseBackendCharacterProfile(before, avatarOnly, 200).backendContextUpdatedAt).toBe(100);

        const worldbookChanged = {
            ...before,
            mountedWorldbooks: [{ id: 'book', title: '书', content: '新正文' }],
        };
        expect(hasBackendCharacterProfileChanged(before, worldbookChanged)).toBe(true);
        expect(reviseBackendCharacterProfile(before, worldbookChanged, 100).backendContextUpdatedAt).toBe(101);

        const userBefore = { ...user(), backendContextUpdatedAt: 300 };
        expect(hasBackendUserProfileChanged(userBefore, { ...userBefore, avatar: 'new-avatar' })).toBe(false);
        expect(reviseBackendUserProfile(userBefore, { ...userBefore, npcNetwork: [{
            id: 'npc', name: '朋友', persona: '', userRelation: '', userAffinity: 0,
            characterRelations: [], createdAt: 1, updatedAt: 1,
        }] }, 300).backendContextUpdatedAt).toBe(301);
    });

    it('registers all existing profiles and the version marker in the required order', async () => {
        const result = await registerBackendProfileBackfill({
            characters: [character('1'), character('2')],
            user: user(),
            now: 1_000,
        });

        expect(result.registered).toBe(true);
        expect(localStorage.getItem(BACKEND_PROFILE_BACKFILL_KEY)).toBe('done');
        expect((await DB.getAllCharacters()).map(item => item.backendContextUpdatedAt)).toEqual([1_000, 1_000]);
        expect((await DB.getUserProfile())?.backendContextUpdatedAt).toBe(1_000);
        expect(await getBackendMemoryChanges('1')).toEqual([
            expect.objectContaining({ entityType: 'character_profile', entityId: 'profile', updatedAt: 1_000 }),
        ]);
        expect((await registerBackendProfileBackfill({
            characters: result.characters,
            user: result.user,
            now: 2_000,
        })).registered).toBe(false);
        expect((await getBackendMemoryChanges('1'))[0]?.updatedAt).toBe(1_000);
    });

    it('does not let an older enqueue overwrite a newer fixed-key marker', async () => {
        await enqueueBackendCharacterProfileChange('1', 200);
        await enqueueBackendCharacterProfileChange('1', 100);
        expect(await getBackendMemoryChanges('1')).toEqual([
            expect.objectContaining({ updatedAt: 200 }),
        ]);
    });

    it('can read the profile marker even when 200 older changes fill the regular window', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(100);
        await enqueueBackendMemoryChanges(Array.from({ length: 205 }, (_, index) => ({
            charId: '1', entityType: 'memory_node' as const, entityId: `old-${index}`,
            operation: 'upsert' as const, payload: { content: 'old' },
        })));
        await enqueueBackendCharacterProfileChange('1', 500);

        expect((await getBackendMemoryChanges('1', 200)).some(change => change.entityType === 'character_profile'))
            .toBe(false);
        expect(await getBackendMemoryChangesByKeys('1', ['1:character_profile:profile'])).toEqual([
            expect.objectContaining({ entityType: 'character_profile', updatedAt: 500 }),
        ]);
    });
});
