import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowLeft,
    BookOpenText,
    ChatCircleDots,
    Check,
    Clock,
    NotePencil,
    PaperPlaneRight,
    SlidersHorizontal,
    StopCircle,
    TextAa,
    Trash,
    UploadSimple,
    X,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import type {
    CharacterProfile,
    TogetherAnnotation,
    TogetherLibraryItem,
    TogetherReaderPreferences,
    TogetherSession,
    TogetherSessionMessage,
} from '../types';
import { DB } from '../utils/db';
import { TogetherStore } from '../utils/togetherStore';
import { buildChatRequestPayload } from '../utils/chatRequestPayload';
import { extractContent, safeResponseJson } from '../utils/safeApi';
import {
    currentInteractionMode,
    extractInteractionModeDirective,
    inferExplicitUserMode,
    type InteractionModeDirective,
} from '../utils/interactionMode';
import { MemoryNodeDB } from '../utils/memoryPalace/db';
import {
    flushBackendMemorySyncQueue,
    loadBackendChatConfig,
    syncBackendContext,
} from '../utils/backendClient';
import { useBlobRefUrl } from '../utils/blobRef';

const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const DEFAULT_READER_PREFERENCES: TogetherReaderPreferences = {
    fontFamily: 'serif',
    fontSize: 17,
    lineHeight: 2,
    background: 'ivory',
};

const READER_THEMES: Record<TogetherReaderPreferences['background'], { name: string; background: string; text: string; panel: string; line: string }> = {
    ivory: { name: '象牙白', background: '#f6f1e7', text: '#3f3c35', panel: '#fbf8f1', line: '#d8d0c1' },
    paper: { name: '纸张', background: '#eee2cf', text: '#453d32', panel: '#f6ecdc', line: '#d1c0a8' },
    mint: { name: '浅薄荷', background: '#e7f0eb', text: '#34423c', panel: '#f1f6f3', line: '#c4d6cd' },
    rose: { name: '柔粉', background: '#f3e9e9', text: '#493d40', panel: '#faf3f2', line: '#decacb' },
    night: { name: '夜间', background: '#252724', text: '#e8e4da', panel: '#30322e', line: '#494c46' },
};

const FONT_OPTIONS: Array<{ id: TogetherReaderPreferences['fontFamily']; name: string; css: string }> = [
    { id: 'serif', name: '宋体', css: '"Songti SC", "Noto Serif SC", serif' },
    { id: 'sans', name: '黑体', css: '"PingFang SC", "Microsoft YaHei", sans-serif' },
    { id: 'kai', name: '楷体', css: 'KaiTi, "STKaiti", serif' },
];

type TextSelection = {
    segmentIndex: number;
    startOffset: number;
    endOffset: number;
    quote: string;
};

async function readTxt(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const utf8 = new TextDecoder('utf-8').decode(buffer);
    const broken = (utf8.match(/�/g) || []).length;
    if (broken <= Math.max(2, utf8.length * 0.002)) return utf8;
    try { return new TextDecoder('gb18030').decode(buffer); } catch { return utf8; }
}

