import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid } from '../db';
import { useWorks, useFormats, useSettings, useSources, useNotes, go } from '../hooks';
import type { Idea, Status, ResearchLevelId, Beat, Phase, Work } from '../types';
import { STATUSES, statusRank, statusLabel, COMPAT_LABELS, SOURCE_STATES, ACCESS_LABELS } from '../types';
import { Field, AgeDot, Section, VersionsPanel, Stars, Empty, PromptBox, Modal } from '../components/ui';
import { WorkPicker, FormatSelect } from '../components/pickers';
import { updateIdea, setStatus, softDelete, snapshot, addJournal, createNote, touchIdea } from '../lib/actions';
import { milestones, segmentDurations, SEGMENTS, workedMinutes } from '../lib/stats';
import { fmtDateTime, fmtDuration, fmtMinutes, toLocalInput, fromLocalInput, isoWeek, fmtDate } from '../lib/util';
import { oralSeconds, wordCount } from '../lib/text';
import { buildPrompt } from '../lib/prompts';
import { FormatSuggestionsPanel, useMemory, runSuggest } from '../components/assist';
import { useAIProvider } from '../components/ui';
import { useRef } from 'react';

const LEVELS: { id: ResearchLevelId; label: string; hint: string }[] = [
  { id: 'light', label: 'Légère', hint: 'Une scène ou une technique précise, simple à documenter.' },
  { id: 'moderate', label: 'Modérée', hint: 'Plusieurs scènes, sources complémentaires ou comparaisons.' },
  { id: 'deep', label: 'Approfondie', hint: 'Interviews, making-of, analyses historiques ou comparaison complexe.' },
];

/** Suggestion locale et transparente du niveau de recherche (à ajuster, ce n'est pas une IA). */
function suggestLevel(idea: Idea, docLoad?: string): { level: ResearchLevelId; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (docLoad) {
    const d = docLoad.toLowerCase();
    if (d.startsWith('approfondie')) { score += 2; reasons.push('le format demande des intentions sourcées'); }
    else if (d.startsWith('modérée')) { score += 1; reasons.push('le format demande une preuve documentaire'); }
    else reasons.push('le format est plutôt léger en documentation');
  }
  if (idea.workIds.length > 1) { score += 1; reasons.push(`${idea.workIds.length} œuvres à comparer`); }
  if (/interview|making|histor|tournage|intention|pourquoi/i.test(idea.observation + idea.angle)) { score += 1; reasons.push('l’angle porte sur des intentions ou le tournage'); }
  return { level: score >= 3 ? 'deep' : score >= 1 ? 'moderate' : 'light', reasons };
}

