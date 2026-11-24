import { describe, it, expect } from 'vitest';
import { structureToBeats, beatsToStructure, detectSeed } from './create';

describe('structure de post', () => {
  it('aller-retour structure ⇄ temps forts', () => {
    const s = { hook: 'H', intro: 'I', angles: ['A1', 'A2'], contradiction: 'C', conclusion: 'F' };
    const beats = structureToBeats(s, { minSec: 30, maxSec: 60 } as any);
    expect(beats.map((b) => b.label)).toEqual(['Hook', 'Intro', 'Angle 1', 'Angle 2', 'Contradiction', 'Conclusion / complément']);
    expect(beatsToStructure(beats)).toEqual(s);
  });
  it('ignore une structure sans repères', () => {
    expect(beatsToStructure([{ id: '1', label: 'Plan 1', seconds: 5, content: '' }])).toBeNull();
  });
  it('détecte le type de départ', () => {
    expect(detectSeed('Her et le corail')).toBe('phrase');
    expect(detectSeed(Array(80).fill('mot').join(' '))).toBe('script');
  });
});

import { distinctTitle } from './create';
describe('titres distincts', () => {
  it('précise un titre proche d’une idée existante', () => {
    const t = distinctTitle('Le corail, couleur de la présence', ['Le corail couleur de la présence'], 'Les scènes seules sont désaturées. Et plus.');
    expect(t).toBe('Le corail, couleur de la présence — Les scènes seules sont désaturées');
  });
  it('laisse un titre unique tel quel', () => {
    expect(distinctTitle('Filmer une voix', ['Le corail de Her'])).toBe('Filmer une voix');
  });
  it('numérote si l’angle ne suffit pas', () => {
    const e = ['Le corail de Her', 'Le corail de Her — Angle A'];
    expect(distinctTitle('Le corail de Her', e, 'Angle A')).toBe('Le corail de Her — Angle A (variante 2)');
  });
});

import { ideaStage } from './stage';
describe('étapes visibles', () => {
  const i = (x: object) => ({ status: 'angle', ...x }) as any;
  it('nuages → à filmer → filmée', () => {
    expect(ideaStage(i({}))).toBe('cloud');
    expect(ideaStage(i({ finalizedAt: 1 }))).toBe('ready');
    expect(ideaStage(i({ finalizedAt: 1, filmedAt: 2 }))).toBe('filmed');
    expect(ideaStage(i({ status: 'published' }))).toBe('filmed');
  });
});
