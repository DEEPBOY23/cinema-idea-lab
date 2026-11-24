import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Home, Inbox, LayoutGrid, BookOpen, PenTool, Film, Lightbulb, FolderOpen, CalendarDays, BarChart3, Settings,
  Wand2, MessageSquarePlus, ChevronLeft, ChevronRight, Search, Bell, Plus, Star, MoreHorizontal, Mic, Check, Sparkles, X,
} from 'lucide-react';
import { db } from '../db';
import { go, useIdeas, useSources, useWorks, useFormats, useSettings, useSync } from '../hooks';
import { createIdea } from '../lib/actions';
import { ageTone } from '../lib/aging';
import { statusRank } from '../types';
import { Dictate, useAIProvider, Modal } from './ui';
import { uid } from '../lib/util';
import { toast } from '../lib/toast';
import { PhotoPicker } from './photos';
import { runSuggest, useMemory } from './assist';

export const NAV = [
  { path: '', label: 'Accueil', Icon: Home, group: 'Créer' },
  { path: 'creer', label: 'Créer', Icon: Wand2, group: 'Créer' },
  { path: 'bac', label: 'Bac à idées', Icon: Inbox, group: 'Créer' },
  { path: 'atelier', label: 'Atelier éditorial', Icon: PenTool, group: 'Créer' },
  { path: 'ideas', label: 'Bibliothèque', Icon: Lightbulb, group: 'Organiser' },
  { path: 'articles', label: 'Articles', Icon: FolderOpen, group: 'Organiser' },
  { path: 'docs', label: 'Documentation', Icon: BookOpen, group: 'Organiser' },
  { path: 'formats', label: 'Formats', Icon: LayoutGrid, group: 'Organiser' },
  { path: 'films', label: 'Filmothèque', Icon: Film, group: 'Organiser' },
  { path: 'planning', label: 'Planning', Icon: CalendarDays, group: 'Suivre' },
  { path: 'stats', label: 'Statistiques', Icon: BarChart3, group: 'Suivre' },
  { path: 'ameliorations', label: 'Améliorations', Icon: MessageSquarePlus, group: 'Suivre' },
] as const;
export const labelOf = (top: string) => (top === 'settings' ? 'Paramètres' : top === 'fond' ? 'Réglage du fond' : NAV.find((n) => n.path === top)?.label ?? 'Accueil');

/** Vignette colorée déduite du titre (pas d'affiche en ligne : tout reste local). */
export function Thumb({ title, size = 34 }: { title: string; size?: number }) {
  let h = 0; for (const c of title) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const warm = h % 2 === 0;
  const bg = warm ? `linear-gradient(145deg, #e7a679, #a5603a 55%, #2a1810)` : `linear-gradient(145deg, #8db8ba, #3e6669 55%, #12201f)`;
  return <span className="thumb" style={{ background: bg, width: size, height: size }}>{title.replace(/^\[.*?\]\s*/, '').slice(0, 1).toUpperCase()}</span>;
}

function useCounts() {
  const inbox = useLiveQuery(() => db.inbox.where('status').equals('pending').count(), []) ?? 0;
  const sources = useSources();
  const toRead = sources.filter((s) => s.state === 'toread' || s.state === 'reading').length;
  return { bac: inbox, articles: toRead };
}

