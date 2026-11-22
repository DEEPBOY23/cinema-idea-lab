import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid } from '../db';
import { useSources, useNotes, useIdeas, useWorks, useFormats, useSettings, useOnline, go } from '../hooks';
import type { Source, SourceState, Access, ReadingNote, ClaimNature, LeadKind, Lead } from '../types';
import { SOURCE_STATES, ACCESS_LABELS, SOURCE_TYPES, CLAIM_LABELS, LEAD_LABELS } from '../types';
import { createSource, createNote, softDelete, addJournal, touchIdea } from '../lib/actions';
import { Field, Empty, TagsInput, PromptBox, Section, Modal } from '../components/ui';
import { WorkPicker } from '../components/pickers';
import { buildPrompt, searchLinks } from '../lib/prompts';
import { extractLinks, parseList } from '../lib/text';
import { fmtDate, fmtDateTime } from '../lib/util';
import { WebSourceFinder } from '../components/webSources';
import { titleFromUrl } from '../components/articles';

type Tab = 'sources' | 'notes' | 'files' | 'search';

export default function Docs({ sub, id, query }: { sub?: string; id?: string; query: URLSearchParams }) {
  if (sub === 'source' && id) return <SourceDetail id={id} />;
  if (sub === 'note' && id) return <NoteDetail id={id} />;
  return <DocsHome query={query} />;
}

function DocsHome({ query }: { query: URLSearchParams }) {
  const [tab, setTab] = useState<Tab>((query.get('tab') as Tab) || 'sources');
  const [newOpen, setNewOpen] = useState(query.get('new') === '1');
  const ideaId = query.get('idea') ?? undefined;
  useEffect(() => { if (query.get('tab')) setTab(query.get('tab') as Tab); if (query.get('new') === '1') setNewOpen(true); }, [query.toString()]);
  return (
    <div>
      <div className="page-head">
        <div><h1>Documentation</h1><p className="muted small">Se documenter avant de créer. Faits, déclarations, interprétations et hypothèses restent distingués.</p></div>
        <button className="btn primary" onClick={() => setNewOpen(true)}>+ Source</button>
      </div>
      <div className="seg" style={{ marginBottom: 14 }}>
        {([['sources', 'Sources'], ['notes', 'Notes de lecture'], ['files', 'Documents locaux'], ['search', 'Rechercher']] as [Tab, string][]).map(([t, l]) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{l}</button>
        ))}
      </div>
      {tab === 'sources' && <SourceList />}
      {tab === 'notes' && <NoteList />}
      {tab === 'files' && <LocalFiles />}
      {tab === 'search' && <SearchHelper ideaId={ideaId} />}
      <NewSourceModal open={newOpen} onClose={() => setNewOpen(false)} ideaId={ideaId} />
    </div>
  );
}

