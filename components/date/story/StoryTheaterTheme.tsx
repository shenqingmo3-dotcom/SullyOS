import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Moon, Palette, Sparkle, SquaresFour, Sun, X } from '@phosphor-icons/react';
import { STORY_THEATER_APPEARANCE_STORAGE_KEY } from '../../../utils/storyTheaterBackup';
import { useOS } from '../../../context/OSContext';

export type StoryColorMode = 'light' | 'dark';
export type StoryDecorMode = 'plain' | 'cinema';

interface StoryAppearance {
    color: StoryColorMode;
    decor: StoryDecorMode;
}

interface StoryThemeContextValue {
    appearance: StoryAppearance;
    setColor: (value: StoryColorMode) => void;
    setDecor: (value: StoryDecorMode) => void;
}

const STORAGE_KEY = STORY_THEATER_APPEARANCE_STORAGE_KEY;
const STORY_APPEARANCE_HISTORY_KEY = '__sullyStoryAppearance';
const DEFAULT_APPEARANCE: StoryAppearance = { color: 'dark', decor: 'cinema' };
const StoryThemeContext = createContext<StoryThemeContextValue | null>(null);

function readAppearance(): StoryAppearance {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_APPEARANCE;
        const value = JSON.parse(raw) as Partial<StoryAppearance>;
        return {
            color: value.color === 'dark' ? 'dark' : 'light',
            decor: value.decor === 'cinema' ? 'cinema' : 'plain',
        };
    } catch {
        return DEFAULT_APPEARANCE;
    }
}