export function Sidebar({ top }: { top: string }) {
  const counts = useCounts();
  const ideas = useIdeas();
  const works = useWorks();
  const settings = useSettings();
  const sync = useSync();
  const favs = [...works.filter((w) => w.favorite).map((w) => ({ id: w.id, title: w.title, href: `#/films/${w.id}` })), ...ideas.filter((i) => i.favorite).map((i) => ({ id: i.id, title: i.title, href: `#/ideas/${i.id}` }))].slice(0, 6);
  const [openFav, setOpenFav] = useState(true);
  const groups = ['Créer', 'Organiser', 'Suivre'] as const;
  return (
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><i /><i /><i /><i /></span><span className="brand-name">Cinema<br />Idea Lab</span></div>
      <nav className="nav" aria-label="Navigation principale">
        {groups.map((g, gi) => (
          <div key={g}>
            {gi > 0 && <div className="nav-sep" />}
            {NAV.filter((n) => n.group === g).map(({ path, label, Icon }) => {
              const badge = path === 'bac' ? counts.bac : path === 'articles' ? counts.articles : 0;
              return (
                <a key={path} href={`#/${path}`} className={top === path ? 'active' : ''}>
                  <Icon size={19} strokeWidth={1.7} />{label}{badge > 0 && <span className="badge">{badge}</span>}
                </a>
              );
            })}
          </div>
        ))}
        <div className="nav-sep" />
        <button className="nav-item" onClick={() => setOpenFav(!openFav)}><Star size={19} strokeWidth={1.7} />Favoris<ChevronRight size={16} style={{ marginLeft: 'auto', transform: openFav ? 'rotate(90deg)' : 'none', transition: 'transform .3s' }} /></button>
        {openFav && (favs.length ? favs.map((f) => <a key={f.id} className="fav" href={f.href}><Thumb title={f.title} />{f.title.replace(/^\[.*?\]\s*/, '')}</a>)
          : <p className="tiny muted" style={{ padding: '2px 14px' }}>Touche ★ sur un film ou une idée pour l’épingler ici.</p>)}
      </nav>
      <a className="workspace" href="#/settings">
        <span className="ws-mark" />
        <span style={{ minWidth: 0 }}><b>{settings.workspaceName || 'Mon espace'}</b><span>{sync.ui === 'local' ? 'Local · hors ligne OK' : sync.label}</span></span>
        <Settings size={18} style={{ marginLeft: 'auto', color: 'var(--text-2)' }} />
      </a>
    </aside>
  );
}

export function TopBar({ top, sub, onSearch, onCapture }: { top: string; sub?: string; onSearch: () => void; onCapture: () => void }) {
  const [bell, setBell] = useState(false);
  const [remark, setRemark] = useState(false);
  const reminders = useReminders();
  return (
    <div className="topbar-wrap">
      <div className="topbar">
        {top ? <button className="round-btn" aria-label="Retour" onClick={() => history.back()}><ChevronLeft size={20} /></button>
          : <span className="brand-mobile"><span className="brand-mark" style={{ width: 26, height: 26 }}><i /><i /><i /><i /></span></span>}
        <div className="crumbs"><ChevronRight size={16} style={{ opacity: .5 }} /><b>{labelOf(top)}</b>{sub && <><ChevronRight size={16} style={{ opacity: .5 }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span></>}</div>
        <button className="search-pill" onClick={onSearch} aria-label="Rechercher"><Search size={18} /><span>Rechercher…</span><kbd>⌘ K</kbd></button>
        <button className="round-btn" aria-label="Noter une amélioration" title="Noter une remarque ou une amélioration" onClick={() => setRemark(true)}><MessageSquarePlus size={19} /></button>
        <button className="round-btn" aria-label="Rappels" onClick={() => setBell(!bell)}><Bell size={19} />{reminders.length > 0 && <span className="dot" />}</button>
        <button className="round-btn milk" aria-label="Capturer une idée" onClick={onCapture}><Plus size={20} /></button>
      </div>
      {remark && <QuickRemark page={sub ? `${labelOf(top)} · ${sub}` : labelOf(top)} onClose={() => setRemark(false)} />}
      {bell && (
        <div className="popover glass-dense" onClick={() => setBell(false)}>
          <h3 style={{ padding: '6px 8px 0' }}>Rappels</h3>
          {reminders.length ? reminders.map((r, i) => (
            <a key={i} href={r.href} className="fav" style={{ alignItems: 'flex-start' }}><span style={{ width: 8, height: 8, borderRadius: 9, marginTop: 7, background: r.color, flex: 'none' }} /><span className="small">{r.text}</span></a>
          )) : <p className="small muted" style={{ padding: '4px 8px' }}>Rien en attente. Belle journée de tournage.</p>}
        </div>
      )}
    </div>
  );
}

function useReminders() {
  const ideas = useIdeas();
  const sources = useSources();
  const settings = useSettings();
  const inbox = useLiveQuery(() => db.inbox.where('status').equals('pending').count(), []) ?? 0;
  const out: { text: string; href: string; color: string }[] = [];
  const sleepy = ideas.filter((i) => statusRank(i.status) < statusRank('done') && ['terracotta', 'bordeaux'].includes(ageTone(i, settings.thresholds).tone));
  if (sleepy.length) out.push({ text: `${sleepy.length} idée${sleepy.length > 1 ? 's' : ''} sans activité depuis longtemps (dont « ${sleepy[0].title} »)`, href: `#/ideas/${sleepy[0].id}`, color: 'var(--terracotta)' });
  const toRead = sources.filter((s) => s.state === 'toread').length;
  if (toRead) out.push({ text: `${toRead} article${toRead > 1 ? 's' : ''} à lire dans tes dossiers`, href: '#/articles', color: 'var(--teal-hi)' });
  if (inbox) out.push({ text: `${inbox} idée${inbox > 1 ? 's' : ''} à trier dans le Bac`, href: '#/bac', color: 'var(--copper-hi)' });
  return out;
}

export function Dock({ top, onCapture, onMore }: { top: string; onCapture: () => void; onMore: () => void }) {
  const main = ['', 'creer'];
  const main2 = ['ideas'];
  const item = (p: string) => { const n = NAV.find((x) => x.path === p)!; const I = n.Icon; return <a key={p} href={`#/${p}`} className={top === p ? 'active' : ''}><I size={20} strokeWidth={1.7} /><small>{p === '' ? 'Accueil' : p === 'creer' ? 'Créer' : 'Idées'}</small></a>; };
  const inMore = !['', 'creer', 'ideas'].includes(top);
  return (
    <nav className="tabbar" aria-label="Navigation">
      {main.map(item)}
      <button className="dock-plus" aria-label="Capturer une idée" onClick={onCapture}><Plus size={24} /></button>
      {main2.map(item)}
      <button className={inMore ? 'active' : ''} onClick={onMore}><MoreHorizontal size={20} /><small>Plus</small></button>
    </nav>
  );
}

export function MoreSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="more-sheet" onClick={onClose}>
      <div className="more-inner">
        {NAV.filter((n) => !['', 'creer', 'ideas'].includes(n.path)).map(({ path, label, Icon }) => <a key={path} href={`#/${path}`}><Icon size={19} strokeWidth={1.7} />{label}</a>)}
        <a href="#/settings"><Settings size={19} strokeWidth={1.7} />Paramètres</a>
      </div>
    </div>
  );
}

