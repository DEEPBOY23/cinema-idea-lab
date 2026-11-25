import { useRef, useState } from 'react';
import type { Idea } from '../types';
import { searchWebSources, groundingAvailable, groundingRefused, researchLeads, getProvider, type GroundedResult, type ResearchLead } from '../lib/ai';
import { searchLinks } from '../lib/prompts';
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
  const [next, setNext] = useState(false);
  const [wideRes, setWideRes] = useState(false);

  const [refused, setRefused] = useState(groundingRefused());
  if (getProvider() === 'none') {
    return <p className="small muted">Recherche assistée : branche <a href="#/settings">Gemini (gratuit)</a> dans Paramètres. En attendant, utilise les liens de recherche ci-dessous.</p>;
  }
  if (!groundingAvailable() || (refused && !res && !busy)) {
    return <LeadsFinder subject={subject} idea={idea} onRetry={groundingAvailable() ? () => { try { localStorage.removeItem('cil.grounding'); } catch { /* */ } setRefused(false); run(); } : undefined} />;
  }

  async function run(wide = false) {
    const iw = works.filter((w) => idea?.workIds.includes(w.id)).map((w) => `${w.title}${w.year ? ` (${w.year})` : ''}${w.director ? `, ${w.director}` : ''}`);
    const fmt = formats.find((f) => f.id === idea?.formatId);
    const prompt = [
      `Je prépare une courte vidéo d'analyse cinéma${fmt ? ` (format « ${fmt.name} » : ${fmt.promise})` : ''}.`,
      `Sujet : ${subject || idea?.title || ''}`,
      iw.length ? `Œuvre(s) : ${iw.join(' ; ')}` : '',
      idea?.observation ? `Mon observation : ${idea.observation}` : '',
      wide
        ? `ÉLARGIS la recherche : thèmes voisins, autres films ou séries qui utilisent le même procédé, théorie du cinéma, publicités et clips à la cinématographie remarquable (storytelling, direction de la photographie), vidéos d'analyse. Commence chaque note par « Pertinence : forte », « moyenne » ou « faible » par rapport au sujet.`
        : `Cherche sur le web des sources RÉELLES, gratuites et fiables : interviews du réalisateur ou du directeur de la photographie, articles de fond sur la cinématographie (American Cinematographer, IndieWire, No Film School, revues de cinéma…), making-of, analyses de mise en scène, masterclasses. Inclus aussi les publicités dont la cinématographie est remarquable quand c'est pertinent (shots.net, LBBOnline, Campaign, making-of de pubs).`,
      `Pour chaque source, une ligne : « - Titre — Média — URL complète — ce qu'elle apporte ». Uniquement des pages trouvées par la recherche ; n'invente aucune URL, aucune citation. Signale si l'accès semble payant ou sur inscription. Réponds en français.`,
    ].filter(Boolean).join('\n');
    setBusy(true); setMsg(''); setRes(null); setWideRes(wide);
    abort.current = new AbortController();
    try {
      const r = await searchWebSources(prompt, abort.current.signal);
      setRes(r);
      setChecked(Object.fromEntries(r.sources.map((s) => [s.url, !existing.some((e) => e.url === s.url)])));
    } catch (e: any) {
      if (groundingRefused()) setRefused(true);
      else setMsg(e?.name === 'AbortError' ? 'Recherche annulée.' : (e?.message ?? String(e)));
    }
    setBusy(false);
  }

  const add = async () => {
    if (!res) return;
    let n = 0;
    for (const s of res.sources) {
      if (!checked[s.url] || existing.some((e) => e.url === s.url)) continue;
      await createSource({
        url: s.url, access: 'unverified', state: 'toread',
        interest: s.note ? `${s.note} (trouvée par recherche Google)` : 'Trouvée par recherche Google.',
        title: /grounding-api-redirect/.test(s.url) ? `Résultat sur ${s.title}` : s.title,
        ideaIds: idea ? [idea.id] : [], workIds: idea?.workIds ?? [],
      });
      n++;
    }
    setMsg(`${n} source${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''} à ta documentation (statut « À lire », accès à vérifier).`);
    setRes(null);
    setNext(true);
  };

  return (
    <div className="card">
      <div className="row between wrap">
        <div><h3 style={{ margin: 0 }}>Vraies sources sur le web</h3><p className="tiny muted" style={{ margin: '4px 0 0' }}>Gemini cherche sur Google. Seuls les liens trouvés par la recherche sont gardés.</p></div>
        {busy ? <button className="btn sm" onClick={() => abort.current?.abort()}>Annuler…</button>
          : <span className="row wrap"><button className="btn sm primary" disabled={!(subject || idea)} onClick={() => run()}>Chercher des sources</button><button className="btn sm" disabled={!(subject || idea)} onClick={() => run(true)} title="Thèmes voisins, autres œuvres, pubs : plus de résultats, parfois moins ciblés">Élargir la recherche</button></span>}
      </div>
      {msg && <p className="small" style={{ marginTop: 8 }}>{msg}</p>}
      {next && !res && !busy && (
        <div className="note small" style={{ marginTop: 10 }}>
          <b>Et maintenant ?</b>
          <div className="row wrap" style={{ marginTop: 8 }}>
            <button className="btn sm" onClick={() => { setNext(false); setMsg(''); run(); }}>Chercher d’autres sources</button>
            <button className="btn sm" onClick={() => { setNext(false); setMsg(''); run(true); }}>Élargir la recherche</button>
            {idea && <a className="btn sm" href={`#/ideas/${idea.id}`}>Revenir à l’idée</a>}
            <a className="btn sm" href="#/creer">Créer d’autres idées</a>
            <a className="btn sm ghost" href="#/">Accueil</a>
          </div>
        </div>
      )}
      {res && (
        <div style={{ marginTop: 10 }}>
          {wideRes && <p className="note small" style={{ margin: '0 0 8px' }}>Recherche élargie : plus de résultats, mais certains sont moins ciblés. Regarde la mention « Pertinence » de chacun.</p>}
          {res.queries.length > 0 && <p className="tiny muted">Recherches effectuées : {res.queries.join(' · ')}</p>}
          {res.sources.map((s) => {
            const dup = existing.some((e) => e.url === s.url);
            let host = '';
            try { host = new URL(s.url).hostname.replace(/^www\./, ''); } catch { /* */ }
            return (
              <label key={s.url} className="row" style={{ alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                <input type="checkbox" disabled={dup} checked={!!checked[s.url] && !dup} onChange={(e) => setChecked({ ...checked, [s.url]: e.target.checked })} style={{ marginTop: 4 }} />
                <span className="small" style={{ flex: 1 }}>
                  <a href={s.url} target="_blank" rel="noreferrer">{/grounding-api-redirect/.test(s.url) ? `Résultat sur ${s.title}` : s.title}</a>
                  <span className="muted tiny"> · {/grounding-api-redirect/.test(s.url) ? `${s.title} (lien Google)` : host}{dup ? ' · déjà dans ta documentation' : ''}</span>
                  {s.note && <span className="tiny muted" style={{ display: 'block' }}>{s.note}</span>}
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

/** Offre gratuite : l'assistant propose des pistes de recherche, chacune ouvre la recherche toute prête. */
function LeadsFinder({ subject, idea, onRetry }: { subject: string; idea?: Idea; onRetry?: () => void }) {
  const works = useWorks();
  const formats = useFormats();
  const [busy, setBusy] = useState(false);
  const [leads, setLeads] = useState<ResearchLead[] | null>(null);
  const [msg, setMsg] = useState('');
  const abort = useRef<AbortController | null>(null);
  const run = async () => {
    const iw = works.filter((w) => idea?.workIds.includes(w.id)).map((w) => `${w.title}${w.year ? ` (${w.year})` : ''}${w.director ? `, ${w.director}` : ''}`);
    const fmt = formats.find((f) => f.id === idea?.formatId);
    const prompt = [`Sujet : ${subject || idea?.title || ''}`, iw.length ? `Œuvre(s) : ${iw.join(' ; ')}` : '', fmt ? `Format : ${fmt.name} — ${fmt.promise}` : '', idea?.observation ? `Observation : ${idea.observation}` : '', idea?.angle ? `Angle : ${idea.angle}` : ''].filter(Boolean).join('\n');
    setBusy(true); setMsg('');
    abort.current = new AbortController();
    try { setLeads(await researchLeads(prompt, abort.current.signal)); }
    catch (e: any) { setMsg(e?.name === 'AbortError' ? 'Annulé.' : (e?.message ?? String(e))); }
    setBusy(false);
  };
  return (
    <div className="card">
      <div className="row between wrap">
        <div><h3 style={{ margin: 0 }}>Pistes de recherche</h3><p className="tiny muted" style={{ margin: '4px 0 0' }}>Offre gratuite : l’assistant te dit quoi chercher et où. Chaque piste ouvre la recherche toute prête ; aucun lien inventé.</p></div>
        {busy ? <button className="btn sm" onClick={() => abort.current?.abort()}>Annuler…</button>
          : <button className="btn sm primary" disabled={!(subject || idea)} onClick={run}>✦ {leads ? 'Autres pistes' : 'Trouver des pistes'}</button>}
      </div>
      {msg && <p className="small tag-hypothesis" style={{ marginTop: 8 }}>{msg}</p>}
      {leads && (
        <ul className="list" style={{ marginTop: 10 }}>
          {leads.map((l) => (
            <li key={l.query} style={{ cursor: 'default' }}>
              <div className="row between wrap"><span className="item-title">{l.query}</span>{l.kind && <span className="chip">{l.kind}</span>}</div>
              {l.why && <div className="item-meta"><span>{l.why}</span></div>}
              <div className="row wrap" style={{ marginTop: 6 }}>{searchLinks(l.query).slice(0, 3).map((x) => <a key={x.label} className="btn sm ghost" href={x.url} target="_blank" rel="noreferrer">{x.label} ↗</a>)}</div>
            </li>
          ))}
        </ul>
      )}
      {onRetry && <p className="tiny muted" style={{ marginTop: 8 }}>Les vrais liens automatiques (recherche Google) demandent le plan Payant. <button className="btn sm ghost" onClick={onRetry}>Réessayer la recherche Google</button></p>}
    </div>
  );
}
