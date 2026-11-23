import { useEffect, useState } from 'react';
import { DEFAULT_TUNING, type BackdropTuning } from '../components/Backdrop';
// Réglages du fond partagés entre l'app et la page de réglage (#/fond). Mémorisés localement.
const KEY = 'cil.backdrop';
export function getTuning(): BackdropTuning {
  try { const r = localStorage.getItem(KEY); if (r) return { ...DEFAULT_TUNING, ...JSON.parse(r) }; } catch { /* */ }
  return DEFAULT_TUNING;
}
export function setTuning(t: BackdropTuning | null) {
  try { t ? localStorage.setItem(KEY, JSON.stringify(t)) : localStorage.removeItem(KEY); } catch { /* */ }
  window.dispatchEvent(new Event('cil-backdrop'));
}
export function useTuning(): BackdropTuning {
  const [t, set] = useState(getTuning);
  useEffect(() => { const f = () => set(getTuning()); window.addEventListener('cil-backdrop', f); return () => window.removeEventListener('cil-backdrop', f); }, []);
  return t;
}
