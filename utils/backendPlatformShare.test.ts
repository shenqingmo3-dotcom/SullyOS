import { describe, expect, it } from 'vitest';
import type { BackendConversationEventRecord } from '../types';
import { buildPlatformShareMessage } from './backendEventRuntime';

const event = (platform: 'x' | 'xhs'): BackendConversationEventRecord => ({
    sequenceId: 7,
    id: `share-${platform}`,
    conversationId: 'conversation',
    charId: 'character',
    charName: 'Sully',
    actorType: 'assistant',
    eventType: 'platform_share',
    content: '海边散步',
    metadata: {
        share: {
            platform,
            url: platform === 'x'
                ? 'https://x.com/shark/status/1234567890'
                : 'https://www.xiaohongshu.com/explore/0123456789abcdef01234567',
            noteId: platform === 'xhs' ? '0123456789abcdef01234567' : undefined,
            title: '海边散步',
            description: '风很轻。',
            author: '小鲨鱼',
            imageUrl: 'https://img.example/share.jpg',
            likes: 42,
            retweets: platform === 'x' ? 7 : undefined,
        },
    },
    occurredAt: '2026-08-12T00:00:00.000Z',
    createdAt: '2026-08-12T00:00:01.000Z',
    receivedAt: Date.parse('2026-08-12T00:00:01.000Z'),
});

describe('backend platform share cards', () => {
    it('renders an X share as a rich webpage card', () => {
        const message = buildPlatformShareMessage(event('x'));
        expect(message).toMatchObject({
            role: 'assistant',
            type: 'webpage_card',
            content: '海边散步',
            metadata: {
                webpage: {
                    siteName: 'X',
                    platform: 'x',
                    author: '小鲨鱼',
                    likes: 42,
                    retweets: 7,
                },
            },
        });
    });

    it('keeps a Xiaohongshu share on the xhs card renderer', () => {
        const message = buildPlatformShareMessage(event('xhs'));
        expect(message).toMatchObject({
            role: 'assistant',
            type: 'xhs_card',
            metadata: {
                xhsNote: {
                    noteId: '0123456789abcdef01234567',
                    title: '海边散步',
                    author: '小鲨鱼',
                    likes: 42,
                },
            },
        });
    });

    it('normalizes common nested X payload aliases for the character card', () => {
        const nested = event('x');
        nested.metadata = { share: {
            platform: 'x', url: 'https://x.com/a/status/1', title: '@a 的 X 帖子',
            post: { full_text: '正文', image_url: 'https://img.example/post.jpg', like_count: 9, retweet_count: 3 },
        } };
        expect(buildPlatformShareMessage(nested)?.metadata).toMatchObject({
            webpage: { excerpt: '正文', image: 'https://img.example/post.jpg', likes: 9, retweets: 3 },
        });
    });
});
