import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSyncConfig, setSyncConfig, syncActive, deviceId, SYNCED_TABLES } from '../db';
import { useSettings, saveSettings, useSync, useOnline } from '../hooks';
import { exportAll, importBackup, downloadJson, autoBackupIfDue, type BackupFile } from '../lib/backup';
import { restore } from '../lib/actions';
import { Section } from '../components/ui';
import { fmtDateTime } from '../lib/util';
import { DEFAULT_SYNC_URL } from '../config';
import { getClaudeConfig, setClaudeConfig, clearClaudeConfig, testClaudeKey, CLAUDE_MODELS } from '../lib/claude';
import { getOpenAIConfig, setOpenAIConfig, clearOpenAIConfig, listOpenAIModels, pickDefaultModel, setProvider, providerLabel, getGeminiConfig, setGeminiConfig, clearGeminiConfig, probeGeminiModels } from '../lib/ai';
import { useAIProvider } from '../components/ui';

export default function SettingsPage() {
  return (
    <div>
      <div className="page-head"><div><h1>Paramètres</h1><p className="muted small">Appareil : {deviceId}</p></div></div>
      <SyncSection />
      <AssistantSection />
      <BackupSection />
      <TrashSection />
      <PrefsSection />
      <StorageSection />
      <AboutSection />
    </div>
  );
}

function SyncSection() {
  const cfg = getSyncConfig();
  const [url, setUrl] = useState(cfg.databaseUrl || DEFAULT_SYNC_URL);
  const s = useSync();
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const enable = () => {
    if (!/^https:\/\/[a-z0-9]+\.dexie\.cloud\/?$/i.test(url.trim()) && !confirm('Cette adresse ne ressemble pas à une base Dexie Cloud (https://xxxx.dexie.cloud). Continuer ?')) return;
    setSyncConfig({ enabled: true, databaseUrl: url.trim().replace(/\/$/, '') });
    location.reload();
  };
  const disable = () => {
    if (!confirm('Désactiver la synchronisation sur cet appareil ? Tes données locales restent intactes et utilisables. Tu restes connecté au compte pour une réactivation ultérieure.')) return;
    setSyncConfig({ enabled: false, databaseUrl: url.trim() });
    location.reload();
  };
  const syncNow = async () => {
    setBusy(true); setMsg('');
    try {
      await db.cloud.sync({ wait: true, purpose: 'push' });
      await db.cloud.sync({ wait: true, purpose: 'pull' });
      setMsg('Synchronisation terminée.');
    } catch (e: any) { setMsg(`Échec : ${e?.message ?? e}`); }
    setBusy(false);
  };
  const login = async () => { setMsg(''); try { await db.cloud.login(); } catch (e: any) { setMsg(`Connexion impossible : ${e?.message ?? e}`); } };
  const logout = async () => {
    if (!confirm('Se déconnecter du compte ? IMPORTANT : Dexie Cloud efface alors la copie locale des données synchronisées sur cet appareil (elles restent sur le serveur et sur tes autres appareils). Une sauvegarde JSON va être téléchargée d’abord.')) return;
    downloadJson(await exportAll(db, false), `cinema-idea-lab-avant-deconnexion-${new Date().toISOString().slice(0, 10)}.json`);
    try { await db.cloud.logout(); setMsg('Déconnecté.'); } catch (e: any) { setMsg(`${e?.message ?? e}`); }
  };

  return (
    <Section title="Synchronisation (facultative)">
      <p className="small">État : <b>{s.label}</b>{s.lastSync ? ` · dernière synchro ${fmtDateTime(s.lastSync.getTime())}` : ''}{s.user?.email ? ` · compte ${s.user.email}` : ''}</p>
      {s.error && <p className="note warn small">Erreur : {s.error}</p>}
      {!syncActive ? (
        <>
          <p className="muted small">L’application fonctionne entièrement en local. Ta base est déjà prête : clique sur « Activer la synchronisation » sur chaque appareil (Mac et téléphone), puis connecte-toi avec le même e-mail.</p>
          <label className="field"><span className="field-label">Adresse de la base Dexie Cloud</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxxxxxx.dexie.cloud" /></label>
          <button className="btn primary" style={{ marginTop: 8 }} disabled={!url.trim().startsWith('https://')} onClick={enable}>Activer la synchronisation</button>
        </>
      ) : (
        <>
          <div className="row wrap">
            {!s.user?.isLoggedIn ? <button className="btn primary" disabled={!online} onClick={login}>Se connecter (code par e-mail)</button>
              : <button className="btn primary" disabled={busy || !online} onClick={syncNow}>{busy ? 'Synchronisation…' : 'Synchroniser maintenant'}</button>}
            <button className="btn ghost" onClick={disable}>Désactiver sur cet appareil</button>
            {s.user?.isLoggedIn && <button className="btn ghost danger" onClick={logout}>Se déconnecter</button>}
          </div>
          {!online && <p className="small muted">Hors ligne : les modifications sont gardées localement et partiront à la reconnexion.</p>}
          <p className="tiny muted">Base : {cfg.databaseUrl}. La synchro a lieu à l’ouverture, à la reconnexion, au retour sur l’app et en continu (WebSocket) quand l’app est ouverte. Sur mobile, rien ne tourne en arrière-plan quand l’app est fermée.</p>
        </>
      )}
      {msg && <p className="small">{msg}</p>}
      <details style={{ marginTop: 8 }}><summary className="small muted">Confidentialité réelle</summary>
        <ul className="small muted">
          <li>Données isolées par utilisateur : chaque compte n’accède qu’à ses propres données (contrôle d’accès côté serveur Dexie Cloud).</li>
          <li>Chiffrement en transit (HTTPS/WSS) et au repos selon l’hébergeur. <b>Ce n’est pas un chiffrement de bout en bout</b> : l’opérateur du service pourrait techniquement lire les données stockées.</li>
          <li>Aucune clé secrète n’est dans le code : l’adresse de base n’est pas un secret, l’authentification se fait par code e-mail.</li>
          <li>Les documents locaux (PDF, images) et les sauvegardes automatiques ne quittent jamais l’appareil.</li>
        </ul>
      </details>
    </Section>
  );
}

