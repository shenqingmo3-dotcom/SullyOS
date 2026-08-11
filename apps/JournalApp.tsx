
import React, { useState, useEffect, useRef } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { CharacterProfile, DiaryComment, DiaryEntry, StickerData, DiaryPage, MemoryFragment } from '../types';
import { ContextBuilder } from '../utils/context';
import { processImage } from '../utils/file';
import Modal from '../components/os/Modal';
import { safeResponseJson } from '../utils/safeApi';
import { ingestDiaryToPalace, type DiaryIngestResult } from '../utils/memoryPalace/pipeline';
import { getRoomLabel } from '../utils/memoryPalace/types';
import { Sparkle, Archive } from '@phosphor-icons/react';
import { CharacterGroupFilterBar, filterCharactersByGroup, GROUP_FILTER_ALL } from '../components/character/CharacterGroupFilter';
import {
    addBackendDiaryComment,
    deleteBackendDiary,
    generateBackendCharacterDiary,
    getBackendDiaries,
    loadBackendChatConfig,
    requestBackendDiaryCommentResponse,
    syncBackendDiary,
} from '../utils/backendClient';
import { deleteDiaryCardMessages, upsertDiaryCardMessage } from '../utils/journalCards';

const INTRO_SEEN_KEY = 'journal_app_intro_seen_v5';

const TWEMOJI_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72';
const twemojiUrl = (codepoint: string) => `${TWEMOJI_BASE}/${codepoint}.png`;

// --- Assets & Constants ---

const PAPER_STYLES = [
    { id: 'plain', name: '白纸', css: 'bg-white', text: 'text-slate-700' },
    { id: 'grid', name: '网格', css: 'bg-white', text: 'text-slate-700', style: { backgroundImage: 'linear-gradient(#e5e7eb 1px, transparent 1px), linear-gradient(90deg, #e5e7eb 1px, transparent 1px)', backgroundSize: '20px 20px' } },
    { id: 'dot', name: '点阵', css: 'bg-[#fffdf5]', text: 'text-slate-700', style: { backgroundImage: 'radial-gradient(#d1d5db 1px, transparent 1px)', backgroundSize: '20px 20px' } },
    { id: 'lined', name: '横线', css: 'bg-[#fefce8]', text: 'text-slate-700', style: { backgroundImage: 'repeating-linear-gradient(transparent, transparent 23px, #e5e7eb 23px, #e5e7eb 24px)' } },
    { id: 'dark', name: '夜空', css: 'bg-slate-800', text: 'text-white/90' },
    { id: 'pink', name: '少女', css: 'bg-pink-50', text: 'text-slate-700', style: { backgroundImage: 'radial-gradient(#fbcfe8 2px, transparent 2px)', backgroundSize: '30px 30px' } },
];

const DEFAULT_STICKERS = [
    twemojiUrl('2728'), twemojiUrl('1f496'), twemojiUrl('1f338'), twemojiUrl('1f380'), twemojiUrl('1f370'),
    twemojiUrl('1f431'), twemojiUrl('1f436'), twemojiUrl('2601-fe0f'), twemojiUrl('1f319'), twemojiUrl('2b50'),
    twemojiUrl('1f3b5'), twemojiUrl('1f33f'), twemojiUrl('1f353'), twemojiUrl('1f9f8'), twemojiUrl('1f388'),
    twemojiUrl('1f48c'), twemojiUrl('1f4a4'), twemojiUrl('1f97a'), twemojiUrl('1f621'), twemojiUrl('1f62d'),
];

// HELPER: Get local date string YYYY-MM-DD
const getLocalDateStr = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

async function upsertDiaryChatCard(
    entry: DiaryEntry,
    char: CharacterProfile,
    userName: string,
): Promise<DiaryEntry> {
    return upsertDiaryCardMessage(entry, char, userName, 'journal');
}

function splitLegacyExchangeDiary(entry: DiaryEntry): DiaryEntry[] {
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

    const characterEntry: DiaryEntry = {
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
    };
    return [userEntry, characterEntry];
}

