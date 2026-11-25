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
  tourner: '#e08a52', finir: '#6e9fd0', 'plus-tard': '#a487d6',
  debut: '#5aa8a0', partiel: '#d9b24f', avance: '#84b86c', ready: '#6e9fd0', filmed: '#84b86c',
};

interface Ghost { title: string; x: number; y: number; over: string | null }
interface BoardCtl { menu: (i: Idea) => void; drop: (i: Idea, targetId: string) => void; ghost: (g: Ghost | null) => void; lift: (l: Lift | null) => void }
type Lift = { id: string; mode: 'menu' | 'drag' };
// Paliers de l'appui long : 0,5 s = menu (standard iOS/Android), 1,1 s = déplacer.
// Assez écartés pour être distincts au doigt, assez courts pour rester fluides.
const MENU_MS = 500;
const DRAG_MS = 1100;

// Pendant un glisser, on bloque le défilement de la page (iOS).
const dragState = { active: false };
if (typeof document !== 'undefined') document.addEventListener('touchmove', (e) => { if (dragState.active) e.preventDefault(); }, { passive: false });

/** Appui long en deux paliers, chacun signalé par une vibration et un changement visuel :
 *  0,5 s → relâcher ouvre le menu ; 1 s → la carte se soulève et peut être glissée sur une autre idée.
 *  Bouger avant 1 s annule (c'est un défilement) ; relâcher après 1 s sans bouger ouvre aussi le menu. */
function usePressDrag(idea: Idea, ctl: BoardCtl) {
  const fired = useRef(false);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button) return;
    fired.current = false;
    const sx = e.clientX, sy = e.clientY;
    // La vraie carte suit le doigt (pas une étiquette fantôme).
    const card = (e.currentTarget as HTMLElement).closest('.ic-variant, .idea-card') as HTMLElement | null;
    const host = card?.classList.contains('ic-variant') ? card.closest('.idea-card') as HTMLElement | null : null;
    const place = (dx: number, dy: number) => {
      if (!card) return;
      card.style.transition = 'transform .06s linear, box-shadow .2s';
      card.style.transform = `translate(${dx}px, ${dy}px) scale(1.04) rotate(${Math.max(-3, Math.min(3, dx / 60))}deg)`;
      card.style.zIndex = '60'; card.style.pointerEvents = 'none'; card.style.position = 'relative';
      if (host) { host.style.overflow = 'visible'; host.style.zIndex = '59'; }
    };
    const reset = () => { if (!card) return; card.style.cssText = card.style.cssText.replace(/(transition|transform|z-index|pointer-events|position|opacity):[^;]*;?/g, ''); if (host) { host.style.overflow = ''; host.style.zIndex = ''; } };
    const settle = (to: string, after: () => void) => {
      if (!card) return after();
      card.style.transition = 'transform .32s cubic-bezier(.2, 1.3, .4, 1), opacity .25s';
      card.style.transform = to;
      if (to.includes('scale(.4)')) card.style.opacity = '0';
      window.setTimeout(() => { after(); reset(); }, 320);
    };
    // Barre qui se remplit pendant l'appui : repère « menu » à 0,5 s, pleine à 1,1 s (déplacer).
    const bar = card ? document.createElement('div') : null;
    if (card && bar) {
      bar.className = 'press-bar';
      bar.style.setProperty('--menu-at', `${(MENU_MS / DRAG_MS) * 100}%`);
      bar.style.setProperty('--press-ms', `${DRAG_MS}ms`);
      bar.innerHTML = '<i></i><b></b>';
      (e.currentTarget as HTMLElement).appendChild(bar); // sous la zone appuyée (carte ou variante)
    }
    const dropBar = () => bar?.remove();
    let dragging = false; let over: string | null = null;
    let canDrag = false;
    const t1 = window.setTimeout(() => { fired.current = true; dragState.active = true; ctl.lift({ id: idea.id, mode: 'menu' }); bar?.classList.add('at-menu'); navigator.vibrate?.(10); }, MENU_MS);
    const t2 = window.setTimeout(() => { canDrag = true; ctl.lift({ id: idea.id, mode: 'drag' }); bar?.classList.add('at-drag'); navigator.vibrate?.([12, 60, 12]); }, DRAG_MS);
    const move = (ev: PointerEvent) => {
      const d = Math.hypot(ev.clientX - sx, ev.clientY - sy);
      if (!canDrag) { if (d > 10) { cleanup(); fired.current = false; } return; }
      if (!dragging && d > 8) dragging = true;
      if (!dragging) return;
      dropBar();
      place(ev.clientX - sx, ev.clientY - sy);
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-drop-id]') as HTMLElement | null;
      over = el?.dataset.dropId && el.dataset.dropId !== idea.id ? el.dataset.dropId : null;
      ctl.ghost({ title: idea.title, x: ev.clientX, y: ev.clientY, over });
    };
    const up = (ev: PointerEvent) => {
      const was = fired.current; const target = over; cleanup(); if (!was) return;
      if (!dragging) { reset(); ctl.menu(idea); return; }
      const t = target ? document.querySelector(`[data-drop-id="${target}"]`)?.getBoundingClientRect() : null;
      if (t && card) {
        // la carte « rentre » dans l'idée visée
        const b = card.getBoundingClientRect();
        const dx = ev.clientX - sx + (t.left + t.width / 2 - (b.left + b.width / 2));
        const dy = ev.clientY - sy + (t.top + t.height / 2 - (b.top + b.height / 2));
        settle(`translate(${dx}px, ${dy}px) scale(.4)`, () => ctl.drop(idea, target!));
      } else settle('translate(0px, 0px) scale(1)', () => {});
    };
    const cancel = () => { cleanup(); fired.current = false; settle('translate(0px, 0px) scale(1)', () => {}); };
    function cleanup() {
      dropBar();
      clearTimeout(t1); clearTimeout(t2); dragState.active = false;
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel);
      ctl.ghost(null); ctl.lift(null);
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
  };
  const onContextMenu = (e: React.MouseEvent) => { e.preventDefault(); if ((e.nativeEvent as PointerEvent).pointerType === 'mouse' || !('ontouchstart' in window)) { fired.current = true; ctl.menu(idea); } };
  return { fired, handlers: { onPointerDown, onContextMenu } };
}