/** Interface de connexion Dexie Cloud (e-mail puis code à usage unique). */
export function LoginDialog({ ui }: { ui: any }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  return (
    <div>
      {ui.options?.length > 0 && <div className="row wrap" style={{ marginBottom: 8 }}>{ui.options.map((o: any) => <button key={o.value} className="btn sm" onClick={() => ui.onSubmit({ [o.name]: o.value })}>{o.displayName}</button>)}</div>}
      {ui.alerts?.map((a: any, i: number) => <p key={i} className={`small ${a.type === 'error' ? 'tag-hypothesis' : 'muted'}`}>{a.message?.replace(/\{(\w+)\}/g, (_: string, k: string) => a.messageParams?.[k] ?? '')}</p>)}
      {Object.entries(ui.fields ?? {}).map(([name, f]: [string, any]) => (
        <label key={name} className="field"><span className="field-label">{f.label ?? (name === 'email' ? 'E-mail' : name === 'otp' ? 'Code reçu par e-mail' : name)}</span>
          <input type={f.type === 'password' ? 'password' : f.type === 'email' ? 'email' : 'text'} inputMode={f.type === 'otp' ? 'numeric' : undefined} autoComplete={f.type === 'otp' ? 'one-time-code' : undefined} placeholder={f.placeholder} value={vals[name] ?? ''} onChange={(e) => setVals({ ...vals, [name]: e.target.value })} autoFocus /></label>
      ))}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn primary" onClick={() => ui.onSubmit(vals)}>{ui.submitLabel ?? 'Valider'}</button>
        {ui.cancelLabel && <button className="btn ghost" onClick={ui.onCancel}>{ui.cancelLabel}</button>}
      </div>
    </div>
  );
}

