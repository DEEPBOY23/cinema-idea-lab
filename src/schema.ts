import Dexie, { type Table } from 'dexie';
import dexieCloud from 'dexie-cloud-addon';
import type {
  Idea, IdeaEvent, TimeSession, Work, Format, Source, ReadingNote, Lead, JournalEntry,
  WorkshopEntry, Version, Settings, LocalFile, AutoBackup,
} from './types';

export const SYNCED_TABLES = [
  'ideas', 'events', 'sessions', 'works', 'formats', 'sources', 'notes', 'leads', 'journal', 'workshops', 'versions', 'settings',
] as const;
export const LOCAL_TABLES = ['localFiles', 'autoBackups'] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];

export class LabDB extends Dexie {
  ideas!: Table<Idea, string>;
  events!: Table<IdeaEvent, string>;
  sessions!: Table<TimeSession, string>;
  works!: Table<Work, string>;
  formats!: Table<Format, string>;
  sources!: Table<Source, string>;
  notes!: Table<ReadingNote, string>;
  leads!: Table<Lead, string>;
  journal!: Table<JournalEntry, string>;
  workshops!: Table<WorkshopEntry, string>;
  versions!: Table<Version, string>;
  settings!: Table<Settings, string>;
  localFiles!: Table<LocalFile, string>;
  autoBackups!: Table<AutoBackup, string>;

  constructor(name = 'cinema-idea-lab', withCloud = true) {
    super(name, withCloud ? { addons: [dexieCloud] } : undefined);
    // Schéma versionné. Pour une évolution : ajouter this.version(2).stores({...}).upgrade(tx => ...)
    this.version(1).stores({
      ideas: 'id, status, formatId, updatedAt, lastActivityAt, plannedWeek, *workIds',
      events: 'id, ideaId, at',
      sessions: 'id, ideaId, start',
      works: 'id, title, seen, updatedAt',
      formats: 'id, order, updatedAt',
      sources: 'id, state, updatedAt, *ideaIds, *workIds',
      notes: 'id, sourceId, ideaId, updatedAt',
      leads: 'id, noteId, ideaId',
      journal: 'id, ideaId, noteId, at',
      workshops: 'id, ideaId, mode, createdAt',
      versions: 'id, [entityId+field], at',
      settings: 'id',
      localFiles: 'id, sourceId, addedAt',
      autoBackups: 'id, at',
    });
  }
}

export const SCHEMA_VERSION = 1;
