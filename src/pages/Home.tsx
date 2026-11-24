import { useState } from 'react';
import { useIdeas, useWorks, useFormats, useSettings, useSources, useEvents, useNotes, go } from '../hooks';
import { createIdea } from '../lib/actions';
import { Dictate, Empty, useAIProvider } from '../components/ui';
import { useMemory, runSuggest } from '../components/assist';
import { db } from '../db';
import { IdeaRow } from '../components/pickers';
import { weekProgress } from '../lib/planning';
import { isoWeek } from '../lib/util';
import { SOURCE_STATES } from '../types';
import { localToday, aiToday, type TodayAction } from '../lib/today';
import type { Source } from '../types';
import type { Memory } from '../lib/assistant';
import { useRef } from 'react';

export default function Home() {
  const ideas = useIdeas();
  const works = useWorks();
  const formats = useFormats();
  const settings = useSettings();
  const sources = useSources();
  const events = useEvents();
  const notes = useNotes();
  const [text, setText] = useState('');
  const provider = useAIProvider();
  const memory = useMemory();
  const [note, setNote] = useState('');
  const week = isoWeek(Date.now());
  const wp = weekProgress(week, ideas, events, formats, settings);

  const capture = async (open: boolean) => {
    const t = text.trim();
    if (!t) return;
    const id = await createIdea({ title: t.split(/[.\n]/)[0].slice(0, 70), observation: t });
    setText('');
    if (open) { go(`ideas/${id}`); return; } // la fiche lance elle-même la proposition de formats
    if (provider !== 'none') {
      setNote('Idée enregistrée. Recherche des formats adaptés…');
      const idea = await db.ideas.get(id);
      if (idea) runSuggest(idea, memory)
        .then((s) => setNote(s.formats.length ? `Idée enregistrée · format proposé : ${memory.formats.find((f) => f.id === s.formats[0].formatId)?.name ?? '?'}.` : 'Idée enregistrée · aucun format évident.'))
        .catch(() => setNote('Idée enregistrée (proposition de formats indisponible pour l’instant).'));
    } else setNote('Idée enregistrée.');
  };

  const inDoc = ideas.filter((i) => i.status === 'documentation').sort((a, b) => b.lastActivityAt - a.lastActivityAt).slice(0, 4);
  const reading = sources.filter((s) => s.state === 'reading' || s.state === 'deepen').sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4);
  const toDevelop = ideas.filter((i) => ['idea', 'angle'].includes(i.status) && !i.paused).sort((a, b) => a.priority - b.priority || b.lastActivityAt - a.lastActivityAt).slice(0, 5);
  const recentNotes = notes.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);

  return (
    <div>
      <h1>Bonjour.</h1>
      <p className="muted" style={{ marginBottom: 16 }}>Qu’as-tu observé aujourd’hui ?</p>

      <div className="card">
        <div className="row between" style={{ marginBottom: 6 }}><span className="field-label" style={{ margin: 0 }}>Capture rapide — une observation, un hook, une intuition</span><Dictate onText={(t) => setText((x) => (x ? x + ' ' : '') + t)} /></div>
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex. Dans ce film, la caméra ne quitte jamais la hauteur des yeux de l’enfant…" />
        <div className="row wrap" style={{ marginTop: 8 }}>
          <button className="btn primary" disabled={!text.trim()} onClick={() => capture(false)}>Enregistrer</button>
          <button className="btn" disabled={!text.trim()} onClick={() => capture(true)}>Enregistrer et développer</button>
          <span className="small" style={{ marginLeft: 'auto' }}><a href="#/creer">✦ Une phrase → plusieurs idées</a> · <a href="#/bac">Bac à idées</a></span>
        </div>
        {note && <p className="small muted" style={{ marginTop: 6 }}>{note} {note.includes('format proposé') && <a href="#/ideas">Voir</a>}</p>}
      </div>

      <TodayCard memory={memory} sources={sources} aiOn={provider !== 'none'} />

      <h2>Cette semaine <span className="muted small">({week.replace('-W', ' · semaine ')})</span></h2>
      <div className="card">
        <WeekBar label="Analyse longue" n={wp.long.length} goal={settings.weeklyLong} />
        <WeekBar label="Analyses courtes" n={wp.short.length} goal={settings.weeklyShort} />
        <p className="small muted" style={{ margin: '6px 0 0' }}>Contenus techniques : {wp.tech.length} (sans quota) · {wp.planned.length} idée(s) planifiée(s) · compté sur : {settings.countOn === 'published' ? 'publication' : 'réalisation'}. <a href="#/planning">Planning →</a></p>
      </div>

      <div className="grid two">
        <div>
          <h2>Recherches en cours</h2>
          {inDoc.length ? <ul className="list">{inDoc.map((i) => <IdeaRow key={i.id} idea={i} works={works} formats={formats} settings={settings} />)}</ul> : <Empty>Aucune idée en documentation.</Empty>}
        </div>
        <div>
          <h2>Reprendre une lecture</h2>
          {reading.length ? (
            <ul className="list">{reading.map((s) => (
              <li key={s.id} onClick={() => go(`docs/source/${s.id}`)}><div className="item-title">{s.title || s.url}</div><div className="item-meta"><span>{SOURCE_STATES[s.state]}</span>{s.media && <span>{s.media}</span>}{s.localFileId && <span>📎 hors ligne</span>}</div></li>
            ))}</ul>
          ) : <Empty>Aucune lecture en cours.</Empty>}
          {recentNotes.length > 0 && <p className="small" style={{ marginTop: 8 }}>Notes récentes : {recentNotes.map((n, i) => <span key={n.id}>{i ? ' · ' : ''}<a href={`#/docs/note/${n.id}`}>{n.title || 'Notes'}</a></span>)}</p>}
        </div>
      </div>

      <h2>Idées à développer</h2>
      {toDevelop.length ? <ul className="list">{toDevelop.map((i) => <IdeaRow key={i.id} idea={i} works={works} formats={formats} settings={settings} />)}</ul> : <Empty>Rien en attente. Capture une observation ci-dessus ou explore un format.</Empty>}
    </div>
  );
}

