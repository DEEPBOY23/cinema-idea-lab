import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { db, syncActive } from './db';
import { useRoute, useSync, go } from './hooks';
import { autoBackupIfDue } from './lib/backup';
import Home from './pages/Home';
import Formats from './pages/Formats';
import Docs from './pages/Docs';
import Workshop from './pages/Workshop';
import Films from './pages/Films';
import Ideas from './pages/Ideas';
import Inbox from './pages/Inbox';
import Articles from './pages/Articles';
import IdeaDetail from './pages/IdeaDetail';
import Planning from './pages/Planning';
import Stats from './pages/Stats';
import SettingsPage, { LoginDialog } from './pages/Settings';
import { Modal } from './components/ui';

const NAV = [
  { path: '', label: 'Accueil', icon: '◐' },
  { path: 'bac', label: 'Bac à idées', icon: '⧉' },
  { path: 'formats', label: 'Les 8 formats', icon: '▦' },
  { path: 'docs', label: 'Documentation', icon: '❡' },
  { path: 'atelier', label: 'Atelier', icon: '✎' },
  { path: 'films', label: 'Filmothèque', icon: '▶' },
  { path: 'ideas', label: 'Idées', icon: '◇' },
  { path: 'articles', label: 'Articles', icon: '❏' },
  { path: 'planning', label: 'Planning', icon: '▤' },
  { path: 'stats', label: 'Statistiques', icon: '∿' },
  { path: 'settings', label: 'Paramètres', icon: '⚙' },
];
const MOBILE_MAIN = ['', 'bac', 'ideas', 'atelier'];

export function SyncBadge({ compact = false }: { compact?: boolean }) {
  const s = useSync();
  return (
    <button className={`sync sync-${s.ui}`} onClick={() => go('settings')} title={s.error ?? s.label}>
      <i />{!compact && <span>{s.label}</span>}
    </button>
  );
}

/** Dialogue de connexion Dexie Cloud (e-mail → code), affiché quel que soit l'écran. */
function CloudInteraction() {
  const [ui, setUi] = useState<any>(null);
  useEffect(() => { if (!syncActive) return; const sub = db.cloud.userInteraction.subscribe(setUi); return () => sub.unsubscribe(); }, []);
  if (!ui) return null;
  return <Modal open onClose={() => ui.onCancel?.()} title={ui.title}><LoginDialog ui={ui} /></Modal>;
}

export default function App() {
  const { path, query } = useRoute();
  const [more, setMore] = useState(false);
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    // Vérifie les nouvelles versions à l'ouverture, au retour sur l'app et toutes les 30 min.
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => { if (navigator.onLine) reg.update().catch(() => {}); };
      check();
      setInterval(check, 30 * 60_000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    },
  });
  // Mise à jour automatique dès que tu n'es pas en train d'écrire (sinon, bandeau « Mettre à jour »).
  useEffect(() => {
    if (!needRefresh) return;
    const tryApply = () => {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (!typing) updateServiceWorker(true);
    };
    const t = setTimeout(tryApply, 1500);
    // Laisser le temps au champ quitté d'enregistrer avant de recharger.
    const onOut = () => setTimeout(tryApply, 1000);
    document.addEventListener('focusout', onOut);
    return () => { clearTimeout(t); document.removeEventListener('focusout', onOut); };
  }, [needRefresh]);

  useEffect(() => {
    // Stockage persistant (évite l'éviction par le navigateur) + sauvegarde auto locale quotidienne
    navigator.storage?.persist?.().catch(() => {});
    autoBackupIfDue(db).catch(() => {});
    // Synchro à l'ouverture et au retour au premier plan (le mobile ne garantit pas l'arrière-plan)
    if (!syncActive) return;
    const onVis = () => { if (document.visibilityState === 'visible' && navigator.onLine) db.cloud.sync({ wait: false, purpose: 'pull' }).catch(() => {}); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('online', onVis); };
  }, []);

  const top = path[0] ?? '';
  let page;
  switch (top) {
    case '': page = <Home />; break;
    case 'bac': page = <Inbox />; break;
    case 'articles': page = <Articles />; break;
    case 'formats': page = <Formats id={path[1]} />; break;
    case 'docs': page = <Docs sub={path[1]} id={path[2]} query={query} />; break;
    case 'atelier': page = <Workshop query={query} />; break;
    case 'films': page = <Films id={path[1]} />; break;
    case 'ideas': page = path[1] ? <IdeaDetail id={path[1]} /> : <Ideas />; break;
    case 'planning': page = <Planning />; break;
    case 'stats': page = <Stats />; break;
    case 'settings': page = <SettingsPage />; break;
    default: page = <Home />;
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">Cinema <b>Idea Lab</b></div>
        <nav>
          {NAV.map((n) => (
            <a key={n.path} href={`#/${n.path}`} className={top === n.path ? 'active' : ''}><span className="ni">{n.icon}</span>{n.label}</a>
          ))}
        </nav>
        <div className="sidebar-foot"><SyncBadge /></div>
      </aside>
      <header className="mobile-top">
        <div className="brand">Cinema <b>Idea Lab</b></div>
        <SyncBadge compact />
      </header>
      {needRefresh && (
        <div className="update-bar">Une nouvelle version est disponible. <button className="btn sm" onClick={() => updateServiceWorker(true)}>Mettre à jour</button></div>
      )}
      <main className="main">{page}</main>
      <CloudInteraction />
      <nav className="tabbar">
        {NAV.filter((n) => MOBILE_MAIN.includes(n.path)).map((n) => (
          <a key={n.path} href={`#/${n.path}`} className={top === n.path ? 'active' : ''} onClick={() => setMore(false)}><span className="ni">{n.icon}</span><small>{n.label.replace('Bac à idées', 'Bac')}</small></a>
        ))}
        <button className={more || !MOBILE_MAIN.includes(top) ? 'active' : ''} onClick={() => setMore(!more)}><span className="ni">⋯</span><small>Plus</small></button>
      </nav>
      {more && (
        <div className="more-sheet" onClick={() => setMore(false)}>
          <div className="more-inner">
            {NAV.filter((n) => !MOBILE_MAIN.includes(n.path)).map((n) => (
              <a key={n.path} href={`#/${n.path}`}><span className="ni">{n.icon}</span>{n.label}</a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
