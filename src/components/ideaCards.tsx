import { useMemo, useRef, useState } from 'react';
import { Lightbulb, Clapperboard, CircleCheck, Pin, ChevronDown, Layers } from 'lucide-react';
import type { Idea, Format, Source, Importance } from '../types';
import { IMPORTANCE } from '../types';
import { go } from '../hooks';
import { ideaProgress, bandOf, BAND_LABEL, groupFamilies, type Family } from '../lib/progress';
import { variantFamilies } from '../lib/create';
import { ideaStage, setFilmed } from '../lib/stage';
import { stepOf } from './pickers';
import { updateIdea } from '../lib/actions';
import { Modal } from './ui';
import { toast } from '../lib/toast';

const STEP_NAMES = ['L’idée', 'Documentation', 'Angle', 'Structure', 'Script', 'Finaliser'];
const COLORS: Record<string, string> = {
  tourner: '#d38d5c', finir: '#8aa3b8', 'plus-tard': '#a99cb8',
  debut: '#7f9c9a', partiel: '#c2b48a', avance: '#93ab8e', ready: '#8aa3b8', filmed: '#93ab8e',
};

/** Appui long (≈ 0,5 s) sans déclencher le clic. */
function useLongPress(onLong: () => void) {
  const t = useRef<number | null>(null);
  const fired = useRef(false);
  const start = () => { fired.current = false; t.current = window.setTimeout(() => { fired.current = true; onLong(); }, 520); };
  const stop = () => { if (t.current) clearTimeout(t.current); t.current = null; };
  return { fired, handlers: { onPointerDown: start, onPointerUp: stop, onPointerLeave: stop, onPointerCancel: stop, onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); stop(); fired.current = true; onLong(); } } };
}

/** Bibliothèque : une carte par idée principale, ses variantes rangées dans un tiroir. */
export function IdeaBoard({ list, all, formats, sources }: { list: Idea[]; all: Idea[]; formats: Format[]; sources: Source[] }) {
  const prog = useMemo(() => new Map(all.map((i) => [i.id, ideaProgress(i, sources)])), [all, sources]);
  const auto = useMemo(() => variantFamilies(all), [all]);
  const fams = useMemo(() => groupFamilies(list, auto, (i) => prog.get(i.id)?.pct ?? 0), [list, auto, prog]);
  const [menu, setMenu] = useState<Idea | null>(null);
  return (
    <>
      <div className="board">{fams.map((f) => <FamilyCard key={f.head.id} fam={f} prog={prog} formats={formats} onMenu={setMenu} />)}</div>
      {menu && <IdeaMenu idea={menu} all={all} onClose={() => setMenu(null)} />}
    </>
  );
}

function colorOf(i: Idea, pct: number) {
  const st = ideaStage(i);
  if (st !== 'cloud') return COLORS[st];
  if (i.importance) return COLORS[i.importance];
  if (i.paused) return COLORS['plus-tard'];
  return COLORS[bandOf(pct)];
}

