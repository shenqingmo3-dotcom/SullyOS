import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { contextSyncSchema } from '../src/contextSchemas.js';
import { memoryToKind, messageRoleToEventType, millisToDate } from '../src/contextMapping.js';
import { buildProfileMetadataPatch } from '../src/contextSync.js';

describe('context sync mapping', () => {
  it('maps SullyOS roles to typed backend events', () => {
    expect(messageRoleToEventType('user')).toBe('user_message');
    expect(messageRoleToEventType('assistant')).toBe('assistant_message');
    expect(messageRoleToEventType('system')).toBe('system_event');
  });

  it('keeps event-box summaries distinguishable from ordinary memories', () => {
    expect(memoryToKind({ isBoxSummary: true })).toBe('summary');
    expect(memoryToKind({ isBoxSummary: false })).toBe('episode');
  });

  it('converts SullyOS millisecond timestamps without losing time', () => {
    expect(millisToDate(1_700_000_000_123)?.getTime()).toBe(1_700_000_000_123);
    expect(millisToDate(undefined)).toBeNull();
  });

  it('does not accept unrelated API credentials into the context payload', () => {
    const parsed = contextSyncSchema.parse({
      clientId: 'browser-test',
      apiConfig: { apiKey: 'must-not-be-synced' },
      user: { name: 'User', bio: '' },
      character: {
        id: 'char-1',
        name: 'Sully',
        description: '',
        systemPrompt: '',
      },
    });

    expect('apiConfig' in parsed).toBe(false);
  });

  it('reads character metadata from the synchronized profile column', () => {
    const source = readFileSync(new URL('../src/contextBuilder.ts', import.meta.url), 'utf8');

    expect(source).toContain('a.profile_metadata AS metadata');
    expect(source).not.toContain('a.metadata');
  });

  it('preserves absent managed fields and treats explicit empty values as clearing', () => {
    const legacy = contextSyncSchema.parse({
      clientId: 'browser-test',
      user: { name: 'User', bio: '' },
      character: { id: 'char-1', name: 'Sully', metadata: { interactionMode: 'online' } },
    });
    expect(buildProfileMetadataPatch(legacy)).toEqual({ interactionMode: 'online' });

    const current = contextSyncSchema.parse({
      clientId: 'browser-test',
      user: { name: '小鱼', bio: '简介' },
      character: {
        id: 'char-1', name: '小冰', updatedAt: 123,
        mountedWorldbooks: [], selfInsights: [], impression: null,
        metadata: { npcNetwork: [{ name: '朋友' }] },
      },
    });
    expect(buildProfileMetadataPatch(current)).toMatchObject({
      mountedWorldbooks: [], selfInsights: [], impression: null,
      userSnapshot: { name: '小鱼', bio: '简介', npcNetwork: [{ name: '朋友' }] },
    });
  });

  it('normalizes recoverable worldbook fields and rejects oversized snapshots', () => {
    const parsed = contextSyncSchema.parse({
      clientId: 'browser-test', user: { name: 'User' },
      character: {
        id: 'char-1', name: 'Sully',
        mountedWorldbooks: [{
          id: 'book-1', content: '正文', position: 99, probability: -5,
          scanDepth: '7', caseSensitive: 'false',
        }],
      },
    });
    expect(parsed.character.mountedWorldbooks?.[0]).toMatchObject({
      title: '未命名世界书', position: 6, probability: 0, scanDepth: 7, caseSensitive: false,
    });

    expect(() => contextSyncSchema.parse({
      clientId: 'browser-test', user: { name: 'User' },
      character: {
        id: 'char-1', name: 'Sully',
        mountedWorldbooks: [{ id: 'book-1', content: 'x'.repeat(200_001) }],
      },
    })).toThrow();
  });

  it('accepts the exact worldbook boundaries and rejects count or total overflow', () => {
    const base = {
      clientId: 'browser-test', user: { name: 'User' },
      character: { id: 'char-1', name: 'Sully' },
    };
    const atBoundary = Array.from({ length: 500 }, (_, index) => ({
      id: `book-${index}`,
      content: 'x'.repeat(400),
    }));

    expect(contextSyncSchema.parse({
      ...base,
      character: { ...base.character, mountedWorldbooks: atBoundary },
    }).character.mountedWorldbooks).toHaveLength(500);
    expect(contextSyncSchema.parse({
      ...base,
      character: {
        ...base.character,
        mountedWorldbooks: [{ id: 'book-max', content: 'x'.repeat(200_000) }],
      },
    }).character.mountedWorldbooks?.[0]?.content).toHaveLength(200_000);

    expect(() => contextSyncSchema.parse({
      ...base,
      character: {
        ...base.character,
        mountedWorldbooks: [...atBoundary, { id: 'book-over-count', content: '' }],
      },
    })).toThrow();
    expect(() => contextSyncSchema.parse({
      ...base,
      character: {
        ...base.character,
        mountedWorldbooks: [
          { id: 'book-a', content: 'x'.repeat(100_000) },
          { id: 'book-b', content: 'x'.repeat(100_001) },
        ],
      },
    })).toThrow('挂载世界书正文合计不能超过 200000 字符');
  });

  it('guards profile columns with client_updated_at while merging metadata keys', () => {
    const source = readFileSync(new URL('../src/contextSync.ts', import.meta.url), 'utf8');
    expect(source).toContain('characters.profile_metadata || EXCLUDED.profile_metadata');
    expect(source).toContain('EXCLUDED.client_updated_at >= characters.client_updated_at');
    expect(source).toContain('profileApplied');
  });
});
