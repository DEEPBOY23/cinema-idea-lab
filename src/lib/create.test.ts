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