function FamilyCard({ fam, prog, formats, onMenu }: { fam: Family<Idea>; prog: Map<string, { pct: number; todo: string[] }>; formats: Format[]; onMenu: (i: Idea) => void }) {
  const i = fam.head;
  const p = prog.get(i.id) ?? { pct: 0, todo: [] };
  const [open, setOpen] = useState(false);
  const lp = useLongPress(() => onMenu(i));
  const st = ideaStage(i);
  const step = stepOf(i);
  const color = colorOf(i, p.pct);
  const fmt = formats.find((f) => f.id === i.formatId);
  const Icon = st === 'filmed' ? CircleCheck : st === 'ready' ? Clapperboard : Lightbulb;
  const tag = st === 'ready' ? 'À filmer' : st === 'filmed' ? 'Filmée' : i.importance ? IMPORTANCE[i.importance] : i.paused ? 'Gardée pour plus tard' : BAND_LABEL[bandOf(p.pct)];
  return (
    <div className={`idea-card ${open ? 'open' : ''}`} style={{ '--c': color } as React.CSSProperties}>
      <div className="ic-main" role="button" tabIndex={0} onClick={() => { if (lp.fired.current) { lp.fired.current = false; return; } go(`ideas/${i.id}`); }} {...lp.handlers}>
        <div className="ic-top">
          <span className="ic-icon"><Icon size={18} strokeWidth={1.8} /></span>
          <span className="ic-tag">{tag}</span>
          {i.favorite && <Pin size={14} className="ic-pin" />}
        </div>
        <b className="ic-title">{i.title}</b>
        <span className="ic-sub">{st === 'cloud' ? `Étape ${Math.min(step, 6)}/6 · ${STEP_NAMES[Math.min(step, 6) - 1]}` : st === 'ready' ? (i.scriptReviewed ? 'Script finalisé' : 'Script à relire') : 'Tournée'}{fmt ? ` · ${fmt.name}` : ''}</span>
        <div className="ic-progress"><i style={{ width: `${p.pct}%` }} /></div>
        <div className="ic-foot">
          <span>{p.pct} %{p.todo.length && p.pct < 100 ? ` · manque : ${p.todo.slice(0, 2).join(', ')}${p.todo.length > 2 ? '…' : ''}` : ''}</span>
          {st === 'ready' && <label className="ic-film" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}><input type="checkbox" onChange={() => setFilmed(i, true)} /> filmée</label>}
        </div>
      </div>
      {fam.children.length > 0 && (
        <>
          <button className="ic-drawer-btn" onClick={() => setOpen(!open)}>
            <Layers size={14} /> {fam.children.length} variante{fam.children.length > 1 ? 's' : ''}{fam.children.some((c) => c.paused || c.importance === 'plus-tard') ? ' · dont plus tard' : ''}
            <ChevronDown size={15} style={{ marginLeft: 'auto', transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .2s' }} />
          </button>
          {open && <div className="ic-drawer">{fam.children.map((c, k) => <VariantRow key={c.id} idea={c} n={k + 2} pct={prog.get(c.id)?.pct ?? 0} onMenu={onMenu} />)}</div>}
        </>
      )}
    </div>
  );
}

function VariantRow({ idea, n, pct, onMenu }: { idea: Idea; n: number; pct: number; onMenu: (i: Idea) => void }) {
  const lp = useLongPress(() => onMenu(idea));
  const later = idea.paused || idea.importance === 'plus-tard';
  const fresh = idea.lastActivityAt - idea.createdAt < 60_000 && !idea.guideStep;
  return (
    <div className="ic-variant" role="button" tabIndex={0} style={{ '--c': colorOf(idea, pct) } as React.CSSProperties} onClick={() => { if (lp.fired.current) { lp.fired.current = false; return; } go(`ideas/${idea.id}`); }} {...lp.handlers}>
      <span className="ic-vnum">V{n}</span>
      <span className="ic-vtitle">{idea.title}<small>{later ? 'gardée pour plus tard' : idea.importance ? IMPORTANCE[idea.importance] : fresh ? 'pas encore commencée' : 'commencée'} · {pct} %</small></span>
    </div>
  );
}

/** Menu de l'appui long : épingler, idée principale / variante, importance. */
function IdeaMenu({ idea, all, onClose }: { idea: Idea; all: Idea[]; onClose: () => void }) {
  const auto = variantFamilies(all).get(idea.id);
  const siblings = auto ? all.filter((x) => x.id !== idea.id && variantFamilies(all).get(x.id)?.color === auto.color && variantFamilies(all).get(x.id)?.of === auto.of) : [];
  const [parent, setParent] = useState(idea.parentId ?? '');
  const act = async (fn: () => Promise<unknown>, msg: string) => { await fn(); toast(msg); onClose(); };
  const setImp = (imp?: Importance) => act(() => updateIdea(idea.id, { importance: imp, paused: imp === 'plus-tard' }), imp ? `Statut : ${IMPORTANCE[imp]}.` : 'Statut retiré.');
  const makeMain = () => act(async () => {
    await updateIdea(idea.id, { parentId: undefined });
    for (const s of [...siblings, ...all.filter((x) => x.parentId && x.parentId === idea.parentId && x.id !== idea.id)]) await updateIdea(s.id, { parentId: idea.id });
  }, 'Devenue l’idée principale de son groupe.');
  return (
    <Modal open onClose={onClose} title={idea.title}>
      <div className="menu-list">
        <span className="field-label">Importance</span>
        <div className="menu-chips">
          {(Object.keys(IMPORTANCE) as Importance[]).map((k) => <button key={k} className={`menu-chip imp-${k} ${idea.importance === k ? 'on' : ''}`} onClick={() => setImp(idea.importance === k ? undefined : k)}><i style={{ background: COLORS[k] }} />{IMPORTANCE[k]}</button>)}
        </div>
        <span className="field-label" style={{ marginTop: 14 }}>Place dans la bibliothèque</span>
        <button className="btn" onClick={makeMain}>★ En faire l’idée principale de son groupe</button>
        <div className="row wrap" style={{ marginTop: 8 }}>
          <select value={parent} onChange={(e) => setParent(e.target.value)} style={{ flex: 1, minWidth: 0 }}>
            <option value="">— Variante de… —</option>
            {all.filter((x) => x.id !== idea.id && !x.parentId).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
          </select>
          <button className="btn" disabled={parent === (idea.parentId ?? '')} onClick={() => act(() => updateIdea(idea.id, { parentId: parent || undefined }), parent ? 'Rangée comme variante.' : 'Idée indépendante.')}>Ranger</button>
        </div>
        <button className="btn ghost" style={{ marginTop: 14 }} onClick={() => act(() => updateIdea(idea.id, { favorite: !idea.favorite }), idea.favorite ? 'Désépinglée.' : 'Épinglée en haut.')}><Pin size={15} /> {idea.favorite ? 'Désépingler' : 'Épingler en haut'}</button>
      </div>
    </Modal>
  );
}
