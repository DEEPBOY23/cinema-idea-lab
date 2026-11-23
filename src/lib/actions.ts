import { db, deviceId } from '../db';
import type { Idea, Status, Version, Work, Source, ReadingNote, Format } from '../types';
import { uid } from './util';
import { toast } from './toast';
import { statusLabel } from '../types';

export async function createIdea(partial: Partial<Idea> = {}): Promise<string> {
  const now = Date.now();
  const idea: Idea = {
    id: uid(), title: partial.title?.trim() || 'Nouvelle idée', workIds: [], category: 'analyse',
    createdAt: now, updatedAt: now, lastActivityAt: now, status: 'idea',
    observation: '', angle: '', hook: '', angles: [], structure: [], script: '', missingInfo: '',
    priority: 2, avDifficulty: 2, paused: false, comments: [],
    ...partial,
  } as Idea;
  await db.transaction('rw', db.ideas, db.events, async () => {
    await db.ideas.add(idea);
    await db.events.add({ id: uid(), ideaId: idea.id, type: 'created', at: idea.createdAt });
    if (idea.status !== 'idea') await db.events.add({ id: uid(), ideaId: idea.id, type: 'status', from: 'idea', to: idea.status, at: idea.createdAt });
  });
  toast('Idée enregistrée');
  return idea.id;
}

export async function updateIdea(id: string, changes: Partial<Idea>) {
  const now = Date.now();
  await db.ideas.update(id, { ...changes, updatedAt: now, lastActivityAt: now });
}

export async function touchIdea(id?: string) {
  if (!id) return;
  const now = Date.now();
  await db.ideas.update(id, { lastActivityAt: now, updatedAt: now });
}

/** Changement de statut flexible : sauts et retours en arrière autorisés, chaque transition est historisée. */
export async function setStatus(idea: Idea, to: Status, at = Date.now()) {
  if (idea.status === to) return;
  await db.transaction('rw', db.ideas, db.events, async () => {
    await db.events.add({ id: uid(), ideaId: idea.id, type: 'status', from: idea.status, to, at });
    await db.ideas.update(idea.id, { status: to, updatedAt: Date.now(), lastActivityAt: Date.now() });
  });
  toast(`Statut : ${statusLabel(to)}`);
}

export async function softDelete(table: 'ideas' | 'works' | 'sources' | 'notes' | 'formats' | 'sessions', id: string) {
  await db.table(table).update(id, { deletedAt: Date.now(), updatedAt: Date.now() });
}
export async function restore(table: string, id: string) {
  await db.table(table).update(id, { deletedAt: undefined, updatedAt: Date.now() });
}

// ---- Versions des textes ----
export async function snapshot(entity: string, entityId: string, field: string, value: string, reason: Version['reason']) {
  if (!value || !value.trim()) return;
  const last = await db.versions.where('[entityId+field]').equals([entityId, field]).sortBy('at');
  const prev = last[last.length - 1];
  if (prev && prev.value === value) return;
  await db.versions.add({ id: uid(), entity, entityId, field, value, at: Date.now(), device: deviceId, reason });
}

// ---- Créations rapides ----
export async function createWork(p: Partial<Work>): Promise<string> {
  const now = Date.now();
  const w: Work = { id: uid(), title: '', director: '', kind: 'film', seen: 'unseen', notes: '', scenes: '', createdAt: now, updatedAt: now, ...p };
  await db.works.add(w);
  return w.id;
}
export async function createSource(p: Partial<Source>): Promise<string> {
  const now = Date.now();
  const s: Source = {
    id: uid(), title: '', url: '', author: '', media: '', date: '', type: 'Article de fond', topics: [], interest: '',
    state: 'toread', access: 'unverified', ideaIds: [], workIds: [], createdAt: now, updatedAt: now, ...p,
  };
  await db.sources.add(s);
  for (const i of s.ideaIds) await touchIdea(i);
  toast(s.ideaIds.length ? 'Article rangé dans l’idée' : 'Source ajoutée');
  return s.id;
}
export async function createNote(p: Partial<ReadingNote>): Promise<string> {
  const now = Date.now();
  const n: ReadingNote = {
    id: uid(), title: '', learned: '', surprised: '', observations: '', rewatch: '', toVerify: '', toDeepen: '',
    claims: [], createdAt: now, updatedAt: now, ...p,
  };
  await db.notes.add(n);
  await touchIdea(n.ideaId);
  return n.id;
}
export async function addJournal(text: string, ideaId?: string, noteId?: string) {
  await db.journal.add({ id: uid(), ideaId, noteId, at: Date.now(), text });
}

/** Un format intégré modifié est enregistré avec le même id (surcharge). */
export async function saveFormat(f: Format) {
  await db.formats.put({ ...f, updatedAt: Date.now() });
}
