import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { db, syncActive } from './db';
import { useRoute } from './hooks';
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
import { Backdrop } from './components/Backdrop';
import { useTuning } from './lib/backdropTuning';
import Lab from './pages/Lab';
import Create from './pages/Create';
import Recap from './pages/Recap';
import Improvements from './pages/Improvements';
import { Sidebar, TopBar, Dock, MoreSheet, Palette, Capture, Toasts } from './components/shell';
import { useLiveQuery } from 'dexie-react-hooks';

/** Dialogue de connexion Dexie Cloud (e-mail → code), affiché quel que soit l'écran. */
function CloudInteraction() {
  const [ui, setUi] = useState<any>(null);
  useEffect(() => { if (!syncActive) return; const sub = db.cloud.userInteraction.subscribe(setUi); return () => sub.unsubscribe(); }, []);
  if (!ui) return null;
  return <Modal open onClose={() => ui.onCancel?.()} title={ui.title}><LoginDialog ui={ui} /></Modal>;
}

/** App installée sur iPhone : les liens externes s'ouvrent dans Safari (vraie page séparée), pas dans une feuille par-dessus l'app. */
function useExternalLinksInSafari() {
  useEffect(() => {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const standalone = (navigator as any).standalone === true || matchMedia('(display-mode: standalone)').matches;
    if (!ios || !standalone) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement)?.closest?.('a[target="_blank"]') as HTMLAnchorElement | null;
      if (!a || !/^https?:/.test(a.href) || a.hasAttribute('download')) return;
      e.preventDefault();
      location.href = 'x-safari-' + a.href;
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
}

export default function App() {
  const { path, query } = useRoute();
  useExternalLinksInSafari();
  const [more, setMore] = useState(false);
  const [palette, setPalette] = useState(false);
  const [capture, setCapture] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((x) => !x); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => { setMore(false); }, [location.hash]);
  // Mises à jour : vérification à l'ouverture, au retour sur l'app et toutes les 30 min ;
  // une nouvelle version s'installe aussitôt et l'app se recharge une seule fois (mode autoUpdate).
  useRegisterSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => { if (navigator.onLine) reg.update().catch(() => {}); };
      check();
      setInterval(check, 30 * 60_000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
      window.addEventListener('focus', check);
    },
  });
  const needRefresh = false;
  const updateServiceWorker = (_reload?: boolean) => { location.reload(); };

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

  const tuning = useTuning();
  // Le fond se met en retrait pendant l'écriture.
  useEffect(() => {
    const isField = (el: EventTarget | null) => el instanceof HTMLElement && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button', 'file'].includes((el as HTMLInputElement).type)) || el.isContentEditable);
    const on = (e: FocusEvent) => { if (isField(e.target)) document.body.classList.add('is-typing'); };
    const off = () => setTimeout(() => { if (!isField(document.activeElement)) document.body.classList.remove('is-typing'); }, 50);
    document.addEventListener('focusin', on); document.addEventListener('focusout', off);
    return () => { document.removeEventListener('focusin', on); document.removeEventListener('focusout', off); };
  }, []);
  const top = path[0] ?? '';
  let page;
  switch (top) {
    case '': page = <Home />; break;
    case 'creer': page = <Create />; break;
    case 'ameliorations': page = <Improvements />; break;
    case 'bac': page = <Inbox />; break;
    case 'articles': page = <Articles />; break;
    case 'formats': page = <Formats id={path[1]} />; break;
    case 'docs': page = <Docs sub={path[1]} id={path[2]} query={query} />; break;
    case 'atelier': page = <Workshop query={query} />; break;
    case 'films': page = <Films id={path[1]} />; break;
    case 'ideas': page = path[1] ? (path[2] === 'recap' ? <Recap id={path[1]} /> : <IdeaDetail id={path[1]} />) : <Ideas />; break;
    case 'planning': page = <Planning />; break;
    case 'stats': page = <Stats />; break;
    case 'settings': page = <SettingsPage />; break;
    case 'fond': page = <Lab />; break;
    default: page = <Home />;
  }

  const subId = top === 'ideas' ? path[1] : undefined;
  const sub = useLiveQuery(() => (subId ? db.ideas.get(subId).then((i) => i?.title) : undefined), [subId]);

  return (
    <div className="app">
      <Backdrop tuning={tuning} />
      <Sidebar top={top} />
      <TopBar top={top} sub={sub} onSearch={() => setPalette(true)} onCapture={() => setCapture(true)} />
      {needRefresh && (
        <div className="update-bar">Une nouvelle version est disponible. <button className="btn sm" onClick={() => updateServiceWorker(true)}>Mettre à jour</button></div>
      )}
      <main className="main"><div className="page" key={location.hash.split('?')[0]}>{page}</div></main>
      <CloudInteraction />
      <Dock top={top} onCapture={() => setCapture(true)} onMore={() => setMore(!more)} />
      {more && <MoreSheet onClose={() => setMore(false)} />}
      {palette && <Palette onClose={() => setPalette(false)} />}
      {capture && <Capture onClose={() => setCapture(false)} />}
      <Toasts />
    </div>
  );
}
