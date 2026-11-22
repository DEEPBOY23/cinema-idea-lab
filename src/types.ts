// Modèle de données — toutes les entités synchronisables ont un id string (UUID) global.
// Les suppressions sont "douces" (deletedAt) pour qu'une suppression synchronisée reste récupérable.

export type Status =
  | 'idea' | 'documentation' | 'angle' | 'structure' | 'script' | 'production' | 'done' | 'published';

export const STATUSES: { id: Status; label: string }[] = [
  { id: 'idea', label: 'Idée' },
  { id: 'documentation', label: 'Documentation' },
  { id: 'angle', label: 'Angle choisi' },
  { id: 'structure', label: 'Structure validée' },
  { id: 'script', label: 'Script facultatif' },
  { id: 'production', label: 'En production' },
  { id: 'done', label: 'Réalisée' },
  { id: 'published', label: 'Publiée' },
];
export const statusLabel = (s: Status) => STATUSES.find((x) => x.id === s)?.label ?? s;
export const statusRank = (s: Status) => STATUSES.findIndex((x) => x.id === s);

export type ResearchLevelId = 'light' | 'moderate' | 'deep';
export interface ResearchLevel {
  level: ResearchLevelId;
  justification: string;
  sourcesNeeded: string;
  missing: string;
  docHours: number; // temps documentaire estimé (ajustable)
  shootHours?: number;
  editHours?: number;
}

export type CompatRating = 'high' | 'conditional' | 'low' | 'insufficient';
export const COMPAT_LABELS: Record<CompatRating, string> = {
  high: 'Très pertinente',
  conditional: 'Pertinente sous certaines conditions',
  low: 'Peu pertinente',
  insufficient: 'Informations insuffisantes',
};

export interface Beat { id: string; label: string; content: string; seconds: number; weak?: boolean }
export interface AngleOption { id: string; text: string; chosen: boolean; origin: 'moi' | 'claude' }
export interface Comment { id: string; at: number; text: string }

export interface Idea {
  id: string;
  title: string;
  workIds: string[];
  formatId?: string;
  category: 'analyse' | 'technique';
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
  status: Status;
  observation: string;
  angle: string;
  hook: string;
  angles: AngleOption[];
  structure: Beat[];
  script: string;
  missingInfo: string;
  priority: 1 | 2 | 3; // 1 = haute
  research?: ResearchLevel;
  avDifficulty: 1 | 2 | 3;
  compat?: { rating: CompatRating; justification: string; at: number };
  targetSeconds?: number;
  paused: boolean;
  plannedWeek?: string; // 'YYYY-Www'
  comments: Comment[];
  deletedAt?: number;
}

export interface IdeaEvent {
  id: string;
  ideaId: string;
  type: 'created' | 'status';
  from?: Status;
  to?: Status;
  at: number;
  manual?: boolean;
}

export type Phase = 'documentation' | 'ecriture' | 'production' | 'montage' | 'autre';
export interface TimeSession { id: string; ideaId: string; phase: Phase; start: number; minutes: number; note?: string; deletedAt?: number }

export type Seen = 'seen' | 'partial' | 'unseen';
export interface Work {
  id: string; title: string; year?: number; director: string; kind: 'film' | 'serie';
  seen: Seen; seenDate?: string; notes: string; scenes: string;
  createdAt: number; updatedAt: number; deletedAt?: number;
}

export interface FormatStructure { name: string; beats: { label: string; seconds: number }[] }
export interface Format {
  id: string; name: string; minSec: number; maxSec: number; promise: string;
  features: string[]; structures: FormatStructure[]; themes: string[]; docLeads: string[];
  docLoad: string; avLoad: string; custom: boolean; order: number;
  updatedAt: number; deletedAt?: number;
}

export type SourceState = 'toread' | 'reading' | 'read' | 'deepen';
export const SOURCE_STATES: Record<SourceState, string> = { toread: 'À lire', reading: 'En cours', read: 'Lu', deepen: 'À approfondir' };
export type Access = 'unverified' | 'verified' | 'signup' | 'paywall' | 'unavailable';
export const ACCESS_LABELS: Record<Access, string> = {
  unverified: 'Accès non vérifié', verified: 'Vérifié, gratuit', signup: 'Inscription requise',
  paywall: 'Payant', unavailable: 'Lien indisponible',
};
export const SOURCE_TYPES = [
  'Interview réalisateur', 'Interview directeur photo', 'Article de fond', 'Analyse de mise en scène',
  'Making-of / BTS', 'Dossier de production', 'Masterclass vidéo', 'Ressource technique', 'Ressource historique', 'Autre',
];
export interface Source {
  id: string; title: string; url: string; author: string; media: string; date: string; type: string;
  topics: string[]; interest: string; minutes?: number; state: SourceState; access: Access;
  ideaIds: string[]; workIds: string[]; localFileId?: string;
  createdAt: number; updatedAt: number; deletedAt?: number;
}

export type ClaimNature = 'fact' | 'statement' | 'interpretation' | 'hypothesis';
export const CLAIM_LABELS: Record<ClaimNature, string> = {
  fact: 'Fait documenté', statement: 'Déclaration vérifiée', interpretation: 'Interprétation', hypothesis: 'Hypothèse à confirmer',
};
export interface Claim { id: string; text: string; nature: ClaimNature; ref: string }
export interface ReadingNote {
  id: string; sourceId?: string; ideaId?: string; title: string;
  learned: string; surprised: string; observations: string; rewatch: string; toVerify: string; toDeepen: string;
  claims: Claim[]; createdAt: number; updatedAt: number; deletedAt?: number;
}

export type LeadKind = 'question' | 'source' | 'axis' | 'link';
export const LEAD_LABELS: Record<LeadKind, string> = { question: 'Question', source: 'Source', axis: 'Axe narratif', link: 'Lien avec un film vu' };
export interface Lead {
  id: string; noteId?: string; ideaId?: string; point: string; kind: LeadKind; text: string;
  state: 'proposed' | 'accepted' | 'rejected'; createdAt: number; updatedAt: number;
}

export interface JournalEntry { id: string; ideaId?: string; noteId?: string; at: number; text: string }

export type WorkshopMode = 'inspiration' | 'development' | 'diagnostic' | 'writing' | 'challenge' | 'compat' | 'deepen' | 'alternatives';
export interface WorkshopEntry { id: string; ideaId?: string; mode: WorkshopMode; input: string; prompt: string; response: string; createdAt: number; updatedAt: number }

export interface Version {
  id: string; entity: string; entityId: string; field: string; value: string; at: number;
  device: string; reason: 'auto' | 'conflict' | 'remote' | 'restore' | 'manual';
}

export interface Settings {
  id: 'main';
  thresholds: [number, number, number]; // 7 / 21 / 45
  weeklyLong: number;
  weeklyShort: number;
  countOn: 'done' | 'published';
  styleProfile: string;
  spoilers: 'avoid' | 'ok';
  wpm: number; // mots par minute à l'oral
  updatedAt: number;
}

// Tables locales uniquement (jamais synchronisées)
export interface LocalFile { id: string; name: string; type: string; size: number; blob: Blob; sourceId?: string; addedAt: number }
export interface AutoBackup { id: string; at: number; json: string; size: number }
