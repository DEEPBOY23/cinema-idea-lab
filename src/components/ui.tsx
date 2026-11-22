import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { snapshot } from '../lib/actions';
import { ageTone, AGE_LABEL } from '../lib/aging';
import type { Idea, Settings, WorkshopMode } from '../types';
import { fmtDateTime, uid } from '../lib/util';
import { diffWords } from '../lib/text';

/**
 * Champ texte à enregistrement immédiat (≈0,6 s après la frappe, et à la sortie du champ).
 * Protection contre l'écrasement silencieux : si la valeur stockée change depuis un autre appareil
 * (synchro) ou un autre onglet, l'ancien texte de cet appareil est conservé dans l'historique des versions ;
 * si tu étais en train d'écrire, les deux versions sont gardées et tu choisis.
 */
export function Field(props: {
  table: string; id: string; field: string; value: string; label?: string; multiline?: boolean; rows?: number;
  placeholder?: string; versioned?: boolean; onSaved?: (v: string) => void; className?: string; dictate?: boolean;
}) {
  const { table, id, field, value, versioned } = props;
  const [draft, setDraft] = useState(value ?? '');
  const lastWritten = useRef(value ?? '');
  const timer = useRef<number>();
  const [conflict, setConflict] = useState<string | null>(null);

  useEffect(() => {
    const incoming = value ?? '';
    if (incoming === lastWritten.current) return;
    // Changement externe
    const dirty = draft !== lastWritten.current;
    if (dirty && incoming !== draft) {
      setConflict(incoming);
      void snapshot(table, id, field, draft, 'conflict');
      void snapshot(table, id, field, incoming, 'remote');
    } else {
      if (versioned && lastWritten.current && lastWritten.current !== incoming) void snapshot(table, id, field, lastWritten.current, 'remote');
      setDraft(incoming);
      lastWritten.current = incoming;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const save = async (v: string) => {
    window.clearTimeout(timer.current);
    if (v === lastWritten.current) return;
    lastWritten.current = v;
    const now = Date.now();
    const changes: Record<string, unknown> = { [field]: v, updatedAt: now };
    if (table === 'ideas') changes.lastActivityAt = now;
    await db.table(table).update(id, changes);
    props.onSaved?.(v);
  };
  const onChange = (v: string) => {
    setDraft(v);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(v), 600);
  };
  const onBlur = () => {
    void save(draft);
    if (versioned) void snapshot(table, id, field, draft, 'auto');
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const common = {
    value: draft, placeholder: props.placeholder, onBlur,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
  };
  return (
    <label className={`field ${props.className ?? ''}`}>
      {props.label && <span className="field-label">{props.label}{props.dictate !== false && props.multiline && <Dictate onText={(t) => onChange((draft ? draft + ' ' : '') + t)} />}</span>}
      {conflict !== null && (
        <div className="conflict">
          <strong>Ce texte a été modifié sur un autre appareil pendant que tu écrivais.</strong> Les deux versions sont conservées dans l’historique.
          <div className="row">
            <button className="btn sm" onClick={() => { setConflict(null); void (async () => { lastWritten.current = conflict; await save(draft); })(); }}>Garder ma version</button>
            <button className="btn sm ghost" onClick={() => { setDraft(conflict); lastWritten.current = conflict; setConflict(null); }}>Prendre l’autre version</button>
          </div>
        </div>
      )}
      {props.multiline ? <textarea rows={props.rows ?? 4} {...common} /> : <input {...common} />}
    </label>
  );
}

/** Saisie vocale via l'API Web Speech, uniquement si le navigateur la fournit réellement. */
export function Dictate({ onText }: { onText: (t: string) => void }) {
  const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const [on, setOn] = useState(false);
  const rec = useRef<any>(null);
  if (!SR) return null;
  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    if (on) { rec.current?.stop(); return; }
    const r = new SR();
    r.lang = 'fr-FR'; r.continuous = true; r.interimResults = false;
    r.onresult = (ev: any) => {
      let t = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) t += ev.results[i][0].transcript;
      if (t.trim()) onText(t.trim());
    };
    r.onend = () => setOn(false);
    r.onerror = (ev: any) => { setOn(false); if (ev.error === 'network') alert('La dictée de ce navigateur nécessite Internet. Utilise la saisie manuelle ou la dictée du clavier de ton téléphone.'); };
    rec.current = r; r.start(); setOn(true);
  };
  return (
    <button className={`dictate ${on ? 'on' : ''}`} onClick={toggle} title="Dicter (selon le navigateur, la reconnaissance peut passer par un service en ligne)" type="button">
      {on ? '● Stop' : '🎙 Dicter'}
    </button>
  );
}

export function CopyButton({ text, label = 'Copier' }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button className="btn sm" type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(text); } catch {
        const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      setOk(true); setTimeout(() => setOk(false), 1500);
    }}>{ok ? 'Copié ✓' : label}</button>
  );
}

