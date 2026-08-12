const isActionStart = (line: string, index: number): boolean => {
    if (line[index] !== '>' || !/\s/.test(line[index + 1] || '')) return false;
    if (index === 0) return true;
    return /\s/.test(line[index - 1]) || /[。！？；：，、”]/.test(line[index - 1]);
};

const isDialogueStart = (line: string, index: number): boolean => {
    const char = line[index];
    if (char === '“') return line.indexOf('”', index + 1) !== -1;
    if (char === '"') return line.indexOf('"', index + 1) !== -1;

    // Some models emit the closing Chinese quote as the opening delimiter.
    if (char !== '”') return false;
    if (index === 0) return true;
    return /\s/.test(line[index - 1]) || /[。！？；：，、]/.test(line[index - 1]);
};

const dialogueEnd = (line: string, index: number): number => {
    const char = line[index];
    if (char === '“') return line.indexOf('”', index + 1);
    if (char === '"') return line.indexOf('"', index + 1);
    return -1;
};

/**
 * Offline replies use explicit syntax: `> ` starts narration and paired Chinese
 * quotation marks delimit spoken dialogue. Add bubble boundaries only where that
 * syntax makes the boundary unambiguous; unmarked prose is left untouched.
 */
export function normalizeOfflineBubbleFormatting(content: string): string {
    if (!content || (!content.includes('>') && !/["“”]/.test(content))) return content;

    const normalizedLines = content.split(/\r\n|\r|\n|\u2028|\u2029/).flatMap((line) => {
        const starts: number[] = [];

        for (let index = 0; index < line.length; index++) {
            if (isActionStart(line, index)) {
                starts.push(index);
                continue;
            }

            if (isDialogueStart(line, index)) {
                starts.push(index);
                const end = dialogueEnd(line, index);
                if (end !== -1) index = end;
            }
        }

        if (starts.length === 0) return [line];

        const chunks: string[] = [];
        if (starts[0] > 0) {
            const prefix = line.slice(0, starts[0]).trim();
            if (prefix) chunks.push(prefix);
        }

        for (let index = 0; index < starts.length; index++) {
            const chunk = line.slice(starts[index], starts[index + 1] ?? line.length).trim();
            if (chunk) chunks.push(chunk);
        }

        return chunks.length > 0 ? chunks : [line];
    });

    return normalizedLines.join('\n');
}
