import { describe, it, expect, vi } from 'vitest';
import {
  createSoundPlayer,
  createHapticPlayer,
  playSuccessFeedback,
  SUCCESS_SOUND_VOLUME,
  SUCCESS_VIBRATION,
  type SoundElement,
} from './successFeedback';

function fakeElement(play: () => Promise<void> | void = () => Promise.resolve()) {
  const el: SoundElement & { seeks: number[] } = {
    volume: 1,
    seeks: [],
    _t: 0,
    get currentTime() {
      return this._t;
    },
    set currentTime(v: number) {
      this._t = v;
      this.seeks.push(v);
    },
    play: vi.fn(play),
  } as any;
  return el;
}

describe('createSoundPlayer', () => {
  it('plays the sound when called', () => {
    const el = fakeElement();
    createSoundPlayer(() => el)();
    expect(el.play).toHaveBeenCalledTimes(1);
  });

  it('sets the configured volume, so a confirmation never arrives at full blast', () => {
    const el = fakeElement();
    createSoundPlayer(() => el)();
    expect(el.volume).toBe(SUCCESS_SOUND_VOLUME);
  });

  it('reuses one element, so the file is fetched and decoded once', () => {
    const el = fakeElement();
    const make = vi.fn(() => el);
    const play = createSoundPlayer(make);
    play();
    play();
    play();
    expect(make).toHaveBeenCalledTimes(1);
    expect(el.play).toHaveBeenCalledTimes(3);
  });

  it('restarts a still-playing sound rather than layering a second copy over it', () => {
    const el = fakeElement();
    const play = createSoundPlayer(() => el);
    play();
    el.currentTime = 1.5; // the sound is midway through
    play();
    expect(el.currentTime).toBe(0);
    expect(el.play).toHaveBeenCalledTimes(2);
  });

  it('swallows a rejected play, because a blocked sound must not break a payment confirmation', async () => {
    const el = fakeElement(() => Promise.reject(new Error('NotAllowedError')));
    const play = createSoundPlayer(() => el);
    expect(() => play()).not.toThrow();
    await Promise.resolve();
  });

  it('swallows a throwing element factory, for environments with no audio at all', () => {
    const play = createSoundPlayer(() => {
      throw new Error('Audio is not defined');
    });
    expect(() => play()).not.toThrow();
  });

  it('recovers on a later call after the factory threw once', () => {
    const el = fakeElement();
    let first = true;
    const play = createSoundPlayer(() => {
      if (first) {
        first = false;
        throw new Error('transient');
      }
      return el;
    });
    play();
    play();
    expect(el.play).toHaveBeenCalledTimes(1);
  });
});

describe('createHapticPlayer', () => {
  it('sends the success pattern', () => {
    const vibrate = vi.fn(() => true);
    createHapticPlayer(() => vibrate)();
    expect(vibrate).toHaveBeenCalledWith(SUCCESS_VIBRATION);
  });

  it('fires on every call, matching the sound — there is no cooldown', () => {
    const vibrate = vi.fn(() => true);
    const buzz = createHapticPlayer(() => vibrate);
    buzz();
    buzz();
    buzz();
    expect(vibrate).toHaveBeenCalledTimes(3);
  });

  it('is a silent no-op where the Vibration API does not exist, such as every iPhone', () => {
    expect(() => createHapticPlayer(() => null)()).not.toThrow();
  });

  it('swallows a throwing vibrate, because a haptic must not break a payment confirmation', () => {
    const buzz = createHapticPlayer(() => () => {
      throw new Error('NotAllowedError');
    });
    expect(() => buzz()).not.toThrow();
  });

  it('swallows a throwing lookup, for a cross-origin frame where reading navigator throws', () => {
    const buzz = createHapticPlayer(() => {
      throw new Error('SecurityError');
    });
    expect(() => buzz()).not.toThrow();
  });
});

describe('playSuccessFeedback', () => {
  it('runs without a window, navigator or Audio at all', () => {
    // The node test environment has none of them — the same guard that
    // protects a server render protects this.
    expect(() => playSuccessFeedback()).not.toThrow();
  });
});
