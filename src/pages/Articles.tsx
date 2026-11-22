import { useMemo, useState } from 'react';
import { useIdeas, useSources, useFormats, useSettings } from '../hooks';
import type { Idea, Source } from '../types';
import { statusRank } from '../types';
import { ArticleRow, AddArticle, ReadProgress, STATE_ICON, SummarizeAll } from '../components/articles';
import { ageTone } from '../lib/aging';
import { Empty } from '../components/ui';

type Filter = 'all' | 'toread' | 'read';

export default function Articles() {
  const ideas = useIdeas();
  const sources = useSources();
  const formats = useFormats();
  const settings = useSettings();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [target, setTarget] = useState('');
  const [showEmpty, setShowEmpty] = useState(false);

  const visible = (s: Source) => {
    if (filter === 'toread' && !(s.state === 'toread' || s.state === 'reading')) return false;
    if (filter === 'read' && !(s.state === 'read' || s.state === 'deepen')) return false;
    if (q && !`${s.title} ${s.url} ${s.media} ${s.topics.join(' ')}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  };

  const { folders, empty, archived, orphans } = useMemo(() => {
    const byIdea = (i: Idea) => sources.filter((s) => s.ideaIds.includes(i.id));
    const sorted = [...ideas].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    const done = (i: Idea) => statusRank(i.status) >= statusRank('done');
    return {
      folders: sorted.filter((i) => !done(i) && byIdea(i).length).map((i) => ({ idea: i, items: byIdea(i) })),
      empty: sorted.filter((i) => !done(i) && !byIdea(i).length),
      archived: sorted.filter((i) => done(i) && byIdea(i).length).map((i) => ({ idea: i, items: byIdea(i) })),
      orphans: sources.filter((s) => !s.ideaIds.some((id) => ideas.some((i) => i.id === id))),
    };
  }, [ideas, sources]);

  const ctx = { ideas, formats, settings, visible, filtering: !!q || filter !== 'all' };
  const toRead = sources.filter((s) => s.state === 'toread' || s.state === 'reading').length;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Articles</h1>
          <p className="muted small">Un dossier par idée : tes articles y sont rangés, à relire quand tu crées ton post. {sources.length} article{sources.length > 1 ? 's' : ''} · {toRead} à lire.</p>
        </div>
      </div>

      <div className="card">
        <h3 style={{ margin: '0 0 8px' }}>Ranger un article</h3>
        <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ marginBottom: 8 }}>
          <option value="">Dans quelle idée ? (sinon : « Sans idée »)</option>
          {ideas.filter((i) => statusRank(i.status) < statusRank('done')).map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}
        </select>
        <AddArticle ideaId={target || undefined} />
        <p className="tiny muted" style={{ margin: '6px 0 0' }}>Astuce : tu peux coller plusieurs liens d’un coup. Chaque article arrive en « À lire » ; clique sur son rond pour le passer en cours, puis lu.</p>
      </div>

      <div className="row wrap" style={{ margin: '16px 0 10px' }}>
        <input placeholder="Chercher un article…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} />
        <div className="seg">
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>Tous</button>
          <button className={filter === 'toread' ? 'on' : ''} onClick={() => setFilter('toread')}>{STATE_ICON.toread} À lire</button>
          <button className={filter === 'read' ? 'on' : ''} onClick={() => setFilter('read')}>{STATE_ICON.read} Lus</button>
        </div>
      </div>

      {folders.length || orphans.length ? (
        <div className="folders">
          {folders.map((f) => <FolderCard ctx={ctx} key={f.idea.id} idea={f.idea} items={f.items} />)}
          {orphans.filter(visible).length > 0 && (
            <section className="folder">
              <header className="folder-head"><div><span className="folder-title">🗂 Sans idée</span><div className="item-meta"><span>Range-les avec ⇄</span></div></div></header>
              <div className="folder-list">{orphans.filter(visible).map((s) => <ArticleRow key={s.id} s={s} ideas={ideas} />)}</div>
            </section>
          )}
        </div>
      ) : <Empty>Aucun article pour l’instant. Colle un lien ci-dessus, ou ajoute-en depuis « Trouver des sources » dans l’atelier.</Empty>}

      {empty.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <button className="link-btn small" onClick={() => setShowEmpty(!showEmpty)}>{showEmpty ? '▾' : '▸'} Idées sans article ({empty.length})</button>
          {showEmpty && <div className="folders" style={{ marginTop: 10 }}>{empty.map((i) => <FolderCard ctx={ctx} key={i.id} idea={i} items={[]} />)}</div>}
        </div>
      )}

      {archived.length > 0 && (
        <details className="section" style={{ marginTop: 18 }}>
          <summary>Idées réalisées ou publiées ({archived.length})</summary>
          <div className="section-body folders">{archived.map((f) => <FolderCard ctx={ctx} key={f.idea.id} idea={f.idea} items={f.items} dim />)}</div>
        </details>
      )}
    </div>
  );
}

interface Ctx { ideas: Idea[]; formats: ReturnType<typeof useFormats>; settings: ReturnType<typeof useSettings>; visible: (s: Source) => boolean; filtering: boolean }

function FolderCard({ ctx, idea, items, dim = false }: { ctx: Ctx; idea: Idea; items: Source[]; dim?: boolean }) {
  const shown = items.filter(ctx.visible);
  const fmt = ctx.formats.find((f) => f.id === idea.formatId);
  const { tone } = ageTone(idea, ctx.settings.thresholds);
  if (!shown.length && ctx.filtering) return null;
  return (
    <section className={`folder edge-${tone}`} style={dim ? { opacity: 0.75 } : undefined}>
      <header className="folder-head">
        <div style={{ minWidth: 0 }}>
          <a href={`#/ideas/${idea.id}`} className="folder-title">📁 {idea.title}</a>
          <div className="item-meta">{fmt && <span>{fmt.name}</span>}<span>{items.length} article{items.length > 1 ? 's' : ''}</span></div>
        </div>
        {items.length > 0 && <div style={{ width: 130 }}><ReadProgress sources={items} /></div>}
      </header>
      {shown.length > 0 && <div className="folder-list">{shown.map((s) => <ArticleRow key={s.id} s={s} ideas={ctx.ideas} currentIdeaId={idea.id} />)}</div>}
      <SummarizeAll items={items} idea={idea} />
      <details className="folder-add" open={!items.length}><summary>+ Ajouter un article à ce dossier</summary><AddArticle ideaId={idea.id} compact /></details>
    </section>
  );
}