const STORY_THEME_CSS = `
.story-theme {
  --story-bg: #dff4f5;
  --story-surface: rgba(238, 252, 252, .72);
  --story-raised: rgba(248, 255, 255, .66);
  --story-ink: #123e50;
  --story-muted: #477487;
  --story-faint: #7fa5b3;
  --story-line: rgba(33, 112, 139, .20);
  --story-soft: rgba(184, 226, 230, .48);
  --story-accent: #168bad;
  --story-accent-soft: rgba(102, 202, 216, .18);
  --story-accent-ink: #096986;
  --story-glass: rgba(246, 255, 255, .58);
  --story-glass-strong: rgba(238, 253, 253, .76);
  --story-shadow: rgba(12, 75, 97, .16);
  --story-card-paper: #fffdfa;
  --story-card-back: #d6ecea;
  --story-card-line: rgba(89, 121, 120, .28);
  --story-card-hairline: rgba(77, 120, 124, .18);
  --story-card-shadow: 0 15px 30px rgba(65, 99, 98, .11), inset 0 1px 0 #fff;
  --story-card-back-shadow: rgba(52, 103, 105, .12);
  --story-card-ink: #263f43;
  --story-card-muted: #789094;
  --story-card-accent: #45a8b3;
  --story-card-accent-ink: #287883;
  --story-card-tab: #f8e7e7;
  --story-card-reason: #f6fbfa;
  --story-card-drama: #fff8f4;
  --story-card-drama-stage: rgba(247, 253, 250, .88);
  --story-card-branch: #fffdf7;
  --story-card-branch-back: rgba(65, 148, 154, .15);
  --story-card-clip: #78999b;
  --story-card-radius: 18px;
  --story-card-sub-radius: 15px;
  position: relative;
  isolation: isolate;
  overflow: hidden;
  background: var(--story-bg);
  color: var(--story-ink);
  color-scheme: light;
}
.story-theme-dark {
  --story-bg: #041d2b;
  --story-surface: rgba(8, 42, 57, .74);
  --story-raised: rgba(16, 57, 73, .66);
  --story-ink: #e5f7f7;
  --story-muted: #9ec7cf;
  --story-faint: #668f9a;
  --story-line: rgba(133, 211, 221, .18);
  --story-soft: rgba(48, 105, 120, .40);
  --story-accent: #62c9d7;
  --story-accent-soft: rgba(70, 178, 196, .20);
  --story-accent-ink: #9be8ee;
  --story-glass: rgba(7, 40, 55, .56);
  --story-glass-strong: rgba(12, 51, 67, .78);
  --story-shadow: rgba(0, 12, 22, .38);
  --story-card-paper: #0d2c38;
  --story-card-back: #123b48;
  --story-card-line: rgba(138, 217, 219, .24);
  --story-card-hairline: rgba(132, 206, 210, .18);
  --story-card-shadow: 0 18px 38px rgba(0, 8, 14, .31), inset 0 1px 0 rgba(229, 255, 255, .07);
  --story-card-back-shadow: rgba(0, 8, 14, .30);
  --story-card-ink: #eaf8f5;
  --story-card-muted: #7ea6aa;
  --story-card-accent: #63ced1;
  --story-card-accent-ink: #bfeeed;
  --story-card-tab: #e9cfd2;
  --story-card-reason: #092631;
  --story-card-drama: #102e39;
  --story-card-drama-stage: rgba(7, 35, 45, .80);
  --story-card-branch: #102f3a;
  --story-card-branch-back: rgba(99, 206, 209, .13);
  --story-card-clip: #83b4b7;
  --story-card-radius: 8px;
  --story-card-sub-radius: 8px;
  color-scheme: dark;
}
.story-theme.story-decor-cinema {
  --story-accent: #0f9fbd;
  --story-accent-soft: rgba(85, 202, 216, .20);
  --story-accent-ink: #087590;
}
.story-theme-dark.story-decor-cinema {
  --story-bg: #031824;
  --story-accent: #6bd6e0;
  --story-accent-soft: rgba(70, 183, 199, .22);
  --story-accent-ink: #a2edf1;
}
.story-theme::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  opacity: 0;
  transition: opacity 240ms ease;
}
.story-theme.story-decor-cinema::before {
  opacity: 1;
  background:
    radial-gradient(ellipse at 12% -8%, rgba(178, 245, 245, .38) 0, transparent 33%),
    radial-gradient(ellipse at 86% 18%, color-mix(in srgb, var(--story-accent) 20%, transparent) 0, transparent 35%),
    linear-gradient(154deg, transparent 0 31%, rgba(199, 249, 246, .055) 35% 39%, transparent 43% 100%),
    linear-gradient(180deg, rgba(130, 226, 232, .09), transparent 32%);
}
.story-theme::after {
  content: '';
  position: absolute;
  inset: -12% -8%;
  z-index: 2;
  pointer-events: none;
  opacity: 0;
  background-image:
    radial-gradient(circle, rgba(207, 251, 249, .28) 0 1px, transparent 2px),
    radial-gradient(circle, rgba(207, 251, 249, .18) 0 2px, transparent 3px),
    radial-gradient(circle, rgba(207, 251, 249, .13) 0 3px, transparent 4px);
  background-size: 83px 101px, 147px 179px, 211px 263px;
  background-position: 7px 23px, 51px 79px, 119px 31px;
}
.story-theme.story-decor-cinema::after { opacity: 1; animation: story-bubble-drift 18s ease-in-out infinite alternate; }
.story-appearance-overlay::before, .story-appearance-overlay::after { display: none; }
@keyframes story-bubble-drift { from { transform: translate3d(0, 2%, 0); } to { transform: translate3d(1.5%, -2%, 0); } }
.story-theme > * { position: relative; z-index: 1; }
.story-theme .bg-stone-100 { background-color: var(--story-bg) !important; }
.story-theme .bg-stone-100\\/95 { background-color: var(--story-bg) !important; }
.story-theme .bg-white { background-color: var(--story-raised) !important; backdrop-filter: blur(16px) saturate(125%); -webkit-backdrop-filter: blur(16px) saturate(125%); }
.story-theme .bg-slate-50, .story-theme .bg-slate-100 { background-color: var(--story-surface) !important; }
.story-theme .bg-slate-200 { background-color: var(--story-soft) !important; }
.story-theme .bg-slate-900 { background-color: var(--story-ink) !important; color: var(--story-bg) !important; }
.story-theme .text-slate-900, .story-theme .text-slate-800, .story-theme .text-slate-700, .story-theme .text-slate-600 { color: var(--story-ink) !important; }
.story-theme .text-slate-500, .story-theme .text-slate-400 { color: var(--story-muted) !important; }
.story-theme .text-slate-300 { color: var(--story-faint) !important; }
.story-theme .border-slate-100, .story-theme .border-slate-200, .story-theme .border-slate-300 { border-color: var(--story-line) !important; }
.story-theme .divide-slate-200 > :not([hidden]) ~ :not([hidden]) { border-color: var(--story-line) !important; }
.story-theme .text-violet-500, .story-theme .text-violet-600, .story-theme .text-violet-700 { color: var(--story-accent-ink) !important; }
.story-theme .bg-violet-50, .story-theme .bg-violet-100 { background-color: var(--story-accent-soft) !important; }
.story-theme .bg-violet-500, .story-theme .bg-violet-600 { background-color: var(--story-accent) !important; }
.story-theme .border-violet-100, .story-theme .border-violet-200 { border-color: color-mix(in srgb, var(--story-accent) 34%, var(--story-line)) !important; }
.story-theme-dark .bg-rose-50\\/70 { background-color: rgba(78, 35, 55, .72) !important; }
.story-theme-dark .text-rose-800, .story-theme-dark .text-rose-700, .story-theme-dark .text-rose-600, .story-theme-dark .text-rose-500 { color: #f4a8bd !important; }
.story-theme-dark .border-rose-200, .story-theme-dark .border-rose-200\\/70 { border-color: rgba(244, 168, 189, .28) !important; }
.story-theme .story-safe-header { padding-top: max(1.25rem, var(--safe-top)); }
.story-theme .story-safe-footer { padding-bottom: calc(var(--safe-bottom) + 12px); }
.story-theme .story-safe-sheet { padding-bottom: calc(var(--safe-bottom) + 18px); }
.story-theme .story-quick-preset { bottom: calc(var(--safe-bottom) + 112px); }
.story-theme .story-page-scroll { overscroll-behavior-y: contain; -webkit-overflow-scrolling: touch; }
.story-theme .story-glass-panel {
  border: 1px solid var(--story-line);
  background: var(--story-glass-strong);
  box-shadow: inset 0 1px 0 rgba(231, 255, 255, .18), 0 18px 44px var(--story-shadow);
  backdrop-filter: blur(22px) saturate(132%);
  -webkit-backdrop-filter: blur(22px) saturate(132%);
}
.story-theme .story-dialog-row { display: flex; align-items: flex-start; gap: 10px; }
.story-theme .story-dialog-row-user { flex-direction: row-reverse; }
.story-theme .story-dialog-avatar {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  border-radius: 999px;
  object-fit: cover;
  border: 1px solid rgba(206, 250, 249, .42);
  box-shadow: 0 8px 22px var(--story-shadow);
}
.story-theme .story-dialog-card {
  min-width: 0;
  max-width: calc(100% - 44px);
  border: 1px solid var(--story-line);
  background: var(--story-glass);
  box-shadow: inset 0 1px 0 rgba(232, 255, 255, .16), 0 14px 32px var(--story-shadow);
  backdrop-filter: blur(20px) saturate(128%);
  -webkit-backdrop-filter: blur(20px) saturate(128%);
  padding: 15px 16px;
}
.story-theme .story-dialog-user { border-radius: 20px 7px 20px 20px; }
.story-theme .story-dialog-row-character { display: block; }
.story-theme .story-dialog-character {
  position: relative;
  isolation: isolate;
  width: 100%;
  max-width: 100%;
  overflow: visible;
  border: 1px solid var(--story-card-line);
  border-radius: var(--story-card-radius);
  color: var(--story-card-ink);
  background: var(--story-card-paper) !important;
  box-shadow: var(--story-card-shadow);
  padding: 0;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  animation: story-card-arrive .34s ease-out both;
}
.story-theme .story-dialog-character::before {
  content: '';
  position: absolute;
  z-index: -1;
  inset: 10px -8px -16px 8px;
  border: 1px solid var(--story-card-line);
  border-radius: var(--story-card-radius);
  background-color: var(--story-card-back);
  background-image: radial-gradient(ellipse at 50% 100%, transparent 0 8px, color-mix(in srgb, var(--story-card-accent) 62%, transparent) 8.8px 10px, transparent 10.8px);
  background-repeat: repeat-x;
  background-position: 3px calc(100% - 8px);
  background-size: 34px 18px;
  box-shadow: 0 12px 24px var(--story-card-back-shadow);
  transform: rotate(.7deg);
  pointer-events: none;
}
.story-theme .story-dialog-character::after {
  content: '';
  position: absolute;
  z-index: 3;
  left: 26px;
  right: 19px;
  bottom: -15px;
  height: 12px;
  opacity: .82;
  background-image: radial-gradient(ellipse at 50% 100%, transparent 0 7px, color-mix(in srgb, var(--story-card-accent) 62%, transparent) 7.8px 9px, transparent 9.8px);
  background-repeat: repeat-x;
  background-position: left bottom;
  background-size: 31px 13px;
  pointer-events: none;
}
.story-theme .story-paper-tab {
  position: absolute;
  z-index: 4;
  top: -1px;
  right: 21px;
  min-width: 54px;
  padding: 6px 9px 7px;
  border: 1px solid var(--story-card-line);
  border-top: 0;
  color: var(--story-card-accent-ink);
  background: var(--story-card-tab);
  font-size: 9px;
  font-weight: 750;
  letter-spacing: .12em;
  text-align: center;
}
.story-theme-dark .story-paper-tab { color: #573f47; }
.story-theme .story-paper-head {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  min-height: 73px;
  padding: 16px 16px 13px;
  border-bottom: 1px solid var(--story-card-hairline);
}
.story-theme .story-paper-cast { display: flex; width: 40px; }
.story-theme .story-paper-cast .story-dialog-avatar {
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  border-color: color-mix(in srgb, var(--story-card-accent) 30%, transparent);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--story-card-paper) 72%, transparent);
}
.story-theme .story-paper-cast img + img { margin-left: -22px; margin-top: 15px; }
.story-theme .story-paper-meta strong { display: block; overflow: hidden; color: var(--story-card-ink); font-size: 13px; font-weight: 720; text-overflow: ellipsis; white-space: nowrap; }
.story-theme .story-paper-meta > span { display: block; margin-top: 3px; color: var(--story-card-muted); font-size: 9px; letter-spacing: .07em; }
.story-theme .story-paper-issue { align-self: end; color: var(--story-card-muted); font-size: 10px; line-height: 1.2; }
.story-theme .story-paper-content { position: relative; padding: 0 22px 27px; }
.story-theme .story-paper-star, .story-theme .story-paper-fish { position: absolute; z-index: 2; color: var(--story-card-accent); opacity: .72; pointer-events: none; }
.story-theme .story-paper-star-one { right: 15px; top: 116px; font-size: 15px; }
.story-theme .story-paper-star-two { right: 33px; top: 139px; font-size: 9px; }
.story-theme .story-paper-fish { left: 11px; bottom: 17px; width: 30px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.4; }
.story-theme .story-paper-fish circle { fill: currentColor; stroke: none; }
.story-theme .story-ocean-prose {
  position: relative;
  color: var(--story-card-ink);
  padding: 20px 0 23px;
  letter-spacing: .012em;
  overflow-wrap: anywhere;
}
.story-theme .story-ocean-prose [role='separator'] { border-color: var(--story-card-hairline) !important; }
.story-theme .story-ocean-slate,
.story-theme .story-ocean-drama,
.story-theme .story-ocean-think,
.story-theme .story-ocean-choices {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--story-card-line);
  border-radius: var(--story-card-sub-radius);
  color: var(--story-card-ink);
  background: var(--story-card-reason);
  box-shadow: var(--story-card-shadow);
}
.story-theme .story-ocean-slate { padding: 17px 16px; }
.story-theme .story-ocean-kicker { color: var(--story-card-accent-ink); font-size: 8px; font-weight: 800; letter-spacing: .22em; text-transform: uppercase; }
.story-theme .story-ocean-drama > summary,
.story-theme .story-ocean-think > summary { min-height: 58px; padding: 10px 14px; }
.story-theme .story-ocean-think > p { margin: 0; padding: 2px 16px 16px 56px; border: 0; color: var(--story-card-muted); font-family: "Iowan Old Style", "Songti SC", serif; }
.story-theme .story-ocean-clip {
  width: 13px;
  height: 36px;
  flex: 0 0 13px;
  border: 2px solid var(--story-card-clip);
  border-radius: 8px;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--story-card-paper) 55%, transparent), 1px 2px 3px var(--story-shadow);
  transform: rotate(11deg);
}
.story-theme .story-ocean-drama { background: var(--story-card-drama); animation: story-card-arrive .36s ease-out both; }
.story-theme .story-ocean-drama > .mt-4 { position: relative; margin: 0 12px 14px; padding: 18px 16px 20px; overflow: hidden; border: 1px solid var(--story-card-hairline); border-radius: calc(var(--story-card-sub-radius) - 3px); background: var(--story-card-drama-stage); }
.story-theme .story-ocean-drama > .mt-4::before,
.story-theme .story-ocean-drama > .mt-4::after { content: ''; position: absolute; left: 0; right: 0; height: 16px; opacity: .5; background-image: radial-gradient(ellipse at 50% 100%, transparent 0 7px, var(--story-card-accent) 7.8px 8.8px, transparent 9.6px); background-repeat: repeat-x; background-size: 30px 15px; pointer-events: none; }
.story-theme .story-ocean-drama > .mt-4::before { top: -7px; transform: rotate(180deg); }
.story-theme .story-ocean-drama > .mt-4::after { bottom: -7px; }
.story-theme .story-ocean-think { animation: story-card-breathe 4.8s ease-in-out infinite; }
.story-theme .story-ocean-choices {
  padding: 17px 14px 13px;
  overflow: visible;
  background: linear-gradient(105deg, transparent 0 68%, color-mix(in srgb, var(--story-card-accent) 12%, transparent) 68.4% 69.1%, transparent 69.5%), var(--story-card-branch);
  box-shadow: var(--story-card-shadow), 5px 6px 0 var(--story-card-branch-back);
  transform: rotate(-.35deg);
}
.story-theme .story-ocean-choices > div:first-child { margin-right: 34px; color: var(--story-card-muted) !important; font-size: 9px; letter-spacing: .12em; }
.story-theme .story-ocean-choices .story-ocean-clip { position: absolute; z-index: 3; top: -11px; right: 24px; }
.story-theme .story-ocean-choice { position: relative; z-index: 1; padding: 9px 0; border: 0; border-top: 1px solid var(--story-card-hairline); border-radius: 0; color: var(--story-card-ink); background: transparent; transition: color 160ms ease, transform 160ms ease; }
.story-theme .story-ocean-choice:first-child { border-top: 0; }
.story-theme .story-ocean-choice:hover { color: var(--story-card-accent-ink); transform: translateX(2px); }
.story-theme .story-ocean-choice:active { transform: translateY(1px) scale(.995); }
.story-theme .story-branch-icon { width: 28px; height: 28px; flex: 0 0 28px; color: var(--story-card-accent-ink); }
.story-theme .story-branch-icon svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.35; stroke-linecap: round; stroke-linejoin: round; }
@keyframes story-card-arrive { from { opacity: 0; transform: translateY(7px) rotate(.25deg); } to { opacity: 1; transform: none; } }
@keyframes story-card-breathe { 0%,100% { box-shadow: 0 8px 22px color-mix(in srgb, var(--story-shadow) 60%, transparent); } 50% { box-shadow: 0 11px 30px color-mix(in srgb, var(--story-accent) 17%, transparent); } }
.story-theme .story-stream-cursor { width: 2px; height: 11px; border-radius: 999px; background: currentColor; animation: story-cursor-breathe 1.15s ease-in-out infinite; }
.story-theme .story-streaming { box-shadow: inset 0 1px rgba(255,255,255,.18), 0 14px 34px color-mix(in srgb, var(--story-accent) 15%, var(--story-shadow)); }
@keyframes story-cursor-breathe { 0%,100% { opacity: .25; } 50% { opacity: 1; } }
.story-theme.story-decor-plain .shadow-sm { box-shadow: none !important; }
.story-theme.story-decor-cinema .story-cinema-rule { position: relative; }
.story-theme.story-decor-cinema .story-cinema-rule::after {
  content: '水光缓慢移动';
  position: absolute;
  right: 0;
  bottom: -5px;
  padding-left: 10px;
  color: var(--story-accent);
  background: var(--story-bg);
  font-size: 7px;
  letter-spacing: .18em;
}
@media (prefers-reduced-transparency: reduce) {
  .story-theme .bg-white, .story-theme .story-glass-panel, .story-theme .story-dialog-card { background: var(--story-surface) !important; backdrop-filter: none; -webkit-backdrop-filter: none; }
}
body.ios-keyboard-open .story-theme .story-safe-footer { padding-bottom: 12px !important; }
body.ios-keyboard-open .story-theme .story-safe-sheet { padding-bottom: 18px !important; }
body.ios-keyboard-open .story-theme .story-quick-preset { bottom: 112px !important; }
@media (prefers-reduced-motion: reduce) {
  .story-theme *, .story-theme *::before, .story-theme *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
}
`;

