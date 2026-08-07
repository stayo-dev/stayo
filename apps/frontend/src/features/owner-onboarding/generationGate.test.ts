import { describe, it, expect } from 'vitest';
import { generationPromptFor, needsGenerationConfirm, type GenerationFlags } from './generationGate';

const none: GenerationFlags = { floorsGen: false, roomsGen: false, bedsGen: false };
const all: GenerationFlags = { floorsGen: true, roomsGen: true, bedsGen: true };

describe('generation confirmation', () => {
  // The reported blind spot: Continue walked straight past an ungenerated
  // step, so an owner could finish onboarding having laid out nothing.
  it('asks before leaving each generation step that was never generated', () => {
    expect(needsGenerationConfirm('floors', none)).toBe(true);
    expect(needsGenerationConfirm('rooms', none)).toBe(true);
    expect(needsGenerationConfirm('beds', none)).toBe(true);
  });

  it('stays silent once the step has been generated', () => {
    expect(needsGenerationConfirm('floors', all)).toBe(false);
    expect(needsGenerationConfirm('rooms', all)).toBe(false);
    expect(needsGenerationConfirm('beds', all)).toBe(false);
  });

  it('reads the flag belonging to the step, not any other', () => {
    const onlyFloors: GenerationFlags = { floorsGen: true, roomsGen: false, bedsGen: false };
    expect(needsGenerationConfirm('floors', onlyFloors)).toBe(false);
    expect(needsGenerationConfirm('rooms', onlyFloors)).toBe(true);
    expect(needsGenerationConfirm('beds', onlyFloors)).toBe(true);
  });

  // Every other step must be unaffected — this must not add a dialog to
  // account, location or publish.
  it('never interrupts a step that has no Generate button', () => {
    for (const screen of ['welcome', 'account', 'kyc', 'create', 'location', 'details', 'review', 'publish', 'success'] as const) {
      expect(needsGenerationConfirm(screen, none)).toBe(false);
      expect(generationPromptFor(screen, none)).toBeNull();
    }
  });

  it('offers both a set-up and a skip route, since generating is optional', () => {
    for (const screen of ['floors', 'rooms', 'beds'] as const) {
      const prompt = generationPromptFor(screen, none);
      expect(prompt).not.toBeNull();
      expect(prompt!.confirmLabel.length).toBeGreaterThan(0);
      expect(prompt!.skipLabel.length).toBeGreaterThan(0);
      // The copy must say what was skipped and that it can be done later,
      // otherwise the dialog is just an obstacle.
      expect(prompt!.body).toMatch(/later|dashboard/i);
      expect(prompt!.title).toMatch(new RegExp(screen, 'i'));
    }
  });
});
