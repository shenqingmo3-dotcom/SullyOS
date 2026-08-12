import { describe, expect, it, vi } from 'vitest';
import type { BackendChatConfig } from './backendClient';
import * as backendClient from './backendClient';
import { appendXChatReadContext, loadXChatReadContext, parseXChatReadIntent } from './xChatRead';

const config: BackendChatConfig = {
  enabled: true,
  serverContextEnabled: false,
  baseUrl: 'https://backend.example.com',
  token: 'token',
};

describe('X chat read intent', () => {
  it('recognizes explicit home, profile, following and status requests', () => {
    expect(parseXChatReadIntent('你去黑x看看首页')).toEqual({ kind: 'home' });
    expect(parseXChatReadIntent('去 X 看看 @shark 的主页')).toEqual({ kind: 'profile', handle: 'shark' });
    expect(parseXChatReadIntent('让角色去黑x看我的主页')).toEqual({ kind: 'profile' });
    expect(parseXChatReadIntent('帮我去推特看看我的关注列表')).toEqual({ kind: 'following' });
    expect(parseXChatReadIntent('看看这个 X 帖子 https://x.com/shark/status/123')).toEqual({
      kind: 'status', url: 'https://x.com/shark/status/123',
    });
  });

  it('does not trigger for ordinary mentions or write requests', () => {
    expect(parseXChatReadIntent('我今天在 X 看到一个帖子')).toBeNull();
    expect(parseXChatReadIntent('帮我在 X 发个帖子')).toBeNull();
    expect(parseXChatReadIntent('看看我的主页')).toBeNull();
  });
});

describe('X chat read context', () => {
  it('waits for the feed and sends text plus at most four unique images to the model', async () => {
    vi.spyOn(backendClient, 'getBackendXFeed').mockResolvedValue({
      view: 'profile', fetchedAt: new Date().toISOString(), items: [{
        platform: 'x', url: 'https://x.com/shark/status/1', title: '标题', description: '完整正文',
        author: '@shark', likes: 12, retweets: 3,
        imageUrl: 'https://img.example/1.jpg',
        mediaUrls: [
          'https://img.example/1.jpg', 'https://img.example/2.jpg',
          'https://img.example/3.jpg', 'https://img.example/4.jpg', 'https://img.example/5.jpg',
        ],
      }],
    });

    const context = await loadXChatReadContext('去 X 看 @shark 的主页', config);
    expect(context?.text).toContain('完整正文');
    expect(context?.text).toContain('12 赞，3 转推');
    expect(context?.mediaUrls).toEqual([
      'https://img.example/1.jpg', 'https://img.example/2.jpg',
      'https://img.example/3.jpg', 'https://img.example/4.jpg',
    ]);
    const messages = appendXChatReadContext([
      { role: 'user', content: '去看看' },
      { role: 'system', content: '末尾格式提醒' },
    ], context);
    expect(messages.at(-2)?.role).toBe('user');
    expect(messages.at(-2)?.content).toHaveLength(5);
    expect(messages.at(-1)?.content).toBe('末尾格式提醒');
  });

  it('injects an honest failure when the backend is disabled', async () => {
    const context = await loadXChatReadContext('去黑x看看首页', { ...config, enabled: false });
    expect(context?.text).toContain('你没有看到请求的内容');
    expect(context?.text).toContain('后端尚未启用');
    expect(context?.mediaUrls).toEqual([]);
  });
});
