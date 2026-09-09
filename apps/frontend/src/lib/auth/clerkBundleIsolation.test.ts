/**
 * The public landing page must not load Clerk (ADR-176 Phase 2.6).
 *
 * `/` is the marketing page and the first paint of the whole product. Mounting
 * Clerk globally made it suspend on the Clerk chunk *before* the router could
 * render, serialising two fetches on the one page that has to be fastest. Clerk
 * is now mounted per-route — `ClerkAuthScreen` for `/sign-in` and `/sign-up`,
 * `ProtectedAppProviders` for every authenticated tree.
 *
 * This walks the **static** import graph from the app entry. Dynamic
 * `import()` is deliberately not followed: that is exactly what a chunk
 * boundary is, and the property under test is that no *static* path leads from
 * the entry to Clerk. Two separate leaks were found this way, both a re-export
 * that looked harmless — so the graph is asserted rather than the file list.
 */

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const ALIASES: Record<string, string> = {
  '@lib': path.join(SRC, 'lib'),
  '@features': path.join(SRC, 'features'),
  '@domains': path.join(SRC, 'domains'),
  '@platforms': path.join(SRC, 'platforms'),
  '@shared': path.join(SRC, 'shared'),
  '@infrastructure': path.join(SRC, 'infrastructure'),
  '@context': path.join(SRC, 'context'),
  '@': SRC,
};

/** Static `import ... from '<spec>'` and `export ... from '<spec>'`. Not `import(...)`. */
function staticSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\b(?![^'"\n]*\()[^'"\n]*?from\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) specs.push(m[1]);
  // Bare side-effect imports: `import './styles.css'`
  const side = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
  while ((m = side.exec(source))) specs.push(m[1]);
  return specs;
}

function resolve(spec: string, fromFile: string): string | null {
  let base: string | null = null;

  if (spec.startsWith('.')) {
    base = path.resolve(path.dirname(fromFile), spec);
  } else {
    // Longest alias first, so '@lib' wins over '@'.
    for (const alias of Object.keys(ALIASES).sort((a, b) => b.length - a.length)) {
      if (spec === alias || spec.startsWith(alias + '/')) {
        base = path.join(ALIASES[alias], spec.slice(alias.length));
        break;
      }
    }
  }
  if (!base) return null; // a package, not a local file

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every file statically reachable from `entry`, plus the packages they import. */
function walk(entry: string) {
  const files = new Set<string>();
  const packages = new Map<string, string[]>(); // package -> importing files
  const queue = [entry];

  while (queue.length) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);

    for (const spec of staticSpecifiers(fs.readFileSync(file, 'utf8'))) {
      const resolved = resolve(spec, file);
      if (resolved) {
        if (!files.has(resolved)) queue.push(resolved);
      } else if (!spec.startsWith('.')) {
        packages.set(spec, [...(packages.get(spec) ?? []), path.relative(SRC, file)]);
      }
    }
  }
  return { files, packages };
}

describe('the public entry does not statically reach Clerk', () => {
  const entry = path.join(SRC, 'main.tsx');
  const graph = walk(entry);

  it('walks a real graph (guards against the resolver silently finding nothing)', () => {
    // If the resolver broke, every assertion below would pass vacuously.
    expect(graph.files.size).toBeGreaterThan(20);
    expect([...graph.packages.keys()]).toContain('react-router-dom');
  });

  it('never imports @clerk/clerk-react', () => {
    const importers = graph.packages.get('@clerk/clerk-react') ?? [];
    expect(importers).toEqual([]);
  });

  it('never reaches the modules that own the Clerk SDK or its config', () => {
    // clerkConfig inlines the publishable key and holds the lazy() trigger;
    // ClerkRuntime is the SDK itself.
    const reachable = [...graph.files].map((f) => path.relative(SRC, f));
    expect(reachable).not.toContain('app/providers/ClerkRuntime.tsx');
    expect(reachable).not.toContain('app/providers/ClerkAuthProvider.tsx');
    expect(reachable).not.toContain('lib/auth/clerkConfig.ts');
  });

  it('still reaches the Clerk-free session context, which route guards need', () => {
    // ProtectedRoute reads it on every render; it must NOT drag Clerk in.
    const contextFile = path.join(SRC, 'app/providers/clerkSessionContext.ts');
    const contextGraph = walk(contextFile);
    expect(contextGraph.packages.has('@clerk/clerk-react')).toBe(false);
  });
});

describe('Clerk is mounted per-route, not globally', () => {
  const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

  it('RootProviders does not mount Clerk', () => {
    expect(read('app/providers/RootProviders.tsx')).not.toContain('ClerkAuthProvider');
  });

  it('the sign-in/sign-up screen mounts it', () => {
    expect(read('app/pages/auth/ClerkAuthScreen.tsx')).toContain('<ClerkAuthProvider>');
  });

  it('every authenticated tree mounts it, via the one shared provider', () => {
    expect(read('app/providers/ProtectedAppProviders.tsx')).toContain('<ClerkAuthProvider>');
  });

  it('ClerkAuthProvider does not re-export the session hook', () => {
    // The re-export was a static edge into the module owning the lazy(), and it
    // put clerkConfig and the ClerkRuntime import straight back in the entry.
    expect(read('app/providers/ClerkAuthProvider.tsx')).not.toMatch(/export\s*\{[^}]*useClerkSession/);
  });
});
