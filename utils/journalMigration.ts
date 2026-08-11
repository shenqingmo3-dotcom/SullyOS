import type { DiaryEntry } from '../types';

export function splitLegacyExchangeDiary(entry: DiaryEntry): DiaryEntry[] {
    if (entry.primaryAuthor && entry.primaryAuthor !== 'shared') return [entry];
    const userText = entry.userPage.text.trim();
    const characterText = entry.charPage?.text?.trim() || '';
    if (!userText && characterText) {
        return [{
            ...entry,
            primaryAuthor: 'character',
            userPage: { text: '', paperStyle: 'grid', stickers: [] },
            charPage: entry.charPage,
            origin: 'imported',
            autoSync: true,
        }];
    }

    const userEntry: DiaryEntry = {
        ...entry,
        primaryAuthor: 'user',
        charPage: undefined,
        autoSync: true,
    };
    if (!characterText) return [userEntry];

    return [userEntry, {
        id: `${entry.id}-character`,
        charId: entry.charId,
        date: entry.date,
        title: entry.title,
        primaryAuthor: 'character',
        userPage: { text: '', paperStyle: 'grid', stickers: [] },
        charPage: entry.charPage,
        comments: [],
        timestamp: entry.timestamp + 1,
        isArchived: entry.isArchived,
        autoSync: true,
        origin: 'imported',
    }];
}
