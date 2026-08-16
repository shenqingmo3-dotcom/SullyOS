import { describe, expect, it } from 'vitest';
import type { CharacterProfile, UserProfile } from '../types';
import {
    BackendContextValidationError,
    buildBackendCharacterContextPayload,
} from './backendClient';

function character(content = '完整正文 {{char}} / {{user}}'): CharacterProfile {
    return {
        id: 'char-1', name: '小冰', avatar: '', description: '备注', systemPrompt: '核心人设', memories: [],
        backendContextUpdatedAt: 100,
        mountedWorldbooks: [{
            id: 'book-1', title: '线上转线下', category: '互动模式', content,
            constant: true, position: 1, probability: 80, useProbability: true,
        }],
        selfInsights: ['我会记得用户喜欢海边。'],
        impression: {
            version: 3,
            value_map: { likes: [], dislikes: [], core_values: '' },
            behavior_profile: { tone_style: '', emotion_summary: '', response_patterns: '' },
            emotion_schema: { triggers: { positive: [], negative: [] }, comfort_zone: '', stress_signals: [] },
            personality_core: { observed_traits: [], interaction_style: '', summary: '很坦率' },
        },
    };
}

const user: UserProfile = {
    name: '小鱼', avatar: '', bio: '用户简介', backendContextUpdatedAt: 200,
};

describe('backend character profile mapping', () => {
    it('sends the complete mounted text and the newest profile revision', () => {
        const payload = buildBackendCharacterContextPayload({ character: character(), user });
        expect(payload.updatedAt).toBe(200);
        expect(payload.mountedWorldbooks).toEqual([
            expect.objectContaining({
                title: '线上转线下', content: '完整正文 {{char}} / {{user}}',
                constant: true, position: 1, probability: 80, useProbability: true,
            }),
        ]);
        expect(payload.selfInsights).toEqual(['我会记得用户喜欢海边。']);
        expect(payload.impression).toMatchObject({ personality_core: { summary: '很坦率' } });
    });

    it('maps shared calendar facts into optional backend metadata without empty placeholders', () => {
        const payload = buildBackendCharacterContextPayload({
            character: character(),
            user,
            sharedCalendar: {
                date: '2026-08-20',
                userSchedule: [{ id: 'task-1', title: '复诊', startTime: '10:00' }],
                relationshipAnniversaries: [{
                    id: 'anni-1', title: '相遇日', date: '2026-08-22', dayDifference: 2, direction: 'countdown',
                }],
            },
        });
        expect(payload.metadata).toMatchObject({
            currentUserSchedule: { date: '2026-08-20', entries: [{ title: '复诊', startTime: '10:00' }] },
            relationshipAnniversaries: [{ title: '相遇日', dayDifference: 2 }],
        });
        expect(buildBackendCharacterContextPayload({ character: character(), user }).metadata)
            .toMatchObject({ currentDailySchedule: null, currentUserSchedule: null, relationshipAnniversaries: null });
    });

    it('does not silently truncate an oversized worldbook', () => {
        expect(() => buildBackendCharacterContextPayload({
            character: character('x'.repeat(200_001)), user,
        })).toThrow(BackendContextValidationError);
    });

    it('accepts exact count and text limits, then rejects count or total overflow', () => {
        const atBoundary = Array.from({ length: 500 }, (_, index) => ({
            id: `book-${index}`,
            title: `书-${index}`,
            content: 'x'.repeat(400),
        }));
        expect(buildBackendCharacterContextPayload({
            character: { ...character(), mountedWorldbooks: atBoundary },
            user,
        }).mountedWorldbooks).toHaveLength(500);
        expect(buildBackendCharacterContextPayload({
            character: {
                ...character(),
                mountedWorldbooks: [{ id: 'book-max', title: '极限', content: 'x'.repeat(200_000) }],
            },
            user,
        }).mountedWorldbooks[0]?.content).toHaveLength(200_000);

        expect(() => buildBackendCharacterContextPayload({
            character: {
                ...character(),
                mountedWorldbooks: [...atBoundary, { id: 'book-over-count', title: '超数', content: '' }],
            },
            user,
        })).toThrow(BackendContextValidationError);
        expect(() => buildBackendCharacterContextPayload({
            character: {
                ...character(),
                mountedWorldbooks: [
                    { id: 'book-a', title: 'A', content: 'x'.repeat(100_000) },
                    { id: 'book-b', title: 'B', content: 'x'.repeat(100_001) },
                ],
            },
            user,
        })).toThrow(BackendContextValidationError);
    });
});
