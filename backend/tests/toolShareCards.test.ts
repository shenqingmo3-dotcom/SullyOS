import { describe, expect, it } from 'vitest';
import { extractXShareCandidates, extractXhsShareCandidates } from '../src/toolRunner.js';

describe('platform share candidates', () => {
  it('extracts an X status as a shareable card candidate', () => {
    const [candidate] = extractXShareCandidates({
      data: [{
        tweet_url: 'https://x.com/shark/status/1234567890',
        text: '今天在海边捡到一块很漂亮的玻璃。',
        handle: 'shark',
        image_url: 'https://img.example/x.jpg',
        like_count: 42,
      }],
    });

    expect(candidate).toMatchObject({
      platform: 'x',
      url: 'https://x.com/shark/status/1234567890',
      title: '今天在海边捡到一块很漂亮的玻璃。',
      author: '@shark',
      imageUrl: 'https://img.example/x.jpg',
      likes: 42,
    });
  });

  it('keeps Xiaohongshu candidates on their dedicated card path', () => {
    const [candidate] = extractXhsShareCandidates({
      noteCard: {
        note_id: '0123456789abcdef01234567',
        title: '海边散步',
        desc: '风很轻。',
        user: { nickname: '小鲨鱼' },
      },
      xsec_token: 'token',
    });

    expect(candidate).toMatchObject({
      platform: 'xhs',
      noteId: '0123456789abcdef01234567',
      title: '海边散步',
      author: '小鲨鱼',
    });
  });
});
