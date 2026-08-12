import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { ChatPrompts } from './chatPrompts';

const char = { id: 'c1', name: 'Sully', timeAwarenessEnabled: false } as any;
const userProfile = { name: '我' } as any;

function xCard(image = ''): Message {
    return {
        id: 1,
        charId: char.id,
        role: 'user',
        type: 'webpage_card',
        content: 'Small Fun',
        timestamp: Date.parse('2026-08-12T00:00:00.000Z'),
        metadata: {
            webpage: {
                platform: 'x',
                siteName: 'X',
                author: '@yongsa412',
                title: 'Small Fun',
                excerpt: '这是角色必须真正读到的帖子正文。',
                finalUrl: 'https://x.com/yongsa412/status/2087158741556928724',
                likes: 71,
                retweets: 428,
                image,
            },
        },
    } as Message;
}

describe('buildMessageHistory X webpage card', () => {
    it('puts the complete post and exact link into the model chat history', () => {
        const { apiMessages } = ChatPrompts.buildMessageHistory(
            [xCard()], 10, char, userProfile, [],
        );
        const content = apiMessages[0]?.content;

        expect(typeof content).toBe('string');
        expect(content).toContain('@yongsa412');
        expect(content).toContain('这是角色必须真正读到的帖子正文。');
        expect(content).toContain('https://x.com/yongsa412/status/2087158741556928724');
        expect(content).toContain('点赞 71');
        expect(content).toContain('转推 428');
        expect(content).not.toBe('Small Fun');
    });

    it('puts the post image into the same multimodal model message', () => {
        const image = 'https://img.example/x-post.jpg';
        const { apiMessages } = ChatPrompts.buildMessageHistory(
            [xCard(image)], 10, char, userProfile, [],
        );
        const content = apiMessages[0]?.content as any[];

        expect(Array.isArray(content)).toBe(true);
        expect(content[0]?.type).toBe('text');
        expect(content[0]?.text).toContain('这是角色必须真正读到的帖子正文。');
        expect(content[0]?.text).toContain('https://x.com/yongsa412/status/2087158741556928724');
        expect(content[1]).toEqual({ type: 'image_url', image_url: { url: image } });
    });
});