export const StoryTheaterThemeProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
    const [appearance, setAppearance] = useState<StoryAppearance>(readAppearance);

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
    }, [appearance]);

    const value = useMemo<StoryThemeContextValue>(() => ({
        appearance,
        setColor: color => setAppearance(current => ({ ...current, color })),
        setDecor: decor => setAppearance(current => ({ ...current, decor })),
    }), [appearance]);

    return <StoryThemeContext.Provider value={value}>
        <div className={`story-theme story-theme-${appearance.color} story-decor-${appearance.decor} h-full w-full min-h-0`}>
            <style>{STORY_THEME_CSS}</style>
            {children}
        </div>
    </StoryThemeContext.Provider>;
};

export const StoryAppearanceButton: React.FC<{ className?: string }> = ({ className = '' }) => {
    const context = useContext(StoryThemeContext);
    const { registerBackHandler } = useOS();
    const [open, setOpen] = useState(false);
    const closePanel = useCallback(() => {
        setOpen(false);
        try {
            if (window.history.state?.[STORY_APPEARANCE_HISTORY_KEY]) window.history.back();
        } catch { /* history 不可用时仍正常关闭 */ }
    }, []);

    useEffect(() => {
        if (!open) return;

        try {
            const previous = window.history.state && typeof window.history.state === 'object'
                ? window.history.state
                : {};
            if (!previous[STORY_APPEARANCE_HISTORY_KEY]) {
                window.history.pushState({ ...previous, [STORY_APPEARANCE_HISTORY_KEY]: true }, '');
            }
        } catch { /* 某些内嵌 WebView 禁用 history，保留其它关闭方式 */ }

        const unregister = registerBackHandler(() => {
            closePanel();
            return true;
        });
        const handlePopState = () => setOpen(false);
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') closePanel();
        };
        window.addEventListener('popstate', handlePopState);
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            unregister();
            window.removeEventListener('popstate', handlePopState);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [closePanel, open, registerBackHandler]);
    if (!context) return null;
    const { appearance, setColor, setDecor } = context;

    return <>
        <button type='button' onClick={() => setOpen(true)} className={`w-9 h-9 rounded-full grid place-items-center ${className}`} title='剧情外观' aria-label='剧情外观'>
            <Palette size={18} weight={appearance.decor === 'cinema' ? 'fill' : 'regular'} />
        </button>
        {open && createPortal(<div
            className={`story-theme story-appearance-overlay story-theme-${appearance.color} story-decor-${appearance.decor} fixed inset-0 z-[90] flex items-end sm:items-center justify-center overflow-y-auto overscroll-contain`}
            style={{ position: 'fixed', paddingTop: 'max(12px, var(--safe-top))', paddingBottom: 'max(0px, var(--safe-bottom))', backgroundColor: 'rgba(2, 6, 23, .35)' }}
            onClick={closePanel}
            role='presentation'
        >
            <div
                className='story-safe-sheet relative flex w-full max-h-full flex-col overflow-hidden sm:max-w-sm rounded-t-[28px] sm:rounded-[28px] bg-stone-100 px-5 pt-5 shadow-2xl'
                onClick={event => event.stopPropagation()}
                role='dialog'
                aria-modal='true'
                aria-labelledby='story-appearance-title'
            >
                <div className='shrink-0 flex items-start gap-4'>
                    <div className='min-w-0 flex-1'><div className='text-[9px] tracking-[.22em] uppercase font-bold text-violet-500'>Aquarium appearance</div><h2 id='story-appearance-title' className='mt-1 text-lg font-semibold'>见面水族馆外观</h2><p className='mt-1 text-[10px] leading-5 text-slate-500'>只影响见面模式，普通聊天与记忆宫殿保持原样。</p></div>
                    <button type='button' onClick={closePanel} className='w-10 h-10 shrink-0 rounded-full bg-white border border-slate-200 grid place-items-center' aria-label='关闭剧情外观'><X size={17} /></button>
                </div>
                <div className='mt-5 min-h-0 overflow-y-auto overscroll-contain border-t border-slate-200'>
                    <div className='py-4 flex items-center gap-3'><span className='text-xs font-semibold w-16'>水深</span><div className='min-w-0 flex-1 grid grid-cols-2 p-1 rounded-xl bg-slate-200'><button onClick={() => setColor('light')} className={`py-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 ${appearance.color === 'light' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}><Sun size={14} />浅海</button><button onClick={() => setColor('dark')} className={`py-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 ${appearance.color === 'dark' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}><Moon size={14} />深海</button></div></div>
                    <div className='py-4 border-t border-slate-200 flex items-center gap-3'><span className='text-xs font-semibold w-16'>水光</span><div className='min-w-0 flex-1 grid grid-cols-2 p-1 rounded-xl bg-slate-200'><button onClick={() => setDecor('plain')} className={`py-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 ${appearance.decor === 'plain' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}><SquaresFour size={14} />静水</button><button onClick={() => setDecor('cinema')} className={`py-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 ${appearance.decor === 'cinema' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}><Sparkle size={14} />浮光</button></div></div>
                </div>
            </div>
        </div>, document.body)}
    </>;
};
