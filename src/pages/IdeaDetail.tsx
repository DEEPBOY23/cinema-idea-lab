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
import { ArticleRow, AddArticle, ReadProgress, SummarizeAll } from '../components/articles';
import { useIdeas } from '../hooks';
import { completePostStructure, structureToBeats } from '../lib/create';
import { WebSourceFinder } from '../components/webSources';
import { liveEstimate, aiEstimate } from '../lib/estimate';
import { proposeAngles, reworkText } from '../lib/devAssist';
import { toast } from '../lib/toast';
import { ideaStage, finalizeIdea, unfinalizeIdea, setFilmed } from '../lib/stage';

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
  const allIdeas = useIdeas();
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

      <EstimateBar idea={idea} fmt={fmt} formats={formats} ctx={ctx} />
      {ideaStage(idea) !== 'cloud' && <FinalizeCard idea={idea} ctx={ctx} target={target} />}

      <Guide idea={idea} steps={[
        { title: 'L’idée', hint: 'Ton observation, le format et l’œuvre. L’IA propose des formats.', body: <>
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

        </> },
        { title: 'Documentation', hint: 'Trouve et range tes sources, estime la recherche nécessaire.', body: <>
      <Section title={`📁 Articles de cette idée (${iSources.length})`} open right={<button className="btn sm" onClick={() => setLinkOpen(true)}>Lier existants</button>}>
        {iSources.length > 0 && <div style={{ marginBottom: 8 }}><ReadProgress sources={iSources} /></div>}
        {iSources.length ? (
          <div className="folder-list">{iSources.map((s) => <ArticleRow key={s.id} s={s} ideas={allIdeas} currentIdeaId={id} />)}</div>
        ) : <p className="muted small">Aucun article pour l’instant. La documentation passe avant l’écriture : colle ci-dessous les liens que tu trouves.</p>}
        <div className="row wrap" style={{ marginTop: 8 }}><SummarizeAll items={iSources} idea={idea} /></div>
        <div style={{ marginTop: 10 }}><AddArticle ideaId={id} /></div>
        <details style={{ marginTop: 10 }}><summary className="small"><b>✦ Trouver des sources avec l’IA</b></summary><div style={{ marginTop: 8 }}><WebSourceFinder subject={idea.angle || idea.title} idea={idea} /></div></details>
        <div className="row wrap" style={{ marginTop: 8 }}>
          <a className="btn sm ghost" href={`#/docs?idea=${id}&tab=search`}>Chercher des articles</a>
          <button className="btn sm ghost" onClick={async () => go(`docs/note/${await createNote({ ideaId: id, title: `Notes — ${idea.title}` })}`)}>+ Notes après lecture</button>
          <a className="btn sm ghost" href="#/articles">Tous mes dossiers d’articles</a>
        </div>
        {iNotes.length > 0 && (
          <>
            <h3 style={{ marginTop: 12 }}>Notes de lecture</h3>
            <ul className="list compact">{iNotes.map((n) => <li key={n.id} onClick={() => go(`docs/note/${n.id}`)}><span>{n.title || 'Notes sans titre'}</span><span className="muted small">{fmtDate(n.updatedAt)}</span></li>)}</ul>
          </>
        )}
      </Section>

      <Section title="Niveau de recherche documentaire" open={!!idea.research} right={<AiBtn label="✦ Remplir et estimer" run={async () => { const t = await aiEstimate(idea, ctx); toast(`Estimation de l’assistant : ≈ ${t} h.`); }} />}>
        <ResearchPanel idea={idea} docLoad={fmt?.docLoad} />
      </Section>

      <Section title="Références : œuvres vues ?" open={iWorks.some((w) => w.seen !== 'seen')}>
        <ReferenceCheck idea={idea} iWorks={iWorks} allWorks={works} ctx={ctx} />
      </Section>

        </> },
        { title: 'Angle', hint: 'Choisis un angle, ou combines-en plusieurs. L’IA en propose.', body: <>
      <Section title={`Angles envisagés (${idea.angles.length})`} open={idea.angles.length > 0} right={<AiBtn label="✦ Proposer 3 angles" run={async () => { const r = await proposeAngles(idea, ctx); toast(`${r.count} angles ajoutés.`); }} />}>
        <AnglesEditor idea={idea} ctx={ctx} />
      </Section>

        </> },
        { title: 'Structure', hint: 'Hook, intro, angles, contradiction, conclusion : l’IA complète.', body: <>
      <Section title={`Structure narrative${idea.structure.length ? ` · ${totalSec} sec` : ''}`} open={idea.structure.length > 0}>
        <PostStructureAI idea={idea} memory={memory} fmt={fmt} setBeats={setBeats} />
        <StructureEditor idea={idea} beats={idea.structure} setBeats={setBeats} fmt={fmt} target={target} total={totalSec} ctx={ctx} />
      </Section>

        </> },
        { title: 'Script', hint: 'L’IA prépare un script, tu le révises avec tes mots.', body: <>
      <Section title={`Script${idea.scriptReviewed ? ' · ✓ finalisé' : idea.scriptAI && !idea.scriptReviewed ? ' · version IA à relire' : ''}`} open={!!(idea.script || idea.scriptAI)}>
        <ScriptTabs idea={idea} ctx={ctx} target={target} wpm={settings.wpm} />
        <details><summary className="small muted">Versions antérieures de ta version</summary>
          <VersionsPanel entityId={id} field="script" current={idea.script} onRestore={async (v) => { await snapshot('ideas', id, 'script', idea.script, 'restore'); await up({ script: v }); }} />
        </details>
      </Section>

        </> },
        { title: 'Finaliser', hint: 'Fiche récap, puis à filmer.', body: <FinalizeCard idea={idea} ctx={ctx} target={target} inGuide /> },
      ]} />

      <h2 style={{ marginTop: 28 }}>Plus d’infos</h2>
      <details className="section" style={{ marginBottom: 12 }}><summary><span>Changer le statut à la main</span></summary><div className="section-body">
      <div className="stepper" role="group" aria-label="Statut">
        {STATUSES.map((s) => (
          <button key={s.id} className={idea.status === s.id ? 'cur' : statusRank(s.id) < statusRank(idea.status) ? 'past' : ''} onClick={() => setStatus(idea, s.id)}>{s.label}</button>
        ))}
      </div>
      <p className="muted tiny">Étapes flexibles : tu peux sauter une étape ou revenir en arrière, chaque transition est historisée.</p>

      </div></details>
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

