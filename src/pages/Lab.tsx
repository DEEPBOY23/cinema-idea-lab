import { DEFAULT_TUNING, type BackdropTuning } from '../components/Backdrop';
import { useTuning, setTuning } from '../lib/backdropTuning';

// Page de réglage du fond (accessible par #/fond). Sert à valider la matière et le verre sur le rendu réel.
const SLIDERS: { k: keyof BackdropTuning; label: string; min: number; max: number; step: number }[] = [
  { k: 'distortion', label: 'Déformation organique', min: 0, max: 1, step: 0.01 },
  { k: 'swirl', label: 'Tourbillon', min: 0, max: 1, step: 0.01 },
  { k: 'speed', label: 'Vitesse', min: 0, max: 0.3, step: 0.005 },
  { k: 'scale', label: 'Taille des masses (petit = plus grandes)', min: 0.2, max: 2, step: 0.01 },
  { k: 'rotation', label: 'Rotation', min: 0, max: 360, step: 1 },
  { k: 'offsetX', label: 'Décalage X', min: -1, max: 1, step: 0.01 },
  { k: 'offsetY', label: 'Décalage Y', min: -1, max: 1, step: 0.01 },
  { k: 'grainMixer', label: 'Grain sur les contours', min: 0, max: 1, step: 0.01 },
];

export default function Lab() {
  const t = useTuning();
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const bare = params.get('bare') === '1';
  if (bare) return <div style={{ height: '100vh' }} />;
  return (
    <div className="stack">
      <div className="page-head"><div><h1>Réglage du fond</h1><p className="muted small">Page de travail : le fond est rendu en direct derrière cette page.</p></div></div>
      <div className="grid three">
        <div className="glass-sample glass-light"><b>Verre léger</b><p className="small">Navigation, petits contrôles.</p></div>
        <div className="glass-sample glass-medium"><b>Verre medium</b><p className="small">Cartes, onglets, sections.</p></div>
        <div className="glass-sample glass-dense"><b>Verre dense</b><p className="small">Formulaires et longs textes : lisibilité maximale.</p></div>
      </div>
      <div className="grid three">
        <div className="glass-sample glass-medium tint-smoke"><b>Fumé</b></div>
        <div className="glass-sample glass-medium tint-teal"><b>Bleu-gris</b></div>
        <div className="glass-sample glass-medium tint-milk"><b>Laiteux</b></div>
      </div>
      <div className="card">
        {SLIDERS.map((s) => (
          <label key={s.k} className="field">
            <span className="field-label">{s.label} <b>{t[s.k]}</b></span>
            <input type="range" min={s.min} max={s.max} step={s.step} value={t[s.k]} onChange={(e) => setTuning({ ...t, [s.k]: Number(e.target.value) })} />
          </label>
        ))}
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => setTuning(null)}>Valeurs par défaut</button>
          <code className="small muted">{JSON.stringify(t)}</code>
        </div>
        <p className="tiny muted">Par défaut : {JSON.stringify(DEFAULT_TUNING)}</p>
      </div>
    </div>
  );
}
