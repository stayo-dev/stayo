/**
 * Loading Clerk without a provider, and waiting for one that has a provider.
 *
 * Session restore and ticket redemption can start a load at the same moment;
 * both must share it, because `clerk.load()` running twice concurrently is not
 * something clerk-js promises to survive. Node-only: `window.Clerk` is a stub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadClerkJsScript = vi.fn();
vi.mock('@clerk/shared/loadClerkJsScript', () => ({ loadClerkJsScript }));
vi.mock('./clerkConfig', () => ({
  readClerkConfig: () => ({ configured: true, publishableKey: 'pk_test_x', problem: null, message: '' }),
}));

type Win = { Clerk?: Record<string, unknown> };
const win = () => (globalThis as unknown as { window: Win }).window;

beforeEach(() => {
  (globalThis as unknown as { window: Win }).window = {};
  loadClerkJsScript.mockReset();
});
afterEach(() => {
  delete (globalThis as unknown as { window?: Win }).window;
  vi.useRealTimers();
});

function scriptInstalls(clerk: Record<string, unknown>) {
  loadClerkJsScript.mockImplementation(async () => {
    win().Clerk = clerk;
  });
}

describe('loadClerk', () => {
  it('shares one in-flight load between concurrent callers', async () => {
    const { loadClerk } = await import('./clerkLoader');
    let finish!: () => void;
    const clerk = {
      loaded: false,
      load: vi.fn(() => new Promise<void>((r) => { finish = () => { clerk.loaded = true; r(); }; })),
    };
    scriptInstalls(clerk);

    const a = loadClerk();
    const b = loadClerk();
    await vi.waitFor(() => expect(clerk.load).toHaveBeenCalled());
    finish();
    expect(await a).toBe(clerk);
    expect(await b).toBe(clerk);
    expect(loadClerkJsScript).toHaveBeenCalledTimes(1);
    expect(clerk.load).toHaveBeenCalledTimes(1);
  });

  it('returns an already-loaded instance without loading anything', async () => {
    const { loadClerk } = await import('./clerkLoader');
    const clerk = { loaded: true, load: vi.fn() };
    win().Clerk = clerk;
    expect(await loadClerk()).toBe(clerk);
    expect(loadClerkJsScript).not.toHaveBeenCalled();
    expect(clerk.load).not.toHaveBeenCalled();
  });

  it('can be retried after a failed load', async () => {
    const { loadClerk } = await import('./clerkLoader');
    loadClerkJsScript.mockRejectedValueOnce(new Error('offline'));
    await expect(loadClerk()).rejects.toThrow('offline');

    const clerk = { loaded: false, load: vi.fn(async () => { clerk.loaded = true; }) };
    scriptInstalls(clerk);
    expect(await loadClerk()).toBe(clerk);
  });
});

describe('waitForClerkLoaded (a ClerkProvider owns the load)', () => {
  it('resolves once the provider has loaded Clerk, and never calls load itself', async () => {
    vi.useFakeTimers();
    const { waitForClerkLoaded } = await import('./clerkBrowser');
    const clerk = { loaded: false, load: vi.fn() };
    win().Clerk = clerk;
    const done = vi.fn();
    waitForClerkLoaded(new AbortController().signal).then(done);
    await vi.advanceTimersByTimeAsync(200);
    expect(done).not.toHaveBeenCalled();
    clerk.loaded = true;
    await vi.advanceTimersByTimeAsync(60);
    expect(done).toHaveBeenCalled();
    expect(clerk.load).not.toHaveBeenCalled();
  });

  it('waits for window.Clerk to appear at all', async () => {
    vi.useFakeTimers();
    const { waitForClerkLoaded } = await import('./clerkBrowser');
    const done = vi.fn();
    waitForClerkLoaded(new AbortController().signal).then(done);
    await vi.advanceTimersByTimeAsync(100);
    win().Clerk = { loaded: true };
    await vi.advanceTimersByTimeAsync(60);
    expect(done).toHaveBeenCalled();
  });

  it('rejects when clerk-js reports it gave up', async () => {
    vi.useFakeTimers();
    const { waitForClerkLoaded } = await import('./clerkBrowser');
    win().Clerk = { loaded: false, status: 'error' };
    await expect(waitForClerkLoaded(new AbortController().signal)).rejects.toThrow('Clerk failed to load');
  });

  it('stops polling when aborted — no timer left behind', async () => {
    vi.useFakeTimers();
    const { waitForClerkLoaded } = await import('./clerkBrowser');
    const controller = new AbortController();
    const p = waitForClerkLoaded(controller.signal);
    controller.abort();
    await expect(p).rejects.toThrow('aborted');
    expect(vi.getTimerCount()).toBe(0);
  });
});