function AnglesEditor({ idea, ctx }: { idea: Idea; ctx: any }) {
  const [t, setT] = useState('');
  const save = (angles: Idea['angles']) => updateIdea(idea.id, { angles });
  return (
    <div>
      {idea.angles.map((a, i) => (
        <div key={a.id} className="row" style={{ alignItems: 'flex-start', marginBottom: 6 }}>
          <input type="checkbox" checked={a.chosen} onChange={(e) => save(idea.angles.map((x, j) => (j === i ? { ...x, chosen: e.target.checked } : x)))} title="Retenir (tu peux en combiner plusieurs)" style={{ marginTop: 10 }} />
          <textarea rows={2} value={a.text} onChange={(e) => save(idea.angles.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
          <AiBtn icon label="✦" title="Retravailler cet angle avec l’IA" run={async () => { const t = await reworkText('cet angle', a.text, ctx); await save(idea.angles.map((x, j) => (j === i ? { ...x, text: t } : x))); }} />
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

function StructureEditor({ idea, beats, setBeats, fmt, target, total, ctx }: { idea: Idea; beats: Beat[]; setBeats: (b: Beat[]) => void; fmt?: ReturnType<typeof useFormats>[number]; target?: number; total: number; ctx: any }) {
  const [local, setLocal] = useState(beats);
  useEffect(() => setLocal(beats), [JSON.stringify(beats)]);
  const commit = (b: Beat[]) => { setLocal(b); setBeats(b); };
  const edit = (i: number, c: Partial<Beat>) => setLocal(local.map((x, j) => (j === i ? { ...x, ...c, validatedAt: undefined } : x)));
  const stamp = (t: number) => new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(' ', ' à ');
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
      {local.length > 0 && <p className="tiny muted" style={{ margin: '0 0 4px' }}>Pour chaque temps fort : son nom, sa durée en secondes, puis ce qu’on y dit ou montre.</p>}
      {local.map((b, i) => (
        <div key={b.id} className={`beat ${b.weak ? 'weak' : ''} ${b.validatedAt ? 'validated' : ''}`}>
          <input value={b.label} onChange={(e) => edit(i, { label: e.target.value })} onBlur={() => commit(local)} />
          <label className="sec-input" title="Durée de ce temps fort, en secondes"><input type="number" min={0} value={b.seconds} onChange={(e) => edit(i, { seconds: Number(e.target.value) })} onBlur={() => commit(local)} aria-label="Durée en secondes" /><span>sec</span></label>
          <div className="row">
            <AiBtn icon label="✦" title="Retravailler ce temps fort avec l’IA" run={async () => { const t = await reworkText(`le temps fort « ${b.label} » (${b.seconds} s)`, b.content, ctx, 'Une intention et ce qu’on montre, en 1 à 3 phrases.'); commit(local.map((x, j) => (j === i ? { ...x, content: t, weak: false } : x))); }} />
            <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Monter">↑</button>
            <button className="icon-btn" disabled={i === local.length - 1} onClick={() => move(i, 1)} aria-label="Descendre">↓</button>
            <button className={`chip ${b.weak ? 'on' : ''}`} onClick={() => commit(local.map((x, j) => (j === i ? { ...x, weak: !x.weak } : x)))} title="Marquer comme partie faible à améliorer">faible</button>
            <button className="icon-btn" onClick={() => commit(local.filter((_, j) => j !== i))} aria-label="Supprimer">✕</button>
          </div>
          <textarea className="beat-text" rows={Math.max(4, Math.ceil(b.content.length / 34) + 1)} value={b.content} placeholder="Intention / contenu de ce temps fort" onChange={(e) => edit(i, { content: e.target.value })} onBlur={() => commit(local)} />
          <div className="beat-validate">
            {b.validatedAt
              ? <><span className="tiny">✓ Validé le {stamp(b.validatedAt)}</span><button className="link-btn tiny" onClick={() => commit(local.map((x, j) => (j === i ? { ...x, validatedAt: undefined } : x)))}>annuler</button></>
              : <button className="btn sm" disabled={!b.content.trim()} onClick={() => commit(local.map((x, j) => (j === i ? { ...x, validatedAt: Date.now(), weak: false } : x)))}>✓ Valider ce temps fort</button>}
          </div>
        </div>
      ))}
      <div className="row wrap" style={{ marginTop: 8 }}>
        <button className="btn sm" onClick={() => commit([...local, { id: uid(), label: 'Nouveau temps fort', seconds: 8, content: '' }])}>+ Temps fort</button>
        {local.length > 0 && <span className="small muted">{local.filter((b) => b.validatedAt).length}/{local.length} validés · </span>}
        <span className="small muted">Total {total} sec{target ? ` · cible ≈ ${target} sec` : ''}{fmt ? ` (format ${fmt.minSec}–${fmt.maxSec} sec)` : ''}</span>
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
          <details><summary>Demander des alternatives à l’assistant (sans spoiler)</summary>
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

/** ✦ L'assistant construit ou complète la structure de post (Hook · Intro · Angles · Contradiction · Conclusion) sans effacer ce qui est écrit. */
function PostStructureAI({ idea, memory, fmt, setBeats }: { idea: Idea; memory: ReturnType<typeof useMemory>; fmt?: Parameters<typeof structureToBeats>[1]; setBeats: (b: Beat[]) => void }) {
  const provider = useAIProvider();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async () => {
    setBusy(true); setErr('');
    try {
      const s = await completePostStructure(idea, memory);
      if (idea.structure.length) await snapshot('ideas', idea.id, 'structure', JSON.stringify(idea.structure), 'manual');
      setBeats(structureToBeats(s, fmt));
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    setBusy(false);
  };
  return (
    <div className="note small" style={{ marginBottom: 10 }}>
      <div className="row between wrap">
        <span><b>✦ Structure du post</b> · Hook, intro, angles, contradiction, conclusion. L’assistant garde ce que tu as déjà écrit et complète le reste.</span>
        {provider === 'none' ? <a className="btn sm" href="#/settings">Brancher Gemini (gratuit)</a> : <button className="btn sm primary" disabled={busy} onClick={run}>{busy ? 'L’assistant structure…' : idea.structure.length ? 'Compléter avec l’IA' : 'Structurer avec l’IA'}</button>}
      </div>
      {err && <p className="small tag-hypothesis" style={{ margin: '6px 0 0' }}>{err}</p>}
    </div>
  );
}

/** Bouton d'action IA : gère l'attente et les erreurs ; invisible sans assistant branché. */
function AiBtn({ label, run, icon, title }: { label: string; run: () => Promise<void>; icon?: boolean; title?: string }) {
  const provider = useAIProvider();
  const [busy, setBusy] = useState(false);
  if (provider === 'none') return null;
  const go_ = async () => { setBusy(true); try { await run(); } catch (e: any) { toast(e?.message ?? String(e)); } setBusy(false); };
  return <button className={icon ? 'icon-btn ai-btn' : 'btn sm'} title={title} disabled={busy} onClick={go_}>{busy ? (icon ? '…' : 'L’assistant travaille…') : label}</button>;
}

/** Estimation globale du temps, recalculée en direct (gratuit) ; l'IA seulement sur demande. */
function EstimateBar({ idea, fmt, formats, ctx }: { idea: Idea; fmt?: ReturnType<typeof useFormats>[number]; formats: ReturnType<typeof useFormats>; ctx: any }) {
  const e = liveEstimate(idea, fmt, formats);
  return (
    <div className="estimate-bar">
      <div>
        <b className="estimate-total">≈ {e.total} h</b>
        <span className="small muted"> · documentation {e.doc} h · tournage {e.shoot} h · montage {e.edit} h</span>
        <div className="tiny muted">En direct, d’après {e.basis}{e.changes.length ? ` + ${e.changes.join(', ')}` : ''}. Calcul gratuit, sans IA.</div>
      </div>
      <AiBtn label="✦ Ré-estimer avec l’IA" run={async () => { const t = await aiEstimate(idea, ctx); toast(`Estimation de l’assistant : ≈ ${t} h.`); }} />
    </div>
  );
}

const scriptInstruction = (target?: number) => `Exception : ici on te demande bien un texte rédigé, à dire face caméra, qui suit la structure de la fiche (hook, intro, angles, contradiction, conclusion) avec l'angle et le hook retenus${target ? `, pour environ ${target} secondes à l'oral` : ''}. Garde les hypothèses formulées comme des hypothèses.`;
async function draftScriptAI(idea: Idea, ctx: any, target?: number) {
  const t = await reworkText('le script', idea.scriptAI ?? '', ctx, scriptInstruction(target));
  await updateIdea(idea.id, { scriptAI: t });
  return t;
}

/** Deux onglets : la maquette de l'IA (jamais écrasée par toi) et ta version, que tu valides. */
function ScriptTabs({ idea, ctx, target, wpm }: { idea: Idea; ctx: any; target?: number; wpm: number }) {
  const [tab, setTab] = useState<'ai' | 'mine'>(idea.script.trim() || !idea.scriptAI ? 'mine' : 'ai');
  const cur = tab === 'ai' ? (idea.scriptAI ?? '') : idea.script;
  return (
    <div>
      <div className="row between wrap" style={{ marginBottom: 8 }}>
        <div className="seg">
          <button className={tab === 'ai' ? 'on' : ''} onClick={() => setTab('ai')}>✦ Script de l’IA</button>
          <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>Ma version{idea.scriptReviewed ? ' ✓' : ''}</button>
        </div>
        {tab === 'ai'
          ? <AiBtn label={idea.scriptAI ? '↻ Régénérer' : '✦ Préparer le script'} run={async () => { await draftScriptAI(idea, ctx, target); toast('Script de l’IA prêt. Ta version n’a pas été touchée.'); }} />
          : <AiBtn label="✦ Retravailler ma version" run={async () => {
              const t = await reworkText('le script', idea.script, ctx, scriptInstruction(target) + ' Garde au maximum ses mots à lui.');
              if (idea.script.trim()) await snapshot('ideas', idea.id, 'script', idea.script, 'manual');
              await updateIdea(idea.id, { script: t, scriptReviewed: false }); toast('Ta version a été retravaillée (l’ancienne est dans l’historique).');
            }} />}
      </div>
      {tab === 'ai' ? (
        idea.scriptAI
          ? <><pre className="script-view">{idea.scriptAI}</pre>
              <div className="row wrap" style={{ marginTop: 8 }}>
                <button className="btn sm" onClick={async () => {
                  if (idea.script.trim() && !confirm('Remplacer ta version par le script de l’IA ? (ta version actuelle reste dans l’historique)')) return;
                  if (idea.script.trim()) await snapshot('ideas', idea.id, 'script', idea.script, 'manual');
                  await updateIdea(idea.id, { script: idea.scriptAI ?? '', scriptReviewed: false }); setTab('mine');
                }}>Partir de ce script pour ma version →</button>
                <span className="tiny muted">La maquette de l’IA reste ici telle quelle : tu ne perds jamais la structure.</span>
              </div></>
          : <p className="small muted">L’IA prépare un script complet à partir de tout ce que tu as choisi (hook, angle, structure). Tu le révises ensuite avec tes mots dans « Ma version ».</p>
      ) : (
        <>
          <Field table="ideas" id={idea.id} field="script" value={idea.script} multiline rows={10} versioned placeholder="Ta version du script, avec tes mots. Pars du script de l’IA ou écris directement." />
          <label className="row small" style={{ marginTop: 8 }}><input type="checkbox" checked={!!idea.scriptReviewed} disabled={!idea.script.trim()} onChange={(e) => updateIdea(idea.id, { scriptReviewed: e.target.checked })} /> Script relu et finalisé</label>
        </>
      )}
      <p className="muted small" style={{ marginTop: 6 }}>{wordCount(cur)} mots · ≈ {oralSeconds(cur, wpm)} sec à l’oral ({wpm} mots/min){target ? ` · cible ${target} sec` : ''}</p>
    </div>
  );
}

/** Après les étapes : proposer de finaliser (fiche récap + script), puis suivre 🔵 à filmer → 🟢 filmée. */
function FinalizeCard({ idea, ctx, target, inGuide }: { idea: Idea; ctx: any; target?: number; inGuide?: boolean }) {
  const provider = useAIProvider();
  const [busy, setBusy] = useState(false);
  const stage = ideaStage(idea);
  const ready = idea.structure.some((b) => b.content.trim()) || !!idea.script.trim();
  if (stage === 'cloud') {
    if (!inGuide && !ready && statusRank(idea.status) < statusRank('structure')) return null;
    const run = async () => {
      setBusy(true);
      try { if (provider !== 'none' && !idea.scriptAI && !idea.script.trim()) await draftScriptAI(idea, ctx, target); await finalizeIdea(idea); go(`ideas/${idea.id}/recap`); }
      catch (e: any) { toast(e?.message ?? String(e)); }
      setBusy(false);
    };
    return (
      <div className="stage-card stage-cloud">
        <div><b>Ton idée a sa structure : prête à finaliser ?</b><div className="tiny muted">Elle passe dans « À filmer » avec une fiche récap (hook, angles, structure, sources, script){provider !== 'none' && !idea.script.trim() ? ', et l’IA prépare le script' : ''}.</div></div>
        <button className="btn sm primary" disabled={busy} onClick={run}>{busy ? 'Préparation du script…' : 'Finaliser l’idée'}</button>
      </div>
    );
  }
  return (
    <div className={`stage-card stage-${stage}`}>
      <div>
        <b><i className={`sdot sdot-${stage}`} />{stage === 'ready' ? 'À filmer' : 'Filmée'}</b>
        <span className="tiny muted"> · {idea.scriptReviewed ? 'script finalisé' : idea.scriptAI || idea.script ? 'script de l’IA à relire' : 'pas encore de script'}</span>
        <label className="row small" style={{ marginTop: 6 }}><input type="checkbox" checked={stage === 'filmed'} onChange={(e) => setFilmed(idea, e.target.checked)} /> Filmée</label>
      </div>
      <div className="row wrap">
        <a className="btn sm primary" href={`#/ideas/${idea.id}/recap`}>Fiche récap</a>
        <button className="btn sm ghost" onClick={() => unfinalizeIdea(idea)}>Remettre dans les nuages</button>
      </div>
    </div>
  );
}

/** Guide de création : 6 étapes numérotées. Valider une étape ouvre la suivante. */
const GUIDE_STATUS: (Idea['status'] | null)[] = ['documentation', null, 'angle', 'structure', 'script', null];
export function guideCurrent(idea: Idea): number {
  if (idea.finalizedAt) return 7;
  if (idea.guideStep) return idea.guideStep;
  const r = statusRank(idea.status);
  return r <= 0 ? 1 : r === 1 ? 2 : r === 2 ? 4 : r === 3 ? 5 : 6;
}
function Guide({ idea, steps }: { idea: Idea; steps: { title: string; hint: string; body: React.ReactNode }[] }) {
  const cur = guideCurrent(idea);
  const [open, setOpen] = useState<number | null>(null);
  const shown = open ?? Math.min(cur, steps.length);
  const validate = async (k: number) => {
    const st = GUIDE_STATUS[k - 1];
    if (st && statusRank(idea.status) < statusRank(st)) await setStatus(idea, st);
    if (k === 3 && !idea.angle.trim()) { const ch = idea.angles.filter((a) => a.chosen).map((a) => a.text.split('\n')[0]).join(' + '); if (ch) await updateIdea(idea.id, { angle: ch }); }
    if (k === 5 && idea.script.trim()) await updateIdea(idea.id, { scriptReviewed: true });
    await updateIdea(idea.id, { guideStep: Math.max(cur, k + 1) });
    setOpen(k + 1);
    setTimeout(() => document.getElementById(`guide-${k + 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };
  return (
    <div className="guide">
      <div className="guide-progress">{steps.map((st, i) => { const k = i + 1; return <button key={k} className={`gp ${k < cur ? 'done' : k === cur ? 'cur' : ''}`} onClick={() => { setOpen(k); document.getElementById(`guide-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}><i>{k < cur ? '✓' : k}</i><span>{st.title}</span></button>; })}</div>
      {steps.map((st, i) => {
        const k = i + 1, isOpen = shown === k, state = k < cur ? 'done' : k === cur ? 'cur' : 'next';
        return (
          <div key={k} id={`guide-${k}`} className={`guide-step ${state} ${isOpen ? 'open' : ''}`}>
            <button className="guide-head" onClick={() => setOpen(isOpen ? -1 : k)}>
              <i className="guide-num">{state === 'done' ? '✓' : k}</i>
              <span className="guide-title"><b>{st.title}</b><span className="tiny muted">{state === 'done' ? 'Fait · touche pour revoir' : state === 'cur' ? st.hint : 'À venir'}</span></span>
              <span className="guide-state">{state === 'done' ? 'Fait' : state === 'cur' ? 'En cours' : ''}</span>
            </button>
            {isOpen && <div className="guide-body">
              {st.body}
              {k < steps.length && <div className="guide-foot"><button className="btn primary" onClick={() => validate(k)}>{state === 'done' ? 'Revalider' : 'Valider'} et passer à : {steps[k].title} →</button></div>}
            </div>}
          </div>
        );
      })}
    </div>
  );
}
