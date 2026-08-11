import type { TogetherLibraryItem, TogetherSession } from '../types';
import { openDB } from './db';

const ITEMS = 'together_items';
const SESSIONS = 'together_sessions';

function complete<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function put<T>(storeName: string, value: T): Promise<void> {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

export const TogetherStore = {
    async listItems(): Promise<TogetherLibraryItem[]> {
        const db = await openDB();
        const items = await complete(db.transaction(ITEMS, 'readonly').objectStore(ITEMS).getAll()) as TogetherLibraryItem[];
        return items.sort((a, b) => b.updatedAt - a.updatedAt);
    },
    saveItem: (item: TogetherLibraryItem) => put(ITEMS, item),
    async deleteItem(id: string): Promise<void> {
        const db = await openDB();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction([ITEMS, SESSIONS], 'readwrite');
            tx.objectStore(ITEMS).delete(id);
            const cursor = tx.objectStore(SESSIONS).index('itemId').openCursor(IDBKeyRange.only(id));
            cursor.onsuccess = () => {
                const current = cursor.result;
                if (!current) return;
                current.delete();
                current.continue();
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    },
    saveSession: (session: TogetherSession) => put(SESSIONS, session),
    async listSessions(charId?: string): Promise<TogetherSession[]> {
        const db = await openDB();
        const store = db.transaction(SESSIONS, 'readonly').objectStore(SESSIONS);
        const request = charId ? store.index('charId').getAll(charId) : store.getAll();
        const sessions = await complete(request) as TogetherSession[];
        return sessions.sort((a, b) => b.startedAt - a.startedAt);
    },
};
