import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { BUILTIN_FORMATS, DEFAULT_SETTINGS } from '../src/defaults';
import { localSuggest, splitLocal, memoryBlock, totalOf } from '../src/lib/assistant';
import { extractJson, pickOpenAIModel, pickGeminiModel, openAIMonthlyEstimate } from '../src/lib/ai';
import { LabDB } from '../src/schema';
import Dexie from 'dexie';

describe('bac à idées sans IA', () => {
  it('sépare par paragraphes ou par puces', () => {
    expect(splitLocal('Idée un sur la couleur.\n\nIdée deux sur un plan.\n\n\nIdée trois')).toHaveLength(3);
    expect(splitLocal('- tester un 24 mm\n- règle des 180°\n- palette rouge')).toEqual(['tester un 24 mm', 'règle des 180°', 'palette rouge']);
    expect(splitLocal('   ')).toEqual([]);
  });
  it('rattache par mots-clés et estime un effort', () => {
    const s = localSuggest('La palette rouge et la couleur corail suivent le personnage', BUILTIN_FORMATS);
    expect(s.formats[0].formatId).toBe('fmt-color-stories');
    expect(s.source).toBe('local');
    expect(s.estimate!.totalHours).toBe(s.estimate!.docHours + s.estimate!.shootHours + s.estimate!.editHours);
    const exp = localSuggest('Je compare un objectif 24 mm vs 85 mm en test', BUILTIN_FORMATS);
    expect(exp.formats.map((f) => f.formatId)).toContain('fmt-experiments');
    expect(localSuggest('blabla', BUILTIN_FORMATS).formats).toHaveLength(0);
  });
  it('classe sans estimation en dernier', () => {
    expect(totalOf(undefined)).toBe(Infinity);
  });
});

describe('réponses de l’IA', () => {
  it('lit le JSON même entouré de texte ou de balises', () => {
    expect(extractJson<{ a: number }>('```json\n{"a":1}\n```').a).toBe(1);
    expect(extractJson<{ a: number }>('Voici : {"a":2} merci').a).toBe(2);
    expect(() => extractJson('pas de json')).toThrow();
  });
  it('ChatGPT : choisit le modèle le plus récent de la gamme demandée', () => {
    const ids = ['gpt-6.2-astra', 'gpt-6.2-sol', 'gpt-6.1-terra', 'gpt-6-luna', 'gpt-5.6-luna', 'gpt-5-nano', 'gpt-6-luna-2026-05-01'];
    expect(pickOpenAIModel(ids, 'eco')).toBe('gpt-6-luna');
    expect(pickOpenAIModel(ids, 'balanced')).toBe('gpt-6.1-terra');
    expect(pickOpenAIModel(ids, 'premium')).toBe('gpt-6.2-sol');
    expect(pickOpenAIModel(ids, 'max')).toBe('gpt-6.2-astra');
    expect(pickOpenAIModel(['gpt-6.2-sol', 'gpt-6.2-astra'], 'eco')).toBe('gpt-6.2-sol'); // repli sur la gamme la plus proche
    expect(pickOpenAIModel([])).toBe('');
    expect(openAIMonthlyEstimate('gpt-6-luna')).toBeCloseTo(0.24);
    expect(openAIMonthlyEstimate('gpt-6.2-astra')).toBeCloseTo(19.2);
  });
  it('Gemini : préfère les modèles stables qui répondent sur l’offre gratuite', () => {
    expect(pickGeminiModel(['gemini-3.8-flash', 'gemini-4-hydrogen', 'gemini-3.5-flash', 'gemini-flash-latest'])).toBe('gemini-3.5-flash');
    expect(pickGeminiModel(['gemini-3.8-flash', 'gemini-flash-lite-latest', 'gemini-flash-latest'])).toBe('gemini-flash-latest');
    expect(pickGeminiModel(['gemini-2.5-pro', 'gemini-2.5-flash'])).toBe('gemini-2.5-flash');
    expect(pickGeminiModel([])).toBe('');
  });
  it('mémoire transmise : films vus et derniers choix, jamais les non-vus comme vus', () => {
    const m = memoryBlock({
      formats: BUILTIN_FORMATS, settings: { ...DEFAULT_SETTINGS, styleProfile: 'ton direct' }, events: [], sessions: [],
      works: [{ id: 'w', title: 'Her', director: '', kind: 'film', seen: 'seen', notes: '', scenes: '', createdAt: 0, updatedAt: 0 },
        { id: 'x', title: 'Drive', director: '', kind: 'film', seen: 'unseen', notes: '', scenes: '', createdAt: 0, updatedAt: 0 }],
      ideas: [{ id: 'i', title: 'Corail', formatId: 'fmt-color-stories', angle: 'la couleur remplace la présence', status: 'angle', updatedAt: 1 } as any],
    });
    expect(m).toContain('Her');
    expect(m).not.toContain('Drive');
    expect(m).toContain('Color Stories');
    expect(m).toContain('ton direct');
  });
});

