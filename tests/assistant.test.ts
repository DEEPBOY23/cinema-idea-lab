import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { BUILTIN_FORMATS, DEFAULT_SETTINGS } from '../src/defaults';
import { localSuggest, splitLocal, memoryBlock, totalOf } from '../src/lib/assistant';
import { extractJson, pickDefaultModel, pickGeminiModel } from '../src/lib/ai';
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
  it('choisit le modèle complet le plus récent', () => {
    expect(pickDefaultModel(['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-2025-04-14', 'gpt-4.1'])).toBe('gpt-4.1');
    expect(pickDefaultModel(['gpt-9-mini', 'gpt-9', 'gpt-8'])).toBe('gpt-9');
    expect(pickDefaultModel([])).toBe('');
  });
  it('Gemini : flash stable le plus récent, ni pro, ni preview', () => {
    expect(pickGeminiModel(['gemini-2.0-flash', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-001'])).toBe('gemini-2.5-flash');
    expect(pickGeminiModel(['gemini-3-flash', 'gemini-2.5-flash'])).toBe('gemini-3-flash');
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
