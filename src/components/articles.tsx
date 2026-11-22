import { useState } from 'react';
import { db } from '../db';
import type { Source, SourceState, Idea } from '../types';
import { SOURCE_STATES } from '../types';
import { createSource, touchIdea } from '../lib/actions';
import { extractLinks } from '../lib/text';
import { go } from '../hooks';

// Cycle de lecture d'un article : un clic fait avancer l'état.
const NEXT: Record<SourceState, SourceState> = { toread: 'reading', reading: 'read', read: 'deepen', deepen: 'toread' };
export const STATE_ICON: Record<SourceState, string> = { toread: '○', reading: '◐', read: '●', deepen: '✦' };

export const domainOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

/** Titre lisible déduit de l'adresse : « interview-roger-deakins » → « Interview roger deakins · site.com ». */
export function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const seg = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '').replace(/\.(html?|php|aspx?)$/i, '').replace(/[-_+]+/g, ' ').trim();
    const dom = domainOf(url);
    if (!seg || /^\d+$/.test(seg)) return dom;
    return `${seg.charAt(0).toUpperCase()}${seg.slice(1)} · ${dom}`;
  } catch { return url; }
}

/** Une ligne d'article : état cliquable, titre, site, ouvrir, ranger ailleurs. */
export function ArticleRow({ s, ideas, currentIdeaId }: { s: Source; ideas: Idea[]; currentIdeaId?: string }) {
  const [moving, setMoving] = useState(false);
  const dom = domainOf(s.url);
  const cycle = async () => {
    await db.sources.update(s.id, { state: NEXT[s.state], updatedAt: Date.now() });
    for (const i of s.ideaIds) await touchIdea(i);
  };
  return (
    <div className={`article art-${s.state}`}>
      <button className="art-state" onClick={cycle} title={`${SOURCE_STATES[s.state]} — cliquer pour passer à « ${SOURCE_STATES[NEXT[s.state]]} »`}>
        <span>{STATE_ICON[s.state]}</span><small>{SOURCE_STATES[s.state]}</small>
      </button>
      <div className="art-body" onClick={() => go(`docs/source/${s.id}`)}>
        <div className="art-title">{s.title || dom || 'Article sans titre'}</div>
        <div className="art-meta">
          {dom && <span className="art-dom">{dom}</span>}
          {s.minutes ? <span>{s.minutes} min</span> : null}
          {s.access !== 'verified' && <span className="tag-hypothesis">à vérifier</span>}
          {s.localFileId && <span>📎 hors ligne</span>}
          {s.ideaIds.length > 1 && <span>dans {s.ideaIds.length} idées</span>}
        </div>
      </div>
      <div className="art-actions">
        {s.url && <a className="icon-btn" href={s.url} target="_blank" rel="noreferrer" title="Ouvrir l’article">↗</a>}
        <button className="icon-btn" title="Ranger dans une autre idée" onClick={() => setMoving(!moving)}>⇄</button>
      </div>
      {moving && (
        <div className="art-move">
          <select defaultValue="" onChange={async (e) => {
            const v = e.target.value; if (!v) return;
            const [mode, id] = v.split(':');
            const ideaIds = mode === 'add' ? [...new Set([...s.ideaIds, id])]
              : mode === 'move' ? [...s.ideaIds.filter((x) => x !== currentIdeaId), id].filter((x, i, a) => a.indexOf(x) === i)
              : s.ideaIds.filter((x) => x !== currentIdeaId);
            await db.sources.update(s.id, { ideaIds, updatedAt: Date.now() });
            if (id) await touchIdea(id);
            setMoving(false);
          }}>
            <option value="">Ranger cet article…</option>
            <optgroup label="Déplacer vers">
              {ideas.filter((i) => i.id !== currentIdeaId).map((i) => <option key={'m' + i.id} value={`move:${i.id}`}>{i.title}</option>)}
            </optgroup>
            <optgroup label="Ajouter aussi à">
              {ideas.filter((i) => !s.ideaIds.includes(i.id)).map((i) => <option key={'a' + i.id} value={`add:${i.id}`}>{i.title}</option>)}
            </optgroup>
            {currentIdeaId && <option value="remove:">Retirer de cette idée (garder dans « Sans idée »)</option>}
          </select>
        </div>
      )}
    </div>
  );
}

/** Ajout express : colle un lien (ou plusieurs), un titre facultatif, et l'article est rangé dans l'idée. */
export function AddArticle({ ideaId, compact = false }: { ideaId?: string; compact?: boolean }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [msg, setMsg] = useState('');
  const add = async () => {
    const links = extractLinks(url);
    const existing = await db.sources.toArray();
    if (!links.length && !title.trim()) return;
    let n = 0;
    const list = links.length ? links : [{ url: '', title: title.trim() }];
    for (const l of list) {
      const dup = l.url && existing.find((e) => e.url === l.url && !e.deletedAt);
      if (dup) {
        if (ideaId && !dup.ideaIds.includes(ideaId)) await db.sources.update(dup.id, { ideaIds: [...dup.ideaIds, ideaId], updatedAt: Date.now() });
        n++; continue;
      }
      const guessed = l.title && !/https?:\/\//.test(l.title) && l.title !== domainOf(l.url) ? l.title : '';
      await createSource({ url: l.url, title: (list.length === 1 && title.trim()) || guessed || titleFromUrl(l.url), ideaIds: ideaId ? [ideaId] : [], access: 'unverified', type: 'Article de fond' });
      n++;
    }
    setUrl(''); setTitle('');
    setMsg(n > 1 ? `${n} articles rangés ✓` : 'Article rangé ✓');
    setTimeout(() => setMsg(''), 2500);
  };
  return (
    <div className={`add-article ${compact ? 'compact' : ''}`}>
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Colle le lien d’un article (ou plusieurs)" onKeyDown={(e) => e.key === 'Enter' && add()} />
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre (facultatif)" onKeyDown={(e) => e.key === 'Enter' && add()} />
      <button className="btn sm primary" disabled={!url.trim() && !title.trim()} onClick={add}>+ Ranger</button>
      {msg && <span className="small" style={{ color: 'var(--done)' }}>{msg}</span>}
    </div>
  );
}

/** Barre de progression de lecture d'un dossier. */
export function ReadProgress({ sources }: { sources: Source[] }) {
  const read = sources.filter((s) => s.state === 'read' || s.state === 'deepen').length;
  const pct = sources.length ? (read / sources.length) * 100 : 0;
  return (
    <div className="row" style={{ gap: 8 }}>
      <div className="progress" style={{ flex: 1 }}><i style={{ width: `${pct}%` }} /></div>
      <span className="tiny muted">{read}/{sources.length} lu{read > 1 ? 's' : ''}</span>
    </div>
  );
}
