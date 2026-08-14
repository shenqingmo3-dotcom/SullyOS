import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Copy, DownloadSimple, FloppyDisk, LockSimple, Plus, Trash, UploadSimple } from '@phosphor-icons/react';
import type { StoryTheaterPreset, StoryTheaterPresetDocument, StoryTheaterPresetPrompt } from '../../../types';
import {
    applyStoryPresetChoice,
    downloadStoryPreset,
    duplicateStoryPreset,
    getStoryPresetPromptGroups,
    isProtectedStoryPrompt,
    isStoryPresetSectionMarker,
    makeStoryTheaterId,
} from '../../../utils/storyTheater';
import { isStoryPresetPromptEnabled, setStoryPresetPromptEnabled } from '../../../utils/storyPresetCompat';
import { parseStoryRegexFile } from '../../../utils/storyRegex';

interface Props {
    preset: StoryTheaterPreset;
    onBack: () => void;
    onSave: (preset: StoryTheaterPreset) => Promise<void> | void;
    onOpenCopy: (preset: StoryTheaterPreset) => Promise<void> | void;
    onDelete?: (preset: StoryTheaterPreset) => Promise<void> | void;
}

export interface StoryPresetSimpleChoice {
    label: string;
    hint: string;
    ids: readonly string[];
    options: Array<{ id?: string; label: string }>;
}

export const STORY_PRESET_SIMPLE_CHOICES: StoryPresetSimpleChoice[] = [
    {
        label: '文风', hint: '决定这场故事读起来是什么质感',
        ids: ['nmj-v3-style-custom', 'nmj-v3-style-soda', 'nmj-v3-style-corridor', 'nmj-v3-style-comedy', 'nmj-v3-style-darkcomedy', 'nmj-v3-style-syrup', 'nmj-v3-style-dullknife', 'nmj-v3-style-drama'],
        options: [{ label: '默认质感' }, { id: 'nmj-v3-style-soda', label: '汽水日常' }, { id: 'nmj-v3-style-corridor', label: '潮雨走廊' }, { id: 'nmj-v3-style-comedy', label: '荒诞喜剧' }, { id: 'nmj-v3-style-darkcomedy', label: '黑喜剧' }, { id: 'nmj-v3-style-syrup', label: '直球甜宠' }, { id: 'nmj-v3-style-dullknife', label: '钝刀虐心' }, { id: 'nmj-v3-style-drama', label: '冷峻正剧' }],
    },
    {
        label: '人称', hint: '决定镜头如何称呼你当前执笔的身份',
        ids: ['nmj-v3-pov-second', 'nmj-v3-pov-third'],
        options: [{ id: 'nmj-v3-pov-second', label: '第二人称' }, { id: 'nmj-v3-pov-third', label: '第三人称' }],
    },
    {
        label: '输入转述', hint: '你给出的构想要先拍出来，还是视作已经发生',
        ids: ['nmj-v62-retelling-replay', 'nmj-v62-retelling-direct'],
        options: [{ id: 'nmj-v62-retelling-replay', label: '回放扩写' }, { id: 'nmj-v62-retelling-direct', label: '直接接戏' }],
    },
    {
        label: '你的执笔权', hint: '故事可以替你当前执笔的身份写到什么程度',
        ids: ['nmj-v63-user-agency-locked', 'nmj-v63-user-agency-assist', 'nmj-v63-user-agency-auto'],
        options: [{ id: 'nmj-v63-user-agency-locked', label: '完全不代写' }, { id: 'nmj-v63-user-agency-assist', label: '有限协演' }, { id: 'nmj-v63-user-agency-auto', label: '全自动演绎' }],
    },
    {
        label: '场景张力', hint: '只调整当前故事的情绪压力',
        ids: ['nmj-v64-tension-lowfever-1', 'nmj-v64-tension-lowfever-2', 'nmj-v64-tension-lowfever-3'],
        options: [{ label: '自然' }, { id: 'nmj-v64-tension-lowfever-1', label: '低烧 I' }, { id: 'nmj-v64-tension-lowfever-2', label: '低烧 II' }, { id: 'nmj-v64-tension-lowfever-3', label: '低烧 III' }],
    },
    {
        label: '小剧场', hint: '正文结束后追加一段独立的边角频道',
        ids: ['nmj-v3-theater-ai', 'nmj-v3-theater-user-sim', 'nmj-v3-theater-group', 'nmj-v3-theater-random', 'nmj-v6-side-channel-terminal', 'nmj-v6-side-channel-evidence', 'nmj-v6-side-channel-public', 'nmj-v6-side-channel-wrong-reel', 'nmj-v3-theater-custom'],
        options: [{ label: '关闭' }, { id: 'nmj-v3-theater-ai', label: '角色与你' }, { id: 'nmj-v3-theater-user-sim', label: '你的倒影' }, { id: 'nmj-v3-theater-group', label: '你和角色们' }, { id: 'nmj-v3-theater-random', label: '随机换台' }, { id: 'nmj-v6-side-channel-terminal', label: '终端残响' }, { id: 'nmj-v6-side-channel-evidence', label: '失物与物证' }, { id: 'nmj-v6-side-channel-public', label: '公共频段' }, { id: 'nmj-v6-side-channel-wrong-reel', label: '错卷放映' }],
    },
    {
        label: '语言', hint: '正文使用哪一种中文',
        ids: ['nmj-v3-language-cn', 'nmj-v3-language-tw'],
        options: [{ id: 'nmj-v3-language-cn', label: '简体中文' }, { id: 'nmj-v3-language-tw', label: '繁體中文' }],
    },
    {
        label: '篇幅', hint: '每次续写的大致长度',
        ids: ['nmj-v3-length-short', 'nmj-v3-length-medium', 'nmj-v3-length-long'],
        options: [{ id: 'nmj-v3-length-short', label: '短' }, { id: 'nmj-v3-length-medium', label: '中' }, { id: 'nmj-v3-length-long', label: '长' }],
    },
];

