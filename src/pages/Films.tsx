import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useWorks, useIdeas, useFormats, useSettings, useSources, go } from '../hooks';
import type { Work, Seen } from '../types';
import { createWork, softDelete } from '../lib/actions';
import { Field, Empty } from '../components/ui';
import { IdeaRow } from '../components/pickers';

const SEEN: Record<Seen, string> = { seen: 'Vu', partial: 'Partiellement vu', unseen: 'À voir' };

export default function Films({ id }: { id?: string }) {
  if (id) return <FilmDetail id={id} />;
  return <FilmList />;
}

function FilmList() {
  const works = useWorks();
  const ideas = useIdeas();
  const [q, setQ] = useState('');
  const [seen, setSeen] = useState<Seen | ''>('');
  const [title, setTitle] = useState('');
  const list = works.filter((w) => (!seen || w.seen === seen) && `${w.title} ${w.director}`.toLowerCase().includes(q.toLowerCase()));
  const add = async () => { if (!title.trim()) return; const id = await createWork({ title: title.trim() }); setTitle(''); go(`films/${id}`); };
  return (
    <div>
      <div className="page-head">
        <div><h1>Filmothèque</h1><p className="muted small">{works.filter((w) => w.seen === 'seen').length} vus · {works.filter((w) => w.seen === 'partial').length} partiellement · {works.filter((w) => w.seen === 'unseen').length} à voir. Rien n’est considéré comme vu par défaut.</p></div>
      </div>
      <div className="row" style={{ marginBottom: 10 }}>
        <input placeholder="Ajouter un film ou une série" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn primary" onClick={add} disabled={!title.trim()}>Ajouter</button>
      </div>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <input placeholder="Rechercher" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} />
        <div className="seg">
          <button className={!seen ? 'on' : ''} onClick={() => setSeen('')}>Tous</button>
          {(Object.keys(SEEN) as Seen[]).map((s) => <button key={s} className={seen === s ? 'on' : ''} onClick={() => setSeen(s)}>{SEEN[s]}</button>)}
        </div>
      </div>
      {list.length ? (
        <ul className="list">
          {list.map((w) => {
            const n = ideas.filter((i) => i.workIds.includes(w.id)).length;
            return (
              <li key={w.id} onClick={() => go(`films/${w.id}`)}>
                <div className="row between"><span className="item-title">{w.title}{w.year ? <span className="muted"> ({w.year})</span> : null}</span><span className={`chip ${w.seen === 'seen' ? 'on' : ''}`}>{SEEN[w.seen]}</span></div>
                <div className="item-meta">{w.director && <span>{w.director}</span>}<span>{w.kind === 'serie' ? 'Série' : 'Film'}</span>{n > 0 && <span>{n} idée{n > 1 ? 's' : ''}</span>}{w.seenDate && <span>vu le {new Date(w.seenDate).toLocaleDateString('fr-FR')}</span>}</div>
              </li>
            );
          })}
        </ul>
      ) : <Empty>Ta filmothèque est vide. Ajoute les films et séries que tu as vus : les propositions s’appuieront dessus.</Empty>}
    </div>
  );
}

function FilmDetail({ id }: { id: string }) {
  const w = useLiveQuery(() => db.works.get(id), [id]);
  const ideas = useIdeas().filter((i) => i.workIds.includes(id));
  const sources = useSources().filter((s) => s.workIds.includes(id));
  const works = useWorks();
  const formats = useFormats();
  const settings = useSettings();
  if (w === undefined) return null;
  if (!w || w.deletedAt) return <Empty>Œuvre introuvable. <a href="#/films">Retour</a></Empty>;
  const up = (c: Partial<Work>) => db.works.update(id, { ...c, updatedAt: Date.now() });
  return (
    <div>
      <div className="row between"><a href="#/films" className="small">← Filmothèque</a>
        <button className="btn sm ghost danger" onClick={async () => { if (confirm('Mettre cette œuvre à la corbeille ?')) { await softDelete('works', id); go('films'); } }}>Corbeille</button></div>
      <Field table="works" id={id} field="title" value={w.title} className="title-field" />
      <div className="grid two" style={{ marginTop: 10 }}>
        <label className="field"><span className="field-label">Année</span><input type="number" value={w.year ?? ''} onChange={(e) => up({ year: e.target.value ? Number(e.target.value) : undefined })} /></label>
        <Field table="works" id={id} field="director" value={w.director} label="Réalisateur·rice / création" />
        <div><span className="field-label">Type</span><div className="seg"><button className={w.kind === 'film' ? 'on' : ''} onClick={() => up({ kind: 'film' })}>Film</button><button className={w.kind === 'serie' ? 'on' : ''} onClick={() => up({ kind: 'serie' })}>Série</button></div></div>
        <div><span className="field-label">Visionnage</span><div className="seg">{(Object.keys(SEEN) as Seen[]).map((s) => <button key={s} className={w.seen === s ? 'on' : ''} onClick={() => up({ seen: s })}>{SEEN[s]}</button>)}</div></div>
        <label className="field"><span className="field-label">Date de visionnage (facultatif)</span><input type="date" value={w.seenDate ?? ''} onChange={(e) => up({ seenDate: e.target.value || undefined })} /></label>
      </div>
      <Field table="works" id={id} field="notes" value={w.notes} label="Notes personnelles" multiline rows={4} versioned />
      <Field table="works" id={id} field="scenes" value={w.scenes} label="Scènes marquantes (avec minutage si possible)" multiline rows={4} versioned />
      <h2>Idées associées ({ideas.length})</h2>
      {ideas.length ? <ul className="list">{ideas.map((i) => <IdeaRow key={i.id} idea={i} works={works} formats={formats} settings={settings} />)}</ul> : <Empty>Aucune idée liée. Associe ce film à un format depuis « Les 8 formats ».</Empty>}
      {sources.length > 0 && (<><h2>Sources liées</h2><ul className="list compact">{sources.map((s) => <li key={s.id} onClick={() => go(`docs/source/${s.id}`)}><span>{s.title}</span></li>)}</ul></>)}
    </div>
  );
}
