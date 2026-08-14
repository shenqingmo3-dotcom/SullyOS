import type { ModelMessage } from './modelClient.js';
import type { SyncedWorldbook } from './contextSchemas.js';

export type SharkWorldbookPosition = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface ResolvedSharkWorldbook {
  book: SyncedWorldbook;
  content: string;
  position: SharkWorldbookPosition;
  order: number;
}

export interface SharkWorldbookSections {
  beforeCharacter: ResolvedSharkWorldbook[];
  afterCharacter: ResolvedSharkWorldbook[];
  authorsNoteTop: ResolvedSharkWorldbook[];
  authorsNoteBottom: ResolvedSharkWorldbook[];
  atDepth: ResolvedSharkWorldbook[];
  beforeExamples: ResolvedSharkWorldbook[];
  afterExamples: ResolvedSharkWorldbook[];
}

function messageText(message: Pick<ModelMessage, 'content'>): string {
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';
  return message.content
    .map((part) => (typeof part === 'string' ? part : (part as { text?: unknown })?.text))
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join('\n');
}

function scanText(book: SyncedWorldbook, messages: ModelMessage[]): string {
  const depth = Math.max(0, Math.floor(book.scanDepth ?? 4));
  if (depth === 0) return '';
  return messages.slice(-depth).map(messageText).filter(Boolean).join('\n');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keywordMatches(text: string, keyword: string, caseSensitive: boolean, wholeWords: boolean): boolean {
  if (!keyword) return false;
  if (!wholeWords) {
    return caseSensitive
      ? text.includes(keyword)
      : text.toLocaleLowerCase().includes(keyword.toLocaleLowerCase());
  }
  const flags = caseSensitive ? 'u' : 'iu';
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(keyword)}(?=$|[^\\p{L}\\p{N}_])`, flags).test(text);
}

function secondaryConditionPasses(
  book: SyncedWorldbook,
  text: string,
  caseSensitive: boolean,
  wholeWords: boolean,
): boolean {
  if (!book.selective) return true;
  const matches = (book.keysecondary ?? []).map((key) => keywordMatches(text, key, caseSensitive, wholeWords));
  if (matches.length === 0) return true;
  const logic = book.selectiveLogic ?? 0;
  if (logic === 1) return !matches.every(Boolean);
  if (logic === 2) return !matches.some(Boolean);
  if (logic === 3) return matches.every(Boolean);
  return matches.some(Boolean);
}

export function isSharkWorldbookActive(
  book: SyncedWorldbook,
  messages: ModelMessage[] = [],
  random: () => number = Math.random,
): boolean {
  if (book.disable) return false;
  const primary = book.key ?? [];
  const isConstant = book.constant ?? primary.length === 0;
  const text = scanText(book, messages);
  const caseSensitive = book.caseSensitive === true;
  const wholeWords = book.matchWholeWords === true;

  if (!isConstant) {
    if (primary.length === 0) return false;
    if (!primary.some((key) => keywordMatches(text, key, caseSensitive, wholeWords))) return false;
    if (!secondaryConditionPasses(book, text, caseSensitive, wholeWords)) return false;
  }

  if (book.useProbability) {
    const probability = Math.min(100, Math.max(0, Number(book.probability ?? 100)));
    if (probability <= 0) return false;
    if (probability < 100 && random() * 100 >= probability) return false;
  }
  return true;
}

export function expandSharkWorldbookMacros(content: string, characterName: string, userName: string): string {
  let expanded = content;
  if (characterName) expanded = expanded.replace(/{{\s*char\s*}}/gi, characterName);
  if (userName) expanded = expanded.replace(/{{\s*user\s*}}/gi, userName);
  return expanded;
}

export function resolveSharkWorldbooks(
  books: SyncedWorldbook[] = [],
  messages: ModelMessage[] = [],
  characterName = '',
  userName = '',
  random: () => number = Math.random,
): ResolvedSharkWorldbook[] {
  return books
    .filter((book) => isSharkWorldbookActive(book, messages, random))
    .map((book) => ({
      book,
      content: expandSharkWorldbookMacros(book.content, characterName, userName),
      position: (book.position ?? 1) as SharkWorldbookPosition,
      order: Number.isFinite(book.order) ? Number(book.order) : 100,
    }))
    .filter((entry) => entry.content.trim())
    .sort((left, right) => left.order - right.order);
}

export function splitSharkWorldbookSections(entries: ResolvedSharkWorldbook[]): SharkWorldbookSections {
  return {
    beforeCharacter: entries.filter((entry) => entry.position === 0),
    afterCharacter: entries.filter((entry) => entry.position === 1),
    authorsNoteTop: entries.filter((entry) => entry.position === 2),
    authorsNoteBottom: entries.filter((entry) => entry.position === 3),
    atDepth: entries.filter((entry) => entry.position === 4),
    beforeExamples: entries.filter((entry) => entry.position === 5),
    afterExamples: entries.filter((entry) => entry.position === 6),
  };
}

export function formatSharkWorldbookSection(entries: ResolvedSharkWorldbook[], heading: string): string {
  if (entries.length === 0) return '';
  let output = `### ${heading}\n`;
  let lastLegacyCategory = '';
  for (const entry of entries) {
    if (entry.book.sourceUid === undefined) {
      const category = entry.book.category || '通用设定 (General)';
      if (category !== lastLegacyCategory) {
        output += `#### [${category}]\n`;
        lastLegacyCategory = category;
      }
      output += `**Title: ${entry.book.title}**\n`;
    }
    output += `${entry.content.trim()}\n---\n`;
  }
  return `${output}\n`;
}

export function injectSharkWorldbookDepthEntries(
  messages: ModelMessage[],
  entries: ResolvedSharkWorldbook[],
): ModelMessage[] {
  if (entries.length === 0) return [...messages];
  const buckets = new Map<number, ResolvedSharkWorldbook[]>();
  for (const entry of entries) {
    const depth = Math.max(0, Math.floor(entry.book.depth ?? 4));
    const index = Math.max(0, messages.length - depth);
    const bucket = buckets.get(index) ?? [];
    bucket.push(entry);
    buckets.set(index, bucket);
  }

  const result: ModelMessage[] = [];
  for (let index = 0; index <= messages.length; index += 1) {
    for (const entry of buckets.get(index) ?? []) {
      const roleValue = entry.book.role ?? 0;
      const role = roleValue === 1 ? 'user' : roleValue === 2 ? 'assistant' : 'system';
      result.push({ role, content: entry.content.trim() });
    }
    const message = messages[index];
    if (message) result.push(message);
  }
  return result;
}
