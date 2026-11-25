import { useRef, useState } from 'react';
import { Dictate, useAIProvider } from '../components/ui';
import { useMemory } from '../components/assist';
import { createIdea, updateIdea } from '../lib/actions';
import { db } from '../db';
import { go } from '../hooks';
import { detectSeed, SEED_LABEL, generateFromSeed, moreAngles, generatedToIdea, distinctTitle, type GeneratedIdea } from '../lib/create';
import { addJournal } from '../lib/actions';
import { searchLinks } from '../lib/prompts';

const DRAFT = 'cil.create.draft';
const RESULTS = 'cil.create.results';
const BATCH = 'cil.create.batch'; // idées gardées depuis la même génération : la principale + ses variantes
const load = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } };

const LEVEL = { light: 'Rapide', moderate: 'Moyen', deep: 'Approfondi' } as const;
const FIT = { high: 'Très adapté', conditional: 'Possible', low: 'Peu adapté' } as const;

/** Créer : une phrase, une idée ou un script → plusieurs idées de posts, avec angles, formats, temps et structure. */
export default function Create() {
  const provider = useAIProvider();
  const memory = useMemory();
  const [seed, setSeed] = useState(() => load(DRAFT, ''));
  const [ideas, setIdeas] = useState<GeneratedIdea[]>(() => load(RESULTS, []));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const abort = useRef<AbortController | null>(null);
  const kind = seed.trim() ? detectSeed(seed) : null;
  const [editing, setEditing] = useState(false);
  const folded = ideas.length > 0 && !editing && !busy;

  const setSeedSaved = (t: string) => { setSeed(t); save(DRAFT, t); };
  const setIdeasSaved = (v: GeneratedIdea[]) => { setIdeas(v); save(RESULTS, v); };

  const generate = async () => {
    setBusy(true); setErr('');
    abort.current = new AbortController();
    try {
      const r = await generateFromSeed(seed.trim(), memory, abort.current.signal);
      setEditing(false);
      save(BATCH, { main: '', ids: [] });
      if (!r.length) setErr('L’assistant n’a rien proposé. Reformule ou ajoute un détail (film, plan, scène).');
      setIdeasSaved(r);
    } catch (e: any) { setErr(e?.name === 'AbortError' ? '' : (e?.message ?? String(e))); }
    setBusy(false);
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Créer</h1>
          <p className="muted small">Une phrase, une idée ou un script, même partiel. L’assistant en tire plusieurs idées de posts : angles, formats, temps estimé et structure (Hook · Intro · Angles · Contradiction · Conclusion).</p>
        </div>
      </div>

      {folded ? (
        <div className="card seed-folded">
          <div style={{ flex: 1, minWidth: 0 }}><span className="tiny muted">Ton point de départ</span><p className="small seed-line">{seed}</p></div>
          <div className="row wrap" style={{ flex: 'none' }}>
            <button className="btn sm" onClick={() => setEditing(true)}>Modifier</button>
            <button className="btn sm primary" onClick={() => { setIdeasSaved([]); setSeedSaved(''); setEditing(true); }}>Nouvelle idée</button>
          </div>
        </div>
      ) : (
      <div className="card">
        <div className="row between" style={{ marginBottom: 6 }}>
          <span className="field-label" style={{ margin: 0 }}>Ton point de départ</span>
          <Dictate onText={(t) => setSeedSaved((seed ? seed + ' ' : '') + t)} />
        </div>
        <textarea rows={5} value={seed} onChange={(e) => setSeedSaved(e.target.value)}
          placeholder="Ex. Dans Her, tout le monde porte du corail sauf quand Theodore est seul…" />
        <div className="row wrap" style={{ marginTop: 8 }}>
          {busy ? <button className="btn" onClick={() => abort.current?.abort()}>L’assistant réfléchit… (annuler)</button>
            : <button className="btn primary" disabled={!seed.trim() || provider === 'none'} onClick={generate}>✦ Générer des idées</button>}
          {kind && <span className="tiny muted">{SEED_LABEL[kind]}</span>}
          {provider === 'none' && <a className="small" href="#/settings">Branche Gemini (gratuit) pour générer →</a>}
          {ideas.length > 0 && !busy && <button className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={() => { setIdeasSaved([]); setSeedSaved(''); }}>Tout effacer</button>}
        </div>
        {err && <p className="small tag-hypothesis" style={{ marginTop: 8 }}>{err}</p>}
      </div>
      )}

      {ideas.length > 0 && <h2>{ideas.length} idée{ideas.length > 1 ? 's' : ''} proposée{ideas.length > 1 ? 's' : ''} · du plus rapide au plus long</h2>}
      {[...ideas].map((g, i) => ({ g, i })).sort((a, b) => (a.g.estimate?.totalHours ?? 1e9) - (b.g.estimate?.totalHours ?? 1e9)).map(({ g, i }) => (
        <GenCard key={i + g.title} g={g} seed={seed}
          onChange={(ng) => setIdeasSaved(ideas.map((x, k) => (k === i ? ng : x)))}
          onKept={() => setIdeasSaved(ideas.filter((_, k) => k !== i))}
          memory={memory} />
      ))}
    </div>
  );
}

/** Range les idées gardées d'une même génération : une principale, les autres en variantes.
 *  La première « développée » devient la principale ; les « plus tard » s'y rattachent. */
