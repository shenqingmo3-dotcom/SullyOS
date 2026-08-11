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
  z-index: 0;
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
  z-index: 0;
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
.story-theme .story-dialog-character { border-radius: 7px 20px 20px 20px; }
.story-theme .story-dialog-cast { display: flex; flex: 0 0 34px; width: 34px; }
.story-theme .story-dialog-cast img + img { margin-left: -18px; }
.story-theme .story-dialog-cast img:nth-child(n+2) { margin-top: 16px; }
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
            className={`story-theme story-theme-${appearance.color} story-decor-${appearance.decor} fixed inset-0 z-[90] flex items-end sm:items-center justify-center overflow-y-auto overscroll-contain`}
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
