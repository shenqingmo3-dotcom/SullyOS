import React, { useState, useEffect, useRef } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { CharacterProfile, DiaryComment, DiaryEntry, StickerData, DiaryPage, MemoryFragment } from '../types';
import { ContextBuilder } from '../utils/context';
import { processImageToBlob } from '../utils/file';
import { putImageBlob, useBlobRefUrl } from '../utils/blobRef';
import Modal from '../components/os/Modal';
import { safeResponseJson } from '../utils/safeApi';
import { ingestDiaryToPalace, type DiaryIngestResult } from '../utils/memoryPalace/pipeline';
import { getRoomLabel } from '../utils/memoryPalace/types';
import { ArrowLeft, Archive, Check, ImageSquare, Sparkle, Trash } from '@phosphor-icons/react';
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
import { splitLegacyExchangeDiary } from '../utils/journalMigration';

const INTRO_SEEN_KEY = 'journal_app_intro_seen_v6';

const TWEMOJI_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72';
const twemojiUrl = (codepoint: string) => `${TWEMOJI_BASE}/${codepoint}.png`;

// --- Assets & Constants ---

const PAPER_STYLES = [
    { id: 'plain', name: '奶油白', css: 'bg-[#fffdf8]', text: 'text-[#36594b]' },
    { id: 'grid', name: '薄荷格', css: 'bg-[#fbfffc]', text: 'text-[#36594b]', style: { backgroundImage: 'linear-gradient(rgba(134,182,158,.16) 1px, transparent 1px), linear-gradient(90deg, rgba(134,182,158,.16) 1px, transparent 1px)', backgroundSize: '20px 20px' } },
    { id: 'dot', name: '薄荷点', css: 'bg-[#f6fcf8]', text: 'text-[#36594b]', style: { backgroundImage: 'radial-gradient(rgba(86,137,112,.25) 1px, transparent 1px)', backgroundSize: '18px 18px' } },
    { id: 'lined', name: '清晨横线', css: 'bg-[#fbfefb]', text: 'text-[#36594b]', style: { backgroundImage: 'repeating-linear-gradient(transparent, transparent 25px, rgba(134,182,158,.19) 25px, rgba(134,182,158,.19) 26px)' } },
];

const DEFAULT_STICKERS = [
    twemojiUrl('1f988'), twemojiUrl('1f98a'), twemojiUrl('1f9c7'),
    twemojiUrl('1f9c1'), twemojiUrl('1f36a'), twemojiUrl('1f369'), twemojiUrl('1f368'), twemojiUrl('1f36e'), twemojiUrl('1f36f'), twemojiUrl('2615'),
    twemojiUrl('1f33b'), twemojiUrl('1f335'), twemojiUrl('1fab4'), twemojiUrl('1f331'), twemojiUrl('1f332'), twemojiUrl('1f305'), twemojiUrl('1f30a'), twemojiUrl('1f3dd-fe0f'),
    twemojiUrl('2728'), twemojiUrl('1f343'), twemojiUrl('1f340'), twemojiUrl('1f4cc'), twemojiUrl('1f4ab'),
];

const DiaryAvatar: React.FC<{ src?: string; name: string; className?: string }> = ({ src, name, className = '' }) => {
    const resolved = useBlobRefUrl(src);
    const isImage = Boolean(resolved && (/^(https?:|data:|blob:|\/)/.test(resolved)));
    return (
        <div className={`grid place-items-center overflow-hidden rounded-[14px] bg-[#cfe8da] text-[#36594b] font-bold ${className}`}>
            {isImage ? <img src={resolved} alt={name} className="h-full w-full object-cover" /> : <span>{resolved || name.slice(0, 1)}</span>}
        </div>
    );
};