export function AgeDot({ idea, settings, showLabel = true }: { idea: Idea; settings: Settings; showLabel?: boolean }) {
  const { tone, days } = ageTone(idea, settings.thresholds);
  return (
    <span className={`age age-${tone}`} title={`Dernière activité il y a ${days} j`}>
      <i />{showLabel && <span>{AGE_LABEL[tone]}{tone !== 'done' && tone !== 'published' ? ` · ${days} j` : ''}</span>}
    </span>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="modal-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="Fermer">✕</button></div>
        {children}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Section({ title, children, right, open = true }: { title: string; children: ReactNode; right?: ReactNode; open?: boolean }) {
  return (
    <details className="section" open={open}>
      <summary><span>{title}</span>{right && <span className="section-right" onClick={(e) => e.preventDefault()}>{right}</span>}</summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

export function TagsInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [t, setT] = useState(value.join(', '));
  useEffect(() => setT(value.join(', ')), [value.join('|')]);
  return <input value={t} placeholder={placeholder} onChange={(e) => setT(e.target.value)} onBlur={() => onChange(t.split(',').map((x) => x.trim()).filter(Boolean))} />;
}

/**
 * Pont vers Claude : prompt copiable + collage de la réponse.
 * Aucune réponse n'est générée par l'app.
 */
export function PromptBox({ prompt, mode, ideaId, input, onImport, importLabel }: {
  prompt: string; mode: WorkshopMode; ideaId?: string; input?: string;
  onImport?: (response: string) => void | Promise<void>; importLabel?: string;
}) {
  const [response, setResponse] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const saveResp = async () => {
    if (!response.trim()) return;
    const now = Date.now();
    const id = saved ?? uid();
    await db.workshops.put({ id, ideaId, mode, input: input ?? '', prompt, response, createdAt: now, updatedAt: now });
    setSaved(id);
    if (onImport) await onImport(response);
  };
  return (
    <div className="promptbox">
      <div className="row wrap">
        <CopyButton text={prompt} label="Copier le prompt" />
        <a className="btn sm ghost" href="https://claude.ai/new" target="_blank" rel="noreferrer">Ouvrir Claude ↗</a>
        <button className="btn sm ghost" type="button" onClick={() => setShow(!show)}>{show ? 'Masquer' : 'Voir'} le prompt</button>
      </div>
      {show && <pre className="prompt">{prompt}</pre>}
      <label className="field">
        <span className="field-label">Réponse de Claude (colle-la ici)</span>
        <textarea rows={5} value={response} onChange={(e) => setResponse(e.target.value)} placeholder="Colle la réponse, puis enregistre. Tu pourras choisir, modifier ou rejeter chaque piste." />
      </label>
      <div className="row">
        <button className="btn sm primary" type="button" disabled={!response.trim()} onClick={saveResp}>{importLabel ?? 'Enregistrer la réponse'}</button>
        {saved && <span className="muted small">Enregistré dans l’historique de l’atelier.</span>}
      </div>
    </div>
  );
}

export function VersionsPanel({ entityId, field, current, onRestore }: { entityId: string; field: string; current: string; onRestore: (v: string) => void }) {
  const versions = useLiveQuery(() => db.versions.where('[entityId+field]').equals([entityId, field]).reverse().sortBy('at'), [entityId, field]) ?? [];
  const [sel, setSel] = useState<string | null>(null);
  const v = versions.find((x) => x.id === sel);
  const REASON: Record<string, string> = { auto: 'auto', conflict: 'conflit (ma version)', remote: 'remplacée par la synchro', restore: 'avant restauration', manual: 'manuelle' };
  if (!versions.length) return <p className="muted small">Aucune version antérieure pour l’instant. Une version est conservée à chaque fin d’édition et à chaque conflit.</p>;
  return (
    <div className="versions">
      <ul className="list compact">
        {versions.slice(0, 30).map((x) => (
          <li key={x.id} className={sel === x.id ? 'sel' : ''} onClick={() => setSel(x.id)}>
            <span>{fmtDateTime(x.at)}</span><span className="muted small">{x.device} · {REASON[x.reason]} · {x.value.length} car.</span>
          </li>
        ))}
      </ul>
      {v && (
        <div>
          <p className="small muted">Différences avec le texte actuel (<del>supprimé</del> / <ins>ajouté</ins> depuis cette version) :</p>
          <div className="diff">{diffWords(v.value, current).map((p, i) => p.type === 'same' ? <span key={i}>{p.text}</span> : p.type === 'add' ? <ins key={i}>{p.text}</ins> : <del key={i}>{p.text}</del>)}</div>
          <button className="btn sm" onClick={() => onRestore(v.value)}>Restaurer cette version</button>
        </div>
      )}
    </div>
  );
}

export function Stars({ value, onChange, max = 3, labels }: { value: number; onChange: (n: number) => void; max?: number; labels: string[] }) {
  return (
    <div className="seg">
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <button key={n} type="button" className={value === n ? 'on' : ''} onClick={() => onChange(n)}>{labels[n - 1]}</button>
      ))}
    </div>
  );
}
