import { useState } from 'react';
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

export function IdeaRow({ idea, works, formats, settings }: { idea: Idea; works: Work[]; formats: Format[]; settings: Settings }) {
  const fmt = formats.find((f) => f.id === idea.formatId);
  const ws = works.filter((w) => idea.workIds.includes(w.id));
  const { tone } = ageTone(idea, settings.thresholds);
  return (
    <li className={`edge-${tone}`} onClick={() => go(`ideas/${idea.id}`)}>
      <div className="row between">
        <span className="item-title">{idea.title}</span>
        {idea.priority === 1 && <span className="chip">priorité</span>}
      </div>
      <div className="item-meta">
        <span>{statusLabel(idea.status)}</span>
        {fmt && <span>{fmt.name}</span>}
        {ws.length > 0 && <span>{ws.map((w) => w.title).join(', ')}</span>}
        {idea.plannedWeek && <span>planifiée {idea.plannedWeek.replace('-W', ' · S')}</span>}
        <AgeDot idea={idea} settings={settings} />
        <span className="tiny">créée {fmtDate(idea.createdAt)}</span>
      </div>
    </li>
  );
}