function SourceList() {
  const sources = useSources();
  const ideas = useIdeas();
  const [state, setState] = useState<SourceState | ''>('');
  const [q, setQ] = useState('');
  const list = sources.filter((s) => (!state || s.state === state) && `${s.title} ${s.author} ${s.media} ${s.topics.join(' ')}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <div>
      <div className="row wrap" style={{ marginBottom: 10 }}>
        <input placeholder="Rechercher (titre, auteur, thème)" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
        <div className="seg"><button className={!state ? 'on' : ''} onClick={() => setState('')}>Toutes</button>
          {(Object.keys(SOURCE_STATES) as SourceState[]).map((s) => <button key={s} className={state === s ? 'on' : ''} onClick={() => setState(s)}>{SOURCE_STATES[s]} ({sources.filter((x) => x.state === s).length})</button>)}
        </div>
      </div>
      {list.length ? (
        <ul className="list">
          {list.map((s) => (
            <li key={s.id} onClick={() => go(`docs/source/${s.id}`)}>
              <div className="item-title">{s.title || s.url || 'Sans titre'}</div>
              <div className="item-meta">
                <span>{SOURCE_STATES[s.state]}</span><span>{s.type}</span>{s.media && <span>{s.media}</span>}
                <span className={s.access === 'verified' ? '' : 'tag-hypothesis'}>{ACCESS_LABELS[s.access]}</span>
                {s.minutes ? <span>{s.minutes} min</span> : null}{s.localFileId && <span>📎 hors ligne</span>}
                {s.ideaIds.length > 0 && <span>{ideas.filter((i) => s.ideaIds.includes(i.id)).map((i) => i.title).join(', ')}</span>}
              </div>
            </li>
          ))}
        </ul>
      ) : <Empty>Aucune source. Ajoute un lien, importe une liste de résultats ou un document local.</Empty>}
    </div>
  );
}

function NewSourceModal({ open, onClose, ideaId }: { open: boolean; onClose: () => void; ideaId?: string }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [bulk, setBulk] = useState('');
  return (
    <Modal open={open} onClose={onClose} title="Ajouter des sources">
      <div className="stack">
        <label className="field"><span className="field-label">Lien</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></label>
        <label className="field"><span className="field-label">Titre</span><input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <button className="btn primary" disabled={!url.trim() && !title.trim()} onClick={async () => { const id = await createSource({ url: url.trim(), title: title.trim(), ideaIds: ideaId ? [ideaId] : [] }); setUrl(''); setTitle(''); onClose(); go(`docs/source/${id}`); }}>Créer et compléter la fiche</button>
        <hr className="hr" />
        <label className="field"><span className="field-label">…ou importer plusieurs liens d’un coup (résultats de recherche, réponse de Claude)</span>
          <textarea rows={5} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder="Colle du texte contenant des liens : chaque URL devient une source « accès non vérifié »." /></label>
        {bulk && <p className="small muted">{extractLinks(bulk).length} lien(s) détecté(s).</p>}
        <button className="btn" disabled={!extractLinks(bulk).length} onClick={async () => {
          const existing = new Set((await db.sources.toArray()).map((s) => s.url));
          let n = 0;
          for (const l of extractLinks(bulk)) { if (existing.has(l.url)) continue; await createSource({ url: l.url, title: (!l.title || /https?:\/\//.test(l.title) ? titleFromUrl(l.url) : l.title), ideaIds: ideaId ? [ideaId] : [], access: 'unverified' }); n++; }
          alert(`${n} source(s) ajoutée(s). Les doublons ont été ignorés. Vérifie chaque lien avant de t’y fier.`);
          setBulk(''); onClose();
        }}>Importer les liens</button>
      </div>
    </Modal>
  );
}

function SourceDetail({ id }: { id: string }) {
  const s = useLiveQuery(() => db.sources.get(id), [id]);
  const ideas = useIdeas();
  const works = useWorks();
  const notes = useNotes().filter((n) => n.sourceId === id);
  const file = useLiveQuery(() => (s?.localFileId ? db.localFiles.get(s.localFileId) : undefined), [s?.localFileId]);
  const online = useOnline();
  const [check, setCheck] = useState('');
  if (s === undefined) return null;
  if (!s || s.deletedAt) return <Empty>Source introuvable. <a href="#/docs">Retour</a></Empty>;
  const up = async (c: Partial<Source>) => { await db.sources.update(id, { ...c, updatedAt: Date.now() }); for (const i of s.ideaIds) await touchIdea(i); };
  const testLink = async () => {
    setCheck('Test en cours…');
    try {
      await fetch(s.url, { mode: 'no-cors', cache: 'no-store' });
      setCheck('Le serveur a répondu. Cela ne garantit pas que la page existe, qu’elle est gratuite, ni sans inscription : ouvre-la pour vérifier.');
    } catch { setCheck('Aucune réponse du serveur (lien cassé, site bloqué ou hors ligne).'); }
  };
  return (
    <div>
      <div className="row between"><a href="#/docs" className="small">← Documentation</a>
        <button className="btn sm ghost danger" onClick={async () => { if (confirm('Mettre cette source à la corbeille ?')) { await softDelete('sources', id); go('docs'); } }}>Corbeille</button></div>
      <Field table="sources" id={id} field="title" value={s.title} className="title-field" placeholder="Titre" />
      <div className="row wrap" style={{ margin: '10px 0' }}>
        <div className="seg">{(Object.keys(SOURCE_STATES) as SourceState[]).map((x) => <button key={x} className={s.state === x ? 'on' : ''} onClick={() => up({ state: x })}>{SOURCE_STATES[x]}</button>)}</div>
      </div>
      <div className="grid two">
        <Field table="sources" id={id} field="url" value={s.url} label="Lien direct" />
        <div><span className="field-label">Accès</span>
          <select value={s.access} onChange={(e) => up({ access: e.target.value as Access })}>{(Object.keys(ACCESS_LABELS) as Access[]).map((a) => <option key={a} value={a}>{ACCESS_LABELS[a]}</option>)}</select></div>
        <Field table="sources" id={id} field="author" value={s.author} label="Auteur" />
        <Field table="sources" id={id} field="media" value={s.media} label="Média" />
        <Field table="sources" id={id} field="date" value={s.date} label="Date" placeholder="ex. 2019-03" />
        <div><span className="field-label">Type de document</span><select value={s.type} onChange={(e) => up({ type: e.target.value })}>{SOURCE_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
        <label className="field"><span className="field-label">Temps de consultation (min)</span><input type="number" min={0} value={s.minutes ?? ''} onChange={(e) => up({ minutes: e.target.value ? Number(e.target.value) : undefined })} /></label>
        <label className="field"><span className="field-label">Thématiques (séparées par des virgules)</span><TagsInput value={s.topics} onChange={(v) => up({ topics: v })} /></label>
      </div>
      <Field table="sources" id={id} field="interest" value={s.interest} label="Intérêt pour l’idée" multiline rows={2} />
      <div className="row wrap" style={{ marginTop: 10 }}>
        {s.url && <a className="btn sm" href={s.url} target="_blank" rel="noreferrer">Ouvrir le lien ↗</a>}
        {s.url && <button className="btn sm ghost" disabled={!online} onClick={testLink}>Tester le lien</button>}
        {!online && s.url && <span className="small muted">Hors ligne : la page n’est pas consultable (seules tes notes et documents importés le sont).</span>}
      </div>
      {check && <p className="small muted">{check}</p>}

      <Section title="Document local (lecture hors ligne)">
        {file ? (
          <div className="row wrap">
            <span className="small">📎 {file.name} · {(file.size / 1024 / 1024).toFixed(1)} Mo</span>
            <button className="btn sm" onClick={() => window.open(URL.createObjectURL(file.blob), '_blank')}>Ouvrir</button>
            <button className="btn sm ghost" onClick={async () => { if (confirm('Retirer ce document de l’appareil ?')) { await db.localFiles.delete(file.id); await up({ localFileId: undefined }); } }}>Retirer</button>
          </div>
        ) : (
          <>
            <p className="muted small">Importe un PDF, une image ou un texte que tu as le droit de conserver (ex. PDF téléchargé, capture de page). Il reste sur cet appareil et n’est pas synchronisé.</p>
            <input type="file" accept=".pdf,.txt,.md,.html,image/*" onChange={async (e) => {
              const f = e.target.files?.[0]; if (!f) return;
              const fid = uid();
              await db.localFiles.add({ id: fid, name: f.name, type: f.type, size: f.size, blob: f, sourceId: id, addedAt: Date.now() });
              await up({ localFileId: fid });
            }} />
          </>
        )}
      </Section>

      <Section title="Liens">
        <span className="field-label">Idées</span>
        <div className="chips">{ideas.map((i) => <button key={i.id} className={`chip ${s.ideaIds.includes(i.id) ? 'on' : ''}`} onClick={() => up({ ideaIds: s.ideaIds.includes(i.id) ? s.ideaIds.filter((x) => x !== i.id) : [...s.ideaIds, i.id] })}>{i.title}</button>)}</div>
        <span className="field-label" style={{ marginTop: 10 }}>Œuvres</span>
        <WorkPicker works={works} selected={s.workIds} onChange={(ids) => up({ workIds: ids })} />
      </Section>

      <Section title={`Notes après lecture (${notes.length})`}>
        {notes.map((n) => <div key={n.id} className="card" onClick={() => go(`docs/note/${n.id}`)} style={{ cursor: 'pointer' }}>{n.title || 'Notes'} <span className="muted small">· {fmtDate(n.updatedAt)}</span></div>)}
        <button className="btn sm" style={{ marginTop: 8 }} onClick={async () => go(`docs/note/${await createNote({ sourceId: id, ideaId: s.ideaIds[0], title: `Notes — ${s.title}` })}`)}>+ Notes après lecture</button>
      </Section>
    </div>
  );
}

function NoteList() {
  const notes = useNotes().sort((a, b) => b.updatedAt - a.updatedAt);
  const sources = useSources();
  return (
    <div>
      <button className="btn sm" style={{ marginBottom: 10 }} onClick={async () => go(`docs/note/${await createNote({ title: 'Nouvelles notes' })}`)}>+ Notes libres</button>
      {notes.length ? (
        <ul className="list">{notes.map((n) => (
          <li key={n.id} onClick={() => go(`docs/note/${n.id}`)}>
            <div className="item-title">{n.title || 'Notes sans titre'}</div>
            <div className="item-meta"><span>{fmtDate(n.updatedAt)}</span>{n.sourceId && <span>{sources.find((s) => s.id === n.sourceId)?.title}</span>}{n.claims.length > 0 && <span>{n.claims.length} affirmation(s) qualifiée(s)</span>}{n.toVerify && <span className="tag-hypothesis">à vérifier</span>}</div>
          </li>
        ))}</ul>
      ) : <Empty>Pas encore de notes de lecture.</Empty>}
    </div>
  );
}

const NOTE_FIELDS: { k: keyof ReadingNote; l: string }[] = [
  { k: 'learned', l: 'Ce que j’ai appris' }, { k: 'surprised', l: 'Ce qui m’a surpris' }, { k: 'observations', l: 'Mes propres observations' },
  { k: 'rewatch', l: 'Les scènes à revoir' }, { k: 'toVerify', l: 'Les informations à vérifier' }, { k: 'toDeepen', l: 'Les points que je veux approfondir' },
];

function NoteDetail({ id }: { id: string }) {
  const n = useLiveQuery(() => db.notes.get(id), [id]);
  const ideas = useIdeas();
  const works = useWorks();
  const formats = useFormats();
  const settings = useSettings();
  const sources = useSources();
  const notes = useNotes();
  const leads = useLiveQuery(() => db.leads.where('noteId').equals(id).toArray(), [id]) ?? [];
  const journal = useLiveQuery(() => db.journal.where('noteId').equals(id).reverse().sortBy('at'), [id]) ?? [];
  const [point, setPoint] = useState('');
  const [claim, setClaim] = useState(''); const [nature, setNature] = useState<ClaimNature>('fact'); const [ref, setRef] = useState('');
  if (n === undefined) return null;
  if (!n || n.deletedAt) return <Empty>Notes introuvables.</Empty>;
  const idea = ideas.find((i) => i.id === n.ideaId);
  const src = sources.find((s) => s.id === n.sourceId);
  const up = async (c: Partial<ReadingNote>) => { await db.notes.update(id, { ...c, updatedAt: Date.now() }); await touchIdea(n.ideaId); };
  const importLeads = async (resp: string) => {
    const sections: Record<LeadKind, RegExp> = { question: /question/i, source: /source/i, axis: /axe/i, link: /lien|film/i };
    const parts = resp.split(/\n(?=#+\s)/);
    const now = Date.now();
    const toAdd: Lead[] = [];
    for (const p of parts) {
      const head = p.split('\n')[0];
      const kind = (Object.keys(sections) as LeadKind[]).find((k) => /^#/.test(head) && sections[k].test(head)) ?? 'axis';
      const body = /^#/.test(head) ? p.split('\n').slice(1).join('\n') : p;
      for (const t of parseList(body)) toAdd.push({ id: uid(), noteId: id, ideaId: n.ideaId, point, kind, text: t, state: 'proposed', createdAt: now, updatedAt: now });
    }
    await db.leads.bulkAdd(toAdd);
    await addJournal(`Approfondissement demandé : « ${point.slice(0, 120)} » — ${toAdd.length} piste(s) importée(s).`, n.ideaId, id);
  };
  return (
    <div>
      <div className="row between"><a href="#/docs?tab=notes" className="small">← Notes</a>
        <button className="btn sm ghost danger" onClick={async () => { if (confirm('Mettre ces notes à la corbeille ?')) { await softDelete('notes', id); go('docs?tab=notes'); } }}>Corbeille</button></div>
      <Field table="notes" id={id} field="title" value={n.title} className="title-field" placeholder="Titre" />
      <div className="row wrap small muted" style={{ margin: '8px 0' }}>
        {src && <a href={`#/docs/source/${src.id}`}>Source : {src.title}</a>}
        <select style={{ width: 'auto' }} value={n.ideaId ?? ''} onChange={(e) => up({ ideaId: e.target.value || undefined })}>
          <option value="">— Aucune idée liée —</option>{ideas.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}
        </select>
        {idea && <a href={`#/ideas/${idea.id}`}>Ouvrir l’idée</a>}
      </div>
      <div className="grid two">
        {NOTE_FIELDS.map((f) => (
          <div key={f.k}>
            <Field table="notes" id={id} field={f.k} value={(n[f.k] as string) ?? ''} label={f.l} multiline rows={3} versioned onSaved={() => touchIdea(n.ideaId)} />
            {(n[f.k] as string) && <button className="link-btn small" onClick={() => setPoint(n[f.k] as string)}>Approfondir ce point →</button>}
          </div>
        ))}
      </div>

      <Section title={`Affirmations qualifiées (${n.claims.length})`}>
        <p className="muted small">Distingue ce qui est documenté de ce qui relève de ta lecture.</p>
        {n.claims.map((c) => (
          <div key={c.id} className="row" style={{ alignItems: 'flex-start', marginBottom: 6 }}>
            <span className={`chip tag-${c.nature}`}>{CLAIM_LABELS[c.nature]}</span>
            <span className="small" style={{ flex: 1 }}>{c.text}{c.ref && <span className="muted"> — {c.ref}</span>}</span>
            <button className="icon-btn" onClick={() => up({ claims: n.claims.filter((x) => x.id !== c.id) })}>✕</button>
          </div>
        ))}
        <div className="grid two">
          <input placeholder="Affirmation" value={claim} onChange={(e) => setClaim(e.target.value)} />
          <select value={nature} onChange={(e) => setNature(e.target.value as ClaimNature)}>{(Object.keys(CLAIM_LABELS) as ClaimNature[]).map((k) => <option key={k} value={k}>{CLAIM_LABELS[k]}</option>)}</select>
          <input placeholder="Référence (source, minutage, page)" value={ref} onChange={(e) => setRef(e.target.value)} />
          <button className="btn sm" disabled={!claim.trim()} onClick={async () => { await up({ claims: [...n.claims, { id: uid(), text: claim.trim(), nature, ref: ref.trim() }] }); setClaim(''); setRef(''); }}>Ajouter</button>
        </div>
        {(nature === 'statement') && !ref && <p className="small tag-hypothesis">Une déclaration vérifiée doit avoir une référence.</p>}
      </Section>

      <Section title="Approfondir ce point" open={!!point}>
        <textarea rows={2} value={point} onChange={(e) => setPoint(e.target.value)} placeholder="Sélectionne un point ci-dessus ou écris-le" />
        {point.trim() && (
          <PromptBox mode="deepen" ideaId={n.ideaId} input={point} importLabel="Importer les pistes"
            prompt={buildPrompt('deepen', { idea, works, formats, sources, notes, settings }, point)} onImport={importLeads} />
        )}
      </Section>

      {leads.length > 0 && (
        <Section title={`Pistes (${leads.filter((l) => l.state === 'accepted').length} retenues / ${leads.length})`}>
          {(Object.keys(LEAD_LABELS) as LeadKind[]).map((k) => {
            const ls = leads.filter((l) => l.kind === k);
            if (!ls.length) return null;
            return (
              <div key={k} style={{ marginBottom: 10 }}>
                <h3>{LEAD_LABELS[k]}</h3>
                {ls.map((l) => (
                  <div key={l.id} className="row" style={{ alignItems: 'flex-start', marginBottom: 6, opacity: l.state === 'rejected' ? 0.45 : 1 }}>
                    <textarea rows={2} defaultValue={l.text} onBlur={(e) => e.target.value !== l.text && db.leads.update(l.id, { text: e.target.value, updatedAt: Date.now() })} />
                    <div className="seg" style={{ flexDirection: 'column' }}>
                      <button className={l.state === 'accepted' ? 'on' : ''} onClick={() => db.leads.update(l.id, { state: l.state === 'accepted' ? 'proposed' : 'accepted', updatedAt: Date.now() })}>Retenir</button>
                      <button className={l.state === 'rejected' ? 'on' : ''} onClick={() => db.leads.update(l.id, { state: l.state === 'rejected' ? 'proposed' : 'rejected', updatedAt: Date.now() })}>Rejeter</button>
                    </div>
                  </div>
                ))}
                {k === 'source' && ls.some((l) => l.state === 'accepted' && /https?:\/\//.test(l.text)) && (
                  <button className="btn sm" onClick={async () => {
                    for (const l of ls.filter((x) => x.state === 'accepted')) for (const link of extractLinks(l.text)) await createSource({ url: link.url, title: link.title, ideaIds: n.ideaId ? [n.ideaId] : [], access: 'unverified' });
                  }}>Ajouter les sources retenues (accès non vérifié)</button>
                )}
              </div>
            );
          })}
        </Section>
      )}
      {journal.length > 0 && (
        <Section title="Historique de cette recherche" open={false}>
          <ul className="timeline">{journal.map((j) => <li key={j.id}><span className="muted tiny">{fmtDateTime(j.at)}</span><br />{j.text}</li>)}</ul>
        </Section>
      )}
    </div>
  );
}

