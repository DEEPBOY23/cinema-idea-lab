import { useState } from 'react';
import { db } from '../db';
import { useFormats, useWorks, useIdeas, useSettings, useSources, useNotes, go } from '../hooks';
import type { Format, CompatRating } from '../types';
import { COMPAT_LABELS } from '../types';
import { BUILTIN_FORMATS } from '../defaults';
import { saveFormat, createIdea, softDelete } from '../lib/actions';
import { WorkPicker, IdeaRow } from '../components/pickers';
import { Empty, Modal, PromptBox, Section } from '../components/ui';
import { buildPrompt } from '../lib/prompts';
import { uid } from '../lib/util';

export default function Formats({ id }: { id?: string }) {
  const formats = useFormats();
  const [editing, setEditing] = useState<Format | null>(null);
  if (id) {
    const f = formats.find((x) => x.id === id);
    if (!f) return <Empty>Format introuvable. <a href="#/formats">Retour</a></Empty>;
    return <FormatDetail f={f} onEdit={() => setEditing(f)} editing={editing} setEditing={setEditing} />;
  }
  return (
    <div>
      <div className="page-head">
        <div><h1>Les formats</h1><p className="muted small">Huit formats récurrents, modifiables, et tes formats personnels.</p></div>
        <button className="btn" onClick={() => setEditing({ id: uid(), name: 'Nouveau format', minSec: 30, maxSec: 60, promise: '', features: [], structures: [], themes: [], docLeads: [], docLoad: '', avLoad: '', custom: true, order: 100 + formats.length, updatedAt: 0 })}>+ Format personnel</button>
      </div>
      <ul className="list">
        {formats.map((f) => (
          <li key={f.id} onClick={() => go(`formats/${f.id}`)}>
            <div className="row between"><span className="item-title">{f.order <= 8 && !f.custom ? `${f.order}. ` : ''}{f.name}</span><span className="muted small">{f.minSec}–{f.maxSec} s</span></div>
            <p className="muted small" style={{ margin: '4px 0 0' }}>{f.promise}</p>
          </li>
        ))}
      </ul>
      <FormatEditor f={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function FormatDetail({ f, onEdit, editing, setEditing }: { f: Format; onEdit: () => void; editing: Format | null; setEditing: (f: Format | null) => void }) {
  const ideas = useIdeas().filter((i) => i.formatId === f.id);
  const works = useWorks();
  const settings = useSettings();
  const formats = useFormats();
  const [assoc, setAssoc] = useState(false);
  const isOverride = !f.custom && f.updatedAt > 0;
  return (
    <div>
      <a href="#/formats" className="small">← Formats</a>
      <div className="page-head" style={{ marginTop: 6 }}>
        <div><h1>{f.name}</h1><p className="muted">{f.minSec}–{f.maxSec} s · {f.custom ? 'format personnel' : isOverride ? 'format intégré (modifié)' : 'format intégré'}</p></div>
        <div className="row wrap">
          <button className="btn primary" onClick={() => setAssoc(true)}>Associer une œuvre</button>
          <button className="btn" onClick={onEdit}>Modifier</button>
        </div>
      </div>
      <p className="note">{f.promise}</p>
      <div className="grid two" style={{ marginTop: 12 }}>
        <div className="card"><h3>Caractéristiques</h3><ul className="small">{f.features.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        <div className="card"><h3>Charge indicative</h3><p className="small"><b>Documentaire :</b> {f.docLoad || '—'}</p><p className="small"><b>Audiovisuelle :</b> {f.avLoad || '—'}</p></div>
        <div className="card"><h3>Exemples de thématiques</h3><ul className="small">{f.themes.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        <div className="card"><h3>Pistes documentaires</h3><ul className="small">{f.docLeads.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
      </div>
      <Section title={`Structures narratives adaptables (${f.structures.length})`}>
        {f.structures.map((s) => (
          <div key={s.name} className="card">
            <h3>{s.name} <span className="muted small">· {s.beats.reduce((a, b) => a + b.seconds, 0)} s</span></h3>
            <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>{s.beats.map((b, i) => <li key={i}>{b.label} <span className="muted">({b.seconds} s)</span></li>)}</ol>
          </div>
        ))}
      </Section>
      <h2>Idées dans ce format ({ideas.length})</h2>
      {ideas.length ? <ul className="list">{ideas.map((i) => <IdeaRow key={i.id} idea={i} works={works} formats={formats} settings={settings} />)}</ul> : <Empty>Aucune idée pour l’instant.</Empty>}
      <AssociateModal open={assoc} onClose={() => setAssoc(false)} f={f} />
      <FormatEditor f={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

/** Associer une œuvre : on demande d'abord si tu as une observation, puis la compatibilité est évaluée (par toi, ou via Claude). */
function AssociateModal({ open, onClose, f }: { open: boolean; onClose: () => void; f: Format }) {
  const works = useWorks();
  const settings = useSettings();
  const sources = useSources();
  const notes = useNotes();
  const formats = useFormats();
  const [workIds, setWorkIds] = useState<string[]>([]);
  const [path, setPath] = useState<'none' | 'mine' | 'research'>('none');
  const [obs, setObs] = useState('');
  const [rating, setRating] = useState<CompatRating | ''>('');
  const [just, setJust] = useState('');
  const work = works.find((w) => w.id === workIds[0]);
  const reset = () => { setWorkIds([]); setPath('none'); setObs(''); setRating(''); setJust(''); onClose(); };
  const fakeIdea = work ? { id: 'tmp', title: `${f.name} — ${work.title}`, workIds, formatId: f.id, observation: obs, angle: '', hook: '', structure: [], status: 'idea', missingInfo: '' } as any : undefined;
  const create = async () => {
    const id = await createIdea({
      title: `${f.name} — ${work?.title ?? ''}`, workIds, formatId: f.id, observation: obs,
      compat: rating ? { rating, justification: just, at: Date.now() } : undefined,
      status: path === 'research' ? 'documentation' : 'idea',
    });
    reset();
    go(`ideas/${id}`);
  };
  return (
    <Modal open={open} onClose={reset} title={`Associer une œuvre · ${f.name}`}>
      <div className="stack">
        <WorkPicker works={works} selected={workIds} onChange={setWorkIds} multiple={false} />
        {work && path === 'none' && (
          <div className="card">
            <p><b>As-tu déjà une idée ou une observation sur cette œuvre, ou préfères-tu que je recherche des pistes intéressantes ?</b></p>
            <div className="row wrap">
              <button className="btn" onClick={() => setPath('mine')}>J’ai une observation</button>
              <button className="btn" onClick={() => setPath('research')}>Chercher des pistes</button>
            </div>
          </div>
        )}
        {work && work.seen !== 'seen' && <p className="note warn small">Tu n’as pas marqué « {work.title} » comme vu{work.seen === 'partial' ? ' en entier' : ''}. Mieux vaut le voir avant de développer un angle.</p>}
        {path === 'mine' && (
          <label className="field"><span className="field-label">Ton observation</span><textarea rows={3} value={obs} onChange={(e) => setObs(e.target.value)} /></label>
        )}
        {path !== 'none' && work && (
          <>
            <div className="card">
              <h3>Compatibilité œuvre / format</h3>
              <p className="muted small">L’app ne juge pas à ta place. Évalue toi-même, ou fais évaluer par Claude avec le prompt ci-dessous (il commence par des pistes documentaires, pas par un script).</p>
              <div className="chips" style={{ margin: '8px 0' }}>
                {(Object.keys(COMPAT_LABELS) as CompatRating[]).map((r) => <button key={r} className={`chip ${rating === r ? 'on' : ''}`} onClick={() => setRating(r)}>{COMPAT_LABELS[r]}</button>)}
              </div>
              <textarea rows={2} placeholder="Justification (sans forcer le rapprochement)" value={just} onChange={(e) => setJust(e.target.value)} />
            </div>
            <details open={path === 'research'}>
              <summary className="small">Prompt « compatibilité + pistes documentaires » pour Claude</summary>
              <PromptBox mode="compat" input={obs} prompt={buildPrompt('compat', { idea: fakeIdea, works, formats, sources, notes, settings }, obs)}
                importLabel="Enregistrer comme justification"
                onImport={(r) => {
                  setJust(r.slice(0, 2000));
                  const low = r.toLowerCase();
                  if (low.includes('très pertinente')) setRating('high');
                  else if (low.includes('sous certaines conditions')) setRating('conditional');
                  else if (low.includes('peu pertinente')) setRating('low');
                  else if (low.includes('informations insuffisantes')) setRating('insufficient');
                }} />
            </details>
            <button className="btn primary" onClick={create}>Créer l’idée {path === 'research' ? '(statut Documentation)' : ''}</button>
          </>
        )}
      </div>
    </Modal>
  );
}

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

function FormatEditor({ f, onClose }: { f: Format | null; onClose: () => void }) {
  const [d, setD] = useState<Format | null>(null);
  const cur = d && f && d.id === f.id ? d : f;
  if (!f || !cur) return null;
  const set = (c: Partial<Format>) => setD({ ...cur, ...c });
  const structText = cur.structures.map((s) => `# ${s.name}\n${s.beats.map((b) => `${b.label} | ${b.seconds}`).join('\n')}`).join('\n\n');
  const parseStruct = (t: string) => t.split(/\n(?=#)/).map((block) => {
    const [h, ...rest] = block.split('\n');
    return { name: h.replace(/^#\s*/, '').trim() || 'Structure', beats: rest.filter((l) => l.trim()).map((l) => { const [label, sec] = l.split('|'); return { label: label.trim(), seconds: Number(sec) || 8 }; }) };
  }).filter((s) => s.beats.length);
  const builtin = BUILTIN_FORMATS.find((b) => b.id === f.id);
  return (
    <Modal open={!!f} onClose={() => { setD(null); onClose(); }} title={`Modifier · ${cur.name}`}>
      <div className="stack">
        <label className="field"><span className="field-label">Nom</span><input value={cur.name} onChange={(e) => set({ name: e.target.value })} /></label>
        <div className="grid two">
          <label className="field"><span className="field-label">Durée min (s)</span><input type="number" value={cur.minSec} onChange={(e) => set({ minSec: Number(e.target.value) })} /></label>
          <label className="field"><span className="field-label">Durée max (s)</span><input type="number" value={cur.maxSec} onChange={(e) => set({ maxSec: Number(e.target.value) })} /></label>
        </div>
        <label className="field"><span className="field-label">Promesse éditoriale</span><textarea rows={2} value={cur.promise} onChange={(e) => set({ promise: e.target.value })} /></label>
        <label className="field"><span className="field-label">Caractéristiques (une par ligne)</span><textarea rows={3} defaultValue={cur.features.join('\n')} onBlur={(e) => set({ features: lines(e.target.value) })} /></label>
        <label className="field"><span className="field-label">Structures (« # Nom » puis « Étape | secondes »)</span><textarea rows={6} defaultValue={structText} onBlur={(e) => set({ structures: parseStruct(e.target.value) })} /></label>
        <label className="field"><span className="field-label">Thématiques (une par ligne)</span><textarea rows={3} defaultValue={cur.themes.join('\n')} onBlur={(e) => set({ themes: lines(e.target.value) })} /></label>
        <label className="field"><span className="field-label">Pistes documentaires (une par ligne)</span><textarea rows={3} defaultValue={cur.docLeads.join('\n')} onBlur={(e) => set({ docLeads: lines(e.target.value) })} /></label>
        <label className="field"><span className="field-label">Charge documentaire</span><input value={cur.docLoad} onChange={(e) => set({ docLoad: e.target.value })} /></label>
        <label className="field"><span className="field-label">Charge audiovisuelle</span><input value={cur.avLoad} onChange={(e) => set({ avLoad: e.target.value })} /></label>
        <div className="row wrap">
          <button className="btn primary" onClick={async () => { await saveFormat(cur); setD(null); onClose(); }}>Enregistrer</button>
          {builtin && f.updatedAt > 0 && <button className="btn ghost" onClick={async () => { if (confirm('Revenir à la version d’origine de ce format ?')) { await db.formats.delete(builtin.id); setD(null); onClose(); } }}>Rétablir l’original</button>}
          {cur.custom && <button className="btn ghost danger" onClick={async () => { if (confirm('Mettre ce format à la corbeille ?')) { await softDelete('formats', cur.id); setD(null); onClose(); go('formats'); } }}>Corbeille</button>}
        </div>
      </div>
    </Modal>
  );
}
