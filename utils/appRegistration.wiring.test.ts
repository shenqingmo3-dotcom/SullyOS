import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('desktop app registration closure', () => {
    it('keeps every installed app connected to icon, lazy host, render switch and preloader', () => {
        const constants = read('../constants.tsx');
        const phoneShell = read('../components/PhoneShell.tsx');
        const preloader = read('../components/os/appPreload.ts');
        const installedBlock = constants.split('export const INSTALLED_APPS')[1]?.split('export const HIDDEN_APP_NAMES')[0] || '';
        const ids = [...installedBlock.matchAll(/\{\s*id:\s*AppID\.(\w+)/g)].map(match => match[1]);

        expect(ids.length).toBeGreaterThan(20);
        for (const id of ids) {
            expect(constants, `${id} is missing an icon renderer`).toMatch(new RegExp(`\\b${id}:\\s*\\(`));
            expect(phoneShell, `${id} is missing from the lazy component map`).toContain(`[AppID.${id}]`);
            expect(phoneShell, `${id} is missing from the render switch`).toContain(`case AppID.${id}:`);
            expect(preloader, `${id} is missing from pointer-down preloading`).toContain(`[AppID.${id}]`);
        }
    });
});
