import { useMemo, useState } from 'react';
import { useIdeas, useWorks, useFormats, useSettings, useEvents, useSessions, useSources, saveSettings } from '../hooks';
import { weekProgress, suggestIdeas, type Kind } from '../lib/planning';
import { isoWeek, shiftWeek, weekStart } from '../lib/util';
import { updateIdea } from '../lib/actions';
import { IdeaRow } from '../components/pickers';
import { Empty } from '../components/ui';
import { WeekBar } from './Home';

export default function Planning() {
  const ideas = useIdeas();
  const works = useWorks();
  const formats = useFormats();
  const settings = useSettings();
  const events = useEvents();
  const sessions = useSessions();
  const sources = useSources();
  const [week, setWeek] = useState(isoWeek(Date.now()));
  const [want, setWant] = useState<Kind | 'any'>('any');
  const wp = weekProgress(week, ideas, events, formats, settings);
  const start = weekStart(week);
  const end = new Date(start); end.setDate(end.getDate() + 6);

  const sourcesRead = useMemo(() => {
    const m: Record<string, { total: number; read: number }> = {};
    for (const s of sources) for (const i of s.ideaIds) { m[i] ??= { total: 0, read: 0 }; m[i].total++; if (s.state === 'read') m[i].read++; }
    return m;
  }, [sources]);
  const sugg = suggestIdeas(ideas, events, sessions, formats, sourcesRead, want).slice(0, 6);

  return (
    <div>
      <div className="page-head"><div><h1>Planning éditorial</h1><p className="muted small">Un cadre, pas une obligation. Les suggestions viennent uniquement de ta bibliothèque.</p></div></div>
      <div className="row between" style={{ marginBottom: 10 }}>
        <button className="btn sm" onClick={() => setWeek(shiftWeek(week, -1))}>←</button>
        <b>{start.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} – {end.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</b>
        <button className="btn sm" onClick={() => setWeek(shiftWeek(week, 1))}>→</button>
      </div>
      <div className="card">
        <WeekBar label="Analyse longue (60–90 s+)" n={wp.long.length} goal={settings.weeklyLong} />
        <WeekBar label="Analyses courtes (30–45 s)" n={wp.short.length} goal={settings.weeklyShort} />
        <p className="small muted" style={{ margin: '6px 0 0' }}>Contenus techniques : {wp.tech.length} (sans quota).</p>
        <details style={{ marginTop: 8 }}><summary className="small muted">Modifier les objectifs</summary>
          <div className="grid three" style={{ marginTop: 8 }}>
            <label className="small muted">Longues / semaine<input type="number" min={0} value={settings.weeklyLong} onChange={(e) => saveSettings({ weeklyLong: Number(e.target.value) })} /></label>
            <label className="small muted">Courtes / semaine<input type="number" min={0} value={settings.weeklyShort} onChange={(e) => saveSettings({ weeklyShort: Number(e.target.value) })} /></label>
            <label className="small muted">Compter à la
              <select value={settings.countOn} onChange={(e) => saveSettings({ countOn: e.target.value as 'done' | 'published' })}><option value="published">publication</option><option value="done">réalisation</option></select></label>
          </div>
          <p className="tiny muted">Long/court est déduit de la durée du format (≥ 60 s = long) ; « Contenu technique » se règle dans la fiche de l’idée.</p>
        </details>
      </div>

      <h2>Terminées cette semaine</h2>
      {[...wp.long, ...wp.short, ...wp.tech].length ? <ul className="list">{[...wp.long, ...wp.short, ...wp.tech].map((i) => <IdeaRow key={i.id} idea={i} works={works} formats={formats} settings={settings} />)}</ul> : <Empty>Rien de terminé sur cette semaine pour l’instant.</Empty>}

      <h2>Planifiées ({wp.planned.length})</h2>
      {wp.planned.length ? (
        <ul className="list">{wp.planned.map((i) => (
          <div key={i.id} style={{ position: 'relative' }}>
            <IdeaRow idea={i} works={works} formats={formats} settings={settings} />
            <button className="btn sm ghost" style={{ position: 'absolute', right: 8, top: 8 }} onClick={() => updateIdea(i.id, { plannedWeek: undefined })}>Retirer</button>
          </div>
        ))}</ul>
      ) : <Empty>Aucune idée planifiée pour cette semaine.</Empty>}

      <h2>Suggestions depuis ta bibliothèque</h2>
      <div className="seg" style={{ marginBottom: 10 }}>
        {([['any', 'Toutes'], ['long', 'Longues'], ['short', 'Courtes'], ['tech', 'Techniques']] as [Kind | 'any', string][]).map(([k, l]) => <button key={k} className={want === k ? 'on' : ''} onClick={() => setWant(k)}>{l}</button>)}
      </div>
      {sugg.length ? sugg.map(({ idea, reasons }) => (
        <div key={idea.id} className="card">
          <div className="row between"><a href={`#/ideas/${idea.id}`} className="item-title">{idea.title}</a>
            <button className="btn sm" onClick={() => updateIdea(idea.id, { plannedWeek: week })}>Planifier</button></div>
          <p className="small muted" style={{ margin: '4px 0 0' }}>{reasons.join(' · ') || 'Pas encore assez d’informations pour classer cette idée.'}</p>
        </div>
      )) : <Empty>Aucune idée disponible pour ce critère. L’app ne génère pas d’idées pour remplir le planning.</Empty>}
    </div>
  );
}