const JournalApp: React.FC = () => {
    const { closeApp, characters, activeCharacterId, apiConfig, addToast, userProfile, updateCharacter, memoryPalaceConfig, characterGroups } = useOS();

    const [mode, setMode] = useState<'select' | 'calendar' | 'write'>('select');
    const [selectedChar, setSelectedChar] = useState<CharacterProfile | null>(null);
    const [journalGroupId, setJournalGroupId] = useState<string>(GROUP_FILTER_ALL); // 选日记本页的分组筛选
    const [diaries, setDiaries] = useState<DiaryEntry[]>([]);
    const [currentEntry, setCurrentEntry] = useState<DiaryEntry | null>(null);
    const [selectedDate, setSelectedDate] = useState<string>(getLocalDateStr());

    // Onboarding popup (一次性)
    const [showIntro, setShowIntro] = useState<boolean>(() => {
        try { return !localStorage.getItem(INTRO_SEEN_KEY); } catch { return false; }
    });
    const dismissIntro = () => {
        try { localStorage.setItem(INTRO_SEEN_KEY, '1'); } catch {}
        setShowIntro(false);
    };

    // Editor State
    const [archivingId, setArchivingId] = useState<string | null>(null);
    const [archiveResult, setArchiveResult] = useState<{
        date: string;
        charName: string;
        summary: string;
        summaryOrigin: 'palace_bullets' | 'prose_fallback';
        palace: DiaryIngestResult | null;
    } | null>(null);
    const [showStickerPanel, setShowStickerPanel] = useState(false);
    const [commentDraft, setCommentDraft] = useState('');
    const [commentPending, setCommentPending] = useState(false);
    const [characterDiaryPending, setCharacterDiaryPending] = useState(false);
    
    // Sticker Interaction State
    const [draggingSticker, setDraggingSticker] = useState<string | null>(null);
    const [selectedStickerId, setSelectedStickerId] = useState<string | null>(null); // For resizing/deleting
    const [resizingSticker, setResizingSticker] = useState<string | null>(null);
    const paperRef = useRef<HTMLDivElement>(null);
    
    // Custom Stickers State (Separate from Chat Emojis)
    const [customStickers, setCustomStickers] = useState<{name: string, url: string}[]>([]);
    const [showImportModal, setShowImportModal] = useState(false);
    const [importText, setImportText] = useState('');
    const [deletingSticker, setDeletingSticker] = useState<{name: string, url: string} | null>(null);
    const [deletingDiary, setDeletingDiary] = useState<DiaryEntry | null>(null);
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const currentSide: 'user' | 'char' = currentEntry?.primaryAuthor === 'character' ? 'char' : 'user';

    // --- Data Loading ---

    useEffect(() => {
        if (characters.length > 0 && activeCharacterId) {
            const initial = characters.find(c => c.id === activeCharacterId);
            if (initial) {
                setSelectedChar(initial);
                setMode('calendar');
                loadDiaries(initial.id);
            }
        }
        // Load custom stickers from new journal store
        DB.getJournalStickers().then(setCustomStickers);
    }, [activeCharacterId]);

    const loadDiaries = async (charId: string) => {
        const config = loadBackendChatConfig();
        const char = characters.find(item => item.id === charId);
        let localDiaries = await DB.getDiariesByCharId(charId);

        // 旧版“交换日记”可能把两位作者塞进同一条记录。首次加载时无损拆分，
        // 此后每篇日记始终只有一个作者，旧正文与原聊天卡片都不会丢失。
        if (char) {
            for (const legacyEntry of localDiaries) {
                const splitEntries = splitLegacyExchangeDiary(legacyEntry);
                const needsMigration = splitEntries.length !== 1 || splitEntries[0] !== legacyEntry;
                if (!needsMigration) continue;
                for (const splitEntry of splitEntries) {
                    const withCard = await upsertDiaryChatCard(splitEntry, char, userProfile.name || '我');
                    await DB.saveDiary(withCard);
                }
            }
            localDiaries = await DB.getDiariesByCharId(charId);
        }

        if (config.enabled && char) {
            try {
                const remoteDiaries = await getBackendDiaries(config, charId, 200);
                for (const remote of remoteDiaries) {
                    const existing = localDiaries.find(item =>
                        item.backendDiaryId === remote.id
                        || Boolean(remote.externalId && item.id === remote.externalId),
                    );
                    const remoteComments: DiaryComment[] = remote.comments.map(comment => ({
                        id: comment.externalId || `backend-comment-${comment.id}`,
                        backendCommentId: comment.id,
                        author: comment.authorType === 'user' ? 'user' : 'character',
                        content: comment.content,
                        createdAt: Date.parse(comment.createdAt) || Date.now(),
                        replyToId: comment.replyToId || undefined,
                    }));
                    const localOnlyComments = (existing?.comments || []).filter(local => !remoteComments.some(remoteComment =>
                        remoteComment.id === local.id
                        || Boolean(remoteComment.backendCommentId && remoteComment.backendCommentId === local.backendCommentId),
                    ));
                    const author = remote.authorType === 'assistant' ? 'character' : 'user';
                    const merged: DiaryEntry = existing ? {
                        ...existing,
                        backendDiaryId: remote.id,
                        title: remote.title || existing.title,
                        date: remote.diaryDate,
                        primaryAuthor: author,
                        userPage: author === 'user'
                            ? { ...existing.userPage, text: remote.content, paperStyle: remote.paperStyle || existing.userPage.paperStyle }
                            : { text: '', paperStyle: 'grid', stickers: [] },
                        charPage: author === 'character'
                            ? { text: remote.content, paperStyle: remote.paperStyle || existing.charPage?.paperStyle || 'plain', stickers: existing.charPage?.stickers || [] }
                            : undefined,
                        comments: [...remoteComments, ...localOnlyComments].sort((a, b) => a.createdAt - b.createdAt),
                    } : {
                        id: remote.externalId || `backend-diary-${remote.id}`,
                        charId,
                        date: remote.diaryDate,
                        title: remote.title,
                        primaryAuthor: author,
                        userPage: author === 'user'
                            ? { text: remote.content, paperStyle: remote.paperStyle || 'grid', stickers: [] }
                            : { text: '', paperStyle: 'grid', stickers: [] },
                        charPage: author === 'character'
                            ? { text: remote.content, paperStyle: remote.paperStyle || 'plain', stickers: [] }
                            : undefined,
                        comments: remoteComments,
                        timestamp: Date.parse(remote.createdAt) || Date.now(),
                        isArchived: false,
                        autoSync: true,
                        backendDiaryId: remote.id,
                        origin: remote.metadata?.source === 'heartbeat' ? 'heartbeat' : 'imported',
                    };
                    const withCard = await upsertDiaryChatCard(merged, char, userProfile.name || '我');
                    await DB.saveDiary(withCard);
                }
            } catch (error) {
                console.debug('[Journal] 后端日记暂时无法同步，继续使用本地副本', error);
            }
        }
        const list = await DB.getDiariesByCharId(charId);
        const sorted = list.sort((a, b) => b.timestamp - a.timestamp || b.date.localeCompare(a.date));
        setDiaries(sorted);
        return sorted;
    };

    useEffect(() => {
        const refresh = async (event: Event) => {
            const detail = (event as CustomEvent).detail as { charId?: string } | undefined;
            if (!selectedChar || detail?.charId !== selectedChar.id) return;
            const list = await DB.getDiariesByCharId(selectedChar.id);
            const sorted = list.sort((a, b) => b.date.localeCompare(a.date));
            setDiaries(sorted);
            setCurrentEntry(previous => previous
                ? sorted.find(item => item.id === previous.id || (
                    previous.backendDiaryId && item.backendDiaryId === previous.backendDiaryId
                )) || previous
                : previous);
        };
        window.addEventListener('backend-event-received', refresh);
        return () => window.removeEventListener('backend-event-received', refresh);
    }, [selectedChar?.id]);

    const handleCharSelect = (char: CharacterProfile) => {
        setSelectedChar(char);
        setMode('calendar');
        loadDiaries(char.id);
    };

    const handleGenerateCharacterDiary = async () => {
        if (!selectedChar || characterDiaryPending) return;
        const config = loadBackendChatConfig();
        if (!config.enabled) {
            addToast('请先在设置中连接 VPS 自主后端', 'info');
            return;
        }
        setCharacterDiaryPending(true);
        try {
            const remote = await generateBackendCharacterDiary(config, selectedChar.id);
            const refreshed = await loadDiaries(selectedChar.id);
            const created = refreshed.find(entry => entry.backendDiaryId === remote.id);
            if (created) {
                setCurrentEntry(created);
                setSelectedDate(created.date);
                setSelectedStickerId(null);
                setCommentDraft('');
                setMode('write');
            }
            addToast(`${selectedChar.name} 写好了一篇自己的日记`, 'success');
        } catch (error) {
            const message = error instanceof Error ? error.message : '未知错误';
            const visible = message.includes('模型池全部不可用') || message.includes('model_unavailable')
                ? '后端模型池当前没有可用模型，请先换一个模型'
                : message;
            addToast(`角色日记生成失败：${visible}`, 'error');
        } finally {
            setCharacterDiaryPending(false);
        }
    };

    const openEntry = (dateOrId: string, forceNew = false) => {
        const existing = forceNew ? undefined : diaries.find(d => d.id === dateOrId || d.date === dateOrId);
        const date = existing?.date || dateOrId;
        if (existing) {
            setCurrentEntry(existing);
        } else {
            // New Entry — 打 autoSync=true, 后续不在列表里显示手动归档按钮
            setCurrentEntry({
                id: `diary-${Date.now()}`,
                charId: selectedChar!.id,
                date: date,
                userPage: { text: '', paperStyle: 'grid', stickers: [] },
                timestamp: Date.now(),
                isArchived: false,
                autoSync: true,
                primaryAuthor: 'user',
                comments: [],
                origin: 'user',
            });
        }
        setMode('write');
        setSelectedDate(date);
        setSelectedStickerId(null); // Reset selection
        setCommentDraft('');
    };

    // --- Editor Logic ---

    const updatePage = (updates: Partial<DiaryEntry['userPage']>, side: 'user' | 'char' = 'user') => {
        if (!currentEntry) return;
        const targetPage = side === 'user' ? 'userPage' : 'charPage';
        
        // If char page doesn't exist yet, init it
        let pageData = currentEntry[targetPage] || { text: '', paperStyle: 'plain', stickers: [] };
        
        setCurrentEntry(prev => {
            if (!prev) return null;
            return {
                ...prev,
                [targetPage]: { ...pageData, ...updates }
            };
        });
    };

    const addSticker = (url: string) => {
        const side = currentSide;
        const targetPage = side === 'user' ? currentEntry?.userPage : currentEntry?.charPage;
        if (!targetPage && side === 'char') return;

        const newSticker: StickerData = {
            id: `st-${Date.now()}-${Math.random()}`,
            url,
            x: 50,
            y: 50,
            rotation: (Math.random() - 0.5) * 40,
            scale: 1.0 // Default scale
        };
        
        const currentStickers = targetPage?.stickers || [];
        updatePage({ stickers: [...currentStickers, newSticker] }, side);
        setShowStickerPanel(false);
    };

    const handleImportStickers = async () => {
        if (!importText.trim()) return;
        const lines = importText.split('\n');
        let count = 0;
        for (const line of lines) {
            const parts = line.split('--');
            if (parts.length >= 2) {
                const name = parts[0].trim();
                const url = parts.slice(1).join('--').trim();
                if (name && url) {
                    await DB.saveJournalSticker(name, url); // Changed Store
                    count++;
                }
            }
        }
        setCustomStickers(await DB.getJournalStickers()); // Changed Store
        setImportText('');
        setShowImportModal(false);
        addToast(`成功添加 ${count} 个贴纸`, 'success');
    };

    const handleDeleteStickerAsset = async () => {
        if (deletingSticker) {
            await DB.deleteJournalSticker(deletingSticker.name); // Changed Store
            setCustomStickers(prev => prev.filter(s => s.name !== deletingSticker.name));
            setDeletingSticker(null);
            addToast('贴纸已删除', 'success');
        }
    };

    // 把日记同步为聊天卡片。新版日记不要求双方都写过：任意一方的正文都能成为主卡片，
    // 便签只更新原卡片，不会再生成普通气泡。
    // 返回最终带 chatCardMessageId 的 entry，供调用方接着 setCurrentEntry/saveDiary。
    const syncDiaryCardToChat = async (entry: DiaryEntry, char: CharacterProfile): Promise<DiaryEntry> => {
        return upsertDiaryChatCard(entry, char, userProfile.name || '我');
    };

    const syncEntryToBackend = async (entry: DiaryEntry): Promise<DiaryEntry> => {
        if (!selectedChar) return entry;
        const config = loadBackendChatConfig();
        if (!config.enabled) return entry;
        const authorType = entry.primaryAuthor === 'character' ? 'assistant' : 'user';
        const page = authorType === 'assistant' ? entry.charPage : entry.userPage;
        if (!page?.text.trim()) return entry;
        const remote = await syncBackendDiary(config, {
            characterId: selectedChar.id,
            clientDiaryId: entry.id,
            authorType,
            title: entry.title || '',
            content: page.text.trim(),
            diaryDate: entry.date,
            paperStyle: page.paperStyle || 'plain',
            metadata: { origin: entry.origin || 'user' },
        });
        return { ...entry, backendDiaryId: remote.id };
    };

    const saveEntry = async () => {
        if (!currentEntry || !selectedChar) return;
        const mainText = currentEntry.primaryAuthor === 'character'
            ? currentEntry.charPage?.text
            : currentEntry.userPage.text;
        if (!mainText?.trim()) {
            addToast('先写一点内容再保存吧', 'info');
            return;
        }
        try {
            let toSave = await syncEntryToBackend(currentEntry);
            toSave = await syncDiaryCardToChat(toSave, selectedChar);
            await DB.saveDiary(toSave);
            setCurrentEntry(toSave);
            await loadDiaries(toSave.charId);
            addToast(toSave.backendDiaryId ? '日记已保存并同步到后端' : '日记已保存在本机', 'success');
        } catch (error) {
            await DB.saveDiary(currentEntry);
            await loadDiaries(currentEntry.charId);
            addToast(`日记已保存在本机，后端同步失败：${error instanceof Error ? error.message : '未知错误'}`, 'error');
        }
    };

    const updateDiaryAndCard = async (entry: DiaryEntry): Promise<DiaryEntry> => {
        if (!selectedChar) return entry;
        const synced = await syncDiaryCardToChat(entry, selectedChar);
        await DB.saveDiary(synced);
        setCurrentEntry(synced);
        await loadDiaries(synced.charId);
        return synced;
    };

    const handleAddComment = async () => {
        if (!currentEntry || !selectedChar || !commentDraft.trim() || commentPending) return;
        setCommentPending(true);
        const comment: DiaryComment = {
            id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            author: 'user',
            content: commentDraft.trim(),
            createdAt: Date.now(),
        };
        setCommentDraft('');
        try {
            let entry = currentEntry.backendDiaryId ? currentEntry : await syncEntryToBackend(currentEntry);
            entry = await updateDiaryAndCard({ ...entry, comments: [...(entry.comments || []), comment] });
            if (entry.backendDiaryId) {
                await addBackendDiaryComment(loadBackendChatConfig(), entry.backendDiaryId, {
                    clientCommentId: comment.id,
                    content: comment.content,
                });
            }
            addToast('便签贴好了', 'success');
        } catch (error) {
            addToast(`便签已留在本机，后端同步失败：${error instanceof Error ? error.message : '未知错误'}`, 'error');
        } finally {
            setCommentPending(false);
        }
    };

    const handleRequestCommentReply = async () => {
        if (!currentEntry || !selectedChar || commentPending) return;
        const config = loadBackendChatConfig();
        if (!config.enabled) {
            addToast('请先在设置中连接 VPS，自主角色才能回应便签', 'info');
            return;
        }
        setCommentPending(true);
        try {
            let entry = currentEntry.backendDiaryId ? currentEntry : await syncEntryToBackend(currentEntry);
            if (!entry.backendDiaryId) throw new Error('日记还没有同步到后端');
            const remote = await requestBackendDiaryCommentResponse(config, entry.backendDiaryId);
            const comment: DiaryComment = {
                id: remote.externalId || remote.id,
                backendCommentId: remote.id,
                author: 'character',
                content: remote.content,
                createdAt: Date.parse(remote.createdAt) || Date.now(),
                replyToId: remote.replyToId || undefined,
            };
            if (!(entry.comments || []).some(item => item.id === comment.id || item.backendCommentId === comment.backendCommentId)) {
                entry = { ...entry, comments: [...(entry.comments || []), comment] };
            }
            await updateDiaryAndCard(entry);
            addToast(`${selectedChar.name} 贴了一张便签`, 'success');
        } catch (error) {
            const message = error instanceof Error ? error.message : '未知错误';
            const isModelPoolError = message.includes('模型池全部不可用') || message.includes('model_unavailable');
            const visibleMessage = isModelPoolError ? '后端模型池当前没有可用模型' : message;
            const hint = isModelPoolError || message.includes('model')
                ? '；请在设置里的后端模型池新增或启用一个可用模型'
                : '';
            addToast(`贴签失败：${visibleMessage}${hint}`, 'error');
        } finally {
            setCommentPending(false);
        }
    };

    const handleDeleteDiary = async () => {
        if (!deletingDiary || !selectedChar) return;
        const target = deletingDiary;
        try {
            if (target.backendDiaryId) {
                const config = loadBackendChatConfig();
                try {
                    await deleteBackendDiary(config, target.backendDiaryId);
                } catch (error) {
                    if (!(error instanceof Error) || !error.message.includes('diary_not_found')) throw error;
                }
            }
            await deleteDiaryCardMessages(target);
            await DB.deleteDiary(target.id);
            setDiaries(previous => previous.filter(item => item.id !== target.id));
            setCurrentEntry(previous => previous?.id === target.id ? null : previous);
            setDeletingDiary(null);
            addToast('日记、便签和聊天卡片均已删除', 'success');
        } catch (error) {
            const message = error instanceof Error ? error.message : '未知错误';
            addToast('删除失败：' + message, 'error');
        }
    };

    // --- Interaction Logic (Move, Resize, Delete) ---

    // 1. Selection
    const selectSticker = (e: React.MouseEvent | React.TouchEvent, id: string) => {
        e.stopPropagation();
        setSelectedStickerId(id);
    };

    // 2. Remove Sticker from Page
    const removeStickerFromPage = (id: string) => {
        const targetPage = currentSide === 'user' ? currentEntry?.userPage : currentEntry?.charPage;
        if (!targetPage) return;
        const updated = targetPage.stickers.filter(s => s.id !== id);
        updatePage({ stickers: updated }, currentSide);
        setSelectedStickerId(null);
    };

    // 3. Pointer Handlers (Move & Resize)
    const handlePointerDown = (e: React.PointerEvent, stickerId: string, action: 'move' | 'resize') => {
        // Allow editing on char page too now
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        
        if (action === 'move') {
            setDraggingSticker(stickerId);
            setSelectedStickerId(stickerId); // Select on drag start
        } else {
            setResizingSticker(stickerId);
        }
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if ((!draggingSticker && !resizingSticker) || !paperRef.current || !currentEntry) return;

        const rect = paperRef.current.getBoundingClientRect();
        
        const targetPage = currentSide === 'user' ? currentEntry.userPage : currentEntry.charPage;
        if (!targetPage) return;

        // Logic for Moving
        if (draggingSticker) {
            const x = ((e.clientX - rect.left) / rect.width) * 100;
            const y = ((e.clientY - rect.top) / rect.height) * 100;
            const clampedX = Math.max(0, Math.min(100, x));
            const clampedY = Math.max(0, Math.min(100, y));

            const updatedStickers = targetPage.stickers.map(s => 
                s.id === draggingSticker ? { ...s, x: clampedX, y: clampedY } : s
            );
            updatePage({ stickers: updatedStickers }, currentSide);
        }

        // Logic for Resizing
        if (resizingSticker) {
            const sticker = targetPage.stickers.find(s => s.id === resizingSticker);
            if (!sticker) return;

            // Simple scale logic based on distance from center of sticker (simulated by pointer position relative to paper)
            const dx = (e.clientX - rect.left) - (sticker.x / 100 * rect.width);
            const dy = (e.clientY - rect.top) - (sticker.y / 100 * rect.height);
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            // Assume 50px is scale 1
            const newScale = Math.max(0.2, Math.min(3.0, dist / 40));
            
            const updatedStickers = targetPage.stickers.map(s => 
                s.id === resizingSticker ? { ...s, scale: newScale } : s
            );
            updatePage({ stickers: updatedStickers }, currentSide);
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        setDraggingSticker(null);
        setResizingSticker(null);
        e.currentTarget.releasePointerCapture(e.pointerId);
    };

    const handleBackgroundClick = () => {
        setSelectedStickerId(null); // Deselect when clicking background
    };

    // Long press handler for drawer items
    const handleDrawerTouchStart = (s: {name: string, url: string}) => {
        longPressTimer.current = setTimeout(() => {
            setDeletingSticker(s);
        }, 600);
    };

    const handleDrawerTouchEnd = () => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };

    // 手动归档: 把一条日记总结成神经链接条目 (char.memories), 跟 chatapp 的自动归档对齐 —
    //   - 开了记忆宫殿: 走副 API extractMemoriesFromBuffer 一次提取多条 MemoryNode → 节点入宫,
    //     同一组节点 bullets 化拼成 MemoryFragment 写 char.memories (mood='diary_palace')。
    //     不再调主 API。神经链接里那条 bullets 跟宫殿节点严格一比一对应。
    //   - 没开记忆宫殿 / 副 API 缺失 / 副 API 没提取出: 回落主 API + 升级 prompt 出 150~300 字
    //     散文式总结 → 写 char.memories (mood='diary')。这条沿用老路径升级版。
    //
    // mood 用 'diary_palace' / 'diary' 跟 chatapp 自动归档的 'palace' 区分,
    // 避免被 mergePalaceFragmentsIntoMemories 误合并到当天聊天那条 palace bullets 里。
    // 召回链路不看 mood,只是元数据 / UI 徽章,所以两种 mood 都正常进 chat 上下文。
    const handleArchiveDiary = async (diary: DiaryEntry) => {
        if (!selectedChar || diary.isArchived) return;
        if (!apiConfig.apiKey) { addToast('请先配置主 API', 'error'); return; }
        if (!diary.userPage.text.trim() && !diary.charPage?.text?.trim()) {
            addToast('日记内容为空,无法归档', 'info');
            return;
        }

        setArchivingId(diary.id);

        // 主 API 散文式总结 — 当宫殿没开 / 副 API 缺失 / 提取为空时的 fallback
        const generateProseSummary = async (): Promise<string> => {
            const baseContext = ContextBuilder.buildCoreContext(selectedChar, userProfile);
            const isCharacterDiary = diary.primaryAuthor === 'character';
            const authorName = isCharacterDiary ? selectedChar.name : (userProfile.name || '用户');
            const diaryText = isCharacterDiary ? diary.charPage?.text : diary.userPage.text;
            const notes = (diary.comments || []).map(comment => (
                `${comment.author === 'character' ? selectedChar.name : (userProfile.name || '用户')}：${comment.content}`
            )).join('\n');
            const prompt = `${baseContext}

### [系统指令: 独立日记归档]
当前任务：把 ${authorName} 在 ${diary.date} 写的这篇独立日记，整理成一段对你 (${selectedChar.name}) 长期有效的记忆。

### 日记正文
"""
${diaryText || '(空白)'}
"""

### 日记旁的便签互动
"""
${notes || '(没有便签)'}
"""

### 输出要求
1. **第一人称**: 全程用"我"称呼自己,用"${userProfile.name}"称呼对方,不要写成第三视角叙述。
2. **要点齐全**: 至少覆盖以下信息 (有就写,没有就跳过,不要生造):
   - 正文作者那天的关键事件、心情、提到的人或物
   - 如果是我的日记，保留我自己的独立经历与想法；如果是 ${userProfile.name} 的日记，保留我从中了解到的具体信息
   - 便签里出现的回应、共鸣或新信息
   - 如果出现任何承诺、约定、未解决的疑问,都要点名记录下来 (这些以后可能要兑现)
3. **细节胜过抽象**: 多说具体的事 (人名、地点、物件、当时的情绪),少用"我们度过了美好的一天"这种空话。
4. **篇幅**: 150~300 字之间的一段中文叙述,不要分段,不要列表,不要任何前缀和标题,直接出叙述。
`;
            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({
                    model: apiConfig.model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.4,
                    max_tokens: 1200,
                }),
            });
            if (!response.ok) throw new Error(`主 API 失败 (${response.status})`);
            const data = await safeResponseJson(response);
            let s = (data.choices?.[0]?.message?.content || '').trim();
            s = s.replace(/^["'「『]|["'」』]$/g, '').trim();
            if (!s) throw new Error('归档总结为空');
            return s;
        };

        try {
            // 1. 如果开了宫殿,先走副 API 一次提取,成败决定神经链接走哪条路径
            let palaceResult: DiaryIngestResult | null = null;
            if (selectedChar.memoryPalaceEnabled) {
                try {
                    palaceResult = await ingestDiaryToPalace(
                        selectedChar,
                        diary.date,
                        diary.userPage.text,
                        diary.charPage?.text || '',
                        memoryPalaceConfig?.lightLLM as any,
                        userProfile.name,
                    );
                } catch (e: any) {
                    console.warn('🏰 [Journal] 入宫失败:', e);
                    palaceResult = null;
                }
            } else {
                palaceResult = { status: 'palace_disabled' };
            }

            // 2. 决定神经链接那条的 summary / mood
            //    宫殿成功 (status==='done' 且 nodes 非空) → bullets 化, mood='diary_palace'
            //    其它一切情况 → 主 API 散文 fallback, mood='diary'
            let summary: string;
            let mood: string;
            let summaryOrigin: 'palace_bullets' | 'prose_fallback';
            if (palaceResult && palaceResult.status === 'done' && palaceResult.nodes.length > 0) {
                summary = palaceResult.nodes
                    .map(n => `- ${(n.content || '').replace(/\n/g, ' ').trim()}`)
                    .filter(line => line.length > 2)
                    .join('\n');
                mood = 'diary_palace';
                summaryOrigin = 'palace_bullets';
            } else {
                summary = await generateProseSummary();
                mood = 'diary';
                summaryOrigin = 'prose_fallback';
            }

            // 3. 神经链接 (char.memories): date 对齐到日记当天
            const newMem: MemoryFragment = {
                id: `mem-diary-${Date.now()}`,
                date: diary.date,
                summary,
                mood,
            };
            updateCharacter(selectedChar.id, {
                memories: [...(selectedChar.memories || []), newMem],
            });

            // 4. 标记 isArchived 防止重复
            const updatedDiary: DiaryEntry = { ...diary, isArchived: true };
            await DB.saveDiary(updatedDiary);
            if (currentEntry?.id === diary.id) setCurrentEntry(updatedDiary);
            await loadDiaries(selectedChar.id);

            // 5. 弹窗展示归档全貌
            setArchiveResult({
                date: diary.date,
                charName: selectedChar.name,
                summary,
                summaryOrigin,
                palace: palaceResult,
            });
        } catch (e: any) {
            console.error(e);
            addToast(`归档失败: ${e.message}`, 'error');
        } finally {
            setArchivingId(null);
        }
    };

    // --- Renderers ---

    const renderPage = (page: DiaryPage, side: 'user' | 'char') => {
        const style = PAPER_STYLES.find(s => s.id === page.paperStyle) || PAPER_STYLES[0];
        const isReadOnly = side === 'char' && currentEntry?.primaryAuthor === 'character';
        const isInteractive = !isReadOnly;

        return (
            <div 
                ref={paperRef}
                className={`relative w-full h-full shadow-md transition-all duration-300 overflow-hidden ${style.css} flex flex-col rounded-3xl touch-none`}
                style={{ ...style.style }}
                onPointerMove={isInteractive ? handlePointerMove : undefined}
                onPointerUp={isInteractive ? handlePointerUp : undefined}
                onPointerLeave={isInteractive ? handlePointerUp : undefined}
                onClick={handleBackgroundClick}
            >
                {/* Content Container */}
                <div className="flex-1 p-6 relative z-10 flex flex-col">
                    <div className="flex justify-between items-center mb-4 pb-2 border-b border-black/5 shrink-0">
                        <span className={`text-xs font-bold uppercase tracking-widest opacity-50 ${style.text}`}>
                            {side === 'user' ? '我的日记' : `${selectedChar?.name || 'TA'} 的日记`}
                        </span>
                        <span className={`text-[10px] opacity-40 font-mono ${style.text}`}>
                            {currentEntry?.date}
                        </span>
                    </div>

                    <textarea 
                        value={page.text}
                        onChange={e => updatePage({ text: e.target.value }, side)}
                        placeholder={side === 'user' ? "记录今天发生的事情..." : "角色会在自己的时间里写下日记"}
                        className={`flex-1 w-full bg-transparent resize-none outline-none leading-loose text-[16px] font-normal ${style.text} placeholder:opacity-30 no-scrollbar`}
                        readOnly={isReadOnly}
                    />
                </div>

                {/* Stickers Layer */}
                {page.stickers.map(s => {
                    const isSelected = selectedStickerId === s.id;
                    const scale = s.scale || 1.0;
                    
                    return (
                        <div 
                            key={s.id} 
                            onPointerDown={isReadOnly ? undefined : (e) => handlePointerDown(e, s.id, 'move')}
                            onClick={isReadOnly ? undefined : (e) => selectSticker(e, s.id)}
                            className={`absolute text-6xl select-none drop-shadow-md z-20 ${isReadOnly ? '' : 'cursor-move'} ${draggingSticker === s.id ? 'opacity-90' : ''} transition-transform`}
                            style={{ 
                                left: `${s.x}%`, 
                                top: `${s.y}%`, 
                                transform: `translate(-50%, -50%) rotate(${s.rotation}deg) scale(${scale})`,
                                border: isSelected ? '2px dashed #3b82f6' : 'none',
                                borderRadius: '8px',
                                padding: '4px'
                            }}
                        >
                            {s.url.startsWith('http') || s.url.startsWith('data') ? (
                                <img src={s.url} className="w-20 h-20 object-contain pointer-events-none" draggable={false} />
                            ) : s.url}

                            {/* Controls for Selected Sticker */}
                            {isSelected && !isReadOnly && (
                                <>
                                    {/* Delete Button (Top Right) */}
                                    <div 
                                        className="absolute -top-3 -right-3 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center text-xs shadow-md cursor-pointer pointer-events-auto"
                                        onClick={(e) => { e.stopPropagation(); removeStickerFromPage(s.id); }}
                                    >×</div>
                                    
                                    {/* Resize Handle (Bottom Right) */}
                                    <div 
                                        className="absolute -bottom-2 -right-2 w-5 h-5 bg-blue-500 rounded-full border-2 border-white shadow-md cursor-nwse-resize pointer-events-auto"
                                        onPointerDown={(e) => handlePointerDown(e, s.id, 'resize')}
                                    ></div>
                                </>
                            )}
                        </div>
                    );
                })}
                
                {/* Paper Texture Overlay (Subtle) */}
                <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/paper-fibers.png')] opacity-10 pointer-events-none z-0 mix-blend-multiply"></div>
            </div>
        );
    };

    // 一次性弹窗：日记正文彼此独立，互动统一通过便签完成。
    const introModal = showIntro ? (
        <Modal
            isOpen={showIntro}
            title="日记 · 新互动方式"
            onClose={dismissIntro}
            footer={
                <button onClick={dismissIntro} className="w-full py-3 bg-amber-500 text-white font-bold rounded-2xl active:scale-95 transition-transform">
                    我知道了
                </button>
            }
        >
            <div className="space-y-3 text-sm text-slate-700 leading-relaxed">
                <p className="font-bold text-amber-700">这里现在是单纯的日记 App，每篇日记只属于一个作者：</p>
                <div className="rounded-2xl bg-amber-50 border border-amber-100 px-4 py-3 space-y-2">
                    <p><span className="font-bold text-amber-700">① 谁都可以先写：</span>你可以独立写日记，角色也能在自主活动时写自己的日记，不需要等待另一方先交作业。</p>
                    <p><span className="font-bold text-amber-700">② 用便签交流：</span>读完一篇日记后可以贴一两句话。你能回应角色的日记，角色也能评论你的日记或回应你的便签。</p>
                    <p><span className="font-bold text-amber-700">③ 自动同步聊天：</span>正文和便签会合在同一张日记卡片里；新增便签只更新原卡片，不会刷出一串普通气泡。</p>
                    <p><span className="font-bold text-amber-700">④ 旧数据继续兼容：</span>以前的双页记录会无损拆成两篇独立日记，正文不会丢失。</p>
                </div>
                <p className="text-xs text-slate-400">这条提示只出现一次。</p>
            </div>
        </Modal>
    ) : null;

    // 归档结果弹窗: 让用户清楚知道生成了哪些内容、被送去了哪里
    const archiveResultModal = archiveResult ? (() => {
        const p = archiveResult.palace;
        const userName = userProfile.name || '我';
        // 宫殿状态文案
        let palaceStatus: { tone: 'on' | 'off' | 'warn' | 'fail'; title: string; detail: string } = { tone: 'off', title: '', detail: '' };
        if (!p) {
            palaceStatus = { tone: 'fail', title: '记忆宫殿 · 写入失败', detail: '记忆宫殿这次没能写入，但日记已经成功存进神经链接。' };
        } else if (p.status === 'palace_disabled') {
            palaceStatus = { tone: 'off', title: '记忆宫殿 · 未开启', detail: `${archiveResult.charName} 没开启记忆宫殿，这次按基础方式存进了神经链接。想让日记记得更细，去角色设置打开"记忆宫殿"开关再归档。` };
        } else if (p.status === 'lightllm_missing') {
            palaceStatus = { tone: 'warn', title: '记忆宫殿 · 副 API 未配置', detail: '记忆宫殿的后台模型还没配置，去设置里填一下就能用完整功能；这次先按基础方式存进了神经链接。' };
        } else if (p.status === 'embedding_missing') {
            palaceStatus = { tone: 'warn', title: '记忆宫殿 · 嵌入模型未配置', detail: '嵌入模型还没配置；这次先按基础方式存进了神经链接，去设置补上就能用完整功能。' };
        } else if (p.status === 'empty_input') {
            palaceStatus = { tone: 'warn', title: '记忆宫殿 · 内容为空', detail: '日记两页都没有正文, 没东西可入宫。' };
        } else if (p.status === 'extracted_none') {
            palaceStatus = { tone: 'warn', title: '记忆宫殿 · 副 API 没提取出内容', detail: '读完这篇日记后没找到值得单独记的内容；日记本身已经存进神经链接了。' };
        } else {
            palaceStatus = {
                tone: 'on',
                title: `记忆宫殿 · 入了 ${p.stored} 条${p.skipped > 0 ? ` (另有 ${p.skipped} 条命中已有记忆去重)` : ''}`,
                detail: '这篇日记被整理成下面这几条记忆，之后聊到相关内容时角色会想起来；日期按日记当天记。',
            };
        }

        const palaceNodes = (p && p.status === 'done') ? p.nodes : [];

        return (
            <Modal
                isOpen={true}
                title={`已归档 · ${archiveResult.date}`}
                onClose={() => setArchiveResult(null)}
                footer={
                    <button onClick={() => setArchiveResult(null)} className="w-full py-3 bg-amber-500 text-white font-bold rounded-2xl active:scale-95 transition-transform">
                        知道了
                    </button>
                }
            >
                <div className="space-y-3 text-sm text-slate-700 leading-relaxed max-h-[60vh] overflow-y-auto no-scrollbar pr-1">
                    {/* 顶部一行: 数据流向示意 */}
                    {archiveResult.summaryOrigin === 'palace_bullets' ? (
                        <div className="rounded-xl bg-gradient-to-r from-emerald-50 to-purple-50 border border-emerald-200/60 px-3 py-2 text-[11px] text-slate-600">
                            ✓ 这次归档同时进了 <b className="text-emerald-700">神经链接</b> 和 <b className="text-purple-700">记忆宫殿</b>,
                            两边拿的是 <b>同一组提取出来的内容</b> —— 这次提取出的几条记忆会一并存进神经链接。
                        </div>
                    ) : (
                        <div className="rounded-xl bg-emerald-50/70 border border-emerald-100 px-3 py-2 text-[11px] text-slate-600">
                            这次归档只进了 <b className="text-emerald-700">神经链接</b>, 用主 API 生成的散文式总结。原因看下面"记忆宫殿"那块。
                        </div>
                    )}

                    {/* 神经链接 */}
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 px-4 py-3 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-bold tracking-widest uppercase text-emerald-700">● 神经链接</span>
                            <span className="text-[10px] text-emerald-600/70">写入 1 条 · 日期 {archiveResult.date}</span>
                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">mood={archiveResult.summaryOrigin === 'palace_bullets' ? 'diary_palace' : 'diary'}</span>
                        </div>
                        <p className="text-[13px] text-slate-700 leading-relaxed whitespace-pre-wrap" style={{ fontFamily: archiveResult.summaryOrigin === 'palace_bullets' ? 'inherit' : 'ui-serif, Georgia, serif' }}>
                            {archiveResult.summary}
                        </p>
                        <p className="text-[10px] text-emerald-700/70">
                            ↑ 这条会出现在「{archiveResult.charName}」的本月详细记录里, 自动跟聊天上下文一起送进 LLM。
                            {archiveResult.summaryOrigin === 'palace_bullets'
                                ? ' 每个 bullet 都对应下面记忆宫殿里的一个节点。'
                                : ''}
                        </p>
                    </div>

                    {/* 记忆宫殿 */}
                    <div className={`rounded-2xl border px-4 py-3 space-y-2 ${
                        palaceStatus.tone === 'on' ? 'border-purple-100 bg-purple-50/70'
                        : palaceStatus.tone === 'off' ? 'border-slate-100 bg-slate-50'
                        : palaceStatus.tone === 'warn' ? 'border-amber-100 bg-amber-50/70'
                        : 'border-red-100 bg-red-50/70'
                    }`}>
                        <div className={`text-[10px] font-bold tracking-widest uppercase ${
                            palaceStatus.tone === 'on' ? 'text-purple-700'
                            : palaceStatus.tone === 'off' ? 'text-slate-500'
                            : palaceStatus.tone === 'warn' ? 'text-amber-700'
                            : 'text-red-600'
                        }`}>
                            ◆ {palaceStatus.title}
                        </div>
                        <p className="text-[12px] text-slate-600">{palaceStatus.detail}</p>
                        {palaceNodes.length > 0 && (
                            <div className="space-y-1.5 pt-1">
                                {palaceNodes.map((n, i) => (
                                    <div key={i} className="rounded-xl bg-white/80 border border-purple-100 px-3 py-2">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">{getRoomLabel(n.room, userName)}</span>
                                            <span className="text-[9px] font-mono text-purple-500/70">重要度 {n.importance}/10</span>
                                            {n.mood && <span className="text-[9px] text-slate-400">· {n.mood}</span>}
                                        </div>
                                        <p className="text-[12px] text-slate-700 leading-snug">{n.content}</p>
                                        {n.tags?.length > 0 && (
                                            <div className="flex flex-wrap gap-1 mt-1.5">
                                                {n.tags.slice(0, 6).map((t, ti) => (
                                                    <span key={ti} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">#{t}</span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </Modal>
        );
    })() : null;

    if (mode === 'select') {
        return (
            <div className="h-full w-full bg-amber-50 flex flex-col font-light">
                {introModal}
                {archiveResultModal}
                <div className="border-b border-amber-100 bg-amber-50/80 backdrop-blur-sm sticky top-0 z-20 shrink-0" style={{ paddingTop: 'var(--chrome-top)' }}>
                    <div className="h-12 px-6 flex items-center justify-between">
                        <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-amber-100/50 active:scale-90 transition-transform">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6 text-amber-900"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                        </button>
                        <span className="font-bold text-amber-900 text-lg tracking-wide">选择日记本</span>
                        <div className="w-8"></div>
                    </div>
                </div>
                
                {/* 分组筛选（没建分组时不渲染），浅色米黄底 */}
                <CharacterGroupFilterBar characters={characters} groups={characterGroups}
                    value={journalGroupId} onChange={setJournalGroupId} className="px-6 pt-4 shrink-0" />
                <div className="p-6 grid grid-cols-2 gap-5 overflow-y-auto pb-20 no-scrollbar">
                    {filterCharactersByGroup(characters, characterGroups, journalGroupId).map(c => (
                        <div key={c.id} onClick={() => handleCharSelect(c)} className="aspect-[3/4] bg-white rounded-r-2xl rounded-l-md border-l-4 border-l-amber-800 shadow-[2px_4px_12px_rgba(0,0,0,0.08)] p-4 flex flex-col items-center justify-center gap-3 cursor-pointer active:scale-95 transition-all relative overflow-hidden group">
                            <div className="absolute inset-y-0 left-0 w-2 bg-gradient-to-r from-black/10 to-transparent"></div>
                            <div className="w-16 h-16 rounded-full p-[2px] border border-amber-100 bg-amber-50">
                                <img src={c.avatar} className="w-full h-full rounded-full object-cover" />
                            </div>
                            <span className="font-bold text-amber-900 text-sm">{c.name}</span>
                            <span className="text-[9px] text-amber-600 bg-amber-50 px-2 py-1 rounded-full font-mono uppercase tracking-wide">Journal</span>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (mode === 'calendar' && selectedChar) {
        return (
            <div className="h-full w-full bg-white flex flex-col font-light relative">
                {introModal}
                {archiveResultModal}
                <div className="pb-6 px-6 bg-amber-500 shadow-lg shrink-0 rounded-b-[2rem] z-20" style={{ paddingTop: 'max(3rem, var(--safe-top))' }}>
                    <div className="flex justify-between items-start mb-4">
                         <button onClick={() => setMode('select')} className="text-white/80 hover:text-white transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>
                         </button>
                         <div className="w-6"></div>
                    </div>
                    <div className="text-white">
                        <div className="text-xs opacity-70 uppercase tracking-widest font-bold mb-1">Diary</div>
                        <div className="text-3xl font-bold tracking-tight">{selectedChar.name}</div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-5 pb-20 no-scrollbar">
                    <button onClick={() => openEntry(getLocalDateStr(), true)} className="w-full py-5 mb-8 border-2 border-dashed border-amber-200 rounded-2xl text-amber-500 font-bold flex items-center justify-center gap-2 hover:bg-amber-50 active:scale-95 transition-all">
                        <span className="text-xl">+</span> 写一篇日记
                    </button>
                    <button
                        onClick={() => void handleGenerateCharacterDiary()}
                        disabled={characterDiaryPending}
                        className="w-full py-4 -mt-5 mb-8 rounded-2xl border border-violet-200 bg-violet-50 text-violet-600 font-bold flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 transition-all"
                    >
                        <span className={characterDiaryPending ? 'animate-pulse' : ''}>✦</span>
                        {characterDiaryPending ? `${selectedChar.name} 正在写…` : `让 ${selectedChar.name} 现在写一篇`}
                    </button>
                    
                    <div className="space-y-4">
                        {diaries.map(d => (
                            <div key={d.id} onClick={() => openEntry(d.id)} className="flex items-center gap-4 p-4 rounded-2xl bg-white border border-slate-100 shadow-sm active:scale-95 transition-all hover:shadow-md cursor-pointer relative overflow-hidden group">
                                <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-400"></div>
                                <div className="w-14 h-14 bg-amber-50 rounded-xl flex flex-col items-center justify-center text-amber-800 shrink-0 border border-amber-100">
                                    <span className="text-[10px] font-bold opacity-60">{d.date.split('-')[1]}月</span>
                                    <span className="text-xl font-bold leading-none">{d.date.split('-')[2]}</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-slate-700 truncate font-medium">{d.title || (d.primaryAuthor === 'character' ? d.charPage?.text : d.userPage.text) || '(空)'}</p>
                                    <div className="flex justify-between items-center mt-1">
                                        <p className="text-xs text-slate-400 font-mono">{d.date.split('-')[0]}</p>
                                        <div className="flex gap-2">
                                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${d.primaryAuthor === 'character' ? 'bg-purple-100 text-purple-600' : 'bg-amber-100 text-amber-600'}`}>
                                                {d.primaryAuthor === 'character' ? `${selectedChar.name} 写的` : '我写的'}
                                            </span>
                                            {!!d.comments?.length && <span className="px-2 py-0.5 bg-pink-50 text-pink-500 rounded-full text-[9px] font-bold">{d.comments.length} 张便签</span>}
                                            {d.chatCardMessageId && <span className="px-2 py-0.5 bg-emerald-50 text-emerald-500 rounded-full text-[9px] font-bold">同步聊天</span>}
                                            {d.isArchived && <span className="px-2 py-0.5 bg-amber-100 text-amber-600 rounded-full text-[9px] font-bold">已归档</span>}
                                        </div>
                                    </div>
                                </div>
                                {/* 归档按钮统一移到了"点进日记后的右上角". 列表保留删除按钮, 不重复入口. */}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setDeletingDiary(d);
                                    }}
                                    className="w-8 h-8 rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors flex items-center justify-center"
                                    title="删除日记"
                                    aria-label="删除日记"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                    </svg>
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                <Modal 
                    isOpen={!!deletingDiary}
                    title="删除日记"
                    onClose={() => setDeletingDiary(null)}
                    footer={
                        <div className="flex gap-2 w-full">
                            <button onClick={() => setDeletingDiary(null)} className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-2xl font-bold">取消</button>
                            <button onClick={handleDeleteDiary} className="flex-1 py-3 bg-red-500 text-white rounded-2xl font-bold">删除</button>
                        </div>
                    }
                >
                    <p className="text-sm text-slate-600">
                        确定删除 {deletingDiary?.date} 的日记吗？删除后无法恢复。
                    </p>
                </Modal>
            </div>
        );
    }

    // --- WRITE MODE ---
    return (
        <div className="h-full w-full bg-[#1a1a1a] flex flex-col relative overflow-hidden">
            {introModal}
            {archiveResultModal}

            {/* Editor Header */}
            <div className="bg-[#1a1a1a]/90 backdrop-blur-md text-white shrink-0 z-30" style={{ paddingTop: 'var(--chrome-top)' }}>
                <div className="h-12 px-4 flex items-center justify-between">
                    <button onClick={() => setMode('calendar')} className="p-2 -ml-2 text-white/60 hover:text-white rounded-full active:bg-white/10 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                    </button>
                    <div className="flex gap-3">
                        {currentEntry?.chatCardMessageId && (
                            <div className="px-3 py-1 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-300 flex items-center gap-1.5" title="该日记已自动同步为聊天卡片">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                                已同步聊天
                            </div>
                        )}
                        {currentEntry?.isArchived && (
                            <div className="px-3 py-1 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 flex items-center gap-1.5" title="该日记已归档进神经链接">
                                <Archive size={11} weight="fill" />
                                已归档
                            </div>
                        )}
                        {/* 老日记 (本次更新前留下的, autoSync 未设) 且角色已回复 → 右上角出现归档按钮.
                            新日记走自动同步聊天那条线, 不显示这个按钮防止重复入库. */}
                        {currentEntry && !currentEntry.autoSync && currentEntry.charPage && !currentEntry.isArchived && (
                            <button
                                onClick={() => handleArchiveDiary(currentEntry)}
                                disabled={archivingId === currentEntry.id}
                                className={`px-3 py-1.5 rounded-full text-xs font-bold shadow-lg transition-all flex items-center gap-1.5 ${archivingId === currentEntry.id ? 'bg-amber-700/60 text-amber-200 cursor-wait' : 'bg-amber-500 text-white hover:bg-amber-400 active:scale-95'}`}
                                title={'把这篇老日记归档进神经链接' + (selectedChar?.memoryPalaceEnabled ? ' / 记忆宫殿' : '')}
                            >
                                {archivingId === currentEntry.id ? (
                                    <>
                                        <div className="w-3 h-3 border-2 border-amber-200/40 border-t-amber-100 rounded-full animate-spin"></div>
                                        归档中
                                    </>
                                ) : (
                                    <>
                                        <Archive size={12} weight="fill" />
                                        归档
                                    </>
                                )}
                            </button>
                        )}
                        {currentEntry?.primaryAuthor !== 'character' && (
                            <button onClick={saveEntry} className="px-4 py-1.5 bg-white/10 rounded-full text-xs font-bold hover:bg-white/20 active:scale-95 transition-transform">
                                保存
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Main Page Area */}
            <div className="flex-1 relative w-full overflow-hidden flex flex-col">
                <div className="flex-1 w-full max-w-xl mx-auto px-2 pb-4 pt-2 flex flex-col relative">
                    {currentEntry && (
                        <input
                            value={currentEntry.title || ''}
                            onChange={event => setCurrentEntry(previous => previous ? { ...previous, title: event.target.value } : previous)}
                            readOnly={currentEntry.primaryAuthor === 'character'}
                            placeholder="给这篇日记起个标题（可选）"
                            className="shrink-0 mb-2 mx-2 h-9 rounded-xl bg-white/5 border border-white/10 px-3 text-sm text-white/80 placeholder:text-white/25 outline-none focus:border-amber-400/50"
                        />
                    )}
                    <div className="flex-1 min-h-0 relative rounded-3xl transition-all duration-500">
                        {currentEntry && (
                            currentEntry.primaryAuthor === 'character' && currentEntry.charPage
                                ? renderPage(currentEntry.charPage, 'char')
                                : renderPage(currentEntry.userPage, 'user')
                        )}
                    </div>

                    {currentEntry && (
                        <div className="shrink-0 mt-2 mx-1 rounded-2xl bg-[#26221b] border border-amber-200/10 px-3 py-2 text-white">
                            {!!currentEntry.comments?.length && (
                                <div className="max-h-24 overflow-y-auto no-scrollbar space-y-1.5 mb-2">
                                    {currentEntry.comments.map(comment => (
                                        <div
                                            key={`${comment.id}-${comment.createdAt}`}
                                            className={`max-w-[88%] rounded-lg px-2.5 py-1.5 text-xs leading-relaxed shadow-sm ${comment.author === 'user' ? 'ml-auto bg-amber-100 text-amber-950 rotate-[0.3deg]' : 'mr-auto bg-pink-100 text-pink-950 -rotate-[0.3deg]'}`}
                                        >
                                            <div className="text-[9px] opacity-55 mb-0.5 font-bold">
                                                {comment.author === 'user' ? (userProfile.name || '我') : selectedChar?.name}
                                            </div>
                                            {comment.content}
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div className="flex items-center gap-2">
                                <input
                                    value={commentDraft}
                                    onChange={event => setCommentDraft(event.target.value)}
                                    onKeyDown={event => {
                                        if (event.key === 'Enter' && !event.shiftKey) {
                                            event.preventDefault();
                                            void handleAddComment();
                                        }
                                    }}
                                    maxLength={2000}
                                    placeholder="贴一张便签……"
                                    className="min-w-0 flex-1 h-9 rounded-xl bg-black/20 border border-white/10 px-3 text-xs text-white/80 placeholder:text-white/25 outline-none focus:border-amber-400/50"
                                />
                                <button
                                    onClick={() => void handleAddComment()}
                                    disabled={!commentDraft.trim() || commentPending}
                                    className="h-9 px-3 rounded-xl bg-amber-500 text-white text-xs font-bold disabled:opacity-35"
                                >
                                    贴上
                                </button>
                                <button
                                    onClick={() => void handleRequestCommentReply()}
                                    disabled={commentPending}
                                    className="h-9 px-3 rounded-xl bg-pink-500/80 text-white text-xs font-bold disabled:opacity-35 whitespace-nowrap"
                                >
                                    {commentPending ? '稍等' : '请 TA 贴便签'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom Controls */}
            <div className="shrink-0 bg-[#222] border-t border-white/5 pb-safe pt-2 z-30">
                <div className="flex items-center justify-between px-6 pb-4">
                    {currentEntry?.primaryAuthor !== 'character' ? (
                        <div className="flex gap-3 bg-[#111] p-1.5 rounded-full border border-white/10">
                            {PAPER_STYLES.slice(0, 4).map(s => (
                                <button
                                    key={s.id}
                                    onClick={() => updatePage({ paperStyle: s.id }, currentSide)}
                                    className={`w-8 h-8 rounded-full border border-white/10 transition-transform active:scale-90 ${s.css}`}
                                    title={s.name}
                                />
                            ))}
                        </div>
                    ) : <div className="text-[10px] text-white/30 px-2">角色独立日记 · 用便签互动</div>}
                    
                    <div className="flex gap-3">
                        {currentEntry?.primaryAuthor !== 'character' && (
                            <button
                                onClick={() => setShowStickerPanel(!showStickerPanel)}
                                className={`w-11 h-11 rounded-full flex items-center justify-center text-xl shadow-lg active:scale-90 transition-transform ${showStickerPanel ? 'bg-white text-black' : 'bg-gradient-to-br from-amber-400 to-orange-500 text-white'}`}
                            >
                                <Sparkle size={24} weight="fill" />
                            </button>
                        )}
                    </div>
                </div>

                {showStickerPanel && (
                    <div className="bg-[#1a1a1a] border-t border-white/10 p-4 animate-slide-up h-48 overflow-y-auto no-scrollbar">
                        <div className="grid grid-cols-6 gap-3">
                            <button onClick={() => setShowImportModal(true)} className="flex items-center justify-center bg-white/10 rounded-xl border-2 border-dashed border-white/20 text-white/50 text-xl font-bold hover:bg-white/20 hover:text-white transition-all aspect-square">
                                +
                            </button>
                            {DEFAULT_STICKERS.map((s, i) => (
                                <button key={`def-${i}`} onClick={() => addSticker(s)} className="hover:scale-110 transition-transform p-2 bg-white/5 rounded-xl border border-white/5 flex items-center justify-center">
                                    <img src={s} alt="" className="w-8 h-8 object-contain pointer-events-none" />
                                </button>
                            ))}
                            {customStickers.map((s, i) => (
                                <button 
                                    key={`cust-${i}`} 
                                    onClick={() => addSticker(s.url)} 
                                    onTouchStart={() => handleDrawerTouchStart(s)}
                                    onTouchEnd={handleDrawerTouchEnd}
                                    onMouseDown={() => handleDrawerTouchStart(s)}
                                    onMouseUp={handleDrawerTouchEnd}
                                    onMouseLeave={handleDrawerTouchEnd}
                                    onContextMenu={(e) => { e.preventDefault(); setDeletingSticker(s); }}
                                    className="p-2 bg-white/5 rounded-xl border border-white/5 flex items-center justify-center relative active:scale-95 transition-transform"
                                >
                                    <img src={s.url} className="w-8 h-8 object-contain pointer-events-none" />
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Sticker Import Modal */}
            <Modal 
                isOpen={showImportModal} title="添加日记贴纸" onClose={() => setShowImportModal(false)}
                footer={<button onClick={handleImportStickers} className="w-full py-3 bg-white/10 text-white font-bold rounded-2xl hover:bg-white/20 transition-all">确认添加</button>}
            >
                <div className="space-y-3">
                    <p className="text-xs text-slate-500">格式：贴纸名称--图片URL (每行一个)</p>
                    <textarea 
                        value={importText} 
                        onChange={e => setImportText(e.target.value)} 
                        placeholder={`CoolCat--https://...\nHeart--https://...`}
                        className="w-full h-32 bg-slate-100 rounded-2xl p-4 text-sm resize-none focus:outline-none text-slate-700"
                    />
                </div>
            </Modal>

            {/* Sticker Delete Confirmation Modal */}
            <Modal 
                isOpen={!!deletingSticker} title="删除贴纸素材" onClose={() => setDeletingSticker(null)}
                footer={<div className="flex gap-2 w-full"><button onClick={() => setDeletingSticker(null)} className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-2xl font-bold">取消</button><button onClick={handleDeleteStickerAsset} className="flex-1 py-3 bg-red-500 text-white rounded-2xl font-bold">删除</button></div>}
            >
                <div className="flex flex-col items-center gap-3 py-2">
                    {deletingSticker && <img src={deletingSticker.url} className="w-16 h-16 object-contain rounded-lg bg-slate-100 border" />}
                    <p className="text-sm text-slate-600">确定要删除这个贴纸素材吗？(不会影响已使用的日记)</p>
                </div>
            </Modal>
        </div>
    );
};

export default JournalApp;