function BackupSection() {
  const [withFiles, setWithFiles] = useState(false);
  const [mode, setMode] = useState<'merge' | 'overwrite'>('merge');
  const [msg, setMsg] = useState('');
  const autos = useLiveQuery(() => db.autoBackups.orderBy('at').reverse().toArray(), []) ?? [];
  const doImport = async (data: BackupFile) => {
    // Filet de sécurité : instantané local avant toute restauration
    await autoBackupIfDue(db, Date.now() + 10 * 86_400_000);
    const r = await importBackup(db, data, mode);
    setMsg(`Restauration : ${r.added} ajouté(s), ${r.updated} mis à jour, ${r.kept} conservé(s) (version locale plus récente)${r.files ? `, ${r.files} document(s)` : ''}. Aucun doublon créé.`);
  };
  return (
    <Section title="Sauvegarde et restauration">
      <p className="note small">La synchronisation n’est pas une sauvegarde : une suppression se propage. Exporte régulièrement un fichier que tu ranges ailleurs (iCloud Drive, disque externe…).</p>
      <div className="row wrap" style={{ marginTop: 10 }}>
        <button className="btn primary" onClick={async () => downloadJson(await exportAll(db, withFiles), `cinema-idea-lab-${new Date().toISOString().slice(0, 10)}.json`)}>Exporter (JSON complet)</button>
        <label className="row small"><input type="checkbox" checked={withFiles} onChange={(e) => setWithFiles(e.target.checked)} /> inclure les documents locaux (fichier plus lourd)</label>
      </div>
      <h3 style={{ marginTop: 16 }}>Restaurer un fichier</h3>
      <div className="seg" style={{ marginBottom: 8 }}>
        <button className={mode === 'merge' ? 'on' : ''} onClick={() => setMode('merge')}>Fusionner (garder le plus récent)</button>
        <button className={mode === 'overwrite' ? 'on' : ''} onClick={() => setMode('overwrite')}>La sauvegarde prime</button>
      </div>
      <input type="file" accept="application/json,.json" onChange={async (e) => {
        const f = e.target.files?.[0]; if (!f) return;
        try { await doImport(JSON.parse(await f.text())); } catch (err: any) { setMsg(`Erreur : ${err?.message ?? err}`); }
        e.target.value = '';
      }} />
      {msg && <p className="small" style={{ marginTop: 8 }}>{msg}</p>}
      <h3 style={{ marginTop: 16 }}>Sauvegardes automatiques locales ({autos.length})</h3>
      <p className="muted small">Une par jour au lancement, 10 conservées, sur cet appareil uniquement (non synchronisées).</p>
      <ul className="list compact">
        {autos.map((b) => (
          <li key={b.id}><span>{fmtDateTime(b.at)}</span>
            <span className="row"><span className="muted small">{(b.size / 1024).toFixed(0)} Ko</span>
              <button className="btn sm" onClick={() => downloadJson(JSON.parse(b.json), `cinema-idea-lab-auto-${new Date(b.at).toISOString().slice(0, 10)}.json`)}>Télécharger</button>
              <button className="btn sm ghost" onClick={async () => { if (confirm('Restaurer cette sauvegarde (fusion sans doublon) ?')) await doImport(JSON.parse(b.json)); }}>Restaurer</button></span></li>
        ))}
      </ul>
    </Section>
  );
}

function TrashSection() {
  const ideas = useLiveQuery(() => db.ideas.filter((x) => !!x.deletedAt).toArray(), []) ?? [];
  const works = useLiveQuery(() => db.works.filter((x) => !!x.deletedAt).toArray(), []) ?? [];
  const sources = useLiveQuery(() => db.sources.filter((x) => !!x.deletedAt).toArray(), []) ?? [];
  const notes = useLiveQuery(() => db.notes.filter((x) => !!x.deletedAt).toArray(), []) ?? [];
  const formats = useLiveQuery(() => db.formats.filter((x) => !!x.deletedAt).toArray(), []) ?? [];
  const all = [
    ...ideas.map((x) => ({ t: 'ideas', id: x.id, label: x.title, kind: 'Idée', at: x.deletedAt! })),
    ...works.map((x) => ({ t: 'works', id: x.id, label: x.title, kind: 'Œuvre', at: x.deletedAt! })),
    ...sources.map((x) => ({ t: 'sources', id: x.id, label: x.title || x.url, kind: 'Source', at: x.deletedAt! })),
    ...notes.map((x) => ({ t: 'notes', id: x.id, label: x.title, kind: 'Notes', at: x.deletedAt! })),
    ...formats.map((x) => ({ t: 'formats', id: x.id, label: x.name, kind: 'Format', at: x.deletedAt! })),
  ].sort((a, b) => b.at - a.at);
  return (
    <Section title={`Corbeille (${all.length})`} open={false}>
      <p className="muted small">Les suppressions sont réversibles, y compris après synchronisation. La suppression définitive est manuelle.</p>
      {all.map((x) => (
        <div key={x.t + x.id} className="row between" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
          <span className="small">{x.kind} · {x.label || 'sans titre'} <span className="muted tiny">({fmtDateTime(x.at)})</span></span>
          <span className="row"><button className="btn sm" onClick={() => restore(x.t, x.id)}>Restaurer</button>
            <button className="btn sm ghost danger" onClick={() => confirm('Supprimer définitivement ? Action irréversible (sauf via une sauvegarde).') && db.table(x.t).delete(x.id)}>Supprimer</button></span>
        </div>
      ))}
    </Section>
  );
}

