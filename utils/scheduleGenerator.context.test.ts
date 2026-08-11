import { describe, expect, it } from 'vitest';
import type { CharacterProfile, Message, Task, UserProfile } from '../types';
import { formatChatHistoryForSchedule, formatUserScheduleForDate, resolveScheduleApiConfig } from './scheduleGenerator';

const char = {
    id: 'char-1',
    name: '阿澄',
    timeAwarenessEnabled: false,
} as CharacterProfile;

const user = { name: '小鱼' } as UserProfile;
const timestamp = new Date('2026-07-30T08:00:00Z').getTime();

const msg = (input: Partial<Message> & Pick<Message, 'id' | 'role' | 'type' | 'content'>): Message => ({
    charId: char.id,
    timestamp,
    ...input,
} as Message);

describe('日程历史与私聊消息格式对齐', () => {
    it('双语消息只保留原文侧，避免历史体积近乎翻倍', () => {
        const block = formatChatHistoryForSchedule([
            msg({
                id: 1,
                role: 'assistant',
                type: 'text',
                content: 'Bonjour, tu vas bien ?\n%%BILINGUAL%%\n你好，最近好吗？',
            }),
        ], char, user);

        expect(block).toContain('Bonjour, tu vas bien ?');
        expect(block).not.toContain('%%BILINGUAL%%');
        expect(block).not.toContain('你好，最近好吗？');
    });

    it('交换日记保留双方正文，并去掉原始 JSON 载荷', () => {
        const card = {
            type: 'diary_card',
            date: '2026-07-30',
            userName: user.name,
            userText: '今天路过旧书店，买到了找很久的画册。',
            charText: '下次记得把那本画册拍给我看，我想看看封面。',
        };
        const block = formatChatHistoryForSchedule([
            msg({
                id: 2,
                role: 'system',
                type: 'score_card',
                content: JSON.stringify(card),
                metadata: { scoreCard: card },
            }),
        ], char, user);

        expect(block).toContain('交换日记');
        expect(block).toContain(card.userText);
        expect(block).toContain(card.charText);
        expect(block).not.toContain('"userText"');
        expect(block).not.toContain('"charText"');
    });

    it('家园正文完整保留，且补上与私聊相同的共同世界框定', () => {
        const worldBody = '「家园 · 海边小屋」下午\n阿澄在露台浇花\n把晒蔫的薄荷搬到了阴影里。';
        const block = formatChatHistoryForSchedule([
            msg({
                id: 3,
                role: 'assistant',
                type: 'world_card',
                content: worldBody,
                metadata: { worldName: '海边小屋', mode: 'normal' },
            }),
        ], char, user);

        expect(block).toContain(worldBody);
        expect(block).toContain('共同世界「家园」');
    });

    it('HTML 卡片只保留可见文字摘要，不把完整 HTML/CSS 塞进日程', () => {
        const rawHtml = `[HTML卡片] <style>${'.card{color:red}'.repeat(1000)}</style><div>隐藏载荷</div>`;
        const block = formatChatHistoryForSchedule([
            msg({
                id: 4,
                role: 'assistant',
                type: 'html_card',
                content: rawHtml,
                metadata: { htmlTextPreview: '今天完成了一张旅行计划卡。' },
            }),
        ], char, user);

        expect(block).toContain('今天完成了一张旅行计划卡。');
        expect(block).not.toContain('.card{color:red}');
        expect(block.length).toBeLessThan(1000);
    });

    it('图片只保留文字占位，不携带 base64', () => {
        const block = formatChatHistoryForSchedule([
            msg({
                id: 5,
                role: 'user',
                type: 'image',
                content: `data:image/png;base64,${'A'.repeat(20_000)}`,
            }),
        ], char, user);

        expect(block).toContain('[User sent an image]');
        expect(block).not.toContain('data:image/png;base64');
        expect(block.length).toBeLessThan(1000);
    });
});

describe('用户日历约束', () => {
    it('把当日与每周重复日程交给角色调度，并尊重单日取消', () => {
        const tasks = [
            { id: 'weekly', title: '上午上课', supervisorId: char.id, tone: 'gentle', isCompleted: false, createdAt: 1, repeatWeekly: true, repeatDays: [4], startTime: '09:00', endTime: '11:00' },
            { id: 'once', title: '十二点一起吃饭', supervisorId: char.id, tone: 'gentle', isCompleted: false, createdAt: 2, scheduleDate: '2026-07-30', startTime: '12:00' },
            { id: 'cancelled', title: '取消的课', supervisorId: char.id, tone: 'gentle', isCompleted: false, createdAt: 3, repeatWeekly: true, repeatDays: [4], excludedDates: ['2026-07-30'], startTime: '15:00' },
        ] as Task[];
        const block = formatUserScheduleForDate(user, tasks, '2026-07-30', 4);
        expect(block).toContain('上午上课');
        expect(block).toContain('十二点一起吃饭');
        expect(block).not.toContain('取消的课');
        expect(block).toContain('只调整受影响时段');
    });
});

describe('日程副 API 路由', () => {
    const primary = { baseUrl: 'https://primary.example/v1', apiKey: 'primary', model: 'main' };

    it('优先使用角色的情绪/日程副 API', () => {
        const withSecondary = {
            ...char,
            emotionConfig: {
                enabled: true,
                api: { baseUrl: 'https://secondary.example/v1', apiKey: 'secondary', model: 'scheduler' },
            },
        } as CharacterProfile;
        expect(resolveScheduleApiConfig(withSecondary, primary)).toEqual(withSecondary.emotionConfig?.api);
    });

    it('副 API 未配置完整时回落主 API', () => {
        expect(resolveScheduleApiConfig(char, primary)).toBe(primary);
    });
});
