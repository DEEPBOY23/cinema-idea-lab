import { useRef, useState } from 'react';
import type { Idea } from '../types';
import { searchWebSources, groundingAvailable, groundingRefused, GROUNDING_REFUSED_MSG, type GroundedResult } from '../lib/ai';
import { createSource } from '../lib/actions';
import { useAIProvider } from './ui';
import { useSources, useWorks, useFormats } from '../hooks';

/** Recherche de vraies sources sur le web (Google, via Gemini). Rien n'est ajouté sans ta validation. */
export function WebSourceFinder({ subject, idea }: { subject: string; idea?: Idea }) {
  useAIProvider(); // se met à jour si l'assistant change
  const existing = useSources();
  const works = useWorks();
  const formats = useFormats();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<GroundedResult | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState('');
  const abort = useRef<AbortController | null>(null);

  if (!groundingAvailable()) {
    return <p className="small muted">Recherche web automatique : branche <a href="#/settings">Gemini (gratuit)</a> dans Paramètres. En attendant, utilise les liens de recherche ci-dessous.</p>;
  }

  if (groundingRefused() && !res && !busy) {
    return (
      <div className="card">
        <h3 style={{ margin: 0 }}>Vraies sources sur le web</h3>
        <p className="small muted" style={{ margin: '6px 0' }}>{GROUNDING_REFUSED_MSG}</p>
        <button className="btn sm ghost" onClick={() => { try { localStorage.removeItem('cil.grounding'); } catch { /* */ } run(); }}>Réessayer quand même</button>
        {msg && msg !== GROUNDING_REFUSED_MSG && <p className="small">{msg}</p>}
      </div>
    );
  }

  async function run() {
    const iw = works.filter((w) => idea?.workIds.includes(w.id)).map((w) => `${w.title}${w.year ? ` (${w.year})` : ''}${w.director ? `, ${w.director}` : ''}`);
    const fmt = formats.find((f) => f.id === idea?.formatId);
    const prompt = [
      `Je prépare une courte vidéo d'analyse cinéma${fmt ? ` (format « ${fmt.name} » : ${fmt.promise})` : ''}.`,
      `Sujet : ${subject || idea?.title || ''}`,
      iw.length ? `Œuvre(s) : ${iw.join(' ; ')}` : '',
      idea?.observation ? `Mon observation : ${idea.observation}` : '',
      `Cherche sur le web des sources RÉELLES, gratuites et fiables : interviews du réalisateur ou du directeur de la photographie, articles de fond sur la cinématographie (American Cinematographer, IndieWire, No Film School, revues de cinéma…), making-of, analyses de mise en scène, masterclasses.`,
      `Pour chaque source, une ligne : « - Titre — Média — URL complète — ce qu'elle apporte ». Uniquement des pages trouvées par la recherche ; n'invente aucune URL, aucune citation. Signale si l'accès semble payant ou sur inscription. Réponds en français.`,
    ].filter(Boolean).join('\n');
    setBusy(true); setMsg(''); setRes(null);
    abort.current = new AbortController();
    try {
      const r = await searchWebSources(prompt, abort.current.signal);
      setRes(r);
      setChecked(Object.fromEntries(r.sources.map((s) => [s.url, !existing.some((e) => e.url === s.url)])));
    } catch (e: any) {
      setMsg(e?.name === 'AbortError' ? 'Recherche annulée.' : (e?.message ?? String(e)));
    }
    setBusy(false);
  }

  const add = async () => {
    if (!res) return;
    let n = 0;
    for (const s of res.sources) {
      if (!checked[s.url] || existing.some((e) => e.url === s.url)) continue;
      await createSource({
        url: s.url, title: s.title, access: 'unverified', state: 'toread',
        interest: s.note ? `Trouvée par recherche Google (${s.note}).` : 'Trouvée par recherche Google.',
        ideaIds: idea ? [idea.id] : [], workIds: idea?.workIds ?? [],
      });
      n++;
    }
    setMsg(`${n} source${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''} à ta documentation (statut « À lire », accès à vérifier).`);
    setRes(null);
  };

  return (
    <div className="card">
      <div className="row between wrap">
        <div><h3 style={{ margin: 0 }}>Vraies sources sur le web</h3><p className="tiny muted" style={{ margin: '4px 0 0' }}>Gemini cherche sur Google. Seuls les liens trouvés par la recherche sont gardés.</p></div>
        {busy ? <button className="btn sm" onClick={() => abort.current?.abort()}>Annuler…</button>
          : <button className="btn sm primary" disabled={!(subject || idea)} onClick={run}>Chercher des sources</button>}
      </div>
      {msg && <p className="small" style={{ marginTop: 8 }}>{msg}</p>}
      {res && (
        <div style={{ marginTop: 10 }}>
          {res.queries.length > 0 && <p className="tiny muted">Recherches effectuées : {res.queries.join(' · ')}</p>}
          {res.sources.map((s) => {
            const dup = existing.some((e) => e.url === s.url);
            let host = '';
            try { host = new URL(s.url).hostname.replace(/^www\./, ''); } catch { /* */ }
            return (
              <label key={s.url} className="row" style={{ alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                <input type="checkbox" disabled={dup} checked={!!checked[s.url] && !dup} onChange={(e) => setChecked({ ...checked, [s.url]: e.target.checked })} style={{ marginTop: 4 }} />
                <span className="small" style={{ flex: 1 }}>
                  <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>
                  <span className="muted tiny"> · {/grounding-api-redirect/.test(s.url) ? 'lien de redirection Google' : host}{dup ? ' · déjà dans ta documentation' : ''}</span>
                </span>
              </label>
            );
          })}
          <details style={{ marginTop: 8 }}><summary className="small muted">Ce que Gemini en dit</summary><p className="small" style={{ whiteSpace: 'pre-wrap' }}>{res.text}</p></details>
          <div className="row wrap" style={{ marginTop: 8 }}>
            <button className="btn sm primary" disabled={!Object.values(checked).some(Boolean)} onClick={add}>Ajouter les sources cochées</button>
            <span className="tiny muted">Ouvre-les avant de t’y fier : Google trouve la page, pas forcément l’information exacte. Résultats via {res.model}.</span>
          </div>
        </div>
      )}
    </div>
  );
}