describe('migration du schéma v1 → v2', () => {
  it('ouvre une base v1 existante sans perte et ajoute le bac', async () => {
    const old = new Dexie('mig-test');
    old.version(1).stores({ ideas: 'id, status' });
    await old.table('ideas').add({ id: 'a', title: 'ancienne', status: 'idea' });
    old.close();
    const db = new LabDB('mig-test', false);
    expect((await db.ideas.get('a'))!.title).toBe('ancienne');
    await db.inbox.add({ id: 'b', batchId: 'x', raw: 'r', title: 't', summary: '', works: [], status: 'pending', createdAt: 0, updatedAt: 0 });
    expect(await db.inbox.count()).toBe(1);
  });
});

import { localToday } from '../src/lib/today';
describe('quoi faire aujourd’hui (sans IA)', () => {
  const base = (o: any) => ({ id: o.id, title: o.id, workIds: [], category: 'analyse', createdAt: 0, updatedAt: Date.now(), lastActivityAt: Date.now(), status: 'idea', observation: '', angle: '', hook: '', angles: [], structure: [], script: '', missingInfo: '', priority: 2, avDifficulty: 2, paused: false, comments: [], formatId: 'fmt-one-shot', ...o });
  it('priorise ce qui est proche de la publication et respecte le temps dispo', () => {
    const ideas = [
      base({ id: 'prod', status: 'production', research: { level: 'light', justification: '', sourcesNeeded: '', missing: '', docHours: 1, shootHours: 1, editHours: 1 } }),
      base({ id: 'struct', status: 'structure', research: { level: 'light', justification: '', sourcesNeeded: '', missing: '', docHours: 1, shootHours: 3, editHours: 2 } }),
      base({ id: 'doc', status: 'documentation' }),
    ];
    const sources = [{ id: 's', title: 'Interview', url: '', author: '', media: '', date: '', type: '', topics: [], interest: '', state: 'toread', access: 'verified', ideaIds: ['doc'], workIds: [], createdAt: 0, updatedAt: 0, minutes: 10 }];
    const big = localToday(600, ideas as any, sources as any, BUILTIN_FORMATS, DEFAULT_SETTINGS, []);
    expect(big[0].ideaId).toBe('prod');
    const short = localToday(15, ideas as any, sources as any, BUILTIN_FORMATS, DEFAULT_SETTINGS, []);
    expect(short.every((a) => a.minutes <= 15 * 1.25)).toBe(true);
    expect(short.some((a) => a.sourceId === 's')).toBe(true);
    expect(localToday(60, [], [], BUILTIN_FORMATS, DEFAULT_SETTINGS, [])).toEqual([]);
  });
});

import { titleFromUrl } from '../src/components/articles';
describe('articles', () => {
  it('titre lisible depuis un lien', () => {
    expect(titleFromUrl('https://www.theasc.com/articles/her-hoyte-van-hoytema-interview')).toBe('Her hoyte van hoytema interview · theasc.com');
    expect(titleFromUrl('https://example.org/')).toBe('example.org');
    expect(titleFromUrl('https://site.fr/2024/12345')).toBe('site.fr');
  });
});