/** Recherche globale (⌘K) : idées, articles, films, formats, pages. */
export function Palette({ onClose }: { onClose: () => void }) {
  const ideas = useIdeas(); const sources = useSources(); const works = useWorks(); const formats = useFormats();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const items = useMemo(() => {
    const all = [
      ...NAV.map((n) => ({ label: n.label, kind: 'Page', href: `#/${n.path}` })),
      { label: 'Paramètres', kind: 'Page', href: '#/settings' },
      ...ideas.map((i) => ({ label: i.title, kind: 'Idée', href: `#/ideas/${i.id}` })),
      ...sources.map((s) => ({ label: s.title || s.url, kind: 'Article', href: `#/docs/source/${s.id}` })),
      ...works.map((w) => ({ label: `${w.title}${w.year ? ` (${w.year})` : ''}`, kind: 'Film', href: `#/films/${w.id}` })),
      ...formats.map((f) => ({ label: f.name, kind: 'Format', href: `#/formats/${f.id}` })),
    ];
    const t = q.trim().toLowerCase();
    return (t ? all.filter((x) => x.label.toLowerCase().includes(t)) : all.filter((x) => x.kind === 'Page' || x.kind === 'Idée')).slice(0, 40);
  }, [q, ideas, sources, works, formats]);
  useEffect(() => setSel(0), [q]);
  const open = (href: string) => { location.hash = href.slice(1); onClose(); };
  return (
    <div className="palette-bg" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Rechercher">
        <input autoFocus placeholder="Rechercher une idée, un article, un film, une page…" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            if (e.key === 'Enter' && items[sel]) open(items[sel].href);
            if (e.key === 'Escape') onClose();
          }} />
        <ul>{items.map((x, i) => <li key={x.kind + x.href} className={i === sel ? 'sel' : ''} onMouseEnter={() => setSel(i)} onClick={() => open(x.href)}>{x.label}<small>{x.kind}</small></li>)}</ul>
        {!items.length && <p className="small muted" style={{ padding: 12 }}>Aucun résultat.</p>}
      </div>
    </div>
  );
}

