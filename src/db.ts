import { LabDB, LOCAL_TABLES } from './schema';
export * from './schema';

// ---- Configuration de la synchronisation (stockée localement, jamais de secret) ----
export interface SyncConfig { enabled: boolean; databaseUrl: string }
const SYNC_KEY = 'cil.sync';
export function getSyncConfig(): SyncConfig {
  try {
    const raw = localStorage.getItem(SYNC_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* stockage indisponible */ }
  return { enabled: false, databaseUrl: '' };
}
export function setSyncConfig(c: SyncConfig) {
  localStorage.setItem(SYNC_KEY, JSON.stringify(c));
}

export const db = new LabDB();

export const syncActive = (() => {
  const cfg = getSyncConfig();
  if (cfg.enabled && /^https:\/\/.+/.test(cfg.databaseUrl)) {
    db.cloud.configure({
      databaseUrl: cfg.databaseUrl,
      requireAuth: false, // l'app reste utilisable sans compte
      unsyncedTables: [...LOCAL_TABLES], // PDF, fichiers et sauvegardes auto restent sur l'appareil
      tryUseServiceWorker: false,
      // Même base IndexedDB qu'en mode local : les données créées avant l'activation restent visibles
      // et sont rattachées au compte lors de la première connexion (par défaut, Dexie Cloud ouvrirait une autre base).
      nameSuffix: false,
      customLoginGui: true, // dialogue de connexion rendu par l'app (en français)
    });
    return true;
  }
  return false;
})();

// Identifiant d'appareil (pour l'historique des versions)
export const deviceId = (() => {
  try {
    let d = localStorage.getItem('cil.device');
    if (!d) {
      const ua = navigator.userAgent;
      const kind = /iPhone|Android|Mobile/.test(ua) ? 'Téléphone' : /iPad|Tablet/.test(ua) ? 'Tablette' : 'Ordinateur';
      d = `${kind}-${Math.random().toString(36).slice(2, 6)}`;
      localStorage.setItem('cil.device', d);
    }
    return d;
  } catch { return 'appareil'; }
})();

export { uid } from './lib/util';

// Accès console pour le diagnostic (aucun secret exposé)
(globalThis as any).__cilDb = db;