export function WeekBar({ label, n, goal }: { label: string; n: number; goal: number }) {
  const pct = goal ? Math.min(100, (n / goal) * 100) : 0;
  return (
    <div className="bar-row">
      <span>{label}</span>
      <div className="progress"><i style={{ width: `${pct}%` }} /></div>
      <span className="muted">{n} / {goal}</span>
    </div>
  );
}

const TIMES = [[15, '15 min'], [60, '1 h'], [120, '2 h'], [240, '½ journée']] as const;

function TodayCard({ memory, sources, aiOn }: { memory: Memory; sources: Source[]; aiOn: boolean }) {
  const [minutes, setMinutes] = useState<number>(() => { try { return Number(localStorage.getItem('cil.today.min')) || 60; } catch { return 60; } });
  const [ai, setAi] = useState<{ message: string; actions: TodayAction[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const abort = useRef<AbortController | null>(null);
  const local = localToday(minutes, memory.ideas, sources, memory.formats, memory.settings, memory.events);
  const actions = ai?.actions ?? local;
  const pick = (m: number) => { setMinutes(m); setAi(null); try { localStorage.setItem('cil.today.min', String(m)); } catch { /* */ } };
  const ask = async () => {
    setBusy(true); setErr('');
    abort.current = new AbortController();
    try { setAi(await aiToday(minutes, memory, sources, abort.current.signal)); }
    catch (e: any) { setErr(e?.name === 'AbortError' ? '' : (e?.message ?? String(e))); }
    setBusy(false);
  };
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="row between wrap">
        <h3 style={{ margin: 0 }}>Quoi faire aujourd’hui ?</h3>
        <div className="seg">{TIMES.map(([m, l]) => <button key={m} className={minutes === m ? 'on' : ''} onClick={() => pick(m)}>{l}</button>)}</div>
      </div>
      {ai?.message && <p className="small" style={{ margin: '8px 0 0' }}>{ai.message}</p>}
      {actions.length ? (
        <ul className="list" style={{ marginTop: 10 }}>
          {actions.map((a, i) => (
            <li key={i} onClick={() => go(a.sourceId ? `docs/source/${a.sourceId}` : a.ideaId ? `ideas/${a.ideaId}` : 'ideas')}>
              <div className="row between"><span className="item-title">{a.action}</span><span className="muted small">≈ {a.minutes >= 60 ? `${Math.round(a.minutes / 30) / 2} h` : `${a.minutes} min`}</span></div>
              <div className="item-meta"><span>{a.why}</span></div>
            </li>
          ))}
        </ul>
      ) : <p className="small muted" style={{ marginTop: 8 }}>Rien d’urgent. Verse de nouvelles idées dans le <a href="#/bac">Bac à idées</a> ou explore un format.</p>}
      <div className="row wrap" style={{ marginTop: 8 }}>
        {aiOn && (busy ? <button className="btn sm" onClick={() => abort.current?.abort()}>L’assistant réfléchit… (annuler)</button>
          : <button className="btn sm primary" onClick={ask}>✦ {ai ? 'Redemander' : 'Demander à l’assistant'}</button>)}
        {ai && <button className="btn sm ghost" onClick={() => setAi(null)}>Revenir aux suggestions simples</button>}
        <span className="tiny muted">{ai ? 'Proposé par l’assistant parmi tes idées.' : 'Suggestions simples : ce qui est le plus proche d’être publié, puis tes lectures en cours.'}</span>
      </div>
      {err && <p className="small tag-hypothesis">{err}</p>}
    </div>
  );
}