/** Capture rapide accessible partout (bouton +). */
export function Capture({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const provider = useAIProvider();
  const memory = useMemory();
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const save = async (then: 'stay' | 'open') => {
    const t = text.trim(); if (!t) return;
    const id = await createIdea({ title: t.split(/[.\n]/)[0].slice(0, 70), observation: t });
    onClose();
    if (then === 'open') { go(`ideas/${id}`); return; }
    if (provider !== 'none') { const idea = await db.ideas.get(id); if (idea) runSuggest(idea, memory).catch(() => {}); }
  };
  const toBac = () => { try { localStorage.setItem('cil.inboxDraft', text); } catch { /* */ } onClose(); go('bac'); };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Capturer une idée">
        <div className="modal-head"><h3 style={{ margin: 0 }}>Capturer une idée</h3><button className="icon-btn" onClick={onClose} aria-label="Fermer"><X size={18} /></button></div>
        <div className="row between" style={{ marginBottom: 8, position: 'relative', zIndex: 1 }}><span className="small muted">Une observation, un hook, une intuition.</span><Dictate onText={(t) => setText((x) => (x ? x + ' ' : '') + t)} /></div>
        <textarea ref={ref} rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex. Dans ce film, la caméra ne quitte jamais la hauteur des yeux de l’enfant…"
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save('stay'); }} />
        <div className="action-bar">
          <button className="btn primary" disabled={!text.trim()} onClick={() => save('stay')}><Check size={17} />Enregistrer</button>
          <button className="btn" disabled={!text.trim()} onClick={() => save('open')}><Sparkles size={17} />Développer</button>
          <button className="btn ghost" disabled={!text.trim()} onClick={toBac}><Inbox size={17} />Plusieurs idées → Bac</button>
        </div>
        {provider !== 'none' && <p className="tiny muted" style={{ marginTop: 10, position: 'relative', zIndex: 1 }}>L’assistant proposera les formats adaptés automatiquement. ⌘ + Entrée pour enregistrer.</p>}
      </div>
    </div>
  );
}

export function Toasts() {
  const [items, setItems] = useState<{ id: number; text: string }[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const id = Date.now() + Math.random();
      setItems((x) => [...x.slice(-2), { id, text: (e as CustomEvent).detail }]);
      setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 2600);
    };
    window.addEventListener('cil-toast', on);
    return () => window.removeEventListener('cil-toast', on);
  }, []);
  return <div className="toasts" aria-live="polite">{items.map((t) => <div key={t.id} className="toast"><Check size={16} className="ok" /><span>{t.text}</span></div>)}</div>;
}

export { Mic };

/** Remarque rapide depuis n'importe quel écran : fenêtre par-dessus la page, on reste où on était. */
function QuickRemark({ page, onClose }: { page: string; onClose: () => void }) {
  const [text, setText] = useState('');
  const [kind, setKind] = useState<'idee' | 'gene' | 'bug'>('idee');
  const [photos, setPhotos] = useState<string[]>([]);
  const save = async () => {
    const now = Date.now();
    await db.remarks.add({ id: uid(), kind, text: text.trim() || 'Voir la photo', page, status: 'open', at: now, updatedAt: now, ...(photos.length ? { photos } : {}) });
    toast('Remarque notée. Retrouve-les dans Améliorations.');
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="Noter une amélioration">
      <p className="tiny muted" style={{ marginTop: 0 }}>Écran : {page}. Tu restes sur ta page.</p>
      <div className="row between wrap" style={{ marginBottom: 6 }}>
        <div className="seg">{([['idee', '💡 Idée'], ['gene', '😕 Gêne'], ['bug', '🐞 Bug']] as const).map(([k, l]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}</div>
        <Dictate onText={(t) => setText((x) => (x ? x + ' ' : '') + t)} />
      </div>
      <textarea autoFocus rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ce qui te gêne, ce qui manque…" />
      <div style={{ marginTop: 8 }}><PhotoPicker photos={photos} onChange={setPhotos} /></div>
      <div className="row wrap" style={{ marginTop: 8 }}>
        <button className="btn primary" disabled={!text.trim() && !photos.length} onClick={save}>Noter</button>
        <button className="btn ghost" onClick={onClose}>Annuler</button>
        <a className="small" href="#/ameliorations" onClick={onClose} style={{ marginLeft: 'auto' }}>Voir toutes mes remarques →</a>
      </div>
    </Modal>
  );
}
