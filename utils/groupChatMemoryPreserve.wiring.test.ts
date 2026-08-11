import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../apps/GroupChat.tsx', import.meta.url), 'utf8');

describe('group dissolution memory choice', () => {
    it('preserves shared memories by default and only deletes them after an explicit second choice', () => {
        expect(source).toContain('handleDeleteGroup(deleteGroupTargetId, false)');
        expect(source).toContain('保留共同记忆并解散');
        expect(source).toContain('handleDeleteGroup(deleteGroupTargetId, true)');
        expect(source).toContain('同时删除这段共同记忆');
        expect(source).toContain('if (deleteSharedMemories)');
    });
});