function elapsedText(startedAt: number, endedAt = Date.now()): string {
    const minutes = Math.max(1, Math.round((endedAt - startedAt) / 60_000));
    return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟` : `${minutes} 分钟`;
}

function segmentNovel(text = ''): string[] {
    return text
        .replace(/\r\n/g, '\n')
        .split(/\n+/)
        .map(segment => segment.trim())
        .filter(Boolean);
}

const Avatar: React.FC<{ src?: string; name: string; tone: 'user' | 'character'; size?: 'sm' | 'md' }> = ({ src, name, tone, size = 'sm' }) => {
    const dimension = size === 'md' ? 'h-11 w-11 text-sm' : 'h-8 w-8 text-[11px]';
    const resolvedSrc = useBlobRefUrl(src);
    if (resolvedSrc) return <img src={resolvedSrc} alt={`${name}的头像`} className={`${dimension} shrink-0 rounded-full border-2 border-white/80 object-cover shadow-sm`} />;
    return (
        <span className={`${dimension} grid shrink-0 place-items-center rounded-full border-2 border-white/75 font-semibold shadow-sm ${tone === 'user' ? 'bg-[#a9cdbd] text-[#315c4f]' : 'bg-[#c9bd99] text-[#5c523d]'}`}>
            {name.trim().slice(0, 1) || '角'}
        </span>
    );
};

const TogetherApp: React.FC = () => {
    const {
        closeApp,
        characters,
        activeCharacterId,
        setActiveCharacterId,
        updateCharacter,
        userProfile,
        groups,
        apiConfig,
        realtimeConfig,
        addToast,
    } = useOS();
    const [items, setItems] = useState<TogetherLibraryItem[]>([]);
    const [activeItem, setActiveItem] = useState<TogetherLibraryItem | null>(null);
    const [session, setSession] = useState<TogetherSession | null>(null);
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const [ending, setEnding] = useState(false);
    const [chatOpen, setChatOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [annotationOpen, setAnnotationOpen] = useState(false);
    const [pendingSelection, setPendingSelection] = useState<TextSelection | null>(null);
    const [annotationDraft, setAnnotationDraft] = useState('');
    const textPaneRef = useRef<HTMLDivElement>(null);
    const sessionRef = useRef<TogetherSession | null>(null);
    const saveTimerRef = useRef<number | null>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);

    const char = characters.find(item => item.id === (session?.charId || activeCharacterId)) || characters[0];
    const preferences = activeItem?.readerPreferences || DEFAULT_READER_PREFERENCES;
    const theme = READER_THEMES[preferences.background];
    const font = FONT_OPTIONS.find(option => option.id === preferences.fontFamily) || FONT_OPTIONS[0];
    const paragraphs = useMemo(() => segmentNovel(activeItem?.text), [activeItem?.text]);
    const messages = session?.messages || [];
    const annotations = session?.annotations || [];

    useEffect(() => { sessionRef.current = session; }, [session]);
    useEffect(() => { void TogetherStore.listItems().then(all => setItems(all.filter(item => item.type === 'novel'))); }, []);
    useEffect(() => () => {
        if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    }, []);
    useEffect(() => {
        if (!chatOpen) return;
        const scroller = chatEndRef.current?.parentElement;
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
    }, [chatOpen, messages.length, sending]);

    const saveSession = async (next: TogetherSession) => {
        setSession(next);
        sessionRef.current = next;
        await TogetherStore.saveSession(next);
    };

    const openItem = async (item: TogetherLibraryItem) => {
        const selectedChar = characters.find(character => character.id === activeCharacterId) || characters[0];
        if (!selectedChar) {
            addToast('请先创建一个角色', 'error');
            return;
        }
        const existing = await TogetherStore.latestOpenSession(item.id, selectedChar.id);
        const next = existing || {
            id: uid('together-session'),
            itemId: item.id,
            itemTitle: item.title,
            mediaType: item.type,
            charId: selectedChar.id,
            startedAt: Date.now(),
            progress: item.lastPosition || 0,
            interactionMode: currentInteractionMode(selectedChar),
            messages: [],
            annotations: [],
        } satisfies TogetherSession;
        setActiveItem({ ...item, readerPreferences: item.readerPreferences || DEFAULT_READER_PREFERENCES });
        await saveSession({ ...next, annotations: next.annotations || [] });
        window.setTimeout(() => {
            const pane = textPaneRef.current;
            if (!pane) return;
            pane.scrollTop = next.progress * Math.max(0, pane.scrollHeight - pane.clientHeight);
        }, 80);
    };

    const importNovel = async (file: File) => {
        const text = (await readTxt(file)).trim();
        if (!text) {
            addToast('TXT 里没有可读文字', 'error');
            return;
        }
        const now = Date.now();
        const item: TogetherLibraryItem = {
            id: uid('together-novel'),
            type: 'novel',
            title: file.name.replace(/\.txt$/i, ''),
            text,
            fileName: file.name,
            createdAt: now,
            updatedAt: now,
            lastPosition: 0,
            readerPreferences: DEFAULT_READER_PREFERENCES,
        };
        await TogetherStore.saveItem(item);
        setItems(current => [item, ...current]);
        addToast('小说已加入一起读', 'success');
    };

    const deleteItem = async (item: TogetherLibraryItem) => {
        await TogetherStore.deleteItem(item.id);
        setItems(current => current.filter(entry => entry.id !== item.id));
    };

    const updatePreferences = async (patch: Partial<TogetherReaderPreferences>) => {
        if (!activeItem) return;
        const next: TogetherLibraryItem = {
            ...activeItem,
            readerPreferences: { ...preferences, ...patch },
            updatedAt: Date.now(),
        };
        setActiveItem(next);
        setItems(current => current.map(item => item.id === next.id ? next : item));
        await TogetherStore.saveItem(next);
    };

    const persistInteractionMode = async (
        activeChar: CharacterProfile,
        directive: InteractionModeDirective,
        changedBy: 'user' | 'assistant',
    ): Promise<CharacterProfile> => {
        const patch = {
            interactionMode: directive.mode,
            interactionScene: {
                ...(activeChar.interactionScene || {}),
                location: directive.location || activeChar.interactionScene?.location,
                distance: directive.distance || activeChar.interactionScene?.distance,
                changedAt: Date.now(),
                changedBy,
            },
        } as const;
        const updatedCharacter = { ...activeChar, ...patch };
        updateCharacter(activeChar.id, patch);
        const backendConfig = loadBackendChatConfig();
        if (backendConfig.enabled) {
            await syncBackendContext({
                config: backendConfig,
                character: updatedCharacter,
                user: userProfile,
                messages: [],
                memories: [],
            }).catch(error => console.warn('[Together] 互动状态同步失败:', error));
        }
        return updatedCharacter;
    };

    const modelReply = async (
        activeChar: CharacterProfile,
        userText: string,
        activeSession: TogetherSession,
        quote?: string,
    ): Promise<{ content: string; directive: InteractionModeDirective | null }> => {
        const history = await DB.getRecentMessagesByCharId(activeChar.id, Math.min(activeChar.contextLimit || 500, 300));
        const text = activeItem?.text || '';
        const center = Math.round(text.length * activeSession.progress);
        const excerpt = text.slice(Math.max(0, center - 1200), Math.min(text.length, center + 1800));
        const discussion = activeSession.messages.slice(-12).map(message => `${message.role === 'user' ? userProfile.name : activeChar.name}: ${message.content}`).join('\n');
        const annotationContext = (activeSession.annotations || []).slice(-8).map(annotation => (
            `${annotation.author === 'user' ? userProfile.name : activeChar.name}批注“${annotation.quote}”：${annotation.comment}`
        )).join('\n');
        const payload = await buildChatRequestPayload({
            char: activeChar,
            userProfile,
            groups,
            emojis: [],
            categories: [],
            historyMsgs: history,
            recentMsgsHint: history.slice(-80),
            contextLimit: Math.min(activeChar.contextLimit || 500, 300),
            realtimeConfig,
            recallQueryHint: `一起读 ${activeSession.itemTitle} ${quote || ''} ${userText}`,
        });
        const task = `\n\n[一起读页面讨论]\n你正在和${userProfile.name}一起读小说《${activeSession.itemTitle}》，当前进度${Math.round(activeSession.progress * 100)}%。\n${quote ? `这次选中的原文：\n“${quote}”\n` : ''}${excerpt ? `眼前片段：\n${excerpt}\n` : ''}${annotationContext ? `近期批注：\n${annotationContext}\n` : ''}${discussion ? `本次讨论：\n${discussion}\n` : ''}${userProfile.name}刚刚说：${userText}\n直接以角色本人身份回应。围绕原文交流，不做助手式分析，不复述人设，控制在1-4句。`;
        const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey || 'sk-none'}` },
            body: JSON.stringify({
                model: apiConfig.model,
                messages: [...payload.fullMessages, { role: 'user', content: task }],
                temperature: 0.9,
                stream: false,
            }),
        });
        const data = await safeResponseJson(response);
        if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
        const extracted = extractInteractionModeDirective(extractContent(data).trim());
        return { content: extracted.content.trim(), directive: extracted.directive };
    };

    const sendDiscussion = async (options?: { text?: string; selection?: TextSelection; annotationId?: string }) => {
        const activeSession = sessionRef.current;
        const userText = (options?.text ?? draft).trim();
        if (!activeSession || !char || !userText || sending) return;
        setDraft('');
        setSending(true);
        setChatOpen(true);
        try {
            const explicitMode = inferExplicitUserMode(userText);
            let replyCharacter = char;
            if (explicitMode) replyCharacter = await persistInteractionMode(char, { mode: explicitMode }, 'user');
            const userMessage: TogetherSessionMessage = {
                id: uid('together-msg'),
                role: 'user',
                content: userText,
                createdAt: Date.now(),
                progress: activeSession.progress,
                annotationId: options?.annotationId,
                quote: options?.selection?.quote,
            };
            const withUser: TogetherSession = {
                ...activeSession,
                interactionMode: explicitMode || activeSession.interactionMode,
                messages: [...activeSession.messages, userMessage],
            };
            await saveSession(withUser);
            const reply = await modelReply(replyCharacter, userText, withUser, options?.selection?.quote);
            if (!reply.content) throw new Error('角色没有返回正文');
            if (reply.directive) replyCharacter = await persistInteractionMode(replyCharacter, reply.directive, 'assistant');
            const replyMessage: TogetherSessionMessage = {
                id: uid('together-msg'),
                role: 'assistant',
                content: reply.content,
                createdAt: Date.now(),
                progress: withUser.progress,
                annotationId: options?.annotationId,
                quote: options?.selection?.quote,
            };
            const replyAnnotation: TogetherAnnotation | null = options?.annotationId && options.selection ? {
                id: uid('together-note'),
                itemId: withUser.itemId,
                sessionId: withUser.id,
                segmentIndex: options.selection.segmentIndex,
                startOffset: options.selection.startOffset,
                endOffset: options.selection.endOffset,
                quote: options.selection.quote,
                comment: reply.content,
                author: 'character',
                createdAt: Date.now(),
                replyToId: options.annotationId,
            } : null;
            await saveSession({
                ...withUser,
                interactionMode: reply.directive?.mode || withUser.interactionMode,
                messages: [...withUser.messages, replyMessage],
                annotations: replyAnnotation ? [...(withUser.annotations || []), replyAnnotation] : withUser.annotations,
            });
        } catch (error: any) {
            addToast(`讨论失败：${error?.message || '未知错误'}`, 'error');
        } finally {
            setSending(false);
        }
    };

    const saveAnnotation = async () => {
        const activeSession = sessionRef.current;
        const comment = annotationDraft.trim();
        if (!activeSession || !pendingSelection || !comment) return;
        const annotation: TogetherAnnotation = {
            id: uid('together-note'),
            itemId: activeSession.itemId,
            sessionId: activeSession.id,
            segmentIndex: pendingSelection.segmentIndex,
            startOffset: pendingSelection.startOffset,
            endOffset: pendingSelection.endOffset,
            quote: pendingSelection.quote,
            comment,
            author: 'user',
            createdAt: Date.now(),
        };
        await saveSession({ ...activeSession, annotations: [...(activeSession.annotations || []), annotation] });
        setAnnotationDraft('');
        setAnnotationOpen(false);
        const selection = pendingSelection;
        setPendingSelection(null);
        window.getSelection()?.removeAllRanges();
        await sendDiscussion({ text: comment, selection, annotationId: annotation.id });
    };

    const captureSelection = () => {
        window.setTimeout(() => {
            const selection = window.getSelection();
            const pane = textPaneRef.current;
            if (!selection || selection.isCollapsed || !selection.rangeCount || !pane) {
                setPendingSelection(null);
                return;
            }
            const range = selection.getRangeAt(0);
            const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE
                ? range.startContainer as Element
                : range.startContainer.parentElement;
            const endElement = range.endContainer.nodeType === Node.ELEMENT_NODE
                ? range.endContainer as Element
                : range.endContainer.parentElement;
            const startSegment = startElement?.closest<HTMLElement>('[data-segment-index]');
            const endSegment = endElement?.closest<HTMLElement>('[data-segment-index]');
            if (!startSegment || startSegment !== endSegment || !pane.contains(startSegment)) {
                setPendingSelection(null);
                return;
            }
            const rawQuote = selection.toString();
            const quote = rawQuote.trim();
            if (!quote) return;
            const before = document.createRange();
            before.selectNodeContents(startSegment);
            before.setEnd(range.startContainer, range.startOffset);
            const leadingWhitespace = rawQuote.indexOf(quote);
            const startOffset = before.toString().length + Math.max(0, leadingWhitespace);
            setPendingSelection({
                segmentIndex: Number(startSegment.dataset.segmentIndex),
                startOffset,
                endOffset: startOffset + quote.length,
                quote,
            });
        }, 80);
    };

    const onNovelScroll = () => {
        const pane = textPaneRef.current;
        const activeSession = sessionRef.current;
        if (!pane || !activeSession) return;
        const max = Math.max(1, pane.scrollHeight - pane.clientHeight);
        const progress = Math.min(1, Math.max(0, pane.scrollTop / max));
        const next = { ...activeSession, progress };
        setSession(next);
        sessionRef.current = next;
        if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = window.setTimeout(() => void TogetherStore.saveSession(next), 240);
    };

    const endSession = async () => {
        const activeSession = sessionRef.current;
        if (!activeSession || !activeItem || !char || ending) return;
        setEnding(true);
        try {
            const endedAt = Date.now();
            const discussion = activeSession.messages.map(message => `${message.role === 'user' ? userProfile.name : char.name}: ${message.content}`).join('\n');
            const notes = (activeSession.annotations || []).map(annotation => `${annotation.author === 'user' ? userProfile.name : char.name}批注“${annotation.quote}”：${annotation.comment}`).join('\n');
            let summary = `${userProfile.name}和${char.name}${activeSession.interactionMode === 'offline' ? '线下' : '线上'}一起读了《${activeSession.itemTitle}》${elapsedText(activeSession.startedAt, endedAt)}，进度到${Math.round(activeSession.progress * 100)}%。`;
            if (discussion || notes) {
                try {
                    const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey || 'sk-none'}` },
                        body: JSON.stringify({
                            model: apiConfig.model,
                            temperature: 0.25,
                            stream: false,
                            messages: [{
                                role: 'user',
                                content: `把以下共读记录压缩成2-4句可长期保存的第三人称事实记忆。保留双方对作品的具体看法、分歧、喜欢的段落和批注，不虚构。\n作品：${activeSession.itemTitle}\n用时：${elapsedText(activeSession.startedAt, endedAt)}\n进度：${Math.round(activeSession.progress * 100)}%\n讨论：\n${discussion || '无'}\n批注：\n${notes || '无'}`,
                            }],
                        }),
                    });
                    const data = await safeResponseJson(response);
                    if (response.ok && extractContent(data).trim()) summary += ` ${extractContent(data).trim()}`;
                } catch { /* deterministic summary remains available */ }
            }
            const completed: TogetherSession = { ...activeSession, endedAt, summary };
            await TogetherStore.saveSession(completed);
            const updatedItem = { ...activeItem, lastPosition: activeSession.progress, updatedAt: endedAt };
            await TogetherStore.saveItem(updatedItem);
            await MemoryNodeDB.save({
                id: uid('mem-together'),
                charId: char.id,
                content: summary,
                room: 'living_room',
                tags: ['一起读', '共读', activeSession.interactionMode === 'offline' ? '线下' : '线上'],
                importance: 7,
                mood: 'warm',
                embedded: false,
                createdAt: endedAt,
                lastAccessedAt: endedAt,
                accessCount: 0,
                origin: 'system',
            });
            const backendConfig = loadBackendChatConfig();
            let backendSynced = false;
            if (backendConfig.enabled) {
                backendSynced = await flushBackendMemorySyncQueue({ config: backendConfig, character: char, user: userProfile })
                    .then(() => true)
                    .catch(() => false);
            }
            setItems(current => current.map(item => item.id === updatedItem.id ? updatedItem : item));
            setChatOpen(false);
            sessionRef.current = null;
            setSession(null);
            setActiveItem(null);
            addToast(
                backendSynced ? '这段共读已写入前端与后端记忆' : '这段共读已写入记忆，后端等待下次同步',
                'success',
            );
        } catch (error: any) {
            addToast(`归档失败：${error?.message || '未知错误'}`, 'error');
        } finally {
            setEnding(false);
        }
    };

    const renderParagraph = (paragraph: string, index: number) => {
        const ranges = annotations
            .filter(annotation => annotation.segmentIndex === index)
            .sort((left, right) => left.startOffset - right.startOffset);
        if (!ranges.length) return paragraph;
        const nodes: React.ReactNode[] = [];
        let cursor = 0;
        ranges.forEach(annotation => {
            const start = Math.max(cursor, Math.min(paragraph.length, annotation.startOffset));
            const end = Math.max(start, Math.min(paragraph.length, annotation.endOffset));
            if (start > cursor) nodes.push(paragraph.slice(cursor, start));
            nodes.push(<mark key={annotation.id} title={annotation.comment} className={`rounded-sm px-0.5 text-inherit ${annotation.author === 'character' ? 'bg-[#86b69e]/35' : 'bg-[#c9bd99]/45'}`}>{paragraph.slice(start, end)}</mark>);
            cursor = end;
        });
        if (cursor < paragraph.length) nodes.push(paragraph.slice(cursor));
        return nodes;
    };

    if (!activeItem || !session) {
        return (
            <div className="relative h-full overflow-y-auto bg-[#eaf2ee] text-[#35423d]">
                <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(81,122,106,.07)_1px,transparent_1px),linear-gradient(90deg,rgba(81,122,106,.07)_1px,transparent_1px)] [background-size:24px_24px]" />
                <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-[#cbdcd3] bg-[#eaf2ee]/95 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur">
                    <button onClick={closeApp} className="grid h-11 w-11 place-items-center rounded-full border border-[#c6d8cf] bg-white/70 active:scale-95" aria-label="返回"><ArrowLeft size={20} weight="bold" /></button>
                    <div>
                        <h1 className="text-[21px] font-semibold tracking-[.08em]">一起读</h1>
                        <p className="mt-0.5 text-[11px] text-[#6c7c75]">把喜欢的句子留在你们之间</p>
                    </div>
                </header>

                <main className="relative z-10 space-y-5 px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-5">
                    <section className="relative overflow-hidden rounded-[26px] border border-white/80 bg-[#f7faf8] p-4 shadow-[0_14px_34px_rgba(65,91,79,.10)]">
                        <span aria-hidden="true" className="absolute right-5 top-3 rotate-[9deg] text-[22px] opacity-65">🍃</span>
                        <p className="text-[11px] font-semibold text-[#6d8077]">今天和谁一起读</p>
                        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                            {characters.map(character => (
                                <button
                                    key={character.id}
                                    onClick={() => setActiveCharacterId(character.id)}
                                    className={`flex shrink-0 items-center gap-2 rounded-full border px-2 py-1.5 text-[12px] font-semibold transition active:scale-[.98] ${character.id === activeCharacterId ? 'border-[#91b9a8] bg-[#dcece5] text-[#315c4f]' : 'border-[#d5dfda] bg-white/75 text-[#66736d]'}`}
                                >
                                    <Avatar src={character.avatar} name={character.name} tone="character" />
                                    {character.name}
                                </button>
                            ))}
                        </div>
                        <label className="mt-4 flex h-12 cursor-pointer items-center justify-center gap-2 rounded-full bg-[#709c8a] text-[13px] font-semibold text-white shadow-[0_8px_18px_rgba(61,105,87,.2)] active:scale-[.99]">
                            <UploadSimple size={18} weight="bold" />导入 TXT
                            <input type="file" accept=".txt,text/plain" className="hidden" onChange={event => event.target.files?.[0] && void importNovel(event.target.files[0])} />
                        </label>
                    </section>

                    <section>
                        <div className="mb-3 flex items-end justify-between px-1">
                            <div><p className="text-[18px] font-semibold">书架</p><p className="mt-1 text-[10px] text-[#77867f]">TXT 会保存在本机完整备份中</p></div>
                            <span className="text-[11px] font-semibold text-[#789688]">{items.length} 本</span>
                        </div>
                        {items.length === 0 ? (
                            <div className="flex min-h-[240px] flex-col items-center justify-center rounded-[26px] border border-dashed border-[#b9cec4] bg-white/45 text-center">
                                <BookOpenText size={35} weight="thin" className="text-[#7ea393]" />
                                <p className="mt-4 text-[14px] font-semibold">书架还是空的</p>
                                <p className="mt-1 text-[11px] leading-5 text-[#819088]">导入一本 TXT，就可以边读边聊。</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {items.map((item, index) => (
                                    <article key={item.id} className={`relative flex items-center gap-3 rounded-[22px] border border-white/80 bg-[#fbfcfa] p-4 shadow-[0_8px_22px_rgba(65,91,79,.08)] ${index % 2 ? 'rotate-[.25deg]' : 'rotate-[-.2deg]'}`}>
                                        <span aria-hidden="true" className="absolute -top-2 right-7 h-5 w-14 rotate-[5deg] bg-[#d8cda9]/50" />
                                        <div className="grid h-12 w-10 shrink-0 place-items-center rounded-r-lg rounded-l-sm bg-[#c9bd99] text-[#554d3c] shadow-sm"><BookOpenText size={21} /></div>
                                        <button className="min-w-0 flex-1 text-left" onClick={() => void openItem(item)}>
                                            <div className="truncate text-[14px] font-semibold">{item.title}</div>
                                            <div className="mt-1 text-[10px] text-[#7d8983]">上次读到 {Math.round((item.lastPosition || 0) * 100)}%</div>
                                        </button>
                                        <button onClick={() => void deleteItem(item)} className="grid h-9 w-9 place-items-center rounded-full text-[#8b958f] active:bg-[#e9efec]" aria-label={`删除${item.title}`}><Trash size={17} /></button>
                                    </article>
                                ))}
                            </div>
                        )}
                    </section>
                </main>
            </div>
        );
    }

    return (
        <div className="relative flex h-full min-h-0 flex-col overflow-hidden" style={{ background: theme.background, color: theme.text }}>
            <header className="relative z-20 flex shrink-0 items-center gap-3 border-b px-3 pb-2 pt-[max(.65rem,env(safe-area-inset-top))]" style={{ borderColor: theme.line, background: `${theme.panel}ee` }}>
                <button onClick={() => void endSession()} className="grid h-10 w-10 place-items-center rounded-full active:scale-95" aria-label="结束共读"><ArrowLeft size={20} weight="bold" /></button>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold">{activeItem.title}</div>
                    <div className="mt-0.5 flex items-center gap-3 text-[10px] opacity-55">
                        <span>{Math.round(session.progress * 100)}%</span>
                        <span className="flex items-center gap-1"><Clock size={11} />{elapsedText(session.startedAt)}</span>
                        <span>{session.interactionMode === 'offline' ? '线下' : '线上'}</span>
                    </div>
                </div>
                <button onClick={() => void endSession()} disabled={ending} className="flex h-9 items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold disabled:opacity-45" style={{ borderColor: theme.line }}>
                    <StopCircle size={15} />{ending ? '归档中' : '结束'}
                </button>
            </header>

            <div
                ref={textPaneRef}
                onScroll={onNovelScroll}
                onPointerUp={captureSelection}
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-32 pt-7 selection:bg-[#c9bd99]/55 [user-select:text]"
                style={{ fontFamily: font.css, fontSize: preferences.fontSize, lineHeight: preferences.lineHeight }}
            >
                <article className="mx-auto max-w-[44rem]">
                    <h1 className="mb-8 text-center text-[1.3em] font-semibold leading-relaxed">{activeItem.title}</h1>
                    {paragraphs.map((paragraph, index) => (
                        <p key={index} data-segment-index={index} className="relative mb-[1.15em] text-justify tracking-[.025em]">
                            {renderParagraph(paragraph, index)}
                            {annotations.some(annotation => annotation.segmentIndex === index && annotation.author === 'user') && (
                                <sup className="ml-1 text-[9px] font-sans font-semibold text-[#8e805e]">{annotations.filter(annotation => annotation.segmentIndex === index && annotation.author === 'user').length}</sup>
                            )}
                        </p>
                    ))}
                </article>
            </div>

            {pendingSelection && !annotationOpen && (
                <div className="absolute inset-x-5 bottom-[5.8rem] z-30 flex items-center gap-2 rounded-[18px] border bg-[#fbfaf5] p-2 text-[#4a473f] shadow-[0_14px_40px_rgba(55,49,38,.18)]" style={{ borderColor: theme.line }}>
                    <p className="min-w-0 flex-1 truncate px-2 text-[11px]">“{pendingSelection.quote}”</p>
                    <button onClick={() => setAnnotationOpen(true)} className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[#c9bd99] px-3 text-[11px] font-semibold text-[#514937]"><NotePencil size={15} />批注</button>
                    <button onClick={() => { setDraft(`我想聊聊这句：${pendingSelection.quote}`); setChatOpen(true); }} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#739d8b] text-white" aria-label="和角色聊这句"><ChatCircleDots size={17} weight="fill" /></button>
                </div>
            )}

            <div className="absolute inset-x-4 bottom-[max(.8rem,env(safe-area-inset-bottom))] z-20 flex h-14 items-center justify-between rounded-full border bg-[#fbfaf6]/95 px-2.5 text-[#45423a] shadow-[0_12px_32px_rgba(55,49,38,.16)] backdrop-blur" style={{ borderColor: theme.line }}>
                <button onClick={() => setSettingsOpen(true)} className="grid h-10 w-10 place-items-center rounded-full active:bg-black/5" aria-label="阅读设置"><TextAa size={21} weight="bold" /></button>
                <div className="flex items-center gap-2 text-[10px] font-semibold text-[#81796a]"><span>{Math.round(session.progress * 100)}%</span><span className="h-1 w-1 rounded-full bg-[#b6aa8c]" /><span>{annotations.filter(annotation => annotation.author === 'user').length} 条批注</span></div>
                <button onClick={() => setChatOpen(true)} className="flex h-10 items-center gap-2 rounded-full bg-[#dceae4] pl-1 pr-3 text-[11px] font-semibold text-[#3f6658] active:scale-[.98]">
                    <Avatar src={char?.avatar} name={char?.name || '角色'} tone="character" />
                    边读边聊
                </button>
            </div>

            {chatOpen && (
                <div className="absolute inset-0 z-40 flex items-end bg-[#31352f]/24" onClick={() => setChatOpen(false)}>
                    <section className="flex max-h-[72%] min-h-[48%] w-full flex-col overflow-hidden rounded-t-[28px] border-t bg-[#f7f7f3] text-[#3d443f] shadow-[0_-18px_55px_rgba(44,49,45,.2)]" onClick={event => event.stopPropagation()}>
                        <div className="flex items-center gap-3 border-b border-[#dce2de] px-4 py-3">
                            <Avatar src={char?.avatar} name={char?.name || '角色'} tone="character" size="md" />
                            <div className="min-w-0 flex-1"><p className="truncate text-[14px] font-semibold">和 {char?.name || '角色'} 边读边聊</p><p className="mt-0.5 text-[10px] text-[#7d8983]">选中的原文和批注，角色都能看见</p></div>
                            <button onClick={() => setChatOpen(false)} className="grid h-9 w-9 place-items-center rounded-full bg-[#e9eeeb]" aria-label="收起聊天"><X size={17} /></button>
                        </div>
                        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
                            {messages.length === 0 && <div className="py-10 text-center text-[11px] text-[#8d9892]">看到想说的地方，就叫一声。</div>}
                            {messages.map(message => {
                                const isUser = message.role === 'user';
                                return (
                                    <div key={message.id} className={`flex items-end gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
                                        {!isUser && <Avatar src={char?.avatar} name={char?.name || '角色'} tone="character" />}
                                        <div className={`max-w-[76%] rounded-[18px] px-3.5 py-2.5 text-[13px] leading-6 shadow-sm ${isUser ? 'rounded-br-md bg-[#a9cdbd] text-[#294b40]' : 'rounded-bl-md border border-[#ddd8c9] bg-[#fffdfa] text-[#45413a]'}`}>
                                            {message.quote && <blockquote className="mb-2 border-l-2 border-[#9f9270] pl-2 text-[10px] leading-4 opacity-65">{message.quote}</blockquote>}
                                            {message.content}
                                        </div>
                                        {isUser && <Avatar src={userProfile.avatar} name={userProfile.name || '你'} tone="user" />}
                                    </div>
                                );
                            })}
                            {sending && (
                                <div className="flex items-end gap-2">
                                    <Avatar src={char?.avatar} name={char?.name || '角色'} tone="character" />
                                    <div className="rounded-[18px] rounded-bl-md border border-[#ddd8c9] bg-[#fffdfa] px-3.5 py-2.5 text-[11px] text-[#8b897f]">正在看你标出的这句…</div>
                                </div>
                            )}
                            <div ref={chatEndRef} />
                        </div>
                        <div className="flex gap-2 border-t border-[#dce2de] bg-[#fafbf9] px-3 pb-[max(.8rem,env(safe-area-inset-bottom))] pt-3">
                            <input
                                value={draft}
                                onChange={event => setDraft(event.target.value)}
                                onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendDiscussion(); } }}
                                placeholder="对这一段说点什么…"
                                className="min-w-0 flex-1 rounded-full border border-[#d7dfda] bg-white px-4 text-[13px] outline-none focus:border-[#87ae9e]"
                            />
                            <button onClick={() => void sendDiscussion()} disabled={sending || !draft.trim()} className="grid h-11 w-11 place-items-center rounded-full bg-[#739d8b] text-white disabled:opacity-40" aria-label="发送"><PaperPlaneRight size={18} weight="fill" /></button>
                        </div>
                    </section>
                </div>
            )}

            {settingsOpen && (
                <div className="absolute inset-0 z-50 flex items-end bg-[#31352f]/25" onClick={() => setSettingsOpen(false)}>
                    <section className="w-full rounded-t-[28px] bg-[#fbfaf6] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 text-[#45413a] shadow-[0_-18px_55px_rgba(44,49,45,.2)]" onClick={event => event.stopPropagation()}>
                        <div className="flex items-center justify-between"><div className="flex items-center gap-2"><SlidersHorizontal size={19} /><h2 className="text-[16px] font-semibold">阅读设置</h2></div><button onClick={() => setSettingsOpen(false)} className="grid h-9 w-9 place-items-center rounded-full bg-[#ece9e0]"><X size={16} /></button></div>
                        <div className="mt-5">
                            <p className="text-[11px] font-semibold text-[#777267]">字体</p>
                            <div className="mt-2 grid grid-cols-3 gap-2">{FONT_OPTIONS.map(option => <button key={option.id} onClick={() => void updatePreferences({ fontFamily: option.id })} className={`h-11 rounded-[14px] border text-[13px] ${preferences.fontFamily === option.id ? 'border-[#8fae9f] bg-[#e4efe9]' : 'border-[#ded9cc] bg-white'}`} style={{ fontFamily: option.css }}>{option.name}</button>)}</div>
                        </div>
                        <div className="mt-5 grid grid-cols-2 gap-4">
                            <label><span className="text-[11px] font-semibold text-[#777267]">字号 {preferences.fontSize}px</span><input type="range" min="14" max="24" step="1" value={preferences.fontSize} onChange={event => void updatePreferences({ fontSize: Number(event.target.value) })} className="mt-3 w-full accent-[#739d8b]" /></label>
                            <label><span className="text-[11px] font-semibold text-[#777267]">行距 {preferences.lineHeight.toFixed(1)}</span><input type="range" min="1.5" max="2.5" step="0.1" value={preferences.lineHeight} onChange={event => void updatePreferences({ lineHeight: Number(event.target.value) })} className="mt-3 w-full accent-[#739d8b]" /></label>
                        </div>
                        <div className="mt-5"><p className="text-[11px] font-semibold text-[#777267]">背景</p><div className="mt-2 grid grid-cols-5 gap-2">{Object.entries(READER_THEMES).map(([id, value]) => <button key={id} onClick={() => void updatePreferences({ background: id as TogetherReaderPreferences['background'] })} className={`relative h-12 rounded-[14px] border ${preferences.background === id ? 'ring-2 ring-[#739d8b] ring-offset-2' : ''}`} style={{ background: value.background, borderColor: value.line }} aria-label={value.name}>{preferences.background === id && <Check size={15} className="absolute inset-0 m-auto" color={value.text} weight="bold" />}</button>)}</div></div>
                    </section>
                </div>
            )}

            {annotationOpen && pendingSelection && (
                <div className="absolute inset-0 z-50 flex items-end bg-[#31352f]/25" onClick={() => setAnnotationOpen(false)}>
                    <section className="w-full rounded-t-[28px] bg-[#fbfaf6] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 text-[#45413a] shadow-[0_-18px_55px_rgba(44,49,45,.2)]" onClick={event => event.stopPropagation()}>
                        <div className="flex items-center justify-between"><h2 className="text-[16px] font-semibold">写批注</h2><button onClick={() => setAnnotationOpen(false)} className="grid h-9 w-9 place-items-center rounded-full bg-[#ece9e0]"><X size={16} /></button></div>
                        <blockquote className="mt-4 rounded-[16px] bg-[#f0ebdf] px-4 py-3 text-[12px] leading-6 text-[#6c6453]">“{pendingSelection.quote}”</blockquote>
                        <label className="mt-4 block"><span className="text-[11px] font-semibold text-[#777267]">你的想法</span><textarea autoFocus value={annotationDraft} onChange={event => setAnnotationDraft(event.target.value)} placeholder={`写完后，${char?.name || '角色'}也会看到这条批注。`} className="mt-2 h-28 w-full resize-none rounded-[18px] border border-[#d9d3c4] bg-white p-4 text-[13px] leading-6 outline-none focus:border-[#87ae9e]" /></label>
                        <button onClick={() => void saveAnnotation()} disabled={!annotationDraft.trim() || sending} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#739d8b] text-[13px] font-semibold text-white disabled:opacity-40"><NotePencil size={17} />保存并告诉角色</button>
                    </section>
                </div>
            )}
        </div>
    );
};

export default TogetherApp;