async function linkVariant(id: string, developed: boolean) {
  const b = load<{ main: string; ids: string[] }>(BATCH, { main: '', ids: [] });
  const mainIdea = b.main ? await db.ideas.get(b.main) : undefined;
  const main = mainIdea && !mainIdea.deletedAt ? mainIdea : undefined;
  const promote = async () => {
    await updateIdea(id, { parentId: undefined });
    for (const o of b.ids) if (o !== id) await updateIdea(o, { parentId: id });
    save(BATCH, { main: id, ids: [...b.ids, id] });
  };
  if (!main || (developed && (main.paused || main.importance === 'plus-tard'))) return promote();
  await updateIdea(id, { parentId: main.id });
  save(BATCH, { main: main.id, ids: [...b.ids, id] });
}

function GenCard({ g, seed, onChange, onKept, memory }: { g: GeneratedIdea; seed: string; onChange: (g: GeneratedIdea) => void; onKept: () => void; memory: ReturnType<typeof useMemory> }) {
  const [chosen, setChosen] = useState<number[]>([0]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const e = g.estimate;
  const toggle = (k: number) => setChosen((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));

  const more = async () => {
    setBusy('angles'); setErr('');
    try { onChange({ ...g, angles: [...g.angles, ...(await moreAngles(g, memory))] }); }
    catch (x: any) { setErr(x?.message ?? String(x)); }
    setBusy('');
  };
  const keep = async (open: boolean) => {
    setBusy('keep');
    const data = generatedToIdea(g, chosen, seed, memory.formats);
    const existing = memory.ideas.filter((x) => !x.deletedAt).map((x) => x.title);
    const angle = chosen.length ? g.angles[chosen[0]] : g.angles[0];
    data.title = distinctTitle(g.title, existing, angle, memory.formats.find((f) => f.id === data.formatId)?.name);
    if (!open) { data.paused = true; data.priority = 3; }
    const id = await createIdea(data);
    if (!open) await addJournal('Gardée pour plus tard depuis « Créer » (en pause).', id);
    await linkVariant(id, open);
    onKept();
    if (open) go(`ideas/${id}`);
  };

  const s = g.structure;
  const parts: [string, string][] = [['Hook', s.hook], ['Intro', s.intro], ...s.angles.map((a, k) => [s.angles.length > 1 ? `Angle ${k + 1}` : 'Angle', a] as [string, string]), ['Contradiction', s.contradiction], ['Conclusion / complément', s.conclusion]];

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="row between wrap" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <h3 style={{ margin: 0 }}>{g.title}</h3>
          {g.summary && <p className="small muted" style={{ margin: '4px 0 0' }}>{g.summary}</p>}
        </div>
        {e && <div style={{ flex: '0 1 auto' }}><b style={{ fontSize: '1.2rem' }}>≈ {e.totalHours} h</b><div className="tiny muted">{LEVEL[e.level] ?? ''} · doc {e.docHours} h · tournage {e.shootHours} h · montage {e.editHours} h</div></div>}
      </div>

      {g.formats.length > 0 && (
        <div className="row wrap" style={{ marginTop: 10, gap: 6 }}>
          {g.formats.map((f) => <span key={f.formatId} className="chip" title={f.reason}>{memory.formats.find((x) => x.id === f.formatId)?.name ?? f.formatId} · {FIT[f.fit]}</span>)}
        </div>
      )}

      <span className="field-label" style={{ marginTop: 12 }}>Angles · coche ceux que tu gardes</span>
      {g.angles.map((a, k) => (
        <label key={k} className="row" style={{ alignItems: 'flex-start', padding: '5px 0', flexWrap: 'nowrap' }}>
          <input type="checkbox" checked={chosen.includes(k)} onChange={() => toggle(k)} style={{ marginTop: 4, flex: 'none' }} />
          <span className="small" style={{ flex: 1, minWidth: 0 }}>{a}</span>
        </label>
      ))}
      <button className="btn sm ghost" disabled={!!busy} onClick={more}>{busy === 'angles' ? 'Recherche d’angles…' : '↻ Autres angles'}</button>

      <details style={{ marginTop: 10 }}>
        <summary className="small"><b>Structure du post</b> <span className="muted">· Hook, intro, angles, contradiction, conclusion</span></summary>
        <div style={{ marginTop: 8 }}>
          {parts.filter(([, t]) => t).map(([l, t], k) => (
            <div key={k} style={{ display: 'grid', gridTemplateColumns: 'minmax(84px, 22%) 1fr', gap: 10, padding: '7px 0', borderTop: k ? '1px solid var(--line)' : undefined }}>
              <b className="small" style={{ color: 'var(--copper-hi)' }}>{l}</b><span className="small">{t}</span>
            </div>
          ))}
        </div>
      </details>

      {g.searches.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary className="small"><b>À chercher pour se documenter</b> <span className="muted">· {g.searches.length} piste{g.searches.length > 1 ? 's' : ''}</span></summary>
          <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {g.searches.map((q) => <li key={q}>{q} <a href={searchLinks(q)[1].url} target="_blank" rel="noreferrer">Google ↗</a></li>)}
          </ul>
        </details>
      )}

      {err && <p className="small tag-hypothesis">{err}</p>}
      <div className="row wrap" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={!!busy} onClick={() => keep(true)}>Garder et développer</button>
        <button className="btn" disabled={!!busy} onClick={() => keep(false)}>Garder pour plus tard</button>
        <span className="tiny muted">Devient une fiche d’idée avec sa structure, ses formats et son estimation. Plusieurs idées gardées d’une même génération sont rangées ensemble : la première est l’idée principale, les autres ses variantes.</span>
      </div>
    </div>
  );
}
