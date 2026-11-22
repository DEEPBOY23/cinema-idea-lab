import { useMemo, useState } from 'react';
import { useIdeas, useWorks, useFormats, useEvents, useSessions, useSources } from '../hooks';
import { computeDashboard, SEGMENTS } from '../lib/stats';
import { STATUSES, type Status } from '../types';
import { fmtDuration, fmtMinutes, DAY } from '../lib/util';
import { Empty } from '../components/ui';

export default function Stats() {
  const allIdeas = useIdeas();
  const works = useWorks();
  const formats = useFormats();
  const events = useEvents();
  const sessions = useSessions();
  const sources = useSources();
  const [f, setF] = useState({ work: '', format: '', period: '', diff: '', status: '' as Status | '', worked: '' });

  const ideas = useMemo(() => allIdeas.filter((i) => {
    if (f.work && !i.workIds.includes(f.work)) return false;
    if (f.format && i.formatId !== f.format) return false;
    if (f.period && i.createdAt < Date.now() - Number(f.period) * DAY) return false;
    if (f.diff && i.research?.level !== f.diff) return false;
    if (f.status && i.status !== f.status) return false;
    if (f.worked) {
      const h = sessions.filter((s) => s.ideaId === i.id).reduce((a, s) => a + s.minutes, 0) / 60;
      if (f.worked === 'lt2' && h >= 2) return false;
      if (f.worked === '2to6' && (h < 2 || h > 6)) return false;
      if (f.worked === 'gt6' && h <= 6) return false;
    }
    return true;
  }), [allIdeas, f, sessions]);

  const sourcesCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of sources) for (const i of s.ideaIds) m[i] = (m[i] ?? 0) + 1;
    return m;
  }, [sources]);
  const d = computeDashboard({ ideas, events, sessions, formats, sourcesCount });
  const totalWorked = d.rows.reduce((a, r) => a + r.worked, 0);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <div>
      <div className="page-head"><div><h1>Parcours et statistiques</h1><p className="muted small">Calculées localement, hors ligne. La rapidité ne dit rien de la qualité d’une vidéo.</p></div></div>
      <div className="grid three" style={{ marginBottom: 14 }}>
        <select value={f.work} onChange={set('work')}><option value="">Toutes les œuvres</option>{works.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}</select>
        <select value={f.format} onChange={set('format')}><option value="">Tous les formats</option>{formats.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <select value={f.period} onChange={set('period')}><option value="">Toute période</option><option value="30">Créées depuis 30 j</option><option value="90">Depuis 3 mois</option><option value="365">Depuis 1 an</option></select>
        <select value={f.diff} onChange={set('diff')}><option value="">Toute difficulté</option><option value="light">Légère</option><option value="moderate">Modérée</option><option value="deep">Approfondie</option></select>
        <select value={f.status} onChange={set('status')}><option value="">Tous statuts</option>{STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        <select value={f.worked} onChange={set('worked')}><option value="">Tout temps de production</option><option value="lt2">&lt; 2 h travaillées</option><option value="2to6">2–6 h</option><option value="gt6">&gt; 6 h</option></select>
      </div>

      <div className="kpis">
        <div className="kpi"><b>{ideas.length}</b><span>idées (filtrées)</span></div>
        <div className="kpi"><b>{d.doneCount}</b><span>réalisées</span></div>
        <div className="kpi"><b>{d.publishedCount}</b><span>publiées</span></div>
        <div className="kpi"><b>{fmtMinutes(totalWorked)}</b><span>temps travaillé saisi</span></div>
      </div>

      <h2>Délais calendaires</h2>
      <div className="table-wrap"><table className="t">
        <thead><tr><th>Étape</th><th>Moyenne</th><th>Médiane</th><th>n</th></tr></thead>
        <tbody>{SEGMENTS.map((s) => { const x = d.segmentStats[s.id]; return <tr key={s.id}><td>{s.label}</td><td>{fmtDuration(x.mean)}</td><td>{fmtDuration(x.median)}</td><td className="muted">{x.n}</td></tr>; })}</tbody>
      </table></div>
      <p className="tiny muted">Une étape sautée n’est pas comptée (pas de durée nulle artificielle). Les dates se corrigent dans chaque fiche.</p>

      <h2>Étapes qui ralentissent</h2>
      {d.bottlenecks.length ? (() => {
        const max = Math.max(...d.bottlenecks.map((b) => b.median ?? 0));
        return d.bottlenecks.map((b) => (
          <div key={b.status.id} className="bar-row"><span>{b.status.label}</span><div className="progress"><i style={{ width: `${((b.median ?? 0) / max) * 100}%` }} /></div><span className="muted">{fmtDuration(b.median)}</span></div>
        ));
      })() : <Empty>Pas encore assez d’historique.</Empty>}
      <p className="tiny muted">Médiane du temps passé dans chaque statut, retours en arrière inclus.</p>

      <div className="grid two">
        <div>
          <h2>Réalisées le plus rapidement</h2>
          {d.fastest.length ? <ol className="small">{d.fastest.map((r) => <li key={r.idea.id}><a href={`#/ideas/${r.idea.id}`}>{r.idea.title}</a> — {fmtDuration(r.seg.create_done)}{r.worked ? ` · ${fmtMinutes(r.worked)} travaillées` : ''}</li>)}</ol> : <Empty>Aucune idée réalisée.</Empty>}
        </div>
        <div>
          <h2>Le plus de documentation</h2>
          {d.mostDoc.length ? <ol className="small">{d.mostDoc.map((r) => <li key={r.idea.id}><a href={`#/ideas/${r.idea.id}`}>{r.idea.title}</a> — {r.docWorked ? fmtMinutes(r.docWorked) : '—'} · {r.sources} source(s)</li>)}</ol> : <Empty>Pas encore de données.</Empty>}
        </div>
        <div>
          <h2>Formats les plus rapides</h2>
          {d.byFormat.length ? <ol className="small">{d.byFormat.map((x) => <li key={x.format.id}>{x.format.name} — médiane {fmtDuration(x.median)} (n={x.n})</li>)}</ol> : <Empty>Pas encore de données.</Empty>}
        </div>
        <div>
          <h2>En attente depuis longtemps</h2>
          {d.waiting.length ? <ol className="small">{d.waiting.map((r) => <li key={r.idea.id}><a href={`#/ideas/${r.idea.id}`}>{r.idea.title}</a> — {Math.floor((Date.now() - r.idea.lastActivityAt) / DAY)} j sans activité</li>)}</ol> : <Empty>Aucune.</Empty>}
        </div>
      </div>

      <h2>Toutes les idées</h2>
      <div className="table-wrap"><table className="t">
        <thead><tr><th>Idée</th><th>Créa → doc</th><th>Doc → struct.</th><th>Struct. → réal.</th><th>Créa → réal.</th><th>Réal. → pub.</th><th>Travaillé</th></tr></thead>
        <tbody>{d.rows.map((r) => (
          <tr key={r.idea.id}><td><a href={`#/ideas/${r.idea.id}`}>{r.idea.title}</a></td>
            <td>{fmtDuration(r.seg.create_doc)}</td><td>{fmtDuration(r.seg.doc_struct)}</td><td>{fmtDuration(r.seg.struct_done)}</td><td>{fmtDuration(r.seg.create_done)}</td><td>{fmtDuration(r.seg.done_pub)}</td><td>{r.worked ? fmtMinutes(r.worked) : '—'}</td></tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}
