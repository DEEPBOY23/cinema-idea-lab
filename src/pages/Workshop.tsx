import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid } from '../db';
import { useIdeas, useWorks, useFormats, useSettings, useSources, useNotes, go } from '../hooks';
import type { Idea, WorkshopMode, Beat } from '../types';
import { statusRank } from '../types';
import { PromptBox, Dictate, Empty, CopyButton } from '../components/ui';
import { buildPrompt, MODE_INFO, type DiagFocus, type WritingTask } from '../lib/prompts';
import { analyzeScript, parseList, diffWords, oralSeconds, wordCount } from '../lib/text';
import { createIdea, updateIdea, setStatus, addJournal, snapshot } from '../lib/actions';
import { extractLinks } from '../lib/text';
import { createSource } from '../lib/actions';
import { useMemory, runSuggest, FormatSuggestionsPanel } from '../components/assist';
import { useAIProvider } from '../components/ui';
import { WebSourceFinder } from '../components/webSources';
import { titleFromUrl } from '../components/articles';
import { proposeAngles, listMissing, proposeStructure, strengthenWeak, applyTip, type WeakTip } from '../lib/devAssist';
import type { PromptCtx } from '../lib/prompts';

/** Bouton « l'assistant le fait » avec annulation et message de résultat. */
function AssistAction({ label, run }: { label: string; run: (signal: AbortSignal) => Promise<string> }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [ctl, setCtl] = useState<AbortController | null>(null);
  return (
    <div className="card" style={{ borderColor: 'var(--accent)' }}>
      <div className="row wrap">
        {busy ? <button className="btn" onClick={() => ctl?.abort()}>L’assistant travaille… (annuler)</button>
          : <button className="btn primary" onClick={async () => {
            const c = new AbortController(); setCtl(c); setBusy(true); setMsg('');
            try { setMsg(await run(c.signal)); } catch (e: any) { setMsg(e?.name === 'AbortError' ? 'Annulé.' : (e?.message ?? String(e))); }
            setBusy(false);
          }}>✦ {label}</button>}
        <span className="tiny muted">par l’assistant, directement dans l’app</span>
      </div>
      {msg && <p className="small" style={{ margin: '8px 0 0' }}>{msg}</p>}
    </div>
  );
}

/** Copier-coller : affiché d'office sans IA, replié quand l'assistant est branché. */
function Fallback({ aiOn, children }: { aiOn: boolean; children: React.ReactNode }) {
  if (!aiOn) return <>{children}</>;
  return <details><summary className="small muted">Ou passer par le copier-coller (ChatGPT, Claude…)</summary>{children}</details>;
}

function WeakStep({ idea, ctx, aiOn, onNext }: { idea: Idea; ctx: PromptCtx; aiOn: boolean; onNext: () => void }) {
  const [res, setRes] = useState<{ verdict: string; tips: WeakTip[] } | null>(null);
  const [applied, setApplied] = useState<Record<number, boolean>>({});
  return (
    <div className="stack">
      <p className="small">Marque les temps forts faibles dans la fiche (bouton « faible »), ou laisse l’assistant les repérer. Pas de réécriture complète.</p>
      {aiOn && <AssistAction label="Renforcer les parties faibles" run={async (sig) => { const r = await strengthenWeak(idea, ctx, sig); setRes(r); setApplied({}); return r.verdict || (r.tips.length ? '' : 'Aucun vrai point faible repéré.'); }} />}
      {res?.tips.map((t, i) => (
        <div key={i} className="card">
          <b className="small">{t.beat}</b>
          <p className="small muted" style={{ margin: '4px 0' }}>{t.problem}</p>
          <p className="small" style={{ margin: '4px 0' }}>Piste : {t.suggestion}</p>
          {t.beatId ? (applied[i] ? <span className="small muted">Ajoutée au temps fort ✓</span>
            : <button className="btn sm" onClick={async () => { await applyTip(idea, t); setApplied({ ...applied, [i]: true }); }}>Ajouter cette piste au temps fort</button>)
            : <span className="tiny muted">Temps fort non retrouvé dans ta structure : à reporter à la main.</span>}
        </div>
      ))}
      <Fallback aiOn={aiOn}><PromptBox mode="development" ideaId={idea.id} prompt={buildPrompt('development', ctx, '', { step: 'weak' })} /></Fallback>
      <button className="btn" onClick={onNext}>Continuer →</button>
    </div>
  );
}