export default function IdeaDetail({ id }: { id: string }) {
  const idea = useLiveQuery(() => db.ideas.get(id), [id]);
  const works = useWorks();
  const formats = useFormats();
  const settings = useSettings();
  const sources = useSources();
  const notes = useNotes();
  const events = useLiveQuery(() => db.events.where('ideaId').equals(id).sortBy('at'), [id]) ?? [];
  const sessions = (useLiveQuery(() => db.sessions.where('ideaId').equals(id).sortBy('start'), [id]) ?? []).filter((s) => !s.deletedAt);
  const journal = useLiveQuery(() => db.journal.where('ideaId').equals(id).reverse().sortBy('at'), [id]) ?? [];
  const workshops = useLiveQuery(() => db.workshops.where('ideaId').equals(id).reverse().sortBy('createdAt'), [id]) ?? [];
  const [linkOpen, setLinkOpen] = useState(false);
  const provider = useAIProvider();
  const memory = useMemory();
  const autoRan = useRef(false);
  // Fluide : avec une IA branchée, une idée sans proposition reçoit automatiquement ses formats.
  useEffect(() => {
    if (autoRan.current || !idea || idea.deletedAt || idea.suggestions || provider === 'none') return;
    if ((idea.observation + idea.script + idea.angle).trim().length < 15) return;
    autoRan.current = true;
    runSuggest(idea, memory).catch(() => { /* l'utilisateur peut relancer à la main */ });
  }, [idea?.id, idea?.suggestions, provider]);

  if (idea === undefined) return <p className="muted">Chargement…</p>;
  if (!idea) return <Empty>Idée introuvable.</Empty>;
  if (idea.deletedAt) return <Empty>Cette idée est dans la corbeille. <a href="#/settings">Restaurer depuis Paramètres</a>.</Empty>;

  const fmt = formats.find((f) => f.id === idea.formatId);
  const iWorks = works.filter((w) => idea.workIds.includes(w.id));
  const iSources = sources.filter((s) => s.ideaIds.includes(id));
  const iNotes = notes.filter((n) => n.ideaId === id);
  const m = milestones(idea, events);
  const seg = segmentDurations(m);
  const totalSec = idea.structure.reduce((a, b) => a + (Number(b.seconds) || 0), 0);
  const target = idea.targetSeconds ?? (fmt ? Math.round((fmt.minSec + fmt.maxSec) / 2) : undefined);
  const up = (c: Partial<Idea>) => updateIdea(id, c);
  const ctx = { idea, works, formats, sources, notes, settings };

  const setBeats = (beats: Beat[]) => up({ structure: beats });

  return (
    <div>
      <div className="row between wrap" style={{ marginBottom: 6 }}>
        <a href="#/ideas" className="small">← Idées</a>
        <div className="row">
          <a className="btn sm" href={`#/atelier?idea=${id}`}>Ouvrir dans l’atelier</a>
          <button className="btn sm ghost danger" onClick={async () => { if (confirm('Mettre cette idée à la corbeille ? (récupérable depuis Paramètres)')) { await softDelete('ideas', id); go('ideas'); } }}>Corbeille</button>
        </div>
      </div>
      <Field table="ideas" id={id} field="title" value={idea.title} className="title-field" placeholder="Titre de l’idée" />
      <div className="row wrap" style={{ margin: '10px 0' }}>
        <AgeDot idea={idea} settings={settings} />
        <span className="muted tiny">Dernière activité {fmtDateTime(idea.lastActivityAt)}</span>
        <span className="spacer" />
        <label className="row small muted"><input type="checkbox" checked={idea.paused} onChange={(e) => up({ paused: e.target.checked })} /> En pause</label>
      </div>

      <div className="stepper" role="group" aria-label="Statut">
        {STATUSES.map((s) => (
          <button key={s.id} className={idea.status === s.id ? 'cur' : statusRank(s.id) < statusRank(idea.status) ? 'past' : ''} onClick={() => setStatus(idea, s.id)}>{s.label}</button>
        ))}
      </div>
      <p className="muted tiny">Étapes flexibles : tu peux sauter une étape ou revenir en arrière, chaque transition est historisée.</p>

      <Section title={`Formats proposés${idea.suggestions?.formats.length ? ` (${idea.suggestions.formats.length})` : ''}`} open={!idea.formatId || !!idea.suggestions}>
        <FormatSuggestionsPanel idea={idea} />
      </Section>

      <Section title="Fiche">
        <div className="grid two">
          <div><span className="field-label">Œuvre(s)</span><WorkPicker works={works} selected={idea.workIds} onChange={(ids) => up({ workIds: ids })} /></div>
          <div>
            <span className="field-label">Format</span>
            <FormatSelect formats={formats} value={idea.formatId} onChange={(f) => up({ formatId: f })} />
            <div className="row wrap" style={{ marginTop: 8 }}>
              <div className="seg">
                <button className={idea.category === 'analyse' ? 'on' : ''} onClick={() => up({ category: 'analyse' })}>Analyse</button>
                <button className={idea.category === 'technique' ? 'on' : ''} onClick={() => up({ category: 'technique' })}>Contenu technique</button>
              </div>
            </div>
          </div>
        </div>
        <div className="grid two" style={{ marginTop: 10 }}>
          <div><span className="field-label">Priorité</span><Stars value={idea.priority} onChange={(n) => up({ priority: n as 1 | 2 | 3 })} labels={['Haute', 'Normale', 'Basse']} /></div>
          <div><span className="field-label">Difficulté audiovisuelle</span><Stars value={idea.avDifficulty} onChange={(n) => up({ avDifficulty: n as 1 | 2 | 3 })} labels={['Simple', 'Moyenne', 'Lourde']} /></div>
        </div>
        <Field table="ideas" id={id} field="observation" value={idea.observation} label="Observation / intuition de départ" multiline rows={3} versioned />
        <Field table="ideas" id={id} field="angle" value={idea.angle} label="Angle" multiline rows={2} versioned onSaved={(v) => v && addJournal(`Angle modifié : ${v.slice(0, 120)}`, id)} />
        <Field table="ideas" id={id} field="hook" value={idea.hook} label="Hook" multiline rows={2} versioned />
        {idea.compat && (
          <p className="note small" style={{ marginTop: 10 }}><b>Compatibilité œuvre/format : {COMPAT_LABELS[idea.compat.rating]}</b><br />{idea.compat.justification}</p>
        )}
      </Section>

      <Section title={`Angles envisagés (${idea.angles.length})`} open={idea.angles.length > 0}>
        <AnglesEditor idea={idea} />
      </Section>

      <Section title="Niveau de recherche documentaire" open={!!idea.research}>
        <ResearchPanel idea={idea} docLoad={fmt?.docLoad} />
      </Section>

      <Section title={`Structure narrative${idea.structure.length ? ` · ${totalSec} s` : ''}`} open={idea.structure.length > 0}>
        <StructureEditor idea={idea} beats={idea.structure} setBeats={setBeats} fmt={fmt} target={target} total={totalSec} />
      </Section>

      <Section title="Script (facultatif)" open={!!idea.script}>
        <Field table="ideas" id={id} field="script" value={idea.script} multiline rows={10} versioned placeholder="Le script reste facultatif. Tu peux aussi le coller dans l’atelier pour un diagnostic." />
        <p className="muted small" style={{ marginTop: 6 }}>{wordCount(idea.script)} mots · ≈ {oralSeconds(idea.script, settings.wpm)} s à l’oral ({settings.wpm} mots/min){target ? ` · cible ${target} s` : ''}</p>
        <details><summary className="small muted">Versions antérieures du script</summary>
          <VersionsPanel entityId={id} field="script" current={idea.script} onRestore={async (v) => { await snapshot('ideas', id, 'script', idea.script, 'restore'); await up({ script: v }); }} />
        </details>
      </Section>

      <Section title="Références : œuvres vues ?" open={iWorks.some((w) => w.seen !== 'seen')}>
        <ReferenceCheck idea={idea} iWorks={iWorks} allWorks={works} ctx={ctx} />
      </Section>

      <Section title={`Sources (${iSources.length}) et notes de lecture (${iNotes.length})`} right={<button className="btn sm" onClick={() => setLinkOpen(true)}>Lier</button>}>
        {iSources.length ? (
          <ul className="list compact">
            {iSources.map((s) => (
              <li key={s.id} onClick={() => go(`docs/source/${s.id}`)}><span>{s.title || s.url}</span><span className="muted small">{SOURCE_STATES[s.state]} · {ACCESS_LABELS[s.access]}</span></li>
            ))}
          </ul>
        ) : <p className="muted small">Aucune source liée. La documentation passe avant l’écriture.</p>}
        <div className="row wrap" style={{ marginTop: 8 }}>
          <a className="btn sm" href={`#/docs?new=1&idea=${id}`}>+ Ajouter une source</a>
          <button className="btn sm" onClick={async () => go(`docs/note/${await createNote({ ideaId: id, title: `Notes — ${idea.title}` })}`)}>+ Notes après lecture</button>
          <a className="btn sm ghost" href={`#/docs?idea=${id}&tab=search`}>Préparer une recherche</a>
        </div>
        {iNotes.length > 0 && (
          <ul className="list compact" style={{ marginTop: 10 }}>
            {iNotes.map((n) => <li key={n.id} onClick={() => go(`docs/note/${n.id}`)}><span>{n.title || 'Notes sans titre'}</span><span className="muted small">{fmtDate(n.updatedAt)}</span></li>)}
          </ul>
        )}
      </Section>

      <Section title="Parcours et dates" open={false}>
        <Timeline idea={idea} events={events} />
        <h3 style={{ marginTop: 14 }}>Durées (calendaires)</h3>
        <table className="t"><tbody>
          {SEGMENTS.map((s) => <tr key={s.id}><td>{s.label}</td><td>{fmtDuration(seg[s.id])}</td></tr>)}
        </tbody></table>
      </Section>

      <Section title={`Temps réellement travaillé · ${fmtMinutes(workedMinutes(id, sessions))}`} open={false}>
        <TimeTracker ideaId={id} sessions={sessions} />
      </Section>

      <Section title={`Commentaires et changements d’orientation`} open={false}>
        <Comments idea={idea} />
        {journal.length > 0 && (
          <>
            <h3 style={{ marginTop: 14 }}>Journal</h3>
            <ul className="timeline">{journal.map((j) => <li key={j.id}><span className="muted tiny">{fmtDateTime(j.at)}</span><br />{j.text}</li>)}</ul>
          </>
        )}
        <JournalAdd ideaId={id} />
      </Section>

      {workshops.length > 0 && (
        <Section title={`Historique de l’atelier (${workshops.length})`} open={false}>
          {workshops.map((w) => (
            <details key={w.id} className="card"><summary className="small">{fmtDateTime(w.createdAt)} · {w.mode}</summary><pre className="prompt">{w.response}</pre></details>
          ))}
        </Section>
      )}

      <LinkSourcesModal open={linkOpen} onClose={() => setLinkOpen(false)} ideaId={id} />
    </div>
  );
}

