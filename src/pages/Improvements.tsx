import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid } from '../db';
import { Dictate, Empty } from '../components/ui';
import { NAV } from '../components/shell';
import { toast } from '../lib/toast';
import type { Remark } from '../types';
import { PhotoPicker, PhotoStrip } from '../components/photos';
import { HANDLED_BY_CLAUDE } from '../lib/handledRemarks';

const when = (t: number) => new Date(t).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const KINDS: Record<Remark['kind'], string> = { idee: '💡 Idée', gene: '😕 Gêne', bug: '🐞 Bug' };
const PAGES = ['Général', ...NAV.map((n) => n.label), 'Fiche d’une idée', 'Paramètres'];

/** Améliorations : noter remarques et idées d'évolution de l'app, puis les transmettre à Claude. */
export default function Improvements() {
  const remarks = useLiveQuery(() => db.remarks.orderBy('at').reverse().toArray(), []) ?? [];
  // Une fois : ré-enregistre les photos déjà rangées à part par la synchro, pour qu'elles voyagent avec la remarque.
  useEffect(() => {
    try { if (localStorage.getItem('cil.remarks.inlinePhotos')) return; } catch { return; }
    const withPhotos = remarks.filter((r) => r.photos?.length && r.photos.every((p) => typeof p === 'string'));
    if (!remarks.length) return;
    Promise.all(withPhotos.map((r) => db.remarks.update(r.id, { photos: [...r.photos!], updatedAt: Date.now() })))
      .then(() => { try { localStorage.setItem('cil.remarks.inlinePhotos', '1'); } catch { /* */ } });
  }, [remarks.length]);
  // Remarques traitées par Claude (liste publiée avec l'app) : passées en « Traitée » automatiquement.
  useEffect(() => {
    const now = Date.now();
    remarks.filter((r) => r.status === 'open' && HANDLED_BY_CLAUDE[r.id])
      .forEach((r) => db.remarks.update(r.id, { status: 'done', doneBy: 'claude', doneAt: now, updatedAt: now }));
  }, [remarks]);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<Remark['kind']>('idee');
  const [page, setPage] = useState('Général');
  const [photos, setPhotos] = useState<string[]>([]);
  const open = remarks.filter((r) => r.status === 'open');
  const done = remarks.filter((r) => r.status === 'done');

  const add = async () => {
    const t = text.trim() || (photos.length ? 'Voir la photo' : '');
    if (!t) return;
    const now = Date.now();
    await db.remarks.add({ id: uid(), kind, text: t, page, status: 'open', at: now, updatedAt: now, ...(photos.length ? { photos } : {}) });
    setText(''); setPhotos([]);
    toast('Remarque notée.');
  };
  const copy = async () => {
    const body = open.map((r) => `- [${KINDS[r.kind].slice(3)}] (${r.page}) ${r.text}${r.photos?.length ? ` (${r.photos.length} photo${r.photos.length > 1 ? 's' : ''} jointe${r.photos.length > 1 ? 's' : ''})` : ''}`).join('\n');
    try { await navigator.clipboard.writeText(`Mes remarques sur Cinema Idea Lab :\n${body}`); toast('Copié : colle-le à Claude.'); }
    catch { toast('Copie impossible sur cet appareil.'); }
  };

  return (
    <div>
      <div className="page-head">
        <div><h1>Améliorations</h1><p className="muted small">Ce qui te gêne, ce qui manque, une idée d’évolution : note-le ici au moment où tu le vis. Ajoute une capture d’écran si c’est plus parlant. Copie ensuite la liste pour Claude (touche une photo pour la télécharger et la lui envoyer).</p></div>
      </div>

      <div className="card">
        <div className="row between wrap" style={{ marginBottom: 6 }}>
          <div className="seg">{(Object.keys(KINDS) as Remark['kind'][]).map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{KINDS[k]}</button>)}</div>
          <Dictate onText={(t) => setText((x) => (x ? x + ' ' : '') + t)} />
        </div>
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex. Dans Créer, je voudrais pouvoir régénérer une seule idée…" />
        <div className="row wrap" style={{ marginTop: 8 }}>
          <select value={page} onChange={(e) => setPage(e.target.value)} style={{ width: 'auto' }}>{PAGES.map((p) => <option key={p}>{p}</option>)}</select>
          <button className="btn primary" disabled={!text.trim() && !photos.length} onClick={add}>Noter</button>
        </div>
        <div style={{ marginTop: 8 }}><PhotoPicker photos={photos} onChange={setPhotos} /></div>
      </div>

      <div className="row between wrap" style={{ marginTop: 20 }}>
        <h2 style={{ margin: 0 }}>À traiter ({open.length})</h2>
        {open.length > 0 && <button className="btn sm" onClick={copy}>Copier pour Claude</button>}
      </div>
      {open.length ? <ul className="list">{open.map((r) => <RemarkRow key={r.id} r={r} />)}</ul> : <Empty>Aucune remarque en attente.</Empty>}

      {done.length > 0 && (
        <details className="section" style={{ marginTop: 20 }}>
          <summary>Traitées ({done.length}) · grisées</summary>
          <div className="section-body"><ul className="list">{done.map((r) => <RemarkRow key={r.id} r={r} />)}</ul></div>
        </details>
      )}
    </div>
  );
}

function RemarkRow({ r }: { r: Remark }) {
  const toggle = () => db.remarks.update(r.id, r.status === 'open' ? { status: 'done', doneBy: 'moi', doneAt: Date.now(), updatedAt: Date.now() } : { status: 'open', doneBy: undefined, doneAt: undefined, updatedAt: Date.now() });
  return (
    <li style={{ cursor: 'default' }} className={r.status === 'done' ? 'remark-done' : ''}>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <span className="small" style={{ flex: 1, textDecoration: r.status === 'done' ? 'line-through' : undefined }}>{r.text}</span>
        <span className="row" style={{ flex: 'none' }}>
          <button className="btn sm ghost" onClick={toggle}>{r.status === 'open' ? '✓ Fait' : 'Rouvrir'}</button>
          <button className="icon-btn" title="Supprimer" onClick={() => db.remarks.delete(r.id)}>✕</button>
        </span>
      </div>
      <PhotoStrip photos={r.photos} name={`remarque-${new Date(r.at).toISOString().slice(0, 10)}`} />
      <div className="item-meta"><span>{KINDS[r.kind]}</span><span>{r.page}</span><span>Écrite le {when(r.at)}</span>{r.status === 'done' && <span>{r.doneBy === 'claude' ? '✓ Traitée par Claude' : '✓ Faite'}{r.doneAt ? ` le ${when(r.doneAt)}` : ''}</span>}</div>
    </li>
  );
}
