import { useState } from 'react';
import { ideaStage, setFilmed } from '../lib/stage';
import type { Variant } from '../lib/create';
import { updateIdea } from '../lib/actions';
import { toast } from '../lib/toast';
import { useRef as useRefP } from 'react';

const GUIDE_NAMES = ['L’idée', 'Documentation', 'Angle', 'Structure', 'Script', 'Finaliser'];
/** Étape du guide (même calcul que la fiche). */
export function stepOf(i: Idea): number { if (i.finalizedAt) return 7; if (i.guideStep) return i.guideStep; const r = ['idea', 'documentation', 'angle', 'structure', 'script'].indexOf(i.status); return r <= 0 ? 1 : r === 1 ? 2 : r === 2 ? 4 : r === 3 ? 5 : 6; }
/** Une idée jamais retouchée depuis sa création (moins d'une minute d'écart). */
export const untouched = (i: Idea) => i.lastActivityAt - i.createdAt < 60_000 && !i.guideStep;
import type { Idea, Work, Format, Settings } from '../types';
import { statusLabel } from '../types';
import { createWork } from '../lib/actions';
import { AgeDot } from './ui';
import { ageTone } from '../lib/aging';
import { go } from '../hooks';
import { fmtDate } from '../lib/util';

const SEEN_LABEL = { seen: 'vu', partial: 'partiellement vu', unseen: 'à voir' } as const;

/** Sélection ou saisie d'une œuvre (film ou série). Une œuvre saisie est ajoutée à la filmothèque comme « à voir » : on ne suppose jamais qu'elle a été vue. */
export function WorkPicker({ works, selected, onChange, multiple = true }: {
  works: Work[]; selected: string[]; onChange: (ids: string[]) => void; multiple?: boolean;
}) {
  const [q, setQ] = useState('');
  const matches = q.trim() ? works.filter((w) => w.title.toLowerCase().includes(q.toLowerCase()) && !selected.includes(w.id)).slice(0, 6) : [];
  const exact = works.some((w) => w.title.toLowerCase() === q.trim().toLowerCase());
  const add = (id: string) => { onChange(multiple ? [...selected, id] : [id]); setQ(''); };
  return (
    <div>
      <div className="chips" style={{ marginBottom: selected.length ? 8 : 0 }}>
        {selected.map((id) => {
          const w = works.find((x) => x.id === id);
          if (!w) return null;
          return (
            <span key={id} className={`chip ${w.seen === 'seen' ? 'on' : ''}`}>
              <a href={`#/films/${w.id}`}>{w.title}{w.year ? ` (${w.year})` : ''}</a>
              <span className="tiny">· {SEEN_LABEL[w.seen]}</span>
              <button className="icon-btn" style={{ padding: 0 }} onClick={() => onChange(selected.filter((x) => x !== id))} aria-label="Retirer">✕</button>
            </span>
          );
        })}
      </div>
      {(multiple || !selected.length) && (
        <div style={{ position: 'relative' }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Film ou série (rechercher dans ta filmothèque ou saisir)" />
          {(matches.length > 0 || (q.trim() && !exact)) && (
            <div className="card" style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, marginTop: 4, padding: 6 }}>
              {matches.map((w) => (
                <button key={w.id} className="btn ghost sm" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => add(w.id)}>
                  {w.title}{w.year ? ` (${w.year})` : ''} <span className="muted tiny">· {SEEN_LABEL[w.seen]}</span>
                </button>
              ))}
              {q.trim() && !exact && (
                <button className="btn ghost sm" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={async () => add(await createWork({ title: q.trim(), seen: 'unseen' }))}>
                  + Ajouter « {q.trim()} » à la filmothèque (statut : à voir)
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function FormatSelect({ formats, value, onChange }: { formats: Format[]; value?: string; onChange: (id?: string) => void }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">— Aucun format —</option>
      {formats.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.minSec}–{f.maxSec} s)</option>)}
    </select>
  );
}

export function IdeaRow({ idea, works, formats, settings, variant }: { idea: Idea; works: Work[]; formats: Format[]; settings: Settings; variant?: Variant }) {
  const fmt = formats.find((f) => f.id === idea.formatId);
  const ws = works.filter((w) => idea.workIds.includes(w.id));
  const { tone } = ageTone(idea, settings.thresholds);
  const stage = ideaStage(idea);
  const step = stepOf(idea);
  const press = useRefP<number | null>(null);
  const longPressed = useRefP(false);
  const startPress = () => { longPressed.current = false; press.current = window.setTimeout(async () => { longPressed.current = true; await updateIdea(idea.id, { favorite: !idea.favorite }); toast(idea.favorite ? 'Idée désépinglée.' : 'Idée épinglée en haut de la bibliothèque.'); }, 550); };
  const endPress = () => { if (press.current) clearTimeout(press.current); press.current = null; };
  return (
    <li className={`edge-${tone} stage-${stage}${idea.paused ? ' is-later' : ''}${variant ? ' has-family' : ''}`} style={variant ? ({ '--family': variant.color } as React.CSSProperties) : undefined} onClick={() => { if (longPressed.current) { longPressed.current = false; return; } go(`ideas/${idea.id}`); }} onPointerDown={startPress} onPointerUp={endPress} onPointerLeave={endPress} onPointerCancel={endPress} onContextMenu={(e) => e.preventDefault()}>
      <div className="row between">
        <span className="item-title">{idea.favorite && <span title="Épinglée" style={{ marginRight: 6 }}>📌</span>}{idea.title}</span>
        <span className="row card-chips">
          {stage === 'ready' && <span className="chip stage-chip-ready"><i className="sdot sdot-ready" />à filmer{idea.scriptReviewed ? ' · script finalisé' : ''}</span>}
          {stage === 'filmed' && <span className="chip stage-chip-filmed"><i className="sdot sdot-filmed" />filmée</span>}
          {stage === 'ready' && <label className="chip" onClick={(e) => e.stopPropagation()} title="Cocher quand c’est filmé"><input type="checkbox" checked={false} onChange={() => setFilmed(idea, true)} style={{ marginRight: 4 }} />filmée</label>}
          {stage === 'cloud' && <span className="chip step-chip">{variant && untouched(idea) ? 'pas encore commencée' : `étape ${step}/6 · ${GUIDE_NAMES[step - 1]}`}</span>}
          {variant && <span className="chip family-chip" title="Idées issues de la même idée de départ"><i className="sdot" style={{ background: variant.color }} />variante {variant.n}/{variant.of}</span>}
          {idea.paused && <span className="chip later-chip"><i className="sdot sdot-later" />gardée pour plus tard</span>}
          {idea.priority === 1 && <span className="chip">priorité</span>}
        </span>
      </div>
      <div className="item-meta">
        {stage !== 'cloud' && <span>{statusLabel(idea.status)}</span>}
        {fmt && <span>{fmt.name}</span>}
        {ws.length > 0 && <span>{ws.map((w) => w.title).join(', ')}</span>}
        {idea.plannedWeek && <span>planifiée {idea.plannedWeek.replace('-W', ' · S')}</span>}
        <AgeDot idea={idea} settings={settings} />
        <span className="tiny">créée {fmtDate(idea.createdAt)}</span>
      </div>
    </li>
  );
}
