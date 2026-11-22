import { useState } from 'react';
import { db, uid } from '../db';
import { useFormats, useWorks, useSettings, useIdeas, useEvents, useSessions } from '../hooks';
import type { Idea, Suggestions, Format } from '../types';
import { FIT_LABELS, statusRank } from '../types';
import { suggestFormats, type Memory } from '../lib/assistant';
import { updateIdea, createIdea, addJournal } from '../lib/actions';
import { useAIProvider } from './ui';
import { providerLabel } from '../lib/ai';

export function useMemory(): Memory {
  return { formats: useFormats(), works: useWorks(), settings: useSettings(), ideas: useIdeas(), events: useEvents(), sessions: useSessions() };
}

export const ideaText = (i: Idea) =>
  [i.title, i.observation, i.angle && `Angle : ${i.angle}`, i.hook && `Hook : ${i.hook}`, i.script && `Script : ${i.script.slice(0, 3000)}`].filter(Boolean).join('\n');

/** Lance la proposition de formats et l'enregistre sur l'idée. */
export async function runSuggest(idea: Idea, memory: Memory): Promise<Suggestions> {
  const s = await suggestFormats(ideaText(idea), memory);
  await db.ideas.update(idea.id, { suggestions: s, updatedAt: Date.now() });
  return s;
}

/** Applique un format proposé à l'idée : format, angle (si vide), structure (si vide), estimation (si absente). */
export async function applyFormat(idea: Idea, formatId: string, formats: Format[], angle?: string, structureName?: string) {
  const f = formats.find((x) => x.id === formatId);
  const st = f?.structures.find((s) => s.name === structureName) ?? f?.structures[0];
  const est = idea.suggestions?.estimate;
  await updateIdea(idea.id, {
    formatId,
    angle: idea.angle || angle || '',
    structure: idea.structure.length || !st ? idea.structure : st.beats.map((b) => ({ id: uid(), label: b.label, seconds: b.seconds, content: '' })),
    research: idea.research ?? (est ? { level: est.level, justification: est.why, sourcesNeeded: '', missing: '', docHours: est.docHours, shootHours: est.shootHours, editHours: est.editHours } : undefined),
  });
  await addJournal(`Format choisi : ${f?.name ?? formatId}${angle ? ` — angle proposé : ${angle}` : ''}`, idea.id);
}

export function FormatSuggestionsPanel({ idea }: { idea: Idea }) {
  const memory = useMemory();
  const provider = useAIProvider();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const s = idea.suggestions;
  const run = async () => {
    setBusy(true); setErr('');
    try { await runSuggest(idea, memory); } catch (e: any) { setErr(e?.message ?? String(e)); }
    setBusy(false);
  };
  return (
    <div>
      <div className="row wrap between">
        <span className="small muted">{s ? `${s.source === 'ia' ? `Proposé par ${s.model ?? 'l’IA'}` : 'Suggestion simple (sans IA)'} · ${new Date(s.at).toLocaleDateString('fr-FR')}` : `Rattacher cette idée à un ou plusieurs de tes formats ${provider === 'none' ? '(règles simples : branche une IA dans Paramètres pour des propositions pertinentes)' : `avec ${providerLabel(provider)}`}.`}</span>
        <button className="btn sm primary" disabled={busy} onClick={run}>{busy ? 'Analyse…' : s ? 'Relancer' : 'Proposer des formats'}</button>
      </div>
      {err && <p className="small tag-hypothesis">{err}</p>}
      {s && s.formats.length === 0 && <p className="small muted" style={{ marginTop: 8 }}>Aucun format évident pour l’instant. Précise ton observation ou ton angle, puis relance.</p>}
      {s?.formats.map((fs, i) => {
        const f = memory.formats.find((x) => x.id === fs.formatId);
        if (!f) return null;
        const current = idea.formatId === fs.formatId;
        return (
          <div key={fs.formatId + i} className="card" style={{ marginTop: 8, borderColor: current ? 'var(--accent)' : undefined }}>
            <div className="row between wrap">
              <b>{f.name} <span className="muted small">· {f.minSec}–{f.maxSec} s</span></b>
              <span className={`chip ${fs.fit === 'high' ? 'on' : ''}`}>{FIT_LABELS[fs.fit]}</span>
            </div>
            <p className="small" style={{ margin: '6px 0' }}>{fs.reason}</p>
            {fs.angle && <p className="small"><span className="muted">Angle proposé :</span> {fs.angle}</p>}
            {fs.structureName && <p className="small muted">Structure conseillée : {fs.structureName}</p>}
            <div className="row wrap">
              {current ? <span className="small muted">Format actuel</span> : (
                <button className="btn sm" onClick={() => applyFormat(idea, fs.formatId, memory.formats, fs.angle, fs.structureName)}>Choisir ce format</button>
              )}
              {i > 0 || (idea.formatId && !current) ? (
                <button className="btn sm ghost" onClick={async () => {
                  const id = await createIdea({ title: `${idea.title} — ${f.name}`, observation: idea.observation, workIds: idea.workIds, suggestions: idea.suggestions });
                  const copy = await db.ideas.get(id);
                  if (copy) await applyFormat(copy, fs.formatId, memory.formats, fs.angle, fs.structureName);
                  await addJournal(`Variante créée dans le format ${f.name}.`, idea.id);
                }}>En faire une idée séparée</button>
              ) : null}
            </div>
          </div>
        );
      })}
      {s?.estimate && (
        <p className="small" style={{ marginTop: 10 }}>
          <b>Effort estimé : ≈ {s.estimate.totalHours} h</b> <span className="muted">(documentation {s.estimate.docHours} h · tournage {s.estimate.shootHours} h · montage {s.estimate.editHours} h)</span><br />
          <span className="muted">{s.estimate.why}</span>
        </p>
      )}
      {idea.status !== 'idea' && statusRank(idea.status) >= statusRank('structure') && <p className="tiny muted">Ton idée a déjà une structure validée : choisir un format ne la remplace pas.</p>}
    </div>
  );
}