function PrefsSection() {
  const s = useSettings();
  const [style, setStyle] = useState(s.styleProfile);
  useEffect(() => setStyle(s.styleProfile), [s.styleProfile]);
  return (
    <Section title="Préférences" open={false}>
      <span className="field-label">Seuils d’ancienneté (jours sans activité)</span>
      <div className="grid three">
        {(['Ambre après', 'Terracotta après', 'Bordeaux après'] as const).map((l, i) => (
          <label key={l} className="small muted">{l}<input type="number" min={1} value={s.thresholds[i]} onChange={(e) => { const t = [...s.thresholds] as [number, number, number]; t[i] = Number(e.target.value); saveSettings({ thresholds: t }); }} /></label>
        ))}
      </div>
      <label className="field" style={{ marginTop: 10 }}><span className="field-label">Débit oral (mots par minute) pour estimer les durées</span><input type="number" min={80} max={260} value={s.wpm} onChange={(e) => saveSettings({ wpm: Number(e.target.value) })} /></label>
      <div style={{ marginTop: 10 }}><span className="field-label">Spoilers dans les prompts</span>
        <div className="seg"><button className={s.spoilers === 'avoid' ? 'on' : ''} onClick={() => saveSettings({ spoilers: 'avoid' })}>Éviter</button><button className={s.spoilers === 'ok' ? 'on' : ''} onClick={() => saveSettings({ spoilers: 'ok' })}>Autorisés</button></div></div>
      <label className="field" style={{ marginTop: 10 }}><span className="field-label">Mon style / ma personnalité (ajouté aux prompts)</span>
        <textarea rows={4} value={style} onChange={(e) => setStyle(e.target.value)} onBlur={() => style !== s.styleProfile && saveSettings({ styleProfile: style })} placeholder="Ton, vocabulaire, rythme, tics à éviter, exemples de phrases que tu dirais…" /></label>
    </Section>
  );
}

function StorageSection() {
  const [est, setEst] = useState<{ usage?: number; quota?: number; persisted?: boolean }>({});
  const [syncSize, setSyncSize] = useState(0);
  useEffect(() => {
    (async () => {
      const e = await navigator.storage?.estimate?.();
      const p = await navigator.storage?.persisted?.();
      setEst({ usage: e?.usage, quota: e?.quota, persisted: p });
      let n = 0; for (const t of SYNCED_TABLES) n += JSON.stringify(await db.table(t).toArray()).length;
      setSyncSize(n);
    })().catch(() => {});
  }, []);
  const mb = (n?: number) => (n === undefined ? '?' : `${(n / 1024 / 1024).toFixed(1)} Mo`);
  return (
    <Section title="Stockage et quotas" open={false}>
      <p className="small">Stockage local utilisé : {mb(est.usage)} sur {mb(est.quota)} disponibles · stockage persistant : {est.persisted ? 'oui' : 'non garanti'}.</p>
      <p className="small">Volume des données synchronisables : ≈ {mb(syncSize)} (notes, liens, métadonnées — sans les documents locaux).</p>
      <p className="muted small">Le quota Dexie Cloud n’est pas lisible depuis l’app : vérifie l’offre gratuite en vigueur et ton usage sur dexie.org et via « npx dexie-cloud » (voir README).</p>
      {!est.persisted && <button className="btn sm" onClick={async () => { const ok = await navigator.storage?.persist?.(); setEst({ ...est, persisted: ok }); }}>Demander un stockage persistant</button>}
    </Section>
  );
}

function AboutSection() {
  return (
    <Section title="Fonctionnement hors ligne et limites" open={false}>
      <ul className="small">
        <li>Hors ligne : tout fonctionne (idées, formats, filmothèque, notes, documents importés, atelier local, planning, statistiques, export/import).</li>
        <li>Une page web enregistrée par son URL n’est pas consultable hors ligne : importe le document si tu en as le droit.</li>
        <li>Aucune IA intégrée : l’atelier prépare des prompts pour Claude et récupère tes réponses collées.</li>
        <li>La dictée dépend du navigateur (sur Chrome, elle passe par un service en ligne). Sur iPhone, la dictée du clavier fonctionne dans tous les champs.</li>
        <li>Conflits : Dexie Cloud fusionne champ par champ ; si un même texte est modifié sur deux appareils, la dernière écriture gagne, mais l’autre version est conservée dans l’historique des versions.</li>
      </ul>
    </Section>
  );
}

