import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, syncActive, SYNCED_TABLES } from './db';
import { BUILTIN_FORMATS, DEFAULT_SETTINGS } from './defaults';
import type { Format, Settings } from './types';
import { alive } from './lib/util';

export function useSettings(): Settings {
  const s = useLiveQuery(() => db.settings.get('main'), []);
  return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}
export async function saveSettings(changes: Partial<Settings>) {
  const cur = await db.settings.get('main');
  if (cur) await db.settings.update('main', { ...changes, updatedAt: Date.now() });
  else await db.settings.put({ ...DEFAULT_SETTINGS, ...changes, updatedAt: Date.now() });
}

/** Formats intégrés + surcharges + formats personnels. */
export function useFormats(includeDeleted = false): Format[] {
  const stored = useLiveQuery(() => db.formats.toArray(), []) ?? [];
  const map = new Map<string, Format>(BUILTIN_FORMATS.map((f) => [f.id, f]));
  for (const f of stored) map.set(f.id, f);
  return [...map.values()].filter((f) => includeDeleted || alive(f)).sort((a, b) => a.order - b.order);
}

export const useIdeas = () => (useLiveQuery(() => db.ideas.toArray(), []) ?? []).filter(alive);
export const useWorks = () => (useLiveQuery(() => db.works.toArray(), []) ?? []).filter(alive).sort((a, b) => a.title.localeCompare(b.title, 'fr'));
export const useSources = () => (useLiveQuery(() => db.sources.toArray(), []) ?? []).filter(alive);
export const useNotes = () => (useLiveQuery(() => db.notes.toArray(), []) ?? []).filter(alive);
export const useEvents = () => useLiveQuery(() => db.events.toArray(), []) ?? [];
export const useSessions = () => (useLiveQuery(() => db.sessions.toArray(), []) ?? []).filter(alive);

// ---------- Routage par hash (compatible GitHub Pages) ----------
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [p, q] = h.split('?');
  return { path: p.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q ?? '') };
}
export function useRoute(): { path: string[]; query: URLSearchParams } {
  const [r, setR] = useState(parseHash);
  useEffect(() => {
    const on = () => { setR(parseHash()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}
export const go = (path: string) => { location.hash = '#/' + path.replace(/^\//, ''); };

// ---------- Connexion & synchronisation ----------
export function useOnline() {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true), b = () => setOn(false);
    window.addEventListener('online', a); window.addEventListener('offline', b);
    return () => { window.removeEventListener('online', a); window.removeEventListener('offline', b); };
  }, []);
  return on;
}

export type SyncUi = 'local' | 'ok' | 'offline' | 'syncing' | 'pending' | 'error' | 'signedout';
export interface SyncInfo {
  ui: SyncUi; label: string; pending: number; lastSync?: Date; error?: string;
  user?: { userId?: string; email?: string; isLoggedIn?: boolean };
}

/** Compte réel des modifications locales non encore envoyées (tables de mutations de Dexie Cloud). */
async function countPending(): Promise<number> {
  const st: any = db.cloud.persistedSyncState.value;
  const latest = st?.latestRevisions ?? {};
  let n = 0;
  for (const t of SYNCED_TABLES) {
    const name = '$' + t + '_mutations';
    if (!db.tables.some((x) => x.name === name)) continue;
    n += await db.table(name).where('rev').above(latest[t] ?? 0).count();
  }
  return n;
}

export function useSync(): SyncInfo {
  const online = useOnline();
  const [state, setState] = useState<any>(syncActive ? db.cloud.syncState.value : null);
  const [user, setUser] = useState<any>(syncActive ? db.cloud.currentUser.value : null);
  const [persisted, setPersisted] = useState<any>(syncActive ? db.cloud.persistedSyncState.value : null);
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (!syncActive) return;
    const s1 = db.cloud.syncState.subscribe(setState);
    const s2 = db.cloud.currentUser.subscribe(setUser);
    const s3 = db.cloud.persistedSyncState.subscribe(setPersisted);
    return () => { s1.unsubscribe(); s2.unsubscribe(); s3.unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!syncActive) return;
    let stop = false;
    const tick = () => countPending().then((n) => { if (!stop) setPending(n); }).catch(() => {});
    tick();
    const id = setInterval(tick, 4000);
    return () => { stop = true; clearInterval(id); };
  }, [state?.phase]);

  if (!syncActive) return { ui: 'local', label: 'Local uniquement', pending: 0 };
  const lastSync: Date | undefined = persisted?.timestamp ? new Date(persisted.timestamp) : undefined;
  const base = { pending, lastSync, user };
  if (!user?.isLoggedIn) return { ...base, ui: 'signedout', label: 'Synchro : non connecté' };
  if (!online || state?.phase === 'offline') return { ...base, ui: 'offline', label: pending ? `Hors ligne · ${pending} en attente` : 'Hors ligne' };
  if (state?.phase === 'error' || state?.status === 'error') return { ...base, ui: 'error', label: 'Erreur à résoudre', error: state?.error?.message ?? persisted?.error };
  if (state?.phase === 'pushing' || state?.phase === 'pulling' || state?.phase === 'initial') return { ...base, ui: 'syncing', label: 'Synchronisation…' };
  if (pending > 0 || state?.phase === 'not-in-sync') return { ...base, ui: 'pending', label: pending ? `${pending} modification${pending > 1 ? 's' : ''} en attente` : 'Modifications en attente' };
  return { ...base, ui: 'ok', label: 'À jour' };
}