/** Numéro de chaque idée : 1 = la plus ancienne (ordre de création, définitif). */
let NUMS = new Map<string, number>();
const numOf = (id: string) => NUMS.get(id);
/** « aujourd’hui 13:20 », « hier 09:12 » ou « 23 nov. 18:05 ». */
export function modifiedLabel(i: Idea) {
  const t = Math.max(i.updatedAt ?? 0, i.lastActivityAt ?? 0, i.createdAt);
  const d = new Date(t); const now = new Date();
  const hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return `aujourd’hui ${hm}`;
  if (diff === 1) return `hier ${hm}`;
  return `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })} ${hm}`;
}

/** Bibliothèque : une carte par idée principale, ses variantes rangées dans un tiroir. */
export function IdeaBoard({ list, all, formats, sources }: { list: Idea[]; all: Idea[]; formats: Format[]; sources: Source[] }) {
  NUMS = useMemo(() => new Map([...all].filter((i) => !i.deletedAt).sort((a, b) => a.createdAt - b.createdAt).map((i, k) => [i.id, k + 1])), [all]);
  const prog = useMemo(() => new Map(all.map((i) => [i.id, ideaProgress(i, sources)])), [all, sources]);
  const auto = useMemo(() => variantFamilies(all), [all]);
  const fams = useMemo(() => groupFamilies(list, auto, (i) => prog.get(i.id)?.pct ?? 0), [list, auto, prog]);
  const [menu, setMenu] = useState<Idea | null>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [lift, setLift] = useState<Lift | null>(null);
  const lifted = lift?.id ?? null;
  const drop = async (i: Idea, targetId: string) => {
    const target = all.find((x) => x.id === targetId);
    if (!target) return;
    await updateIdea(i.id, { parentId: targetId });
    for (const c of all) if (c.parentId === i.id) await updateIdea(c.id, { parentId: targetId });
    const short = (t: string) => (t.length > 34 ? t.slice(0, 32).trimEnd() + "…" : t);
    toast(`Rangée en variante de « ${short(target.title)} »`);
  };
  const ctl: BoardCtl = { menu: setMenu, drop, ghost: setGhost, lift: setLift };
  return (
    <>
      <div className={`board ${lift?.mode === 'drag' ? 'dragging' : ''}`}>{fams.map((f) => <FamilyCard key={f.head.id} fam={f} prog={prog} formats={formats} ctl={ctl} lifted={lifted} lift={lift} over={ghost?.over ?? null} />)}</div>
      {ghost?.over && <p className="drag-hint tiny drag">Relâche pour en faire une variante de « {all.find((x) => x.id === ghost.over)?.title} »</p>}
      {lift && !ghost && <p className={`drag-hint tiny ${lift.mode}`}>{lift.mode === 'menu' ? 'Relâche pour le menu · garde appuyé pour déplacer' : 'Glisse sur une autre idée pour en faire une variante'}</p>}
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

function FamilyCard({ fam, prog, formats, ctl, lifted, lift, over }: { fam: Family<Idea>; prog: Map<string, { pct: number; todo: string[] }>; formats: Format[]; ctl: BoardCtl; lifted: string | null; lift: Lift | null; over: string | null }) {
  const i = fam.head;
  const p = prog.get(i.id) ?? { pct: 0, todo: [] };
  const [open, setOpen] = useState(false);
  const lp = usePressDrag(i, ctl);
  const st = ideaStage(i);
  const step = stepOf(i);
  const color = colorOf(i, p.pct);
  const fmt = formats.find((f) => f.id === i.formatId);
  const Icon = st === 'filmed' ? CircleCheck : st === 'ready' ? Clapperboard : Lightbulb;
  const tag = st === 'ready' ? 'À filmer' : st === 'filmed' ? 'Filmée' : i.importance ? IMPORTANCE[i.importance] : i.paused ? 'Gardée pour plus tard' : BAND_LABEL[bandOf(p.pct)];
  return (
    <div data-drop-id={i.id} className={`idea-card ${open ? 'open' : ''} ${lifted === i.id ? `lifted ${lift?.mode ?? ''}` : ''} ${over === i.id ? 'drop-over' : ''}`} style={{ '--c': color } as React.CSSProperties}>
      <div className="ic-main" role="button" tabIndex={0} onClick={() => { if (lp.fired.current) { lp.fired.current = false; return; } go(`ideas/${i.id}`); }} {...lp.handlers}>
        <div className="ic-top">
          <span className="ic-icon"><Icon size={18} strokeWidth={1.8} /></span>
          {numOf(i.id) && <span className="ic-num" title={`Idée n° ${numOf(i.id)}, créée le ${new Date(i.createdAt).toLocaleDateString('fr-FR')}`}>#{numOf(i.id)}</span>}
          <span className="ic-tag">{tag}</span>
          <span className="ic-date" title="Dernière modification">modif. {modifiedLabel(i)}</span>
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
          {open && <div className="ic-drawer">{fam.children.map((c, k) => <VariantRow key={c.id} idea={c} n={k + 2} pct={prog.get(c.id)?.pct ?? 0} ctl={ctl} lifted={lifted} lift={lift} />)}</div>}
        </>
      )}
    </div>
  );
}

function VariantRow({ idea, n, pct, ctl, lifted, lift }: { idea: Idea; n: number; pct: number; ctl: BoardCtl; lifted: string | null; lift: Lift | null }) {
  const lp = usePressDrag(idea, ctl);
  const later = idea.paused || idea.importance === 'plus-tard';
  const fresh = idea.lastActivityAt - idea.createdAt < 60_000 && !idea.guideStep;
  return (
    <div className={`ic-variant ${lifted === idea.id ? `lifted ${lift?.mode ?? ''}` : ''}`} role="button" tabIndex={0} style={{ '--c': colorOf(idea, pct) } as React.CSSProperties} onClick={() => { if (lp.fired.current) { lp.fired.current = false; return; } go(`ideas/${idea.id}`); }} {...lp.handlers}>
      <span className="ic-vnum">V{n}</span>
      <span className="ic-vtitle">{numOf(idea.id) && <em className="ic-num">#{numOf(idea.id)}</em>}{idea.title}<small>modif. {modifiedLabel(idea)} · {later ? 'gardée pour plus tard' : idea.importance ? IMPORTANCE[idea.importance] : fresh ? 'pas encore commencée' : 'commencée'} · {pct} %</small></span>
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