function LocalFiles() {
  const files = useLiveQuery(() => db.localFiles.orderBy('addedAt').reverse().toArray(), []) ?? [];
  const sources = useSources();
  const total = files.reduce((a, f) => a + f.size, 0);
  return (
    <div>
      <p className="muted small">Documents stockés uniquement sur cet appareil ({(total / 1024 / 1024).toFixed(1)} Mo). Consultables hors ligne. Non synchronisés : importe-les aussi sur ton autre appareil, ou inclus-les dans un export.</p>
      <input type="file" accept=".pdf,.txt,.md,.html,image/*" multiple onChange={async (e) => {
        for (const f of Array.from(e.target.files ?? [])) {
          const fid = uid();
          await db.localFiles.add({ id: fid, name: f.name, type: f.type, size: f.size, blob: f, addedAt: Date.now() });
          const sid = await createSource({ title: f.name.replace(/\.[^.]+$/, ''), localFileId: fid, access: 'verified', type: 'Autre' });
          await db.localFiles.update(fid, { sourceId: sid });
        }
        e.target.value = '';
      }} />
      <ul className="list compact" style={{ marginTop: 10 }}>
        {files.map((f) => (
          <li key={f.id}>
            <span>📎 {f.name}</span>
            <span className="row">
              <span className="muted small">{(f.size / 1024).toFixed(0)} Ko · {sources.find((s) => s.id === f.sourceId)?.title ?? 'sans fiche'}</span>
              <button className="btn sm" onClick={() => window.open(URL.createObjectURL(f.blob), '_blank')}>Ouvrir</button>
              {f.sourceId && <a className="btn sm ghost" href={`#/docs/source/${f.sourceId}`}>Fiche</a>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SearchHelper({ ideaId }: { ideaId?: string }) {
  const ideas = useIdeas(); const works = useWorks(); const formats = useFormats(); const settings = useSettings(); const sources = useSources(); const notes = useNotes();
  const [sel, setSel] = useState(ideaId ?? '');
  const idea = ideas.find((i) => i.id === sel);
  const iw = works.filter((w) => idea?.workIds.includes(w.id));
  const fmt = formats.find((f) => f.id === idea?.formatId);
  const [q, setQ] = useState('');
  useEffect(() => { if (idea) setQ([iw.map((w) => w.title).join(' '), iw[0]?.director, fmt?.name === 'Color Stories' ? 'color palette' : 'cinematography'].filter(Boolean).join(' ')); }, [sel]);
  const online = useOnline();
  return (
    <div className="stack">
      <p className="note small">Aucune API de recherche gratuite sans clé n’est intégrée : l’app prépare des requêtes ciblées qui s’ouvrent dans ton navigateur, et un prompt pour Claude. Importe ensuite les liens trouvés (bouton « + Source » → import multiple).</p>
      <select value={sel} onChange={(e) => setSel(e.target.value)}><option value="">— Recherche libre —</option>{ideas.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}</select>
      <label className="field"><span className="field-label">Requête</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ex. Roger Deakins lighting interview" /></label>
      <WebSourceFinder subject={q} idea={idea} />
      <p className="small muted" style={{ margin: '4px 0' }}>Ou cherche toi-même :</p>
      <div className="row wrap">{searchLinks(q).map((l) => <a key={l.label} className={`btn sm ${online ? '' : 'ghost'}`} href={l.url} target="_blank" rel="noreferrer">{l.label} ↗</a>)}</div>
      {!online && <p className="small muted">Hors ligne : les liens s’ouvriront quand la connexion reviendra.</p>}
      <h3 style={{ marginTop: 14 }}>Inspiration documentaire avec Claude</h3>
      <PromptBox mode="inspiration" ideaId={idea?.id} input={q} importLabel="Enregistrer et importer les liens"
        prompt={buildPrompt('inspiration', { idea, works, formats, sources, notes, settings }, '', { subject: q || idea?.title })}
        onImport={async (r) => {
          const existing = new Set(sources.map((s) => s.url));
          let n = 0;
          for (const l of extractLinks(r)) { if (existing.has(l.url)) continue; await createSource({ url: l.url, title: (!l.title || /https?:\/\//.test(l.title) ? titleFromUrl(l.url) : l.title), ideaIds: idea ? [idea.id] : [], access: 'unverified' }); n++; }
          if (n) alert(`${n} lien(s) ajouté(s) aux sources avec le statut « accès non vérifié ». Ouvre-les pour les vérifier.`);
        }} />
    </div>
  );
}
