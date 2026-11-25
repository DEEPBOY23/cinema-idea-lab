import { useMemo, useState } from 'react';
import { useIdeas, useWorks, useFormats, useSettings, useSources, go } from '../hooks';
import { IdeaBoard } from '../components/ideaCards';
import { STATUSES, type Status } from '../types';
import { IdeaRow } from '../components/pickers';
import { Empty } from '../components/ui';
import { createIdea } from '../lib/actions';
import { ageTone } from '../lib/aging';
import { variantFamilies } from '../lib/create';
import { ideaStage, STAGE_LABEL, type Stage } from '../lib/stage';

type Sort = 'activity' | 'created' | 'num' | 'priority' | 'age';

export default function Ideas() {
  const ideas = useIdeas();
  const works = useWorks();
  const formats = useFormats();
  const settings = useSettings();
  const sources = useSources();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<Status | 'active' | 'all'>('active');
  const [fmt, setFmt] = useState('');
  const [work, setWork] = useState('');
  const [diff, setDiff] = useState('');
  const [sort, setSort] = useState<Sort>('activity');
  const [stage, setStage] = useState<Stage>(() => { try { return (sessionStorage.getItem('cil.ideas.stage') as Stage) || 'cloud'; } catch { return 'cloud'; } });
  const pickStage = (s: Stage) => { setStage(s); try { sessionStorage.setItem('cil.ideas.stage', s); } catch { /* */ } };
  const stageCount = useMemo(() => { const c: Record<Stage, number> = { cloud: 0, ready: 0, filmed: 0 }; for (const i of ideas) c[ideaStage(i)]++; return c; }, [ideas]);

  const list = useMemo(() => {
    let l = ideas.filter((i) => {
      if (ideaStage(i) !== stage) return false;
      if (stage === 'cloud' && status === 'active' && (i.status === 'done' || i.status === 'published')) return false;
      if (status !== 'active' && status !== 'all' && i.status !== status) return false;
      if (fmt && i.formatId !== fmt) return false;
      if (work && !i.workIds.includes(work)) return false;
      if (diff && i.research?.level !== diff) return false;
      if (q && !(`${i.title} ${i.observation} ${i.angle} ${i.hook}`.toLowerCase().includes(q.toLowerCase()))) return false;
      return true;
    });
    l = [...l].sort((a, b) => {
      if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
      if (sort === 'created') return b.createdAt - a.createdAt;
      if (sort === 'num') return a.createdAt - b.createdAt;
      if (sort === 'priority') return a.priority - b.priority || b.lastActivityAt - a.lastActivityAt;
      if (sort === 'age') return a.lastActivityAt - b.lastActivityAt;
      return b.lastActivityAt - a.lastActivityAt;
    });
    return l;
  }, [ideas, q, status, fmt, work, diff, sort, stage]);

  const families = useMemo(() => variantFamilies(ideas), [ideas]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of ideas) { const t = ageTone(i, settings.thresholds).tone; c[t] = (c[t] ?? 0) + 1; }
    return c;
  }, [ideas, settings.thresholds]);

  return (
    <div>
      <div className="page-head">
        <div><h1>Bibliothèque d’idées</h1><p className="muted small">{ideas.length} idée{ideas.length > 1 ? 's' : ''} · {counts.bordeaux ?? 0} endormie{(counts.bordeaux ?? 0) > 1 ? 's' : ''} · {(counts.done ?? 0) + (counts.published ?? 0)} terminée{((counts.done ?? 0) + (counts.published ?? 0)) > 1 ? 's' : ''}</p></div>
        <button className="btn primary" onClick={async () => go(`ideas/${await createIdea({})}`)}>+ Nouvelle idée</button>
      </div>
      <div className="seg stage-tabs" style={{ marginBottom: 12 }}>
        {(Object.keys(STAGE_LABEL) as Stage[]).map((k) => <button key={k} className={stage === k ? 'on' : ''} onClick={() => pickStage(k)}><i className={`sdot sdot-${k}`} />{STAGE_LABEL[k]} ({stageCount[k]})</button>)}
      </div>
      <p className="tiny muted" style={{ margin: '-4px 0 12px' }}>{stage === 'cloud' ? 'Une carte par idée ; ses variantes sont dans le tiroir. Appui long sur une carte : importance, idée principale, épingler.' : stage === 'ready' ? 'Finalisées, avec leur fiche récap. Coche « filmée » quand c’est tourné.' : 'Tournées, réalisées ou publiées.'}</p>
      <input placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }} />
      <details className="filters"><summary>Filtres et tri{(fmt || work || diff || status !== 'active' || sort !== 'activity') ? ' · actifs' : ''}</summary>
      <div className="grid two" style={{ margin: '8px 0 12px' }}>
        <select value={status} onChange={(e) => setStatus(e.target.value as any)}>
          <option value="active">Idées actives</option>
          <option value="all">Toutes</option>
          {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select value={fmt} onChange={(e) => setFmt(e.target.value)}>
          <option value="">Tous les formats</option>
          {formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <select value={work} onChange={(e) => setWork(e.target.value)}>
          <option value="">Toutes les œuvres</option>
          {works.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}
        </select>
        <select value={diff} onChange={(e) => setDiff(e.target.value)}>
          <option value="">Toute difficulté documentaire</option>
          <option value="light">Recherche légère</option>
          <option value="moderate">Recherche modérée</option>
          <option value="deep">Recherche approfondie</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="activity">Tri : activité récente</option>
          <option value="age">Tri : les plus anciennes d’abord</option>
          <option value="created">Tri : date de création (récentes d’abord)</option>
          <option value="num">Tri : numéro (#1 d’abord)</option>
          <option value="priority">Tri : priorité</option>
        </select>
      </div></details>
      {list.length ? (
        <IdeaBoard list={list} all={ideas} formats={formats} sources={sources} />
      ) : <Empty>Aucune idée ne correspond. Capture une observation depuis l’accueil ou crée une idée.</Empty>}
      <p className="legend tiny muted" style={{ marginTop: 16 }}>
        <span><i style={{ background: '#e08a52' }} />À tourner</span><span><i style={{ background: '#6e9fd0' }} />À finir / à filmer</span><span><i style={{ background: '#a487d6' }} />Plus tard</span>
        <span><i style={{ background: '#5aa8a0' }} />À peine commencée</span><span><i style={{ background: '#d9b24f' }} />En partie</span><span><i style={{ background: '#84b86c' }} />Bien avancée / filmée</span>
      </p>
    </div>
  );
}
