export const uid = () =>
  (globalThis.crypto && 'randomUUID' in globalThis.crypto)
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

export const DAY = 86_400_000;

/** Semaine ISO 'YYYY-Www' (lundi → dimanche, heure locale). */
export function isoWeek(ts: number | Date): string {
  const d = new Date(ts);
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (date.getDay() + 6) % 7; // lundi = 0
  date.setDate(date.getDate() - day + 3); // jeudi de la semaine
  const firstThursday = new Date(date.getFullYear(), 0, 4);
  const fd = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - fd + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * DAY));
  return `${date.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Lundi 00:00 de la semaine ISO donnée. */
export function weekStart(week: string): Date {
  const [y, w] = week.split('-W').map(Number);
  const jan4 = new Date(y, 0, 4);
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (w - 1) * 7);
  monday.setHours(0, 0, 0, 0);
  return monday;
}
export function shiftWeek(week: string, delta: number): string {
  const d = weekStart(week);
  d.setDate(d.getDate() + delta * 7 + 3);
  return isoWeek(d);
}

export const fmtDate = (ts?: number) =>
  ts ? new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const fmtDateTime = (ts?: number) =>
  ts ? new Date(ts).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/** Valeur pour <input type="datetime-local"> en heure locale. */
export function toLocalInput(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const fromLocalInput = (v: string) => new Date(v).getTime();

export function fmtDuration(ms?: number): string {
  if (ms === undefined || ms === null || isNaN(ms)) return '—';
  const days = ms / DAY;
  if (days >= 1) return `${days < 10 ? days.toFixed(1).replace('.0', '') : Math.round(days)} j`;
  const h = ms / 3_600_000;
  if (h >= 1) return `${Math.round(h)} h`;
  return `${Math.max(0, Math.round(ms / 60_000))} min`;
}
export const fmtMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}` : `${Math.round(m)} min`);

export function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

export const alive = <T extends { deletedAt?: number }>(x: T) => !x.deletedAt;
