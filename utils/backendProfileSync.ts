import type { CharacterProfile, UserProfile } from '../types';
import { openDB } from './db';
import {
    backendCharacterProfileChangeKey,
    enqueueBackendCharacterProfileChanges,
    type BackendMemoryChange,
} from './backendSyncQueue';

export const BACKEND_PROFILE_SYNC_EVENT = 'shark-backend-profile-sync-requested';
export const BACKEND_PROFILE_BACKFILL_KEY = 'shark_backend_profile_backfill_v1';

const nextRevision = (previous: unknown, now = Date.now()): number => Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.max(Math.trunc(Number(now) || 0), Math.trunc(Number(previous) || 0) + 1),
);

const characterProjection = (character: CharacterProfile) => ({
    name: character.name,
    description: character.description,
    systemPrompt: character.systemPrompt,
    worldview: character.worldview ?? null,
    writerPersona: character.writerPersona ?? null,
    mountedWorldbooks: character.mountedWorldbooks ?? [],
    selfInsights: character.selfInsights ?? [],
    impression: character.impression ?? null,
    interactionMode: character.interactionMode ?? 'online',
    interactionScene: character.interactionScene ?? null,
});

const userProjection = (user: UserProfile) => ({
    name: user.name,
    bio: user.bio,
    npcNetwork: user.npcNetwork ?? [],
});

export function hasBackendCharacterProfileChanged(
    previous: CharacterProfile | undefined,
    next: CharacterProfile,
): boolean {
    return !previous || JSON.stringify(characterProjection(previous)) !== JSON.stringify(characterProjection(next));
}

export function hasBackendUserProfileChanged(previous: UserProfile, next: UserProfile): boolean {
    return JSON.stringify(userProjection(previous)) !== JSON.stringify(userProjection(next));
}

export function refreshBackendCharacterProfileRevision(
    character: CharacterProfile,
    now = Date.now(),
): CharacterProfile {
    return { ...character, backendContextUpdatedAt: nextRevision(character.backendContextUpdatedAt, now) };
}

export function refreshBackendUserProfileRevision(user: UserProfile, now = Date.now()): UserProfile {
    return { ...user, backendContextUpdatedAt: nextRevision(user.backendContextUpdatedAt, now) };
}

export function reviseBackendCharacterProfile(
    previous: CharacterProfile | undefined,
    next: CharacterProfile,
    now = Date.now(),
): CharacterProfile {
    if (!hasBackendCharacterProfileChanged(previous, next)) return next;
    return refreshBackendCharacterProfileRevision({
        ...next,
        backendContextUpdatedAt: previous?.backendContextUpdatedAt ?? next.backendContextUpdatedAt,
    }, now);
}

export function reviseBackendUserProfile(
    previous: UserProfile,
    next: UserProfile,
    now = Date.now(),
): UserProfile {
    if (!hasBackendUserProfileChanged(previous, next)) return next;
    return refreshBackendUserProfileRevision({
        ...next,
        backendContextUpdatedAt: previous.backendContextUpdatedAt,
    }, now);
}

function notifyBackendProfileSync(charIds: string[]): void {
    if (typeof window === 'undefined' || charIds.length === 0) return;
    window.dispatchEvent(new CustomEvent(BACKEND_PROFILE_SYNC_EVENT, { detail: { charIds } }));
}

export async function queueBackendCharacterProfiles(
    profiles: Array<{ charId: string; updatedAt: number }>,
): Promise<void> {
    await enqueueBackendCharacterProfileChanges(profiles);
    notifyBackendProfileSync(profiles.map((profile) => profile.charId));
}

export function queueBackendCharacterProfile(character: CharacterProfile): Promise<void> {
    const updatedAt = Math.trunc(Number(character.backendContextUpdatedAt));
    if (!Number.isSafeInteger(updatedAt) || updatedAt <= 0) {
        return Promise.reject(new Error(`角色资料缺少有效同步修订号：${character.id}`));
    }
    return queueBackendCharacterProfiles([{
        charId: character.id,
        updatedAt,
    }]);
}

export async function registerBackendProfileBackfill(input: {
    characters: CharacterProfile[];
    user: UserProfile;
    now?: number;
}): Promise<{ characters: CharacterProfile[]; user: UserProfile; registered: boolean }> {
    if (localStorage.getItem(BACKEND_PROFILE_BACKFILL_KEY) === 'done') {
        return { ...input, registered: false };
    }

    const now = input.now ?? Date.now();
    const user = refreshBackendUserProfileRevision(input.user, now);
    const characters = input.characters.map((character) => refreshBackendCharacterProfileRevision(character, now));
    const db = await openDB();
    const requiredStores = ['characters', 'user_profile', 'backend_sync_queue'];
    if (requiredStores.some((store) => !db.objectStoreNames.contains(store))) {
        throw new Error('Shark 后端资料补传所需的 IndexedDB 存储不存在');
    }

    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(requiredStores, 'readwrite');
        const characterStore = tx.objectStore('characters');
        const userStore = tx.objectStore('user_profile');
        const queueStore = tx.objectStore('backend_sync_queue');
        userStore.put({ ...user, id: 'me' });
        for (const character of characters) {
            characterStore.put(character);
            queueStore.put({
                key: backendCharacterProfileChangeKey(character.id),
                charId: character.id,
                entityType: 'character_profile',
                entityId: 'profile',
                operation: 'upsert',
                updatedAt: character.backendContextUpdatedAt!,
            } satisfies BackendMemoryChange);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });

    localStorage.setItem(BACKEND_PROFILE_BACKFILL_KEY, 'done');
    notifyBackendProfileSync(characters.map((character) => character.id));
    return { characters, user, registered: true };
}
