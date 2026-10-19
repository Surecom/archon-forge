/**
 * Chat history — IndexedDB, this browser only.
 *
 *   db 'archon-forge' · store 'messages' { id, sessionId, order, role, content, ts, status?, appliedCount? }
 *
 * Only completed exchanges feed the model's history; cancelled and failed
 * turns stay visible in the transcript but are skipped when building context.
 */
import { openDB, type IDBPDatabase } from 'idb';

export type StoredRole = 'user' | 'assistant';
export type TurnStatus = 'finished' | 'cancelled' | 'error';

export interface StoredMessage {
  id?: number;
  sessionId: string;
  order: number;
  role: StoredRole;
  content: string;
  ts: number;
  status?: TurnStatus;
  appliedCount?: number;
}

const DB_NAME = 'archon-forge';
const DB_VERSION = 1;
const STORE = 'messages';
export const DEFAULT_SESSION_ID = 'default';

let dbp: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbp) {
    dbp = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('bySession', ['sessionId', 'order']);
        }
      },
    });
  }
  return dbp;
}

const sessionRange = (sessionId: string) => IDBKeyRange.bound([sessionId, -Infinity], [sessionId, Infinity]);

export async function append(message: Omit<StoredMessage, 'id'>): Promise<void> {
  const db = await getDb();
  await db.add(STORE, message);
}

export async function loadSession(sessionId: string = DEFAULT_SESSION_ID): Promise<StoredMessage[]> {
  const db = await getDb();
  const rows = await db.getAllFromIndex(STORE, 'bySession', sessionRange(sessionId)) as StoredMessage[];
  return rows.sort((a, b) => a.order - b.order);
}

export async function clearSession(sessionId: string = DEFAULT_SESSION_ID): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  let cursor = await tx.store.index('bySession').openCursor(sessionRange(sessionId));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}