const DiaryDecoration: React.FC<{ sticker: StickerData }> = ({ sticker }) => {
    const resolved = useBlobRefUrl(sticker.url);
    if (sticker.kind === 'scene-card') {
        return (
            <div className="w-28 rounded-[6px] bg-[#fffdf8] p-2 shadow-[0_7px_18px_rgba(54,89,75,.16)]">
                <div className="grid h-16 place-items-center rounded-[3px] bg-[linear-gradient(145deg,#dcefe5,#f4fbf7_58%,#cfe8da)] text-2xl">🌿</div>
                <p className="mt-2 line-clamp-3 text-[9px] font-medium leading-4 text-[#527060]">{sticker.caption || '一小段没有拍下来的画面'}</p>
            </div>
        );
    }
    if (!resolved) return <div className="h-14 w-14 animate-pulse rounded-xl bg-[#dcefe5]" />;
    return <img src={resolved} alt={sticker.kind === 'photo' ? sticker.caption || '日记照片' : ''} className={sticker.kind === 'photo' ? 'h-24 w-28 rounded-[4px] border-[7px] border-[#fffdf8] object-cover shadow-[0_7px_18px_rgba(54,89,75,.16)]' : 'h-20 w-20 object-contain pointer-events-none'} draggable={false} />;
};

function mergeSceneCards(stickers: StickerData[], metadata: Record<string, unknown>, diaryKey: string): StickerData[] {
    if (stickers.some(sticker => sticker.kind === 'scene-card')) return stickers;
    const raw = metadata.sceneCards;
    if (!Array.isArray(raw)) return stickers;
    const sceneCards = raw
        .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
        .slice(0, 2)
        .map((caption, index): StickerData => ({
            id: `scene-${diaryKey}-${index}`,
            url: '',
            kind: 'scene-card',
            caption: caption.trim().slice(0, 120),
            x: 30 + index * 42,
            y: 72 - index * 10,
            rotation: index === 0 ? -4 : 5,
            scale: 0.9,
        }));
    return [...stickers, ...sceneCards];
}

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