const STORY_ROLE_LABELS: Record<StoryTheaterPresetPrompt['role'], string> = {
    system: '规则',
    user: '你',
    assistant: '正文',
};

const StoryPresetMaker: React.FC<Props> = ({ preset, onBack, onSave, onOpenCopy, onDelete }) => {
    const [draft, setDraft] = useState<StoryTheaterPreset>(() => ({
        ...preset,
        document: { ...preset.document, generation: { ...preset.document.generation }, prompts: preset.document.prompts.map(item => ({ ...item })) },
    }));
    const [mode, setMode] = useState<'simple' | 'pro'>('simple');
    const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState('');
    const [saving, setSaving] = useState(false);
    const readOnly = preset.builtIn === true;
    const tavernSource = draft.document.source;
    const groups = useMemo(() => getStoryPresetPromptGroups(draft.document), [draft.document]);
    const activeGroup = groups.find(group => group.key === activeGroupKey) || null;
    const activePrompts = useMemo(() => {
        if (!activeGroup) return [];
        const ids = new Set(activeGroup.promptIds);
        return draft.document.prompts.filter(prompt => ids.has(prompt.id) && !isStoryPresetSectionMarker(prompt));
    }, [activeGroup, draft.document.prompts]);
    const selected = activePrompts.find(prompt => prompt.id === selectedId) || null;

    const replaceDocument = (document: StoryTheaterPresetDocument) => setDraft(current => ({ ...current, name: document.name, document, updatedAt: Date.now() }));
    const patchDocument = (patch: Partial<StoryTheaterPresetDocument>) => replaceDocument({ ...draft.document, ...patch });
    const patchPrompt = (id: string, patch: Partial<StoryTheaterPresetPrompt>) => {
        const { enabled, ...fields } = patch;
        const next = enabled === undefined ? draft.document : setStoryPresetPromptEnabled(draft.document, id, enabled);
        replaceDocument({ ...next, prompts: next.prompts.map(prompt => prompt.id === id ? { ...prompt, ...fields } : prompt) });
    };
    const selectSimpleChoice = (choice: StoryPresetSimpleChoice, id?: string) => {
        if (readOnly || tavernSource) return;
        replaceDocument(applyStoryPresetChoice(draft.document, choice.ids, id));
    };
    const moveGroup = (key: string, direction: -1 | 1) => {
        if (readOnly) return;
        const ordered = [...groups];
        const index = ordered.findIndex(group => group.key === key);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= ordered.length) return;
        [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
        const byId = new Map(draft.document.prompts.map(prompt => [prompt.id, prompt]));
        patchDocument({ prompts: ordered.flatMap(group => group.promptIds.map(id => byId.get(id)).filter((prompt): prompt is StoryTheaterPresetPrompt => Boolean(prompt))) });
    };
    const movePrompt = (id: string, direction: -1 | 1) => {
        const index = activePrompts.findIndex(prompt => prompt.id === id);
        const target = index + direction;
        if (readOnly || tavernSource || index < 0 || target < 0 || target >= activePrompts.length) return;
        const prompts = [...draft.document.prompts];
        const fromIndex = prompts.findIndex(prompt => prompt.id === id);
        const toIndex = prompts.findIndex(prompt => prompt.id === activePrompts[target].id);
        [prompts[fromIndex], prompts[toIndex]] = [prompts[toIndex], prompts[fromIndex]];
        patchDocument({ prompts });
    };
    const addPrompt = () => {
        if (!activeGroup || activeGroup.protected || readOnly || tavernSource) return;
        const next: StoryTheaterPresetPrompt = { id: makeStoryTheaterId(), name: '新提示词', enabled: true, role: 'system', content: '' };
        const prompts = [...draft.document.prompts];
        const last = prompts[activeGroup.endIndex];
        const insertAt = last && isStoryPresetSectionMarker(last) ? activeGroup.endIndex : activeGroup.endIndex + 1;
        prompts.splice(insertAt, 0, next);
        patchDocument({ prompts });
        setSelectedId(next.id);
    };
    const removePrompt = (id: string) => {
        const prompt = draft.document.prompts.find(item => item.id === id);
        if (!prompt || readOnly || tavernSource || isProtectedStoryPrompt(prompt)) return;
        patchDocument({ prompts: draft.document.prompts.filter(item => item.id !== id) });
        if (selectedId === id) setSelectedId('');
    };
    const save = async () => {
        if (readOnly) { await onOpenCopy(duplicateStoryPreset(draft)); return; }
        setSaving(true);
        try { await onSave({ ...draft, name: draft.document.name.trim() || '未命名剧情预设', updatedAt: Date.now() }); }
        finally { setSaving(false); }
    };
    const importRegex = async (file?: File) => {
        if (!file || readOnly) return;
        const scripts = parseStoryRegexFile(await file.text());
        patchDocument({ regexScripts: scripts.map((script, sourceIndex) => ({ ...script, sourceIndex })) });
    };
    const renderRegex = () => {
        const scripts = draft.document.regexScripts || [];
        if (scripts.length === 0) return null;
        return <details className='mb-6 rounded-2xl border border-cyan-200 bg-cyan-50/60 p-4'>
            <summary className='cursor-pointer list-none flex items-center justify-between gap-3'><span><span className='text-[9px] uppercase tracking-[.2em] font-bold text-cyan-700'>Regex worker</span><strong className='block mt-1 text-sm'>Regex 脚本</strong></span><span className='text-[9px] text-cyan-700'>{scripts.filter(script => !script.disabled).length}/{scripts.length} 启用</span></summary>
            <p className='mt-3 text-[10px] leading-5 text-slate-500'>按原顺序在独立 Worker 执行；每条都可单独开关，超时脚本只跳过自身。</p>
            <div className='mt-3 max-h-72 overflow-y-auto divide-y divide-cyan-100'>{scripts.map(script => <div key={script.id} className='py-2.5 flex items-center gap-3'><span className='min-w-0 flex-1 truncate text-[10px] font-semibold'>{script.name}</span><button disabled={readOnly} onClick={() => patchDocument({ regexScripts: scripts.map(item => item.id === script.id ? { ...item, disabled: !item.disabled } : item) })} className={`text-[9px] font-bold ${script.disabled ? 'text-slate-400' : 'text-emerald-600'}`}>{script.disabled ? 'OFF' : 'ON'}</button></div>)}</div>
        </details>;
    };

    const renderCompatibility = () => {
        const items = draft.document.compatibility || [];
        if (!tavernSource || items.length === 0) return null;
        const levels = ['完整支持', '部分支持', '已保存但不执行', '输入无效'] as const;
        const colors = { '完整支持': 'text-emerald-700 bg-emerald-50', '部分支持': 'text-amber-700 bg-amber-50', '已保存但不执行': 'text-slate-600 bg-slate-100', '输入无效': 'text-rose-700 bg-rose-50' } as const;
        return <section className='mb-6 rounded-2xl border border-sky-200 bg-sky-50/60 p-4'>
            <div className='flex items-start justify-between gap-3'><div><div className='text-[9px] uppercase tracking-[.2em] font-bold text-sky-700'>Compatibility report</div><h2 className='mt-1 text-sm font-bold'>SillyTavern {tavernSource.baseline}</h2></div><span className='text-[9px] text-sky-700'>{tavernSource.order.length} 个顺序项</span></div>
            <p className='mt-2 text-[10px] leading-5 text-slate-500'>执行只认导入文件的 prompt order；{tavernSource.unreferencedPromptIds.length} 个未引用 prompt 会保存，但不会被补到队尾。</p>
            <div className='mt-3 flex flex-wrap gap-1.5'>{levels.map(level => <span key={level} className={`rounded-full px-2 py-1 text-[9px] font-bold ${colors[level]}`}>{level} {items.filter(item => item.level === level).length}</span>)}</div>
            <details className='mt-3'><summary className='cursor-pointer text-[10px] font-bold text-sky-800'>查看全部 {items.length} 项</summary><div className='mt-3 max-h-72 overflow-y-auto divide-y divide-sky-100'>{items.map((item, index) => <div key={`${item.fieldPath}:${item.resourceId}:${index}`} className='py-2.5'><div className='flex items-center gap-2'><span className={`rounded px-1.5 py-0.5 text-[8px] font-bold ${colors[item.level]}`}>{item.level}</span><strong className='min-w-0 flex-1 truncate text-[10px]'>{item.name}</strong><span className='text-[8px] text-slate-400'>{item.enabled ? item.executes ? '本轮执行' : '已启用' : '已关闭'}</span></div><div className='mt-1 break-all font-mono text-[8px] text-slate-400'>{item.fieldPath}</div><p className='mt-1 text-[9px] leading-4 text-slate-500'>{item.reason}</p></div>)}</div></details>
        </section>;
    };

    const renderGeneration = () => <section>
        <button onClick={() => setActiveGroupKey(null)} className='mb-5 text-[10px] font-bold text-violet-600'>← 返回大分类</button>
        <div className='text-[9px] uppercase tracking-[.22em] font-bold text-violet-500'>Professional</div><h2 className='mt-1 text-2xl font-serif font-semibold'>续写参数</h2>
        <p className='mt-2 text-[10px] leading-5 text-slate-500'>只有明确知道采样参数含义时再调整。一般保持预设值即可。</p>
        <div className='mt-6 grid grid-cols-2 gap-3'>
            {([
                ['temperature', 'Temperature', 0, 2, 0.05],
                ['topP', 'Top P', 0, 1, 0.01],
                ['frequencyPenalty', 'Frequency penalty', -2, 2, 0.05],
                ['presencePenalty', 'Presence penalty', -2, 2, 0.05],
                ['maxTokens', 'Max tokens', 256, 32000, 256],
            ] as const).map(([key, label, min, max, step]) => <label key={key} className={key === 'maxTokens' ? 'col-span-2' : ''}><span className='text-[10px] text-slate-500'>{label}</span><input disabled={readOnly} type='number' min={min} max={max} step={step} value={draft.document.generation[key]} onChange={event => patchDocument({ generation: { ...draft.document.generation, [key]: Number(event.target.value) } })} className='mt-1 w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-xs disabled:opacity-50' /></label>)}
        </div>
        <label className='block mt-4'><span className='text-[10px] text-slate-500'>正文起笔</span><textarea disabled={readOnly} value={draft.document.assistantPrefill || ''} onChange={event => patchDocument({ assistantPrefill: event.target.value })} className='mt-1 w-full min-h-24 p-3 rounded-xl bg-white border border-slate-200 font-mono text-[11px] disabled:opacity-50' /></label>
    </section>;

    const renderGroupDetails = () => {
        if (!activeGroup) return null;
        return <section>
            <button onClick={() => { setActiveGroupKey(null); setSelectedId(''); }} className='mb-5 text-[10px] font-bold text-violet-600'>← 返回大分类</button>
            <div className='flex items-start justify-between gap-4'><div><div className='text-[9px] uppercase tracking-[.22em] font-bold text-violet-500'>Professional</div><h2 className='mt-1 text-2xl font-serif font-semibold'>{activeGroup.label}</h2><p className='mt-2 text-[10px] leading-5 text-slate-500'>{activeGroup.description}</p></div>{activeGroup.protected && <span className='shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 text-[9px] font-bold text-amber-700'><LockSimple size={12} />受保护</span>}</div>
            {activeGroup.protected && <div className='mt-5 p-4 rounded-2xl bg-amber-50 border border-amber-200 text-[11px] leading-6 text-amber-800'>这里是糯米机连接角色、你的身份、世界书与历史的骨架。可以上下调整发送顺序，但不能修改内容、开关、消息位置或类型，也不能删除。</div>}
            <div className='mt-5 border-y border-slate-200 divide-y divide-slate-200'>
                {activePrompts.map((prompt, index) => { const locked = activeGroup.protected || isProtectedStoryPrompt(prompt); return <div key={prompt.id} className={`flex items-center gap-2 py-3 ${selectedId === prompt.id ? 'text-violet-700' : ''}`}>
                    <button disabled={readOnly || locked} onClick={() => patchPrompt(prompt.id, { enabled: !isStoryPresetPromptEnabled(draft.document, prompt.id) })} className={`w-9 shrink-0 text-[9px] font-bold disabled:opacity-50 ${isStoryPresetPromptEnabled(draft.document, prompt.id) ? 'text-emerald-600' : 'text-slate-300'}`}>{isStoryPresetPromptEnabled(draft.document, prompt.id) ? 'ON' : 'OFF'}</button>
                    <button onClick={() => setSelectedId(prompt.id)} className='min-w-0 flex-1 text-left'><span className='block text-xs font-semibold truncate'>{index + 1}. {prompt.name}</span><span className='block mt-1 text-[9px] text-slate-400'>{locked ? '系统连接位 · 内容锁定' : STORY_ROLE_LABELS[prompt.role]}</span></button>
                    {!readOnly && !tavernSource && <span className='flex shrink-0'><button disabled={index === 0} onClick={() => movePrompt(prompt.id, -1)} className='p-1.5 text-slate-400 disabled:opacity-20'><ArrowUp size={14} /></button><button disabled={index === activePrompts.length - 1} onClick={() => movePrompt(prompt.id, 1)} className='p-1.5 text-slate-400 disabled:opacity-20'><ArrowDown size={14} /></button>{!locked && <button onClick={() => removePrompt(prompt.id)} className='p-1.5 text-rose-400'><Trash size={14} /></button>}</span>}
                </div>; })}
            </div>
            {!activeGroup.protected && !readOnly && !tavernSource && <button onClick={addPrompt} className='mt-4 h-10 px-4 rounded-xl bg-white border border-slate-200 text-xs font-bold flex items-center gap-1'><Plus size={14} />在本区新增提示词</button>}
            {selected && <div className='mt-7 pt-6 border-t border-slate-200'>
                {activeGroup.protected || isProtectedStoryPrompt(selected) ? <div className='py-8 text-center'><LockSimple size={28} className='mx-auto text-amber-400' /><div className='mt-2 text-xs font-bold'>系统连接内容已锁定</div><p className='mt-1 text-[10px] text-slate-400'>你仍可以在上方调整它与其他连接位的顺序。</p></div> : <>
                    <div className='grid grid-cols-2 gap-3'><label><span className='text-[10px] text-slate-500'>名称</span><input disabled={readOnly} value={selected.name} onChange={event => patchPrompt(selected.id, { name: event.target.value })} className='mt-1 w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-xs' /></label><label><span className='text-[10px] text-slate-500'>消息位置</span><select disabled={readOnly} value={selected.role} onChange={event => patchPrompt(selected.id, { role: event.target.value as StoryTheaterPresetPrompt['role'] })} className='mt-1 w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-xs'><option value='system'>规则</option><option value='user'>你</option><option value='assistant'>正文</option></select></label></div>
                    <textarea disabled={readOnly} value={selected.content} onChange={event => patchPrompt(selected.id, { content: event.target.value })} className='mt-3 w-full min-h-64 p-4 rounded-2xl bg-white border border-slate-200 font-mono text-[11px] leading-6 resize-y' placeholder='支持 {{user}} / {{char}} / {{group}}' />
                </>}
            </div>}
        </section>;
    };

    return <div className='h-full w-full flex flex-col bg-stone-100 text-slate-800'>
        <header className='story-safe-header shrink-0 border-b border-slate-200'>
            <div className='h-16 px-4 flex items-center gap-3'>
                <button onClick={onBack} className='w-9 h-9 rounded-full grid place-items-center'><ArrowLeft size={20} /></button>
                <div className='min-w-0 flex-1'><div className='text-[9px] uppercase tracking-[.24em] font-bold text-violet-500'>Preset maker</div><div className='font-semibold truncate'>预设制作器</div></div>
                {readOnly && <span className='hidden sm:inline-flex text-[9px] px-2 py-1 rounded-full bg-amber-100 text-amber-700 font-bold'>内置只读</span>}
                <button onClick={() => downloadStoryPreset(draft)} className='w-9 h-9 shrink-0 rounded-full bg-white border border-slate-200 grid place-items-center' title='导出糯米机原生预设'><DownloadSimple size={16} /></button>
                {!readOnly && <label className='w-9 h-9 shrink-0 rounded-full bg-white border border-slate-200 grid place-items-center cursor-pointer' title='导入 Regex JSON'><UploadSimple size={16} /><input type='file' accept='.json,application/json' className='hidden' onChange={event => { void importRegex(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label>}
                <button onClick={save} className='h-9 px-3 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center gap-1.5'>{readOnly ? <Copy size={14} /> : <FloppyDisk size={14} />}{readOnly ? '复制调整' : saving ? '保存中' : '保存'}</button>
            </div>
            <div className='mx-5 mb-4 grid grid-cols-2 p-1 rounded-xl bg-slate-200'>
                <button onClick={() => { setMode('simple'); setActiveGroupKey(null); }} className={`py-2 rounded-lg text-xs font-bold ${mode === 'simple' ? 'bg-white shadow-sm text-violet-700' : 'text-slate-500'}`}>默认版</button>
                <button onClick={() => setMode('pro')} className={`py-2 rounded-lg text-xs font-bold ${mode === 'pro' ? 'bg-white shadow-sm text-violet-700' : 'text-slate-500'}`}>专业版</button>
            </div>
        </header>

        <main className='story-page-scroll flex-1 overflow-y-auto px-5 py-6 pb-24'>
            <div className='max-w-2xl mx-auto'>
                {renderCompatibility()}
                {renderRegex()}
                {mode === 'simple' ? <>
                    <section className='pb-5 border-b border-slate-200'><div className='text-[9px] uppercase tracking-[.22em] font-bold text-violet-500'>Easy controls</div><h1 className='mt-1 text-3xl font-serif font-semibold'>只调看得懂的部分</h1><p className='mt-3 text-[11px] leading-6 text-slate-500'>角色、世界书、历史注入和底层发送结构由糯米机照管。这里的选择不会修改角色档案。</p>{readOnly && <p className='mt-3 text-[10px] text-amber-700'>这是内置原版。点右上角“复制调整”后即可保存你的选择。</p>}</section>
                    <div className='divide-y divide-slate-200'>{STORY_PRESET_SIMPLE_CHOICES.filter(choice => choice.ids.some(id => draft.document.prompts.some(prompt => prompt.id === id))).map(choice => {
                        const active = choice.ids.find(id => isStoryPresetPromptEnabled(draft.document, id));
                        return <section key={choice.label} className='py-6'><h2 className='text-sm font-bold'>{choice.label}</h2><p className='mt-1 text-[10px] text-slate-400'>{choice.hint}</p><div className='mt-3 flex flex-wrap gap-2'>{choice.options.map(option => { const selectedOption = option.id ? active === option.id : !active; return <button key={option.id || 'default'} disabled={readOnly} onClick={() => selectSimpleChoice(choice, option.id)} className={`px-3 py-2 rounded-full border text-[11px] font-semibold disabled:opacity-60 ${selectedOption ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-200 text-slate-600'}`}>{option.label}</button>; })}</div></section>;
                    })}</div>
                    {!readOnly && <section className='pt-5 border-t border-slate-200'><label><span className='text-[10px] font-bold text-slate-500'>预设名称</span><input value={draft.document.name} onChange={event => patchDocument({ name: event.target.value })} className='mt-2 w-full px-3 py-3 rounded-xl bg-white border border-slate-200 text-sm' /></label></section>}
                </> : activeGroupKey === '__generation__' ? renderGeneration() : activeGroup ? renderGroupDetails() : <>
                    <section className='pb-5 border-b border-slate-200'><div className='text-[9px] uppercase tracking-[.22em] font-bold text-violet-500'>Professional</div><h1 className='mt-1 text-3xl font-serif font-semibold'>先选大区，再看细节</h1><p className='mt-3 text-[11px] leading-6 text-slate-500'>手机上一次只展开一个区。上下箭头移动整区；进入大区后才会显示内部条目。</p></section>
                    <div className='divide-y divide-slate-200'>{groups.map((group, index) => {
                        const groupPrompts = draft.document.prompts.filter(prompt => group.promptIds.includes(prompt.id) && !isStoryPresetSectionMarker(prompt));
                        const enabled = groupPrompts.filter(prompt => isStoryPresetPromptEnabled(draft.document, prompt.id)).length;
                        return <div key={group.key} className='py-4 flex items-center gap-3'><button onClick={() => { setActiveGroupKey(group.key); setSelectedId(''); }} className='min-w-0 flex-1 text-left'><span className='flex items-center gap-2'><strong className='text-sm'>{group.label}</strong>{group.protected && <LockSimple size={13} className='text-amber-500' />}</span><span className='block mt-1 text-[10px] text-slate-400 truncate'>{group.description}</span><span className='block mt-1 text-[9px] text-violet-500'>{enabled}/{groupPrompts.length} 条启用</span></button>{!readOnly && !tavernSource && <span className='flex shrink-0'><button disabled={index === 0} onClick={() => moveGroup(group.key, -1)} className='p-2 text-slate-400 disabled:opacity-20'><ArrowUp size={15} /></button><button disabled={index === groups.length - 1} onClick={() => moveGroup(group.key, 1)} className='p-2 text-slate-400 disabled:opacity-20'><ArrowDown size={15} /></button></span>}</div>;
                    })}<button onClick={() => setActiveGroupKey('__generation__')} className='w-full py-5 text-left'><strong className='text-sm'>续写参数</strong><span className='block mt-1 text-[10px] text-slate-400'>Temperature、Top P、惩罚项与最大输出</span></button></div>
                    {!readOnly && <section className='pt-6 border-t border-slate-200 grid gap-3 sm:grid-cols-2'><label><span className='text-[10px] font-bold text-slate-500'>预设名称</span><input value={draft.document.name} onChange={event => patchDocument({ name: event.target.value })} className='mt-1 w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm' /></label><label><span className='text-[10px] font-bold text-slate-500'>说明</span><input value={draft.document.description || ''} onChange={event => patchDocument({ description: event.target.value })} className='mt-1 w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm' /></label></section>}
                    {!readOnly && onDelete && <button onClick={() => onDelete(draft)} className='mt-8 w-full py-3 text-xs font-bold text-rose-500'>删除这个预设</button>}
                </>}
            </div>
        </main>
    </div>;
};

export default StoryPresetMaker;
