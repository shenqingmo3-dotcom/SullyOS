/// <reference lib="webworker" />

interface ScriptInput {
    findRegex: string;
    replaceString: string;
    trimStrings: string[];
}

const parseRegex = (source: string): RegExp | null => {
    try {
        if (source.startsWith('/')) {
            for (let index = source.length - 1; index > 0; index -= 1) {
                if (source[index] !== '/' || source[index - 1] === '\\') continue;
                return new RegExp(source.slice(1, index), source.slice(index + 1));
            }
        }
        return new RegExp(source, 'g');
    } catch {
        return null;
    }
};

self.onmessage = (event: MessageEvent<{ requestId: number; input: string; script: ScriptInput }>) => {
    const { requestId, input, script } = event.data;
    const regex = parseRegex(script.findRegex);
    if (!regex || !input) {
        self.postMessage({ requestId, output: input });
        return;
    }
    try {
        const output = input.replace(regex, (...args: unknown[]) => {
            const groups = typeof args.at(-1) === 'object' ? args.at(-1) as Record<string, string> : undefined;
            return script.replaceString.replace(/\{\{match\}\}/gi, '$0').replace(/\$(\d+)|\$<([^>]+)>/g, (_whole, number, name) => {
                const candidate = name ? groups?.[name] : args[Number(number)];
                if (typeof candidate !== 'string') return '';
                let value: string = candidate;
                for (const trim of script.trimStrings) value = value.replaceAll(trim, '');
                return value;
            });
        });
        self.postMessage({ requestId, output });
    } catch (error) {
        self.postMessage({ requestId, error: error instanceof Error ? error.message : String(error) });
    }
};

export {};