const MODES: WorkshopMode[] = ['inspiration', 'development', 'diagnostic', 'writing', 'challenge'];

export default function Workshop({ query }: { query: URLSearchParams }) {
  const ideas = useIdeas();
  const [mode, setMode] = useState<WorkshopMode>((query.get('mode') as WorkshopMode) || 'development');
  const [ideaId, setIdeaId] = useState(query.get('idea') ?? '');
  useEffect(() => { if (query.get('idea')) setIdeaId(query.get('idea')!); }, [query.get('idea')]);
  const idea = ideas.find((i) => i.id === ideaId);
  return (
    <div>
      <div className="page-head"><div><h1>Atelier éditorial</h1><p className="muted small">Documentation → réflexion → angle → structure → script facultatif. L’app fonctionne sans IA ; l’assistant (Gemini, gratuit) répond directement dans l’app une fois sa clé ajoutée dans Paramètres. Le copier-coller reste possible.</p></div></div>
      <div className="seg" style={{ marginBottom: 12 }}>{MODES.map((m) => <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{MODE_INFO[m].label}</button>)}</div>
      <p className="muted small">{MODE_INFO[mode].intro}</p>
      <div className="row" style={{ margin: '10px 0 16px' }}>
        <select value={ideaId} onChange={(e) => setIdeaId(e.target.value)}>
          <option value="">— Sans idée (travail libre) —</option>
          {ideas.sort((a, b) => b.lastActivityAt - a.lastActivityAt).map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}
        </select>
        {idea && <a className="btn sm ghost" href={`#/ideas/${idea.id}`}>Fiche</a>}
      </div>
      {mode === 'inspiration' && <Inspiration idea={idea} />}
      {mode === 'development' && <Development idea={idea} onCreated={setIdeaId} />}
      {mode === 'diagnostic' && <Diagnostic idea={idea} />}
      {mode === 'writing' && <Writing idea={idea} />}
      {mode === 'challenge' && <Challenge idea={idea} />}
      <History ideaId={ideaId} />
    </div>
  );
}

function useCtx(idea?: Idea) {
  return { idea, works: useWorks(), formats: useFormats(), sources: useSources(), notes: useNotes(), settings: useSettings() };
}