const JournalApp: React.FC = () => {
    const { closeApp, characters, activeCharacterId, apiConfig, addToast, userProfile, updateCharacter, memoryPalaceConfig, characterGroups } = useOS();

    const [mode, setMode] = useState<'select' | 'calendar' | 'write'>('select');
    const [selectedChar, setSelectedChar] = useState<CharacterProfile | null>(null);
    const [journalGroupId, setJournalGroupId] = useState<string>(GROUP_FILTER_ALL); // 选日记本页的分组筛选
    const [diaries, setDiaries] = useState<DiaryEntry[]>([]);
    const [journalStats, setJournalStats] = useState<Record<string, { count: number; latest?: string }>>({});
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
    const photoInputRef = useRef<HTMLInputElement>(null);
    
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

    useEffect(() => {
        let alive = true;
        Promise.all(characters.map(async character => {
            const entries = await DB.getDiariesByCharId(character.id);
            const latest = entries.sort((a, b) => b.timestamp - a.timestamp)[0]?.date;
            return [character.id, { count: entries.length, latest }] as const;
        })).then(rows => {
            if (alive) setJournalStats(Object.fromEntries(rows));
        });
        return () => { alive = false; };
    }, [characters]);

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
                    const remoteSceneStickers = mergeSceneCards(existing?.charPage?.stickers || [], remote.metadata || {}, remote.id);
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
                            ? { text: remote.content, paperStyle: remote.paperStyle || existing.charPage?.paperStyle || 'plain', stickers: remoteSceneStickers }
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
                            ? { text: remote.content, paperStyle: remote.paperStyle || 'plain', stickers: remoteSceneStickers }
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
        setJournalStats(previous => ({
            ...previous,
            [charId]: { count: sorted.length, latest: sorted[0]?.date },
        }));
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
            kind: 'sticker',
            x: 50,
            y: 50,
            rotation: (Math.random() - 0.5) * 40,
            scale: 1.0 // Default scale
        };
        
        const currentStickers = targetPage?.stickers || [];
        updatePage({ stickers: [...currentStickers, newSticker] }, side);
        setShowStickerPanel(false);
    };

    const addPhoto = async (file: File) => {
        if (!currentEntry || currentEntry.primaryAuthor === 'character') return;
        try {
            const blob = await processImageToBlob(file, { maxWidth: 1200, quality: 0.86, forceJpeg: true });
            const ref = await putImageBlob(blob);
            const photo: StickerData = {
                id: `photo-${Date.now()}-${Math.random()}`,
                url: ref,
                kind: 'photo',
                caption: file.name.replace(/\.[^.]+$/, ''),
                x: 50,
                y: 42,
                rotation: (Math.random() - 0.5) * 8,
                scale: 1,
            };
            updatePage({ stickers: [...currentEntry.userPage.stickers, photo] }, 'user');
            setShowStickerPanel(false);
            addToast('照片已经贴进日记', 'success');
        } catch (error) {
            addToast(error instanceof Error ? error.message : '照片添加失败', 'error');
        }
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
                className={`relative flex h-full w-full touch-none flex-col overflow-hidden rounded-[24px_20px_26px_18px] border border-white shadow-[0_12px_32px_rgba(54,89,75,.13)] transition-all duration-300 ${style.css}`}
                style={{ ...style.style }}
                onPointerMove={isInteractive ? handlePointerMove : undefined}
                onPointerUp={isInteractive ? handlePointerUp : undefined}
                onPointerLeave={isInteractive ? handlePointerUp : undefined}
                onClick={handleBackgroundClick}
            >
                {/* Content Container */}
                <div className="relative z-10 flex flex-1 flex-col p-5">
                    <div className="mb-4 flex shrink-0 items-center justify-between border-b border-[#86b69e]/20 pb-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                            <DiaryAvatar
                                src={side === 'user' ? (userProfile.perCharAvatars?.[selectedChar?.id || ''] || userProfile.avatar) : selectedChar?.avatar}
                                name={side === 'user' ? (userProfile.name || '我') : (selectedChar?.name || '角色')}
                                className="h-9 w-9 shrink-0 text-xs"
                            />
                            <span className={`truncate text-xs font-black tracking-wide ${style.text}`}>
                                {side === 'user' ? `${userProfile.name || '我'} 写的` : `${selectedChar?.name || '角色'} 写的`}
                            </span>
                        </div>
                        <span className={`ml-2 shrink-0 font-mono text-[10px] opacity-50 ${style.text}`}>{currentEntry?.date}</span>
                    </div>

                    <textarea 
                        value={page.text}
                        onChange={e => updatePage({ text: e.target.value }, side)}
                        placeholder={side === 'user' ? "记录今天发生的事情..." : "角色会在自己的时间里写下日记"}
                        className={`no-scrollbar w-full flex-1 resize-none bg-transparent text-[16px] font-normal leading-loose outline-none placeholder:opacity-30 ${style.text}`}
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
                            className={`absolute z-20 select-none ${isReadOnly ? '' : 'cursor-move'} ${draggingSticker === s.id ? 'opacity-90' : ''} transition-transform`}
                            style={{ 
                                left: `${s.x}%`, 
                                top: `${s.y}%`, 
                                transform: `translate(-50%, -50%) rotate(${s.rotation}deg) scale(${scale})`,
                                border: isSelected ? '2px dashed #86b69e' : 'none',
                                borderRadius: '8px',
                                padding: '4px'
                            }}
                        >
                            <DiaryDecoration sticker={s} />

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
                                        className="absolute -bottom-2 -right-2 w-5 h-5 bg-[#86b69e] rounded-full border-2 border-white shadow-md cursor-nwse-resize pointer-events-auto"
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
                <button onClick={dismissIntro} className="w-full rounded-2xl bg-[#86b69e] py-3 font-bold text-white transition-transform active:scale-95">
                    我知道了
                </button>
            }
        >
            <div className="space-y-3 text-sm leading-relaxed text-[#36594b]">
                <p className="font-bold">这里的日记彼此独立，每一篇只属于一个作者：</p>
                <div className="space-y-2 rounded-2xl border border-[#cfe5d9] bg-[#e7f4ed] px-4 py-3">
                    <p><span className="font-bold">① 谁都可以先写：</span>你可以写自己的日记，角色也会在自主活动时记录自己的生活。</p>
                    <p><span className="font-bold">② 用便签交流：</span>读完一篇日记后可以贴一两句话，角色也能评论你的日记或回应便签。</p>
                    <p><span className="font-bold">③ 自动同步聊天：</span>正文和便签会合在同一张日记卡片里，新增便签只更新原卡片。</p>
                    <p><span className="font-bold">④ 旧数据继续兼容：</span>以前的双页记录会无损拆成两篇独立日记。</p>
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
                    <button onClick={() => setArchiveResult(null)} className="w-full rounded-2xl bg-[#86b69e] py-3 font-bold text-white transition-transform active:scale-95">
                        知道了
                    </button>
                }
            >
                <div className="space-y-3 text-sm text-slate-700 leading-relaxed max-h-[60vh] overflow-y-auto no-scrollbar pr-1">
                    {/* 顶部一行: 数据流向示意 */}
                    {archiveResult.summaryOrigin === 'palace_bullets' ? (
                        <div className="rounded-xl border border-[#cfe5d9] bg-[#e7f4ed] px-3 py-2 text-[11px] text-[#527060]">
                            ✓ 这次归档同时进了 <b>神经链接</b> 和 <b>记忆宫殿</b>,
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
                        palaceStatus.tone === 'on' ? 'border-[#cfe5d9] bg-[#e7f4ed]'
                        : palaceStatus.tone === 'off' ? 'border-slate-100 bg-slate-50'
                        : palaceStatus.tone === 'warn' ? 'border-[#b8d7c7] bg-[#f4fbf7]'
                        : 'border-red-100 bg-red-50/70'
                    }`}>
                        <div className={`text-[10px] font-bold tracking-widest uppercase ${
                            palaceStatus.tone === 'on' ? 'text-[#527060]'
                            : palaceStatus.tone === 'off' ? 'text-slate-500'
                            : palaceStatus.tone === 'warn' ? 'text-[#638471]'
                            : 'text-red-600'
                        }`}>
                            ◆ {palaceStatus.title}
                        </div>
                        <p className="text-[12px] text-slate-600">{palaceStatus.detail}</p>
                        {palaceNodes.length > 0 && (
                            <div className="space-y-1.5 pt-1">
                                {palaceNodes.map((n, i) => (
                                    <div key={i} className="rounded-xl border border-[#cfe5d9] bg-white/80 px-3 py-2">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="rounded bg-[#dcefe5] px-1.5 py-0.5 text-[9px] font-bold text-[#527060]">{getRoomLabel(n.room, userName)}</span>
                                            <span className="font-mono text-[9px] text-[#739987]">重要度 {n.importance}/10</span>
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
        const visibleCharacters = filterCharactersByGroup(characters, characterGroups, journalGroupId);
        return (
            <div className="flex h-full w-full flex-col bg-[#f4fbf7] font-sans text-[#36594b]">
                {introModal}
                {archiveResultModal}
                <div className="sticky top-0 z-20 shrink-0 border-b border-[#cfe5d9] bg-[#f4fbf7]/92 backdrop-blur-md" style={{ paddingTop: 'var(--chrome-top)' }}>
                    <div className="flex h-14 items-center justify-between px-5">
                        <button onClick={closeApp} className="grid h-10 w-10 place-items-center rounded-full text-[#36594b] active:scale-95 active:bg-[#dcefe5]" aria-label="返回">
                            <ArrowLeft size={22} />
                        </button>
                        <div className="text-center">
                            <p className="text-[10px] font-semibold uppercase tracking-[.28em] text-[#739987]">My little notes</p>
                            <h1 className="text-lg font-bold tracking-[.08em]">选择日记本</h1>
                        </div>
                        <div className="w-10" />
                    </div>
                </div>

                <CharacterGroupFilterBar characters={characters} groups={characterGroups}
                    value={journalGroupId} onChange={setJournalGroupId} className="shrink-0 px-5 pt-4" />

                <div className="no-scrollbar flex-1 overflow-y-auto px-5 pb-24 pt-5">
                    <div className="mb-5 flex items-end justify-between px-1">
                        <div>
                            <p className="text-2xl font-black tracking-tight">日记便签簿</p>
                            <p className="mt-1 text-xs text-[#739987]">每一本，都收着你和角色各自写下的生活。</p>
                        </div>
                        <span className="rotate-6 text-3xl" aria-hidden>🌿</span>
                    </div>

                    <div className="space-y-4">
                        {visibleCharacters.map((character, index) => {
                            const stats = journalStats[character.id];
                            return (
                                <button
                                    key={character.id}
                                    onClick={() => handleCharSelect(character)}
                                    className={`relative flex w-full items-center gap-4 overflow-hidden rounded-[18px_15px_20px_14px] border border-white bg-[#dcefe5] px-4 py-4 text-left shadow-[0_7px_20px_rgba(54,89,75,.11)] transition-transform active:scale-[.985] ${index % 2 ? 'rotate-[.35deg]' : '-rotate-[.25deg]'}`}
                                >
                                    <span className="absolute left-1/2 top-0 h-3 w-20 -translate-x-1/2 bg-white/55 shadow-sm" aria-hidden />
                                    <DiaryAvatar src={character.avatar} name={character.name} className="h-14 w-14 shrink-0 border-2 border-white/80 text-lg" />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-base font-black">{character.name} 的日记本</span>
                                        <span className="mt-1 block text-[11px] text-[#638471]">
                                            {stats?.count ? `${stats.count} 篇小记 · 最近 ${stats.latest || '刚刚'}` : '还是空白页，等第一篇小记'}
                                        </span>
                                    </span>
                                    <span className="text-xl" aria-hidden>{index % 3 === 0 ? '🦈' : index % 3 === 1 ? '🧇' : '🪴'}</span>
                                </button>
                            );
                        })}
                    </div>

                    {visibleCharacters.length === 0 && (
                        <div className="mt-14 rounded-[20px] border border-dashed border-[#a9cdbb] bg-white/65 px-6 py-10 text-center">
                            <div className="text-3xl">🪴</div>
                            <p className="mt-3 text-sm font-bold">这个分组里还没有角色</p>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    if (mode === 'calendar' && selectedChar) {
        const userAvatar = userProfile.perCharAvatars?.[selectedChar.id] || userProfile.avatar;
        return (
            <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#f4fbf7] font-sans text-[#36594b]">
                {introModal}
                {archiveResultModal}
                <div className="relative z-20 shrink-0 overflow-hidden rounded-b-[28px] border-b border-white/70 bg-[#dcefe5] px-5 pb-5 shadow-[0_10px_28px_rgba(54,89,75,.10)]" style={{ paddingTop: 'max(2.8rem, var(--safe-top))' }}>
                    <span className="absolute right-7 top-14 rotate-12 text-3xl opacity-70" aria-hidden>🦊</span>
                    <button onClick={() => setMode('select')} className="grid h-10 w-10 place-items-center rounded-full bg-white/55 text-[#36594b] active:scale-95" aria-label="选择其他日记本">
                        <ArrowLeft size={21} />
                    </button>
                    <div className="mt-3 flex items-center gap-3">
                        <DiaryAvatar src={selectedChar.avatar} name={selectedChar.name} className="h-12 w-12 border-2 border-white/80" />
                        <div className="min-w-0">
                            <p className="text-[10px] font-bold uppercase tracking-[.25em] text-[#739987]">Diary notes</p>
                            <h1 className="truncate text-2xl font-black">{selectedChar.name} 的日记本</h1>
                        </div>
                    </div>
                </div>

                <div className="no-scrollbar flex-1 overflow-y-auto px-5 pb-24 pt-5">
                    <div className="grid grid-cols-2 gap-3">
                        <button onClick={() => openEntry(getLocalDateStr(), true)} className="flex min-h-20 flex-col items-start justify-center rounded-[18px_14px_19px_13px] border border-white bg-[#86b69e] px-4 text-left text-white shadow-[0_7px_18px_rgba(54,89,75,.14)] active:scale-[.98]">
                            <span className="text-lg font-black">＋ 写我的日记</span>
                            <span className="mt-1 text-[10px] text-white/80">一篇属于你的记录</span>
                        </button>
                        <button
                            onClick={() => void handleGenerateCharacterDiary()}
                            disabled={characterDiaryPending}
                            className="flex min-h-20 flex-col items-start justify-center rounded-[15px_19px_14px_18px] border border-[#c9e2d5] bg-white/75 px-4 text-left text-[#527060] shadow-[0_7px_18px_rgba(54,89,75,.08)] active:scale-[.98] disabled:opacity-55"
                        >
                            <span className="truncate text-sm font-black">{characterDiaryPending ? `${selectedChar.name} 正在写…` : `请 ${selectedChar.name} 写一篇`}</span>
                            <span className="mt-1 text-[10px] text-[#739987]">测试自主日记入口</span>
                        </button>
                    </div>

                    <div className="mb-3 mt-7 flex items-center justify-between px-1">
                        <h2 className="text-sm font-black tracking-[.12em]">最近的小记</h2>
                        <span className="text-[10px] text-[#739987]">你和 {selectedChar.name}，各写各的</span>
                    </div>

                    <div className="space-y-3">
                        {diaries.map((diary, index) => {
                            const characterAuthored = diary.primaryAuthor === 'character';
                            const authorName = characterAuthored ? selectedChar.name : (userProfile.name || '我');
                            const authorAvatar = characterAuthored ? selectedChar.avatar : userAvatar;
                            const text = characterAuthored ? diary.charPage?.text : diary.userPage.text;
                            return (
                                <div
                                    key={diary.id}
                                    onClick={() => openEntry(diary.id)}
                                    className={`relative flex cursor-pointer items-center gap-3 rounded-[17px_14px_18px_13px] border border-white bg-[#e7f4ed] px-3 py-3 shadow-[0_6px_17px_rgba(54,89,75,.09)] transition-transform active:scale-[.985] ${index % 2 ? 'rotate-[.22deg]' : '-rotate-[.18deg]'}`}
                                >
                                    <span className="absolute left-1/2 top-0 h-2.5 w-14 -translate-x-1/2 bg-white/55" aria-hidden />
                                    <DiaryAvatar src={authorAvatar} name={authorName} className="h-11 w-11 shrink-0 border border-white/90 text-sm" />
                                    <div className="min-w-0 flex-1 pt-1">
                                        <div className="flex items-center gap-2">
                                            <span className="truncate text-[11px] font-black text-[#527060]">{authorName} 写的</span>
                                            <span className="shrink-0 text-[9px] font-mono text-[#739987]">{diary.date}</span>
                                        </div>
                                        <p className="mt-1 truncate text-sm font-semibold text-[#36594b]">{diary.title || text || '(空白小记)'}</p>
                                        <div className="mt-1.5 flex flex-wrap gap-2 text-[9px] text-[#739987]">
                                            {!!diary.comments?.length && <span>{diary.comments.length} 张便签</span>}
                                            {diary.chatCardMessageId && <span>已同步聊天</span>}
                                            {diary.isArchived && <span>已归档</span>}
                                        </div>
                                    </div>
                                    <button
                                        onClick={event => { event.stopPropagation(); setDeletingDiary(diary); }}
                                        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[#739987] active:bg-white/70 active:text-red-500"
                                        title="删除日记"
                                        aria-label="删除日记"
                                    >
                                        <Trash size={16} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>

                    {diaries.length === 0 && (
                        <div className="mt-8 rounded-[20px] border border-dashed border-[#a9cdbb] bg-white/60 px-6 py-10 text-center">
                            <div className="text-3xl">🧇</div>
                            <p className="mt-3 text-sm font-black">这里还没有日记</p>
                            <p className="mt-1 text-xs text-[#739987]">你可以先写，角色也会在自己的时间里留下记录。</p>
                        </div>
                    )}
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
        <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#f4fbf7] font-sans text-[#36594b]">
            {introModal}
            {archiveResultModal}

            {/* Editor Header */}
            <div className="z-30 shrink-0 border-b border-[#cfe5d9] bg-[#f4fbf7]/92 backdrop-blur-md" style={{ paddingTop: 'var(--chrome-top)' }}>
                <div className="flex h-14 items-center justify-between px-4">
                    <button onClick={() => setMode('calendar')} className="grid h-10 w-10 place-items-center rounded-full text-[#36594b] active:scale-95 active:bg-[#dcefe5]" aria-label="返回日记列表">
                        <ArrowLeft size={22} />
                    </button>
                    <div className="min-w-0 text-center">
                        <p className="truncate text-xs font-black">{currentEntry?.primaryAuthor === 'character' ? `${selectedChar?.name || '角色'} 的日记` : `${userProfile.name || '我'}的日记`}</p>
                        <p className="mt-0.5 font-mono text-[9px] text-[#739987]">{selectedDate}</p>
                    </div>
                    <div className="flex min-w-10 justify-end gap-2">
                        {/* 老日记 (本次更新前留下的, autoSync 未设) → 右上角出现归档按钮.
                            新日记走自动同步聊天那条线, 不显示这个按钮防止重复入库. */}
                        {currentEntry && !currentEntry.autoSync && currentEntry.charPage && !currentEntry.isArchived && (
                            <button
                                onClick={() => handleArchiveDiary(currentEntry)}
                                disabled={archivingId === currentEntry.id}
                                className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold shadow-sm transition-all ${archivingId === currentEntry.id ? 'cursor-wait bg-[#739987] text-white/70' : 'bg-[#dcefe5] text-[#527060] active:scale-95'}`}
                                title={'把这篇老日记归档进神经链接' + (selectedChar?.memoryPalaceEnabled ? ' / 记忆宫殿' : '')}
                            >
                                {archivingId === currentEntry.id ? (
                                    <>
                                        <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white"></div>
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
                            <button onClick={saveEntry} className="rounded-full bg-[#86b69e] px-4 py-2 text-xs font-black text-white shadow-sm transition-transform active:scale-95">
                                保存
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Main Page Area */}
            <div className="relative flex min-h-0 flex-1 w-full flex-col overflow-hidden">
                <div className="relative mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col px-3 pb-3 pt-3">
                    {currentEntry && (currentEntry.chatCardMessageId || currentEntry.isArchived) && (
                        <div className="mb-2 flex flex-wrap gap-2 px-1 text-[9px] font-bold text-[#638471]">
                            {currentEntry.chatCardMessageId && <span className="inline-flex items-center gap-1 rounded-full bg-[#dcefe5] px-2 py-1"><Check size={10} />已同步聊天</span>}
                            {currentEntry.isArchived && <span className="inline-flex items-center gap-1 rounded-full bg-[#dcefe5] px-2 py-1"><Archive size={10} weight="fill" />已归档</span>}
                        </div>
                    )}
                    {currentEntry && (
                        <input
                            value={currentEntry.title || ''}
                            onChange={event => setCurrentEntry(previous => previous ? { ...previous, title: event.target.value } : previous)}
                            readOnly={currentEntry.primaryAuthor === 'character'}
                            placeholder="给这篇日记起个标题（可选）"
                            className="mx-1 mb-2 h-10 shrink-0 rounded-[14px] border border-[#cfe5d9] bg-white/75 px-3 text-sm font-semibold text-[#36594b] outline-none placeholder:text-[#87a696] focus:border-[#86b69e]"
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
                        <div className="mx-1 mt-2 shrink-0 rounded-[18px_15px_19px_14px] border border-white bg-[#dcefe5] px-3 py-2.5 text-[#36594b] shadow-[0_6px_16px_rgba(54,89,75,.08)]">
                            {!!currentEntry.comments?.length && (
                                <div className="max-h-24 overflow-y-auto no-scrollbar space-y-1.5 mb-2">
                                    {currentEntry.comments.map(comment => (
                                        <div
                                            key={`${comment.id}-${comment.createdAt}`}
                                            className={`max-w-[88%] rounded-[10px_8px_11px_7px] border border-white/80 px-2.5 py-1.5 text-xs leading-relaxed shadow-sm ${comment.author === 'user' ? 'ml-auto rotate-[0.3deg] bg-[#f7fcf9]' : 'mr-auto -rotate-[0.3deg] bg-[#cfe8da]'}`}
                                        >
                                            <div className="text-[9px] opacity-55 mb-0.5 font-bold">
                                                {comment.author === 'user' ? (userProfile.name || '我') : selectedChar?.name}
                                            </div>
                                            {comment.content}
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
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
                                    className="h-10 min-w-0 rounded-xl border border-white bg-white/70 px-3 text-xs text-[#36594b] outline-none placeholder:text-[#87a696] focus:border-[#86b69e]"
                                />
                                <button
                                    onClick={() => void handleAddComment()}
                                    disabled={!commentDraft.trim() || commentPending}
                                    className="h-10 rounded-xl bg-[#86b69e] px-4 text-xs font-black text-white disabled:opacity-35"
                                >
                                    贴上
                                </button>
                                <button
                                    onClick={() => void handleRequestCommentReply()}
                                    disabled={commentPending}
                                    className="col-span-2 h-9 rounded-xl border border-white bg-white/55 px-3 text-xs font-bold text-[#527060] disabled:opacity-35"
                                >
                                    {commentPending ? '稍等一下…' : `请 ${selectedChar?.name || '角色'} 回应这张便签`}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom Controls */}
            <div className="z-30 shrink-0 border-t border-[#cfe5d9] bg-[#f4fbf7]/95 pt-2 backdrop-blur-md" style={{ paddingBottom: 'calc(2.75rem + var(--safe-bottom, 0px))' }}>
                <div className="flex items-center justify-between px-4">
                    {currentEntry?.primaryAuthor !== 'character' ? (
                        <div className="flex gap-2 rounded-full border border-[#cfe5d9] bg-white/65 p-1.5">
                            {PAPER_STYLES.slice(0, 4).map(s => (
                                <button
                                    key={s.id}
                                    onClick={() => updatePage({ paperStyle: s.id }, currentSide)}
                                    className={`h-8 w-8 rounded-full border border-[#cfe5d9] shadow-sm transition-transform active:scale-90 ${s.css}`}
                                    title={s.name}
                                />
                            ))}
                        </div>
                    ) : <div className="px-2 text-[10px] font-bold text-[#739987]">角色独立日记 · 正文只读</div>}
                    
                    <div className="flex gap-3">
                        {currentEntry?.primaryAuthor !== 'character' && (
                            <button
                                onClick={() => setShowStickerPanel(!showStickerPanel)}
                                className={`flex h-11 w-11 items-center justify-center rounded-full text-xl shadow-sm transition-transform active:scale-90 ${showStickerPanel ? 'bg-white text-[#527060]' : 'bg-[#86b69e] text-white'}`}
                            >
                                <Sparkle size={24} weight="fill" />
                            </button>
                        )}
                    </div>
                </div>

                {showStickerPanel && (
                    <div className="no-scrollbar h-52 overflow-y-auto border-t border-[#cfe5d9] bg-[#e7f4ed] p-4 animate-slide-up">
                        <div className="grid grid-cols-6 gap-2.5">
                            <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (file) void addPhoto(file); }} />
                            <button onClick={() => photoInputRef.current?.click()} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-white bg-white/65 text-[#527060]" title="添加照片">
                                <ImageSquare size={19} /><span className="text-[8px] font-bold">照片</span>
                            </button>
                            <button onClick={() => setShowImportModal(true)} className="flex aspect-square items-center justify-center rounded-xl border-2 border-dashed border-[#a9cdbb] bg-white/45 text-xl font-bold text-[#739987] transition-all active:scale-95">
                                +
                            </button>
                            {DEFAULT_STICKERS.map((s, i) => (
                                <button key={`def-${i}`} onClick={() => addSticker(s)} className="flex aspect-square items-center justify-center rounded-xl border border-white bg-white/60 p-2 transition-transform active:scale-90">
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
                                    className="relative flex aspect-square items-center justify-center rounded-xl border border-white bg-white/60 p-2 transition-transform active:scale-95"
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
                footer={<button onClick={handleImportStickers} className="w-full rounded-2xl bg-[#86b69e] py-3 font-bold text-white transition-transform active:scale-95">确认添加</button>}
            >
                <div className="space-y-3">
                    <p className="text-xs text-slate-500">格式：贴纸名称--图片URL (每行一个)</p>
                    <textarea 
                        value={importText} 
                        onChange={e => setImportText(e.target.value)} 
                        placeholder={`CoolCat--https://...\nHeart--https://...`}
                        className="h-32 w-full resize-none rounded-2xl border border-[#cfe5d9] bg-[#f4fbf7] p-4 text-sm text-[#36594b] outline-none focus:border-[#86b69e]"
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