function AnglesEditor({ idea }: { idea: Idea }) {
  const [t, setT] = useState('');
  const save = (angles: Idea['angles']) => updateIdea(idea.id, { angles });
  return (
    <div>
      {idea.angles.map((a, i) => (
        <div key={a.id} className="row" style={{ alignItems: 'flex-start', marginBottom: 6 }}>
          <input type="checkbox" checked={a.chosen} onChange={(e) => save(idea.angles.map((x, j) => (j === i ? { ...x, chosen: e.target.checked } : x)))} title="Retenir (tu peux en combiner plusieurs)" style={{ marginTop: 10 }} />
          <textarea rows={2} value={a.text} onChange={(e) => save(idea.angles.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
          <span className="chip tiny">{a.origin}</span>
          <button className="icon-btn" onClick={() => save(idea.angles.filter((_, j) => j !== i))} aria-label="Supprimer">✕</button>
        </div>
      ))}
      <div className="row">
        <input value={t} onChange={(e) => setT(e.target.value)} placeholder="Ajouter un angle" onKeyDown={(e) => { if (e.key === 'Enter' && t.trim()) { save([...idea.angles, { id: uid(), text: t.trim(), chosen: false, origin: 'moi' }]); setT(''); } }} />
        <button className="btn sm" disabled={!t.trim()} onClick={() => { save([...idea.angles, { id: uid(), text: t.trim(), chosen: false, origin: 'moi' }]); setT(''); }}>Ajouter</button>
      </div>
      {idea.angles.some((a) => a.chosen) && (
        <button className="btn sm" style={{ marginTop: 8 }} onClick={async () => {
          const chosen = idea.angles.filter((a) => a.chosen).map((a) => a.text).join(' + ');
          await updateIdea(idea.id, { angle: chosen });
          await addJournal(`Angle choisi : ${chosen.slice(0, 160)}`, idea.id);
          if (statusRank(idea.status) < statusRank('angle')) await setStatus(idea, 'angle');
        }}>Valider l’angle retenu (ou la combinaison)</button>
      )}
    </div>
  );
}

function ResearchPanel({ idea, docLoad }: { idea: Idea; docLoad?: string }) {
  const r = idea.research ?? { level: 'light' as ResearchLevelId, justification: '', sourcesNeeded: '', missing: '', docHours: 1 };
  const sug = suggestLevel(idea, docLoad);
  const set = (c: Partial<typeof r>) => updateIdea(idea.id, { research: { ...r, ...c } });
  return (
    <div>
      <div className="seg">{LEVELS.map((l) => <button key={l.id} className={idea.research && r.level === l.id ? 'on' : ''} onClick={() => set({ level: l.id })}>{l.label}</button>)}</div>
      <p className="muted small" style={{ marginTop: 6 }}>{LEVELS.find((l) => l.id === r.level)?.hint}</p>
      <p className="note small">Suggestion locale (règles simples, à ajuster) : <b>{LEVELS.find((l) => l.id === sug.level)?.label}</b>{sug.reasons.length ? ` — ${sug.reasons.join(', ')}` : ''}.{' '}
        {(!idea.research || r.level !== sug.level) && <button className="link-btn" onClick={() => set({ level: sug.level, justification: r.justification || sug.reasons.join(', ') })}>Appliquer</button>}
      </p>
      <div className="grid two">
        <ResearchText label="Justification" value={r.justification} onSave={(v) => set({ justification: v })} />
        <ResearchText label="Sources nécessaires" value={r.sourcesNeeded} onSave={(v) => set({ sourcesNeeded: v })} />
        <ResearchText label="Informations manquantes" value={r.missing} onSave={(v) => set({ missing: v })} />
        <div>
          <span className="field-label">Estimations (heures, ajustables)</span>
          <div className="grid three">
            <label className="small muted">Documentation<input type="number" min={0} step={0.5} value={r.docHours} onChange={(e) => set({ docHours: Number(e.target.value) })} /></label>
            <label className="small muted">Tournage<input type="number" min={0} step={0.5} value={r.shootHours ?? ''} onChange={(e) => set({ shootHours: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
            <label className="small muted">Montage<input type="number" min={0} step={0.5} value={r.editHours ?? ''} onChange={(e) => set({ editHours: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
          </div>
        </div>
      </div>
    </div>
  );
}
function ResearchText({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <label className="field"><span className="field-label">{label}</span><textarea rows={2} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} /></label>;
}

function StructureEditor({ idea, beats, setBeats, fmt, target, total }: { idea: Idea; beats: Beat[]; setBeats: (b: Beat[]) => void; fmt?: ReturnType<typeof useFormats>[number]; target?: number; total: number }) {
  const [local, setLocal] = useState(beats);
  useEffect(() => setLocal(beats), [JSON.stringify(beats)]);
  const commit = (b: Beat[]) => { setLocal(b); setBeats(b); };
  const edit = (i: number, c: Partial<Beat>) => setLocal(local.map((x, j) => (j === i ? { ...x, ...c } : x)));
  const move = (i: number, d: number) => { const b = [...local]; const [x] = b.splice(i, 1); b.splice(i + d, 0, x); commit(b); };
  return (
    <div>
      {fmt && (
        <div className="row wrap" style={{ marginBottom: 8 }}>
          <span className="small muted">Partir d’une structure du format :</span>
          {fmt.structures.map((s) => (
            <button key={s.name} className="chip" onClick={() => {
              if (local.length && !confirm('Remplacer la structure actuelle ? (l’ancienne sera conservée dans l’historique)')) return;
              if (local.length) void snapshot('ideas', idea.id, 'structure', JSON.stringify(local), 'manual');
              commit(s.beats.map((b) => ({ id: uid(), label: b.label, seconds: b.seconds, content: '' })));
            }}>{s.name}</button>
          ))}
        </div>
      )}
      {local.map((b, i) => (
        <div key={b.id} className={`beat ${b.weak ? 'weak' : ''}`}>
          <input value={b.label} onChange={(e) => edit(i, { label: e.target.value })} onBlur={() => commit(local)} />
          <input type="number" min={0} value={b.seconds} onChange={(e) => edit(i, { seconds: Number(e.target.value) })} onBlur={() => commit(local)} title="secondes" />
          <div className="row">
            <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Monter">↑</button>
            <button className="icon-btn" disabled={i === local.length - 1} onClick={() => move(i, 1)} aria-label="Descendre">↓</button>
            <button className={`chip ${b.weak ? 'on' : ''}`} onClick={() => commit(local.map((x, j) => (j === i ? { ...x, weak: !x.weak } : x)))} title="Marquer comme partie faible à améliorer">faible</button>
            <button className="icon-btn" onClick={() => commit(local.filter((_, j) => j !== i))} aria-label="Supprimer">✕</button>
          </div>
          <textarea rows={2} value={b.content} placeholder="Intention / contenu de ce temps fort" onChange={(e) => edit(i, { content: e.target.value })} onBlur={() => commit(local)} />
        </div>
      ))}
      <div className="row wrap" style={{ marginTop: 8 }}>
        <button className="btn sm" onClick={() => commit([...local, { id: uid(), label: 'Nouveau temps fort', seconds: 8, content: '' }])}>+ Temps fort</button>
        <span className="small muted">Total {total} s{target ? ` · cible ≈ ${target} s` : ''}{fmt ? ` (format ${fmt.minSec}–${fmt.maxSec} s)` : ''}</span>
        <span className="spacer" />
        {local.length > 0 && statusRank(idea.status) < statusRank('structure') && (
          <button className="btn sm primary" onClick={async () => { await snapshot('ideas', idea.id, 'structure', JSON.stringify(local), 'manual'); await setStatus(idea, 'structure'); }}>Valider la structure</button>
        )}
      </div>
    </div>
  );
}

function ReferenceCheck({ idea, iWorks, allWorks, ctx }: { idea: Idea; iWorks: Work[]; allWorks: Work[]; ctx: any }) {
  const unseen = iWorks.filter((w) => w.seen !== 'seen');
  const seen = allWorks.filter((w) => w.seen === 'seen');
  if (!iWorks.length) return <p className="muted small">Aucune œuvre associée.</p>;
  return (
    <div className="stack">
      {iWorks.map((w) => (
        <div key={w.id} className="row between">
          <span>{w.title}{w.year ? ` (${w.year})` : ''}</span>
          <select style={{ width: 'auto' }} value={w.seen} onChange={async (e) => { await db.works.update(w.id, { seen: e.target.value as Work['seen'], updatedAt: Date.now() }); await touchIdea(idea.id); }}>
            <option value="seen">Vu</option><option value="partial">Partiellement vu</option><option value="unseen">À voir</option>
          </select>
        </div>
      ))}
      {unseen.length > 0 && (
        <div className="note warn small">
          <p><b>Référence non vue : {unseen.map((w) => w.title).join(', ')}.</b> Avant de poursuivre :</p>
          <ol style={{ margin: '0 0 8px 18px', padding: 0 }}>
            <li>Chercher une alternative parmi tes films vus{seen.length ? '' : ' (ta filmothèque n’a encore aucun film marqué « vu »)'}.</li>
            <li>Évaluer si cette alternative reste pertinente.</li>
            <li>Sinon, regarder l’œuvre originale avant de continuer.</li>
          </ol>
          {unseen.map((u) => {
            const sameDir = seen.filter((s) => u.director && s.director && s.director.toLowerCase() === u.director.toLowerCase());
            return sameDir.length ? <p key={u.id}>Même réalisateur, déjà vu : {sameDir.map((s) => s.title).join(', ')} — à évaluer.</p> : null;
          })}
          <details><summary>Demander des alternatives à Claude (sans spoiler)</summary>
            <PromptBox mode="alternatives" ideaId={idea.id} input={unseen.map((w) => w.title).join(', ')}
              prompt={buildPrompt('alternatives', ctx, unseen.map((w) => `${w.title}${w.year ? ` (${w.year})` : ''}`).join(', '))}
              onImport={(r) => addJournal(`Alternatives proposées pour ${unseen.map((w) => w.title).join(', ')} :\n${r.slice(0, 600)}`, idea.id)} />
          </details>
          <button className="btn sm" style={{ marginTop: 8 }} onClick={() => addJournal(`Décision : regarder ${unseen.map((w) => w.title).join(', ')} avant de poursuivre.`, idea.id)}>Je regarde d’abord l’œuvre originale</button>
        </div>
      )}
    </div>
  );
}

function Timeline({ idea, events }: { idea: Idea; events: { id: string; type: string; from?: Status; to?: Status; at: number; manual?: boolean }[] }) {
  const [addTo, setAddTo] = useState<Status>('documentation');
  const [addAt, setAddAt] = useState(toLocalInput(Date.now()));
  return (
    <div>
      <ul className="timeline">
        <li>
          Création ·{' '}
          <input type="datetime-local" value={toLocalInput(idea.createdAt)} onChange={(e) => e.target.value && updateIdea(idea.id, { createdAt: fromLocalInput(e.target.value) })} />
        </li>
        {events.filter((e) => e.type === 'status').map((e) => (
          <li key={e.id}>
            {e.from ? `${statusLabel(e.from)} → ` : ''}<b>{e.to && statusLabel(e.to)}</b>{e.manual ? ' (ajout manuel)' : ''} ·{' '}
            <input type="datetime-local" value={toLocalInput(e.at)} onChange={(ev) => ev.target.value && db.events.update(e.id, { at: fromLocalInput(ev.target.value) })} />
            <button className="icon-btn" title="Supprimer cette transition" onClick={() => confirm('Supprimer cette transition de l’historique ?') && db.events.delete(e.id)}>✕</button>
          </li>
        ))}
        <li>Dernière activité · {fmtDateTime(idea.lastActivityAt)}</li>
      </ul>
      <div className="row wrap small">
        <span className="muted">Ajouter une date d’étape oubliée :</span>
        <select style={{ width: 'auto' }} value={addTo} onChange={(e) => setAddTo(e.target.value as Status)}>{STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        <input type="datetime-local" style={{ width: 'auto' }} value={addAt} onChange={(e) => setAddAt(e.target.value)} />
        <button className="btn sm" onClick={() => db.events.add({ id: uid(), ideaId: idea.id, type: 'status', to: addTo, at: fromLocalInput(addAt), manual: true })}>Ajouter</button>
      </div>
    </div>
  );
}

const PHASES: { id: Phase; label: string }[] = [
  { id: 'documentation', label: 'Documentation' }, { id: 'ecriture', label: 'Écriture' }, { id: 'production', label: 'Tournage' }, { id: 'montage', label: 'Montage' }, { id: 'autre', label: 'Autre' },
];
const TIMER_KEY = 'cil.timer';
function TimeTracker({ ideaId, sessions }: { ideaId: string; sessions: { id: string; phase: Phase; start: number; minutes: number; note?: string }[] }) {
  const [timer, setTimer] = useState<{ ideaId: string; phase: Phase; start: number } | null>(() => { try { return JSON.parse(localStorage.getItem(TIMER_KEY) || 'null'); } catch { return null; } });
  const [phase, setPhase] = useState<Phase>('documentation');
  const [manual, setManual] = useState('');
  const [, force] = useState(0);
  useEffect(() => { if (!timer) return; const t = setInterval(() => force((x) => x + 1), 15000); return () => clearInterval(t); }, [timer]);
  const start = () => { const t = { ideaId, phase, start: Date.now() }; localStorage.setItem(TIMER_KEY, JSON.stringify(t)); setTimer(t); };
  const stop = async () => {
    if (!timer) return;
    const minutes = Math.round((Date.now() - timer.start) / 60000);
    if (minutes > 0) await db.sessions.add({ id: uid(), ideaId: timer.ideaId, phase: timer.phase, start: timer.start, minutes });
    await touchIdea(timer.ideaId);
    localStorage.removeItem(TIMER_KEY); setTimer(null);
  };
  const running = timer && timer.ideaId === ideaId;
  return (
    <div>
      <div className="row wrap">
        <select style={{ width: 'auto' }} value={phase} onChange={(e) => setPhase(e.target.value as Phase)}>{PHASES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
        {running ? <button className="btn sm primary" onClick={stop}>■ Arrêter ({fmtMinutes((Date.now() - timer!.start) / 60000)})</button>
          : timer ? <span className="small muted">Un chronomètre tourne sur une autre idée.</span>
            : <button className="btn sm" onClick={start}>▶ Chronomètre</button>}
        <input style={{ width: 90 }} type="number" min={1} placeholder="min" value={manual} onChange={(e) => setManual(e.target.value)} />
        <button className="btn sm" disabled={!Number(manual)} onClick={async () => { await db.sessions.add({ id: uid(), ideaId, phase, start: Date.now(), minutes: Number(manual) }); await touchIdea(ideaId); setManual(''); }}>Ajouter manuellement</button>
      </div>
      {sessions.length > 0 && (
        <table className="t" style={{ marginTop: 10 }}><tbody>
          {sessions.map((s) => (
            <tr key={s.id}><td>{fmtDateTime(s.start)}</td><td>{PHASES.find((p) => p.id === s.phase)?.label}</td>
              <td><input type="number" style={{ width: 80 }} value={s.minutes} onChange={(e) => db.sessions.update(s.id, { minutes: Number(e.target.value) })} /> min</td>
              <td><button className="icon-btn" onClick={() => db.sessions.update(s.id, { deletedAt: Date.now() })}>✕</button></td></tr>
          ))}
        </tbody></table>
      )}
      <p className="muted tiny">Le temps travaillé est distinct du temps calendaire. Il est saisi par toi : l’app ne le devine pas.</p>
    </div>
  );
}

function Comments({ idea }: { idea: Idea }) {
  const [t, setT] = useState('');
  return (
    <div>
      {idea.comments.map((c) => <p key={c.id} className="small"><span className="muted tiny">{fmtDateTime(c.at)}</span><br />{c.text}</p>)}
      <div className="row"><input value={t} onChange={(e) => setT(e.target.value)} placeholder="Commentaire" />
        <button className="btn sm" disabled={!t.trim()} onClick={async () => { await updateIdea(idea.id, { comments: [...idea.comments, { id: uid(), at: Date.now(), text: t.trim() }] }); setT(''); }}>Ajouter</button></div>
    </div>
  );
}
function JournalAdd({ ideaId }: { ideaId: string }) {
  const [t, setT] = useState('');
  return (
    <div className="row" style={{ marginTop: 8 }}><input value={t} onChange={(e) => setT(e.target.value)} placeholder="Noter un changement d’orientation" />
      <button className="btn sm" disabled={!t.trim()} onClick={async () => { await addJournal(t.trim(), ideaId); await touchIdea(ideaId); setT(''); }}>Noter</button></div>
  );
}

function LinkSourcesModal({ open, onClose, ideaId }: { open: boolean; onClose: () => void; ideaId: string }) {
  const sources = useSources();
  const [q, setQ] = useState('');
  return (
    <Modal open={open} onClose={onClose} title="Lier des sources existantes">
      <input placeholder="Filtrer" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="list compact" style={{ marginTop: 8 }}>
        {sources.filter((s) => (s.title + s.url).toLowerCase().includes(q.toLowerCase())).map((s) => {
          const linked = s.ideaIds.includes(ideaId);
          return (
            <li key={s.id} onClick={async () => { await db.sources.update(s.id, { ideaIds: linked ? s.ideaIds.filter((x) => x !== ideaId) : [...s.ideaIds, ideaId], updatedAt: Date.now() }); await touchIdea(ideaId); }}>
              <span>{linked ? '☑' : '☐'} {s.title || s.url}</span><span className="muted small">{SOURCE_STATES[s.state]}</span>
            </li>
          );
        })}
      </ul>
      {!sources.length && <Empty>Aucune source enregistrée.</Empty>}
      <p className="muted tiny" style={{ marginTop: 8 }}>Semaine en cours : {isoWeek(Date.now())}</p>
    </Modal>
  );
}
