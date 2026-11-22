import type { LabDB } from '../schema';
import { SYNCED_TABLES, SCHEMA_VERSION } from '../schema';
import { uid } from './util';

export interface BackupFile {
  app: 'cinema-idea-lab';
  schema: number;
  exportedAt: string;
  tables: Record<string, any[]>;
  files?: { id: string; name: string; type: string; size: number; sourceId?: string; addedAt: number; data: string }[];
}

async function blobToBase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
function base64ToBlob(data: string, type: string): Blob {
  const bin = atob(data);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}

/** Export complet (y compris éléments en corbeille). Les documents locaux sont optionnels car volumineux. */
export async function exportAll(db: LabDB, includeFiles = false): Promise<BackupFile> {
  const tables: Record<string, any[]> = {};
  for (const t of SYNCED_TABLES) tables[t] = await db.table(t).toArray();
  const out: BackupFile = { app: 'cinema-idea-lab', schema: SCHEMA_VERSION, exportedAt: new Date().toISOString(), tables };
  if (includeFiles) {
    const files = await db.localFiles.toArray();
    out.files = await Promise.all(files.map(async (f) => ({ id: f.id, name: f.name, type: f.type, size: f.size, sourceId: f.sourceId, addedAt: f.addedAt, data: await blobToBase64(f.blob) })));
  }
  return out;
}

export interface ImportReport { added: number; updated: number; kept: number; files: number }

/**
 * Restauration sans duplication : chaque enregistrement est identifié par son id.
 * - 'merge' : on garde la version la plus récente (updatedAt) quand l'id existe déjà.
 * - 'overwrite' : la sauvegarde remplace les enregistrements de même id.
 * Avant d'écraser un texte plus récent, l'ancien contenu n'est jamais détruit en mode merge.
 */
export async function importBackup(db: LabDB, data: BackupFile, mode: 'merge' | 'overwrite' = 'merge'): Promise<ImportReport> {
  if (!data || data.app !== 'cinema-idea-lab' || typeof data.tables !== 'object') throw new Error('Fichier non reconnu : ce n’est pas une sauvegarde Cinema Idea Lab.');
  if (data.schema > SCHEMA_VERSION) throw new Error(`Sauvegarde créée par une version plus récente (schéma ${data.schema}). Mets l’application à jour avant de restaurer.`);
  const report: ImportReport = { added: 0, updated: 0, kept: 0, files: 0 };
  await db.transaction('rw', [...SYNCED_TABLES.map((t) => db.table(t)), db.localFiles], async () => {
    for (const t of SYNCED_TABLES) {
      const rows = data.tables[t];
      if (!Array.isArray(rows)) continue;
      const table = db.table(t);
      const existing = new Map((await table.bulkGet(rows.map((r) => r.id))).filter(Boolean).map((r: any) => [r.id, r]));
      const toPut: any[] = [];
      for (const r of rows) {
        if (!r || typeof r.id !== 'string') continue;
        const cur = existing.get(r.id);
        if (!cur) { toPut.push(r); report.added++; continue; }
        const newer = (r.updatedAt ?? r.at ?? 0) > (cur.updatedAt ?? cur.at ?? 0);
        if (mode === 'overwrite' || newer) { toPut.push(r); report.updated++; } else report.kept++;
      }
      if (toPut.length) await table.bulkPut(toPut);
    }
    if (data.files) {
      for (const f of data.files) {
        if (await db.localFiles.get(f.id)) continue;
        await db.localFiles.put({ id: f.id, name: f.name, type: f.type, size: f.size, sourceId: f.sourceId, addedAt: f.addedAt, blob: base64ToBlob(f.data, f.type) });
        report.files++;
      }
    }
  });
  return report;
}

/** Sauvegarde automatique locale quotidienne (jamais synchronisée), 10 dernières conservées. */
export async function autoBackupIfDue(db: LabDB, now = Date.now(), keep = 10): Promise<boolean> {
  const last = await db.autoBackups.orderBy('at').last();
  if (last && now - last.at < 20 * 3_600_000) return false;
  const counts = await Promise.all(SYNCED_TABLES.map((t) => db.table(t).count()));
  if (counts.every((c) => c === 0)) return false;
  const json = JSON.stringify(await exportAll(db, false));
  await db.autoBackups.add({ id: uid(), at: now, json, size: json.length });
  const all = await db.autoBackups.orderBy('at').toArray();
  if (all.length > keep) await db.autoBackups.bulkDelete(all.slice(0, all.length - keep).map((b) => b.id));
  return true;
}

export function downloadJson(obj: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
