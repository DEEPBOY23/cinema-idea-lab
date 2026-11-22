import { useMemo, useState } from 'react';
import { useIdeas, useWorks, useFormats, useSettings, go } from '../hooks';
import { STATUSES, type Status } from '../types';
import { IdeaRow } from '../components/pickers';
import { Empty } from '../components/ui';
import { createIdea } from '../lib/actions';
import { ageTone } from '../lib/aging';

type Sort = 'activity' | 'created' | 'priority' | 'age';

export default function Ideas() {
  const ideas = useIdeas();
  const works = useWorks();
  const formats = useFormats();
  const settings = useSettings();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<Status | 'active' | 'all'>('active');
  const [fmt, setFmt] = useState('');
  const [work, setWork] = useState('');
  const [diff, setDiff] = useState('');
  const [sort, setSort] = useState<Sort>('activity');

  const list = useMemo(() => {
    let l = ideas.filter((i) => {
      if (status === 'active' && (i.status === 'done' || i.status === 'published')) return false;
      if (status !== 'active' && status !== 'all' && i.status !== status) return false;
      if (fmt && i.formatId !== fmt) return false;
      if (work && !i.workIds.includes(work)) return false;
      if (diff && i.research?.level !== diff) return false;
      if (q && !(`${i.title} ${i.observation} ${i.angle} ${i.hook}`.toLowerCase().includes(q.toLowerCase()))) return false;
      return true;
    });
    l = [...l].sort((a, b) => {
      if (sort === 'created') return b.createdAt - a.createdAt;
      if (sort === 'priority') return a.priority - b.priority || b.lastActivityAt - a.lastActivityAt;
      if (sort === 'age') return a.lastActivityAt - b.lastActivityAt;
      return b.lastActivityAt - a.lastActivityAt;
    });
    return l;
  }, [ideas, q, status, fmt, work, diff, sort]);

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
      <div className="grid two" style={{ marginBottom: 12 }}>
        <input placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} />
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
          <option value="created">Tri : date de création</option>
          <option value="priority">Tri : priorité</option>
        </select>
      </div>
      {list.length ? (
        <ul className="list">{list.map((i) => <IdeaRow key={i.id} idea={i} works={works} formats={formats} settings={settings} />)}</ul>
      ) : <Empty>Aucune idée ne correspond. Capture une observation depuis l’accueil ou crée une idée.</Empty>}
      <p className="muted tiny" style={{ marginTop: 16 }}>
        Pastilles : <span className="age age-fresh"><i />0–{settings.thresholds[0]} j</span> · <span className="age age-amber"><i />–{settings.thresholds[1]} j</span> · <span className="age age-terracotta"><i />–{settings.thresholds[2]} j</span> · <span className="age age-bordeaux"><i />au-delà</span> · <span className="age age-done"><i />réalisée</span> · <span className="age age-published"><i />publiée</span> (seuils modifiables dans Paramètres).
      </p>
    </div>
  );
}