function Inspiration({ idea }: { idea?: Idea }) {
  const ctx = useCtx(idea);
  const [subject, setSubject] = useState(idea?.title ?? '');
  return (
    <div className="stack">
      <label className="field"><span className="field-label">Film, série, technique ou format à explorer</span><input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
      <WebSourceFinder subject={subject} idea={idea} />
      <PromptBox mode="inspiration" ideaId={idea?.id} input={subject} prompt={buildPrompt('inspiration', ctx, '', { subject })} importLabel="Enregistrer et importer les liens"
        onImport={async (r) => {
          const existing = new Set(ctx.sources.map((s) => s.url));
          for (const l of extractLinks(r)) if (!existing.has(l.url)) await createSource({ url: l.url, title: (!l.title || /https?:\/\//.test(l.title) ? titleFromUrl(l.url) : l.title), ideaIds: idea ? [idea.id] : [], access: 'unverified' });
        }} />
      <p className="muted small">Les liens détectés dans la réponse sont ajoutés aux sources avec le statut « accès non vérifié ».</p>
    </div>
  );
}

const DEV_STEPS = ['Comprendre mon idée', 'Angles', 'Choisir / combiner', 'Infos manquantes', 'Structure', 'Parties faibles', 'Valider'];

function Development({ idea, onCreated }: { idea?: Idea; onCreated: (id: string) => void }) {
  const ctx = useCtx(idea);
  const memory = useMemory();
  const aiOn = useAIProvider() !== 'none';
  const [step, setStep] = useState(0);
  const [intuition, setIntuition] = useState('');
  if (!idea) {
    return (
      <div className="card stack">
        <h3>Écris ou dicte ton intuition, un hook ou une observation</h3>
        <div className="row between"><span className="muted small">Elle deviendra une idée dans ta bibliothèque.</span><Dictate onText={(t) => setIntuition((x) => (x ? x + ' ' : '') + t)} /></div>
        <textarea rows={4} value={intuition} onChange={(e) => setIntuition(e.target.value)} />
        <button className="btn primary" disabled={!intuition.trim()} onClick={async () => {
          const id = await createIdea({ title: intuition.trim().slice(0, 60), observation: intuition.trim() });
          onCreated(id);
          const idea = await db.ideas.get(id);
          if (idea && aiOn) runSuggest(idea, memory).catch(() => {});
        }}>Enregistrer mon idée et continuer</button>
      </div>
    );
  }
  const importAngles = async (r: string) => {
    const items = parseList(r).filter((x) => x.length > 15).slice(0, 6);
    await updateIdea(idea.id, { angles: [...idea.angles, ...items.map((t) => ({ id: uid(), text: t, chosen: false, origin: 'claude' as const }))] });
    setStep(2);
  };
  const importStructure = async (r: string) => {
    const beats: Beat[] = parseList(r).map((l) => {
      const m = l.match(/^(.*?)\s*\((\d+)\s*s?\)\s*[—–:-]?\s*(.*)$/);
      return m ? { id: uid(), label: m[1].trim(), seconds: Number(m[2]), content: m[3].trim() } : { id: uid(), label: l.slice(0, 60), seconds: 8, content: l.length > 60 ? l : '' };
    });
    if (idea.structure.length) await snapshot('ideas', idea.id, 'structure', JSON.stringify(idea.structure), 'manual');
    await updateIdea(idea.id, { structure: beats });
  };
  return (
    <div>
      <div className="stepper" style={{ marginBottom: 12 }}>{DEV_STEPS.map((s, i) => <button key={s} className={i === step ? 'cur' : i < step ? 'past' : ''} onClick={() => setStep(i)}>{i + 1}. {s}</button>)}</div>
      {step === 0 && (
        <div className="stack">
          <ObsField idea={idea} />
          <div className="card"><h3>Quel format ?</h3><FormatSuggestionsPanel idea={idea} /></div>
          <p className="muted small">Étape suivante : demander 2 ou 3 angles différents à l’assistant, ou les écrire toi-même.</p>
          <button className="btn" onClick={() => setStep(1)}>Continuer →</button>
        </div>
      )}
      {step === 1 && (
        <div className="stack">
          {aiOn && <AssistAction label="Proposer 3 angles" run={async (sig) => { const r = await proposeAngles(idea, ctx, sig); setStep(2); return `${r.count} angles ajoutés.${r.understood ? ` Ce que l’assistant a compris : « ${r.understood} »` : ''}`; }} />}
          <Fallback aiOn={aiOn}><PromptBox mode="development" ideaId={idea.id} input={idea.observation} prompt={buildPrompt('development', ctx, idea.observation)} importLabel="Importer comme angles" onImport={importAngles} /></Fallback>
          <button className="btn ghost sm" onClick={() => setStep(2)}>J’écris mes angles moi-même →</button>
        </div>
      )}
      {step === 2 && <AngleChooser idea={idea} onDone={() => setStep(3)} />}
      {step === 3 && (
        <div className="stack">
          {aiOn && <AssistAction label="Lister ce qui manque" run={async (sig) => { const n = await listMissing(idea, ctx, sig); return n ? `${n} point${n > 1 ? 's' : ''} ajouté${n > 1 ? 's' : ''} ci-dessous.` : 'Rien d’important ne manque selon l’assistant.'; }} />}
          <label className="field"><span className="field-label">Informations manquantes</span>
            <textarea key={idea.missingInfo} rows={5} defaultValue={idea.missingInfo} onBlur={(e) => e.target.value !== idea.missingInfo && updateIdea(idea.id, { missingInfo: e.target.value })} /></label>
          <Fallback aiOn={aiOn}><PromptBox mode="development" ideaId={idea.id} prompt={buildPrompt('development', ctx, '', { step: 'missing' })} importLabel="Ajouter aux infos manquantes"
              onImport={(r) => updateIdea(idea.id, { missingInfo: [idea.missingInfo, parseList(r).map((x) => `- ${x}`).join('\n')].filter(Boolean).join('\n') })} /></Fallback>
          <WebSourceFinder subject={idea.angle || idea.title} idea={idea} />
          <button className="btn" onClick={() => setStep(4)}>Continuer →</button>
        </div>
      )}
      {step === 4 && (
        <div className="stack">
          {aiOn && <AssistAction label={idea.structure.length ? 'Proposer une autre structure' : 'Proposer une structure'} run={async (sig) => { const n = await proposeStructure(idea, ctx, ctx.formats.find((f) => f.id === idea.formatId), sig); return `${n} temps forts proposés${idea.structure.length ? ' (l’ancienne structure est gardée dans les versions)' : ''}. Modifie-les dans la fiche si besoin.`; }} />}
          {idea.structure.length > 0 ? <ol className="small">{idea.structure.map((b) => <li key={b.id}><b>{b.label}</b> ({b.seconds} s){b.content && <span className="muted"> — {b.content}</span>}</li>)}</ol>
            : <p className="small muted">Pas encore de structure.</p>}
          {idea.structure.length > 0 && <p className="small muted">Total {idea.structure.reduce((a, b) => a + b.seconds, 0)} s</p>}
          <a className="btn sm" href={`#/ideas/${idea.id}`}>Éditer la structure dans la fiche</a>
          <Fallback aiOn={aiOn}><PromptBox mode="development" ideaId={idea.id} prompt={buildPrompt('development', ctx, '', { step: 'structure' })} importLabel="Importer comme structure (l’ancienne est gardée en version)" onImport={importStructure} /></Fallback>
          <button className="btn" onClick={() => setStep(5)}>Continuer →</button>
        </div>
      )}
      {step === 5 && <WeakStep idea={idea} ctx={ctx} aiOn={aiOn} onNext={() => setStep(6)} />}
      {step === 6 && (
        <div className="stack">
          <p>Tout est enregistré au fur et à mesure. Tu peux valider la structure maintenant ou y revenir plus tard.</p>
          {statusRank(idea.status) < statusRank('structure')
            ? <button className="btn primary" disabled={!idea.structure.length} onClick={() => setStatus(idea, 'structure')}>Valider la structure</button>
            : <p className="muted small">Structure déjà validée.</p>}
          <p className="muted small">Le script reste facultatif. L’écriture assistée n’est accessible que sur demande explicite (onglet dédié).</p>
          <button className="btn ghost" onClick={() => go(`ideas/${idea.id}`)}>Ouvrir la fiche</button>
        </div>
      )}
    </div>
  );
}

function ObsField({ idea }: { idea: Idea }) {
  const [v, setV] = useState(idea.observation);
  useEffect(() => setV(idea.observation), [idea.observation]);
  return (
    <label className="field"><span className="field-label">Ton intuition / observation<Dictate onText={(t) => { const nv = (v ? v + ' ' : '') + t; setV(nv); updateIdea(idea.id, { observation: nv }); }} /></span>
      <textarea rows={4} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== idea.observation && updateIdea(idea.id, { observation: v })} /></label>
  );
}

function AngleChooser({ idea, onDone }: { idea: Idea; onDone: () => void }) {
  const [t, setT] = useState('');
  const save = (angles: Idea['angles']) => updateIdea(idea.id, { angles });
  return (
    <div className="stack">
      {!idea.angles.length && <Empty>Aucun angle pour l’instant.</Empty>}
      {idea.angles.map((a, i) => (
        <label key={a.id} className="card row" style={{ alignItems: 'flex-start' }}>
          <input type="checkbox" checked={a.chosen} onChange={(e) => save(idea.angles.map((x, j) => (j === i ? { ...x, chosen: e.target.checked } : x)))} style={{ marginTop: 4 }} />
          <textarea rows={2} value={a.text} onChange={(e) => save(idea.angles.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
          <button className="icon-btn" onClick={(e) => { e.preventDefault(); save(idea.angles.filter((_, j) => j !== i)); }}>✕</button>
        </label>
      ))}
      <div className="row"><input value={t} onChange={(e) => setT(e.target.value)} placeholder="Mon angle" />
        <button className="btn sm" disabled={!t.trim()} onClick={() => { save([...idea.angles, { id: uid(), text: t.trim(), chosen: false, origin: 'moi' }]); setT(''); }}>Ajouter</button></div>
      <button className="btn primary" disabled={!idea.angles.some((a) => a.chosen)} onClick={async () => {
        const chosen = idea.angles.filter((a) => a.chosen).map((a) => a.text).join(' + ');
        await updateIdea(idea.id, { angle: chosen });
        await addJournal(`Angle choisi : ${chosen.slice(0, 200)}`, idea.id);
        if (statusRank(idea.status) < statusRank('angle')) await setStatus(idea, 'angle');
        onDone();
      }}>Retenir la sélection (combinaison possible)</button>
    </div>
  );
}

function Diagnostic({ idea }: { idea?: Idea }) {
  const ctx = useCtx(idea);
  const [text, setText] = useState(idea?.script ?? '');
  const [focus, setFocus] = useState<DiagFocus>('all');
  useEffect(() => { if (idea?.script) setText(idea.script); }, [idea?.id]);
  const fmt = ctx.formats.find((f) => f.id === idea?.formatId);
  const a = analyzeScript(text, ctx.settings.wpm, fmt ? { min: fmt.minSec, max: fmt.maxSec } : undefined);
  return (
    <div className="stack">
      <label className="field"><span className="field-label">Colle ton script (même incomplet). Il ne sera pas modifié.</span><textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} /></label>
      {text.trim() && (
        <div className="card">
          <h3>Mesures locales (sans IA)</h3>
          <div className="kpis">
            <div className="kpi"><b>{a.words}</b><span>mots</span></div>
            <div className="kpi"><b>≈ {a.seconds} s</b><span>à l’oral ({ctx.settings.wpm} mots/min)</span></div>
            <div className="kpi"><b>{a.hook.seconds} s</b><span>première phrase (hook)</span></div>
            <div className="kpi"><b>{a.avgSentenceWords}</b><span>mots / phrase en moyenne</span></div>
          </div>
          {a.target && <p className="small" style={{ marginTop: 10 }}>Format {fmt!.name} : {a.target.min}–{a.target.max} s → {a.target.verdict === 'within' ? 'dans la fourchette' : a.target.verdict === 'over' ? `≈ ${a.seconds - a.target.max} s au-dessus` : `≈ ${a.target.min - a.seconds} s en dessous`}.</p>}
          {a.longSentences.length > 0 && <p className="small">Phrases de plus de 25 mots (à vérifier à voix haute, pas forcément un défaut) : {a.longSentences.length}</p>}
          {a.repeated.length > 0 && <p className="small">Mots fréquents : {a.repeated.map((r) => `${r.word} ×${r.count}`).join(', ')}</p>}
          {a.paragraphs.length > 1 && <div className="small">{a.paragraphs.map((p, i) => <div key={i} className="bar-row"><span className="muted">§{i + 1} {p.preview.slice(0, 18)}…</span><div className="progress"><i style={{ width: `${Math.min(100, (p.seconds / Math.max(1, a.seconds)) * 100)}%` }} /></div><span>{p.seconds} s</span></div>)}</div>}
        </div>
      )}
      <div><span className="field-label">Analyse par l’assistant, portée :</span>
        <div className="seg">{([['all', 'Tout'], ['hook', 'Hook'], ['structure', 'Structure'], ['fond', 'Fond'], ['rythme', 'Rythme']] as [DiagFocus, string][]).map(([k, l]) => <button key={k} className={focus === k ? 'on' : ''} onClick={() => setFocus(k)}>{l}</button>)}</div></div>
      {text.trim() && <PromptBox mode="diagnostic" ideaId={idea?.id} input={text} prompt={buildPrompt('diagnostic', ctx, text, { focus })} />}
    </div>
  );
}

function Writing({ idea }: { idea?: Idea }) {
  const ctx = useCtx(idea);
  const [unlocked, setUnlocked] = useState(false);
  const [task, setTask] = useState<WritingTask>('draft');
  const [input, setInput] = useState('');
  const [a, setA] = useState(''); const [b, setB] = useState('');
  return (
    <div className="stack">
      <div className="card">
        <h3>Estimer la durée orale</h3>
        <textarea rows={3} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Colle un passage ou un brouillon" />
        <p className="small muted">{wordCount(input)} mots · ≈ {oralSeconds(input, ctx.settings.wpm)} s ({ctx.settings.wpm} mots/min, réglable dans Paramètres)</p>
      </div>
      <div className="card">
        <h3>Comparer deux versions</h3>
        <div className="grid two">
          <textarea rows={5} value={a} onChange={(e) => setA(e.target.value)} placeholder="Version A" />
          <textarea rows={5} value={b} onChange={(e) => setB(e.target.value)} placeholder="Version B" />
        </div>
        {idea?.script && <button className="link-btn small" onClick={() => setA(idea.script)}>Mettre le script de l’idée en A</button>}
        {a && b && <div className="diff" style={{ marginTop: 8 }}>{diffWords(a, b).map((p, i) => p.type === 'same' ? <span key={i}>{p.text}</span> : p.type === 'add' ? <ins key={i}>{p.text}</ins> : <del key={i}>{p.text}</del>)}</div>}
        {a && b && <p className="small muted">A : ≈ {oralSeconds(a, ctx.settings.wpm)} s · B : ≈ {oralSeconds(b, ctx.settings.wpm)} s</p>}
      </div>
      {!unlocked ? (
        <div className="card">
          <p>L’écriture assistée n’est proposée que si tu la demandes explicitement. Ta structure et ta réflexion passent d’abord.</p>
          <button className="btn" onClick={() => setUnlocked(true)}>Je demande explicitement une aide à l’écriture</button>
        </div>
      ) : (
        <div className="stack">
          <div className="seg">
            <button className={task === 'draft' ? 'on' : ''} onClick={() => setTask('draft')}>Rédiger depuis la structure validée</button>
            <button className={task === 'restructure' ? 'on' : ''} onClick={() => setTask('restructure')}>Restructurer un brouillon oral</button>
            <button className={task === 'improve' ? 'on' : ''} onClick={() => setTask('improve')}>Améliorer un passage</button>
          </div>
          {task === 'draft' && (!idea || statusRank(idea.status) < statusRank('structure')) && <p className="note warn small">La structure de cette idée n’est pas encore validée. Valide-la d’abord (ou choisis une idée).</p>}
          {task !== 'draft' && <p className="small muted">Utilise le champ « Estimer la durée orale » ci-dessus pour coller le texte concerné.</p>}
          {(task !== 'draft' || (idea && statusRank(idea.status) >= statusRank('structure'))) && (
            <PromptBox mode="writing" ideaId={idea?.id} input={input} prompt={buildPrompt('writing', ctx, input, { task })} importLabel={idea ? 'Enregistrer (et proposer comme script)' : 'Enregistrer'}
              onImport={async (r) => {
                if (idea && confirm('Remplacer le script de l’idée par cette réponse ? (l’actuel est conservé dans les versions)')) {
                  await snapshot('ideas', idea.id, 'script', idea.script, 'restore');
                  await updateIdea(idea.id, { script: r });
                }
              }} />
          )}
        </div>
      )}
    </div>
  );
}

function Challenge({ idea }: { idea?: Idea }) {
  const ctx = useCtx(idea);
  const [p, setP] = useState('');
  if (!idea) return <Empty>Choisis une idée à challenger.</Empty>;
  return (
    <div className="stack">
      <label className="field"><span className="field-label">Point précis à challenger (facultatif)</span><input value={p} onChange={(e) => setP(e.target.value)} /></label>
      <PromptBox mode="challenge" ideaId={idea.id} input={p} prompt={buildPrompt('challenge', ctx, p)} onImport={(r) => addJournal(`Challenge : ${r.slice(0, 300)}`, idea.id)} />
    </div>
  );
}

function History({ ideaId }: { ideaId: string }) {
  const items = useLiveQuery(() => (ideaId ? db.workshops.where('ideaId').equals(ideaId).reverse().sortBy('createdAt') : db.workshops.orderBy('createdAt').reverse().limit(10).toArray()), [ideaId]) ?? [];
  if (!items.length) return null;
  return (
    <details className="section" style={{ marginTop: 24 }}>
      <summary>Réponses enregistrées ({items.length})</summary>
      <div className="section-body">
        {items.map((w) => (
          <details key={w.id} className="card"><summary className="small">{new Date(w.createdAt).toLocaleString('fr-FR')} · {MODE_INFO[w.mode]?.label}</summary>
            <pre className="prompt">{w.response}</pre><CopyButton text={w.response} /></details>
        ))}
      </div>
    </details>
  );
}
