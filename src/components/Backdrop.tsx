import { useEffect, useState } from 'react';
import { MeshGradient } from '@paper-design/shaders-react';

/**
 * Fond abstrait global : un seul rendu WebGL (Paper Shaders, MeshGradient), derrière toute l'app.
 * - Lumière défocalisée : grandes masses cuivre / bleu-vert fumé / blanc nacré sur des noirs chauds.
 * - Mouvement extrêmement lent, mis en pause quand l'app est cachée, figé si « réduire les animations ».
 * - Résolution limitée (le rendu est flou par nature : inutile de calculer chaque pixel), plus basse sur mobile.
 * - Secours : image locale statique si WebGL est indisponible, et dégradé CSS en dernier recours.
 */

// Palette validée (désaturée). L'ordre compte : le shader répartit les couleurs en « taches » mobiles.
export const BACKDROP_COLORS = [
  '#040303', // noir chaud
  '#a65a2c', // cuivre
  '#050404', // noir chaud
  '#d38d5c', // cuivre lumineux (cœur des lueurs)
  '#030303', // noir
  '#2c5659', // bleu-vert fumé
  '#060505', // noir chaud
  '#0b0908', // graphite chaud
];

export interface BackdropTuning { distortion: number; swirl: number; speed: number; scale: number; grainMixer: number; offsetX: number; offsetY: number; rotation: number }
export const DEFAULT_TUNING: BackdropTuning = { distortion: 0.38, swirl: 0.08, speed: 0.16, scale: 0.72, grainMixer: 0, offsetX: 0.04, offsetY: 0, rotation: 200 };

function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}
const mq = (q: string) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : false);

export function Backdrop({ tuning = DEFAULT_TUNING, colors = BACKDROP_COLORS }: { tuning?: BackdropTuning; colors?: string[] }) {
  const [gl] = useState(webglAvailable);
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');
  const [reduced, setReduced] = useState(() => mq('(prefers-reduced-motion: reduce)'));
  const small = mq('(max-width: 700px)');

  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVis);
    const m = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const onMq = () => setReduced(!!m?.matches);
    m?.addEventListener?.('change', onMq);
    return () => { document.removeEventListener('visibilitychange', onVis); m?.removeEventListener?.('change', onMq); };
  }, []);

  const speed = !visible || reduced ? 0 : tuning.speed;
  return (
    <div className="backdrop" aria-hidden="true">
      <img className="backdrop-fallback" src={`${import.meta.env.BASE_URL}backdrop-fallback.jpg`} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} alt="" />
      {gl && (
        <MeshGradient
          className="backdrop-canvas"
          colors={colors}
          distortion={tuning.distortion}
          swirl={tuning.swirl}
          grainMixer={tuning.grainMixer}
          grainOverlay={0}
          speed={speed}
          frame={reduced ? 42_000 : undefined}
          scale={tuning.scale}
          rotation={tuning.rotation}
          offsetX={tuning.offsetX}
          offsetY={tuning.offsetY}
          minPixelRatio={1}
          maxPixelCount={small ? 1_300_000 : 2_600_000}
          webGlContextAttributes={{ antialias: false, alpha: false, powerPreference: 'low-power' }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        />
      )}
      <div className="backdrop-depth" />
      <div className="backdrop-dither" style={{ backgroundImage: `url(${import.meta.env.BASE_URL}noise.png)` }} />
      <div className="backdrop-focus" />
    </div>
  );
}
