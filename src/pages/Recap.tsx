import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useFormats, useSources, useWorks } from '../hooks';
import { Empty } from '../components/ui';
import { liveEstimate } from '../lib/estimate';
import { ideaStage, setFilmed } from '../lib/stage';
import { SOURCE_STATES } from '../types';

/** Fiche récap : tout ce qu'il faut pour tourner, sur une page. Affichable dans l'app ou exportable en PDF. */
export default function Recap({ id }: { id: string }) {
  const idea = useLiveQuery(() => db.ideas.get(id), [id]);
  const formats = useFormats();
  const works = useWorks();
  const sources = useSources();
  if (idea === undefined) return <p className="muted">Chargement…</p>;
  if (!idea) return <Empty>Idée introuvable.</Empty>;
  const fmt = formats.find((f) => f.id === idea.formatId);
  const e = liveEstimate(idea, fmt, formats);
  const iWorks = works.filter((w) => idea.workIds.includes(w.id));
  const iSources = sources.filter((s) => s.ideaIds.includes(id));
  const chosen = idea.angles.filter((a) => a.chosen);
  const total = idea.structure.reduce((a, b) => a + (Number(b.seconds) || 0), 0);
  const stage = ideaStage(idea);
  const script = idea.script.trim() ? idea.script : idea.scriptAI ?? '';

  return (
    <div className="recap">
      <div className="row between wrap no-print" style={{ marginBottom: 10 }}>
        <a className="small" href={`#/ideas/${id}`}>← Retour à la fiche</a>
        <div className="row wrap">
          {stage !== 'cloud' && <label className="row small"><input type="checkbox" checked={stage === 'filmed'} onChange={(ev) => setFilmed(idea, ev.target.checked)} /> Filmée</label>}
          <button className="btn sm primary" onClick={() => window.print()}>Exporter en PDF</button>
        </div>
      </div>

      <div className="card recap-sheet">
        <div className="row between wrap" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            <span className={`chip recap-stage-${stage}`}><i className={`sdot sdot-${stage}`} />{stage === 'filmed' ? 'Filmée' : stage === 'ready' ? 'À filmer' : 'En cours'}</span>
            <h1 style={{ margin: '8px 0 4px' }}>{idea.title}</h1>
            <p className="small muted" style={{ margin: 0 }}>{[fmt && `${fmt.name} (${fmt.minSec}–${fmt.maxSec} sec)`, iWorks.map((w) => `${w.title}${w.year ? ` (${w.year})` : ''}`).join(', ')].filter(Boolean).join(' · ')}</p>
          </div>
          <div><b style={{ fontSize: '1.3rem' }}>≈ {e.total} h</b><div className="tiny muted">doc {e.doc} h · tournage {e.shoot} h · montage {e.edit} h</div></div>
        </div>

        {idea.hook && <RecapBlock title="Hook"><p className="recap-hook">« {idea.hook} »</p></RecapBlock>}
        {(idea.angle || chosen.length > 0) && <RecapBlock title="Angle retenu"><p>{idea.angle || chosen.map((a) => a.text.split('\n')[0]).join(' + ')}</p></RecapBlock>}
        {idea.observation && <RecapBlock title="Observation de départ"><p>{idea.observation}</p></RecapBlock>}

        {idea.structure.length > 0 && (
          <RecapBlock title={`Structure · ${total} sec`}>
            {idea.structure.map((b) => (
              <div key={b.id} className="recap-beat"><b>{b.label}</b><span className="tiny muted">{b.seconds} sec</span><span>{b.content}</span></div>
            ))}
          </RecapBlock>
        )}

        {script && (
          <RecapBlock title={idea.script.trim() ? `Script${idea.scriptReviewed ? ' · finalisé' : ' · à relire'}` : 'Script de l’IA · à relire'}>
            <pre className="script-view">{script}</pre>
          </RecapBlock>
        )}

        <RecapBlock title={`Sources (${iSources.length})`}>
          {iSources.length ? <ul className="recap-list">{iSources.map((s) => <li key={s.id}><a href={s.url} target="_blank" rel="noreferrer">{s.title || s.url}</a> <span className="tiny muted">· {SOURCE_STATES[s.state]}{s.url ? ` · ${s.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}` : ''}</span></li>)}</ul>
            : <p className="small muted">Aucune source rattachée.</p>}
        </RecapBlock>

        {idea.missingInfo.trim() && <RecapBlock title="À vérifier avant de tourner"><pre className="script-view">{idea.missingInfo}</pre></RecapBlock>}
      </div>
    </div>
  );
}

function RecapBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="recap-block"><h3>{title}</h3>{children}</section>;
}
