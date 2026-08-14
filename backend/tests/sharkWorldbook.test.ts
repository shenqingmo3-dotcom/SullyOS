import { describe, expect, it } from 'vitest';
import {
  formatWorldbookSection as formatFrontendWorldbookSection,
  injectWorldbookDepthEntries as injectFrontendWorldbookDepthEntries,
  resolveWorldbookEntries as resolveFrontendWorldbookEntries,
  splitWorldbookSections as splitFrontendWorldbookSections,
} from '../../utils/worldbook.js';
import type { MountedWorldbook } from '../../types.js';
import {
  formatSharkWorldbookSection,
  injectSharkWorldbookDepthEntries,
  isSharkWorldbookActive,
  resolveSharkWorldbooks,
  splitSharkWorldbookSections,
} from '../src/sharkWorldbook.js';
import type { SyncedWorldbook } from '../src/contextSchemas.js';

const sampleText = `[Mode A]\n{{char}}在线上和{{user}}交谈。\n\n[Mode B]\n动作里的“咔哒”仍是正文。`;

function book(overrides: Partial<SyncedWorldbook> = {}): SyncedWorldbook {
  return {
    id: 'book-1',
    title: '线上转线下',
    content: sampleText,
    category: '互动模式',
    constant: true,
    order: 100,
    position: 1,
    selectiveLogic: undefined,
    depth: undefined,
    sourceUid: undefined,
    ...overrides,
  };
}

describe('SharkOS backend worldbook parity', () => {
  it('keeps ordinary text opaque while matching the frontend wrapper and macros', () => {
    const input = [book()];
    const frontend = resolveFrontendWorldbookEntries(input as MountedWorldbook[], [], '小冰', '小鱼');
    const backend = resolveSharkWorldbooks(input, [], '小冰', '小鱼');

    expect(backend.map(({ content, position, order }) => ({ content, position, order })))
      .toEqual(frontend.map(({ content, position, order }) => ({ content, position, order })));
    expect(formatSharkWorldbookSection(backend, '扩展设定集 (Worldbooks)'))
      .toBe(formatFrontendWorldbookSection(frontend, '扩展设定集 (Worldbooks)'));
    expect(backend[0]?.content).toContain('[Mode A]');
    expect(backend[0]?.content).toContain('动作里的“咔哒”仍是正文。');
    expect(backend[0]?.content).not.toContain('{{char}}');
  });

  it('uses the same scanDepth, selection logic, ordering and depth insertion as the frontend', () => {
    const books = [
      book({ id: 'before', order: 20, position: 0 }),
      book({
        id: 'depth', title: '关键词', content: '命中的指定深度内容', constant: false,
        key: ['海边'], keysecondary: ['下雨'], selective: true, selectiveLogic: 0,
        scanDepth: 2, order: 10, position: 4, depth: 1, role: 2,
      }),
      book({ id: 'disabled', disable: true }),
    ] as SyncedWorldbook[];
    const messages = [
      { role: 'user' as const, content: '很早以前去了海边' },
      { role: 'assistant' as const, content: '后来回家了' },
      { role: 'user' as const, content: '今天海边下雨' },
    ];
    const frontend = resolveFrontendWorldbookEntries(books as MountedWorldbook[], messages, '小冰', '小鱼');
    const backend = resolveSharkWorldbooks(books, messages, '小冰', '小鱼');

    expect(backend.map((entry) => entry.book.id)).toEqual(frontend.map((entry) => entry.book.id));
    expect(injectSharkWorldbookDepthEntries(messages, backend.filter((entry) => entry.position === 4)))
      .toEqual(injectFrontendWorldbookDepthEntries(messages, frontend.filter((entry) => entry.position === 4)));
  });

  it('routes every supported position and all four selective modes like the frontend', () => {
    const positionBooks = Array.from({ length: 7 }, (_, position) => (
      book({ id: `position-${position}`, position })
    ));
    const selectiveBooks = [
      book({ id: 'any', constant: false, key: ['海边'], selective: true, keysecondary: ['下雨', '晴天'], selectiveLogic: 0 }),
      book({ id: 'not-all', constant: false, key: ['海边'], selective: true, keysecondary: ['下雨', '晴天'], selectiveLogic: 1 }),
      book({ id: 'none', constant: false, key: ['海边'], selective: true, keysecondary: ['晴天'], selectiveLogic: 2 }),
      book({ id: 'all', constant: false, key: ['海边'], selective: true, keysecondary: ['下雨', '海边'], selectiveLogic: 3 }),
    ];
    const messages = [{ role: 'user' as const, content: '今天海边下雨' }];
    const books = [...positionBooks, ...selectiveBooks];
    const frontend = resolveFrontendWorldbookEntries(books as MountedWorldbook[], messages, '小冰', '小鱼');
    const backend = resolveSharkWorldbooks(books, messages, '小冰', '小鱼');
    const frontendSections = splitFrontendWorldbookSections(frontend);
    const backendSections = splitSharkWorldbookSections(backend);
    const sectionIds = (sections: object) => Object.fromEntries(
      Object.entries(sections).map(([name, entries]) => [
        name,
        (entries as Array<{ book: { id: string } }>).map((entry) => entry.book.id),
      ]),
    );

    expect(backend.map((entry) => entry.book.id)).toEqual(frontend.map((entry) => entry.book.id));
    expect(sectionIds(backendSections)).toEqual(sectionIds(frontendSections));
    expect(backend.filter((entry) => selectiveBooks.some((item) => item.id === entry.book.id)))
      .toHaveLength(4);
  });

  it('rolls probability exactly once per entry and accepts a fixed random source in tests', () => {
    let rolls = 0;
    const random = () => { rolls += 1; return 0.49; };
    expect(isSharkWorldbookActive(book({ useProbability: true, probability: 50 }), [], random)).toBe(true);
    expect(rolls).toBe(1);
    expect(isSharkWorldbookActive(book({ useProbability: true, probability: 50 }), [], () => 0.5)).toBe(false);
  });
});
