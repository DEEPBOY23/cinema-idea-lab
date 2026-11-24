import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid } from '../db';
import { go } from '../hooks';
import type { InboxItem, Idea } from '../types';
import { FIT_LABELS, statusRank } from '../types';
import { analyzeInbox, totalOf, titleOf } from '../lib/assistant';
import { createIdea, createWork } from '../lib/actions';
import { Dictate, Empty, useAIProvider } from '../components/ui';
import { useMemory, applyFormat, runSuggest } from '../components/assist';
import { providerLabel } from '../lib/ai';
import { DAY } from '../lib/util';

const LEVEL = { light: 'légère', moderate: 'modérée', deep: 'approfondie' } as const;

export default function Inbox() {
  const memory = useMemory();
  const provider = useAIProvider();
  const items = useLiveQuery(() => db.inbox.toArray(), []) ?? [];
  const [dump, setDump] = useState(() => { try { const d = localStorage.getItem('cil.inboxDraft') ?? ''; localStorage.removeItem('cil.inboxDraft'); return d; } catch { return ''; } });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const abort = useRef<AbortController | null>(null);

  const pending = useMemo(() => items.filter((i) => i.status === 'pending').sort((a, b) => totalOf(a.suggestions) - totalOf(b.suggestions)), [items]);
  const done = items.filter((i) => i.status !== 'pending').sort((a, b) => b.updatedAt - a.updatedAt);

  const analyze = async () => {
    setBusy(true); setErr('');
    abort.current = new AbortController();
    try {
      const drafts = await analyzeInbox(dump, memory, abort.current.signal);
      const batchId = uid(), now = Date.now();
      await db.inbox.bulkAdd(drafts.map((d) => ({ id: uid(), batchId, raw: d.raw, title: d.title || titleOf(d.raw), summary: d.summary, works: d.works, suggestions: d.suggestions, status: 'pending' as const, createdAt: now, updatedAt: now })));
      setDump('');
    } catch (e: any) {
      setErr(e?.name === 'AbortError' ? 'Analyse annulée. Ton texte est toujours là.' : `${e?.message ?? e} Ton texte est conservé : réessaie ou désactive l’IA pour un tri simple.`);
    }
    setBusy(false);
  };

  const convert = async (it: InboxItem) => {
    const workIds: string[] = [];
    for (const name of it.works) {
      const w = memory.works.find((x) => x.title.toLowerCase() === name.toLowerCase());
      workIds.push(w ? w.id : await createWork({ title: name, seen: 'unseen' }));
    }
    const id = await createIdea({ title: it.title, observation: it.raw, workIds, suggestions: it.suggestions });
    const top = it.suggestions?.formats[0];
    const idea = await db.ideas.get(id);
    if (idea && top && top.fit !== 'low') await applyFormat(idea, top.formatId, memory.formats, top.angle, top.structureName);
    await db.inbox.update(it.id, { status: 'converted', ideaId: id, updatedAt: Date.now() });
    return id;
  };

  return (
    <div>
      <div className="page-head">
        <div><h1>Bac à idées</h1><p className="muted small">Verse tout en vrac : idées, bouts de script, notes. {provider === 'none' ? 'Sans IA, l’app sépare par paragraphes et estime avec des règles simples.' : `${providerLabel(provider)} sépare chaque idée, la rattache à tes formats et estime le temps de réalisation.`}</p></div>
      </div>

      <div className="card">
        <div className="row between" style={{ marginBottom: 6 }}><span className="field-label" style={{ margin: 0 }}>Une idée par paragraphe, ou tout mélangé : l’analyse s’en charge</span><Dictate onText={(t) => setDump((x) => (x ? x + '\n\n' : '') + t)} /></div>
        <textarea rows={8} value={dump} onChange={(e) => setDump(e.target.value)} placeholder={'Ex.\nDans Her, la couleur corail suit Theodore…\n\nTester un 24 mm contre un 85 mm sur un visage…\n\nPourquoi Villeneuve filme le désert si vide ?'} />
        <div className="row wrap" style={{ marginTop: 8 }}>
          {busy ? <button className="btn" onClick={() => abort.current?.abort()}>Annuler l’analyse…</button>
            : <button className="btn primary" disabled={!dump.trim()} onClick={analyze}>Analyser et classer</button>}
          {provider === 'none' && <a className="small" href="#/settings">Brancher Gemini (gratuit) pour des propositions pertinentes →</a>}
        </div>
        {err && <p className="small tag-hypothesis" style={{ marginTop: 8 }}>{err}</p>}
      </div>

      <div className="row between wrap" style={{ marginTop: 20 }}>
        <h2 style={{ margin: 0 }}>À trier · du plus rapide au plus long ({pending.length})</h2>
        {pending.length > 1 && <button className="btn sm" onClick={async () => { for (const it of pending) await convert(it); }}>Tout transformer en idées</button>}
      </div>
      {pending.length ? pending.map((it, idx) => {
          const band = (h: number) => (h <= 3 ? '⚡ Rapide · 3 h ou moins' : h <= 8 ? '◐ Moyen · une journée' : h < 1e9 ? '◉ Long · plusieurs jours' : 'Non estimé');
          const b = band(totalOf(it.suggestions)), prev = idx ? band(totalOf(pending[idx - 1].suggestions)) : '';
          return <div key={it.id}>{b !== prev && <p className="field-label" style={{ margin: '14px 0 4px' }}>{b}</p>}<InboxCard it={it} rank={idx + 1} memory={memory} onConvert={async () => go(`ideas/${await convert(it)}`)} onConvertStay={() => convert(it)} /></div>;
        })
        : <Empty>Rien à trier. Verse des idées ci-dessus.</Empty>}

      <ExistingRanking />

      {done.length > 0 && (
        <details className="section" style={{ marginTop: 20 }}>
          <summary>Déjà traitées ({done.length})</summary>
          <div className="section-body">
            {done.map((it) => (
              <div key={it.id} className="row between" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                <span className="small">{it.title} <span className="muted">· {it.status === 'converted' ? 'transformée en idée' : 'ignorée'}</span></span>
                <span className="row">
                  {it.ideaId && <a className="btn sm ghost" href={`#/ideas/${it.ideaId}`}>Ouvrir</a>}
                  {it.status === 'dismissed' && <button className="btn sm ghost" onClick={() => db.inbox.update(it.id, { status: 'pending', updatedAt: Date.now() })}>Remettre</button>}
                  <button className="icon-btn" title="Supprimer de l’historique" onClick={() => db.inbox.delete(it.id)}>✕</button>
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function InboxCard({ it, rank, memory, onConvert, onConvertStay }: { it: InboxItem; rank: number; memory: ReturnType<typeof useMemory>; onConvert: () => void; onConvertStay: () => void }) {
  const e = it.suggestions?.estimate;
  return (
    <div className="card" style={{ marginTop: 10 }}>
      <div className="row" style={{ alignItems: 'center' }}>
        <span className="chip on">#{rank}</span>
        <input defaultValue={it.title} onBlur={(ev) => ev.target.value !== it.title && db.inbox.update(it.id, { title: ev.target.value, updatedAt: Date.now() })} style={{ fontWeight: 600, flex: 1, minWidth: 0 }} />
      </div>
      <div className="row wrap" style={{ margin: '8px 0 0', gap: 10, alignItems: 'baseline' }}>
        <b style={{ fontSize: '1.25rem' }}>{e ? `≈ ${e.totalHours} h` : 'non estimé'}</b>
        {e && <span className="tiny muted">documentation {e.docHours} h · tournage {e.shootHours} h · montage {e.editHours} h</span>}
      </div>
      {it.summary && <p className="small" style={{ margin: '6px 0 0' }}>{it.summary}</p>}
      {e && <p className="small muted" style={{ margin: '6px 0' }}>Recherche {LEVEL[e.level]} — {e.why}</p>}
      <div className="chips" style={{ margin: '6px 0' }}>
        {it.suggestions?.formats.map((f) => {
          const fmt = memory.formats.find((x) => x.id === f.formatId);
          return fmt ? <span key={f.formatId} className={`chip ${f.fit === 'high' ? 'on' : ''}`} title={`${f.reason}${f.angle ? `\nAngle : ${f.angle}` : ''}`}>{fmt.name} · {FIT_LABELS[f.fit]}</span> : null;
        })}
        {!it.suggestions?.formats.length && <span className="small muted">Aucun format évident</span>}
        {it.works.map((w) => <span key={w} className="chip">🎬 {w}</span>)}
      </div>
      {it.suggestions?.formats[0]?.angle && <p className="small"><span className="muted">Angle proposé :</span> {it.suggestions.formats[0].angle}</p>}
      <details><summary className="tiny muted">Texte d’origine</summary><p className="small" style={{ whiteSpace: 'pre-wrap' }}>{it.raw}</p></details>
      <div className="row wrap" style={{ marginTop: 8 }}>
        <button className="btn sm primary" onClick={onConvert}>Créer l’idée et l’ouvrir</button>
        <button className="btn sm" onClick={onConvertStay}>Créer l’idée</button>
        <button className="btn sm ghost" onClick={() => db.inbox.update(it.id, { status: 'dismissed', updatedAt: Date.now() })}>Ignorer</button>
      </div>
      <p className="tiny muted" style={{ margin: '6px 0 0' }}>{it.suggestions?.source === 'ia' ? `Estimation par ${it.suggestions.model}` : 'Estimation simple, sans IA'} · indicative, ajustable dans la fiche. Rapide ne veut pas dire meilleur.</p>
    </div>
  );
}

/** Classe aussi les idées déjà dans la bibliothèque, du plus rapide au plus long. */
function ExistingRanking() {
  const memory = useMemory();
  const [busy, setBusy] = useState(0);
  const active = memory.ideas.filter((i) => statusRank(i.status) < statusRank('done') && !i.paused);
  const hoursOf = (i: Idea) => {
    const r = i.research;
    if (r && (r.docHours || r.shootHours || r.editHours)) return (r.docHours || 0) + (r.shootHours || 0) + (r.editHours || 0);
    return i.suggestions?.estimate?.totalHours;
  };
  // Une idée déjà avancée demande moins de temps restant : on retire la part déjà faite (indicatif).
  const remaining = (i: Idea) => {
    const h = hoursOf(i);
    if (h === undefined) return undefined;
    const r = i.research ?? i.suggestions?.estimate;
    const doc = r?.docHours ?? 0;
    return statusRank(i.status) >= statusRank('angle') ? Math.max(0.5, h - doc) : h;
  };
  const ranked = [...active].sort((a, b) => (remaining(a) ?? 1e9) - (remaining(b) ?? 1e9));
  const missing = active.filter((i) => hoursOf(i) === undefined);
  if (!active.length) return null;
  return (
    <div style={{ marginTop: 28 }}>
      <div className="row between wrap">
        <h2 style={{ margin: 0 }}>Mes idées en cours · de la plus rapide à la plus longue</h2>
        {missing.length > 0 && (
          <button className="btn sm" disabled={busy > 0} onClick={async () => {
            for (let k = 0; k < missing.length; k++) { setBusy(k + 1); try { await runSuggest(missing[k], memory); } catch { /* on continue */ } }
            setBusy(0);
          }}>{busy ? `Estimation ${busy}/${missing.length}…` : `Estimer les ${missing.length} sans estimation`}</button>
        )}
      </div>
      <ul className="list" style={{ marginTop: 10 }}>
        {ranked.map((i, k) => {
          const rem = remaining(i);
          const age = Math.floor((Date.now() - i.lastActivityAt) / DAY);
          return (
            <li key={i.id} onClick={() => go(`ideas/${i.id}`)}>
              <div className="row between"><span className="item-title">{rem !== undefined ? `${k + 1}. ` : ''}{i.title}</span><b>{rem !== undefined ? `≈ ${rem} h` : '—'}</b></div>
              <div className="item-meta"><span>{memory.formats.find((f) => f.id === i.formatId)?.name ?? 'sans format'}</span><span>{age} j sans activité</span>{rem === undefined && <span>pas encore estimée</span>}</div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
