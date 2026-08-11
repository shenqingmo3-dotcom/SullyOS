import type { Anniversary } from '../types';

export const getCharacterAnniversaries = (
    anniversaries: Anniversary[],
    charId: string,
): Anniversary[] => anniversaries.filter(anniversary => anniversary.charId === charId);