/** Assistant IA : Gemini gratuit par défaut ; ChatGPT et Claude (payants) en option pour plus tard. */
function AssistantSection() {
  const provider = useAIProvider();
  const online = useOnline();
  const gc = getGeminiConfig();
  const [gkey, setGkey] = useState(gc.apiKey);
  const [gmodels, setGmodels] = useState<string[]>(gc.models?.length ? gc.models : gc.model ? [gc.model] : []);
  const [gmodel, setGmodel] = useState(gc.model);
  const oc = getOpenAIConfig();
  const [okey, setOkey] = useState(oc.apiKey);
  const [models, setModels] = useState<string[]>(oc.model ? [oc.model] : []);
  const [omodel, setOmodel] = useState(oc.model);
  const cc = getClaudeConfig();
  const [ckey, setCkey] = useState(cc.apiKey);
  const [cmodel, setCmodel] = useState(cc.model);
  const [msg, setMsg] = useState('');

  const connectGemini = async () => {
    setMsg('Connexion à Gemini…');
    try {
      const ok = await probeGeminiModels(gkey.trim(), setMsg);
      if (!ok.length) { setMsg('Clé valide, mais aucun modèle Gemini n’a répondu (surcharge ?). Réessaie dans quelques minutes.'); return; }
      setGmodels(ok); setGmodel(ok[0]);
      setGeminiConfig({ apiKey: gkey.trim(), model: ok[0], models: ok }); setProvider('gemini');
      setMsg(`Connecté à Gemini. ${ok.length} modèle${ok.length > 1 ? 's répondent' : ' répond'} ; principal : ${ok[0]}. Si l’un est surchargé, l’app passe automatiquement au suivant.`);
    } catch (e: any) { setMsg(e?.message ?? String(e)); }
  };
  const connectOpenAI = async () => {
    setMsg('Connexion à OpenAI…');
    try {
      const ids = await listOpenAIModels(okey.trim());
      if (!ids.length) { setMsg('Clé valide, mais aucun modèle de texte accessible avec ce compte.'); return; }
      const m = omodel && ids.includes(omodel) ? omodel : pickDefaultModel(ids);
      setModels(ids); setOmodel(m);
      setOpenAIConfig({ apiKey: okey.trim(), model: m }); setProvider('openai');
      setMsg(`Connecté à ChatGPT (${m}).`);
    } catch (e: any) { setMsg(e?.message ?? String(e)); }
  };

  return (
    <Section title={`Assistant IA · ${providerLabel(provider)}`} open={provider === 'none'}>
      <p className="small">Avec l’assistant, l’app <b>rattache chaque idée à tes formats</b>, <b>trie ton bac à idées du plus rapide au plus long</b> et répond directement dans l’atelier, sans quitter l’app. Sans assistant, tout fonctionne avec des règles simples et le copier-coller.</p>

      <div className="card" style={{ marginTop: 10 }}>
        <h3>Gemini (Google) · gratuit, recommandé</h3>
        <ol className="small" style={{ margin: '0 0 8px', paddingLeft: 18 }}>
          <li>Ouvre <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a> et connecte-toi avec ton compte Google.</li>
          <li>Clique sur « Create API key » (aucune carte bancaire demandée), puis copie la clé.</li>
          <li>Colle-la ici et clique sur « Connecter ». C’est tout.</li>
        </ol>
        <input type="password" autoComplete="off" value={gkey} onChange={(e) => setGkey(e.target.value)} placeholder="Clé Gemini (AIza…)" />
        {gmodels.length > 1 && (
          <label className="field"><span className="field-label">Modèle principal (parmi ceux qui ont répondu au test)</span>
            <select value={gmodel} onChange={(e) => { setGmodel(e.target.value); setGeminiConfig({ apiKey: gkey.trim(), model: e.target.value, models: gmodels }); }}>{gmodels.map((m) => <option key={m}>{m}</option>)}</select></label>
        )}
        <div className="row wrap" style={{ marginTop: 8 }}>
          <button className="btn primary" disabled={!gkey.trim() || !online} onClick={connectGemini}>Connecter</button>
          {provider !== 'gemini' && gc.apiKey && <button className="btn ghost" onClick={() => { setProvider('gemini'); setMsg('Gemini est l’assistant actif.'); }}>Utiliser Gemini</button>}
          {gc.apiKey && <button className="btn ghost danger" onClick={() => { clearGeminiConfig(); setGkey(''); setGmodels([]); setGmodel(''); setMsg('Clé Gemini effacée de cet appareil.'); }}>Effacer la clé</button>}
        </div>
        <p className="tiny muted" style={{ marginTop: 8 }}>Gratuit avec des limites quotidiennes (largement suffisantes pour trier des idées). Sur l’offre gratuite, Google peut utiliser les textes envoyés pour améliorer ses services : n’y mets rien de confidentiel. Conditions à vérifier sur le site de Google.</p>
      </div>

      {msg && <p className="small" style={{ marginTop: 8 }}>{msg}</p>}

      <details style={{ marginTop: 12 }}>
        <summary className="small muted">Options payantes, pour plus tard : ChatGPT ou Claude via leur API</summary>
        <p className="small muted" style={{ marginTop: 8 }}>Les abonnements ChatGPT Plus et Claude Pro ne peuvent pas être reliés à une app. Ces options demandent une clé API payée à l’usage (compte séparé).</p>
        <div className="card">
          <h3>ChatGPT (OpenAI)</h3>
          <input type="password" autoComplete="off" value={okey} onChange={(e) => setOkey(e.target.value)} placeholder="sk-…" />
          {models.length > 1 && <select style={{ marginTop: 8 }} value={omodel} onChange={(e) => { setOmodel(e.target.value); setOpenAIConfig({ apiKey: okey.trim(), model: e.target.value }); }}>{models.map((m) => <option key={m}>{m}</option>)}</select>}
          <div className="row wrap" style={{ marginTop: 8 }}>
            <button className="btn" disabled={!okey.trim() || !online} onClick={connectOpenAI}>Connecter</button>
            {oc.apiKey && <button className="btn ghost danger" onClick={() => { clearOpenAIConfig(); setOkey(''); setModels([]); setOmodel(''); setMsg('Clé OpenAI effacée.'); }}>Effacer</button>}
          </div>
        </div>
        <div className="card">
          <h3>Claude (Anthropic)</h3>
          <input type="password" autoComplete="off" value={ckey} onChange={(e) => setCkey(e.target.value)} placeholder="sk-ant-…" />
          <select style={{ marginTop: 8 }} value={cmodel} onChange={(e) => setCmodel(e.target.value)}>{CLAUDE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
          <div className="row wrap" style={{ marginTop: 8 }}>
            <button className="btn" disabled={!ckey.trim() || !online} onClick={async () => {
              setMsg('Vérification…');
              const r = await testClaudeKey(ckey.trim());
              if (r === 'Clé valide.') { setClaudeConfig({ apiKey: ckey.trim(), model: cmodel }); setProvider('claude'); setMsg('Connecté à Claude.'); } else setMsg(r);
            }}>Connecter</button>
            {cc.apiKey && <button className="btn ghost danger" onClick={() => { clearClaudeConfig(); setCkey(''); setMsg('Clé Claude effacée.'); }}>Effacer</button>}
          </div>
        </div>
      </details>

      {provider !== 'none' && <button className="btn sm ghost" style={{ marginTop: 10 }} onClick={() => { setProvider('none'); setMsg('Assistant désactivé : règles simples et copier-coller. Tes clés restent enregistrées.'); }}>Désactiver l’assistant</button>}
      {provider === 'none' && (gc.apiKey || oc.apiKey || cc.apiKey) && <button className="btn sm" style={{ marginTop: 10 }} onClick={() => { setProvider(gc.apiKey ? 'gemini' : oc.apiKey ? 'openai' : 'claude'); setMsg('Assistant réactivé.'); }}>Réactiver l’assistant</button>}

      <details style={{ marginTop: 8 }}><summary className="small muted">Mémoire et confidentialité</summary>
        <ul className="small muted">
          <li>L’IA ne se souvient de rien d’une demande à l’autre. C’est l’app qui garde ta mémoire et la lui transmet à chaque fois : tes formats, tes films vus, ton style, tes derniers choix de format et d’angle, tes délais réels.</li>
          <li>Ces échanges n’apparaissent pas dans ton compte Gemini ou ChatGPT : ils restent dans l’app (historique de l’atelier, fiches d’idées).</li>
          <li>Les clés restent sur cet appareil (jamais synchronisées ni exportées). Saisis-la aussi sur ton téléphone pour y avoir l’assistant.</li>
        </ul>
      </details>
    </Section>
  );
}
