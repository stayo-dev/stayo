# Admin Console Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing platform-admin console with the new `Stayo Admin.dc.html` shell, and rebuild the three screens whose backend data is already fully real (Owners, Hostel Listings, KYC) so the console is working and shippable at the end of this plan.

**Architecture:** A single `AdminConsoleShell` (dark sidebar + topbar + drawer host + toast host) wraps eleven lazy routes. Pure decision logic (nav model, drawer URL state, table shaping) lives in `.ts` modules under `src/platforms/admin/` and is unit-tested; components are thin renderers over already-tested state, because this project's vitest runs **node-only with no jsdom**. All network access goes through `features/platform-admin/api`, which is the only layer permitted to know endpoint shapes.

**Tech Stack:** Vite + React 19, react-router-dom, TanStack Query, Tailwind (arbitrary values, exact design hex), lucide-react icons, vitest (node env).

**Spec:** `docs/superpowers/specs/2026-08-16-admin-console-rebuild-design.md`

## Global Constraints

- **Palette (exact, from the design):** canvas `#EFE9E2`, grid lines `#E3D8CB`, sidebar `#201C18`, topbar `#F7F3EF`, card `#FFFFFF`, card border `#EFE6DA`, hairline `#F2ECE5`, ink `#221E1A`, body `#5A5147`, muted `#8A7F75`, faint `#A2978B`, accent `#B46A55`, accent-dark `#9C5341`, accent-tint `#F5E9E3`, green `#1F7A52`, green-tint `#EAF3EE`, amber `#B8792B`, amber-tint `#FBF1DE`, red `#B3402F`, red-tint `#FBEFE9`, blue `#3B5B9E`, blue-tint `#EAF0FB`.
- **Fonts:** Manrope (display/numeric) and Inter (body). Already loaded in `index.html` — do not add font loading.
- **Card shadow:** `0 1px 2px rgba(40,30,20,.04), 0 6px 16px rgba(40,30,20,.05)`.
- **No raw `fetch()` or `axios`** anywhere under `src/app`, `src/platforms`, `src/shared/ui`, `src/features`, `src/portal`, `src/context`. Use `@features/platform-admin/api`. Enforced by `npm run check:architecture`, which fails the build.
- **Tests are node-only.** `vitest.config.ts` sets `environment: 'node'` and `include: ['src/**/*.test.ts']`. Never write a `.test.tsx`, never import React in a test, never attempt to render a component in a test.
- **Never render a fabricated number.** Any panel without a live data source uses `<NotWiredYet>`. No zeros, no placeholder rows.
- **Do not touch** `AdminProviderShell.tsx`, `RequireAdminSession.tsx`, `useAdminSession.ts` — the auth spine is unchanged by this work.
- **Branch:** `feat/admin-console-rebuild`. Never push to `main`.

---

### Task 1: Palette constants and the nav model

The nav model is pure data + one predicate, so it is unit-tested. The palette is constants with no logic, so it ships alongside without its own test.

**Files:**
- Create: `apps/frontend/src/platforms/admin/theme/palette.ts`
- Create: `apps/frontend/src/platforms/admin/layout/adminNav.ts`
- Test: `apps/frontend/src/platforms/admin/layout/adminNav.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ADMIN_PALETTE` — a frozen record of the hex values in Global Constraints.
  - `type AdminNavItem = { to: string; label: string; icon: LucideIcon; badge: number; badgeTone: 'amber' | 'accent' | 'red'; end?: boolean }`
  - `type AdminNavGroup = { label: string; items: AdminNavItem[] }`
  - `buildAdminNav(counts: AdminNavCounts): AdminNavGroup[]`
  - `type AdminNavCounts = { leads?: number; kyc?: number; listings?: number; reports?: number }`
  - `isNavItemActive(itemPath: string, currentPath: string, end?: boolean): boolean`

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/platforms/admin/layout/adminNav.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildAdminNav, isNavItemActive } from './adminNav';

describe('buildAdminNav', () => {
  it('returns the four design groups in order', () => {
    const groups = buildAdminNav({});
    expect(groups.map((g) => g.label)).toEqual(['Manage', 'Review', 'Business', 'Support']);
  });

  it('keeps Settings in the Support group even though the design omits it', () => {
    const support = buildAdminNav({}).find((g) => g.label === 'Support');
    expect(support?.items.map((i) => i.to)).toContain('/admin/settings');
  });

  it('omits a badge when the count is zero or missing', () => {
    const groups = buildAdminNav({ kyc: 0 });
    const kyc = groups.flatMap((g) => g.items).find((i) => i.to === '/admin/kyc');
    expect(kyc?.badge).toBe(0);
  });

  it('shows a badge when there is real work waiting', () => {
    const groups = buildAdminNav({ kyc: 4, listings: 2 });
    const items = groups.flatMap((g) => g.items);
    expect(items.find((i) => i.to === '/admin/kyc')?.badge).toBe(4);
    expect(items.find((i) => i.to === '/admin/listings')?.badge).toBe(2);
  });

  it('exposes every screen the console routes to', () => {
    const paths = buildAdminNav({}).flatMap((g) => g.items).map((i) => i.to);
    expect(paths).toEqual([
      '/admin', '/admin/leads', '/admin/owners',
      '/admin/kyc', '/admin/listings',
      '/admin/revenue', '/admin/settlements', '/admin/subscriptions',
      '/admin/reports', '/admin/broadcasts', '/admin/settings',
    ]);
  });
});

describe('isNavItemActive', () => {
  it('matches Overview only exactly, so it does not stay lit on every child route', () => {
    expect(isNavItemActive('/admin', '/admin', true)).toBe(true);
    expect(isNavItemActive('/admin', '/admin/leads', true)).toBe(false);
  });

  it('matches other items on their own path', () => {
    expect(isNavItemActive('/admin/leads', '/admin/leads')).toBe(true);
    expect(isNavItemActive('/admin/leads', '/admin/owners')).toBe(false);
  });

  it('stays lit on a nested child route', () => {
    expect(isNavItemActive('/admin/listings', '/admin/listings/abc')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/platforms/admin/layout/adminNav.test.ts`
Expected: FAIL — cannot resolve `./adminNav`.

- [ ] **Step 3: Write the palette**

Create `apps/frontend/src/platforms/admin/theme/palette.ts`:

```ts
/**
 * The admin console's palette, taken verbatim from `Stayo Admin.dc.html`.
 *
 * These are literal hex values rather than theme tokens on purpose: the admin
 * console is a distinct visual surface from the owner and tenant apps, and
 * routing it through the shared token set would make a change intended for
 * owners silently restyle the console.
 */
export const ADMIN_PALETTE = Object.freeze({
  canvas: '#EFE9E2',
  grid: '#E3D8CB',
  sidebar: '#201C18',
  topbar: '#F7F3EF',
  card: '#FFFFFF',
  cardBorder: '#EFE6DA',
  hairline: '#F2ECE5',
  ink: '#221E1A',
  body: '#5A5147',
  muted: '#8A7F75',
  faint: '#A2978B',
  accent: '#B46A55',
  accentDark: '#9C5341',
  accentTint: '#F5E9E3',
  green: '#1F7A52',
  greenTint: '#EAF3EE',
  amber: '#B8792B',
  amberTint: '#FBF1DE',
  red: '#B3402F',
  redTint: '#FBEFE9',
  blue: '#3B5B9E',
  blueTint: '#EAF0FB',
} as const);

/** The design's card treatment, repeated on every panel. */
export const ADMIN_CARD =
  'rounded-[18px] border border-[#EFE6DA] bg-white shadow-[0_1px_2px_rgba(40,30,20,.04),0_6px_16px_rgba(40,30,20,.05)]';
```

- [ ] **Step 4: Write the nav model**

Create `apps/frontend/src/platforms/admin/layout/adminNav.ts`:

```ts
import {
  LayoutGrid, TrendingUp, Users, ShieldCheck, Building2,
  BarChart3, Wallet, CreditCard, Bug, Megaphone, Settings,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type AdminNavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  badge: number;
  badgeTone: 'amber' | 'accent' | 'red';
  end?: boolean;
};

export type AdminNavGroup = { label: string; items: AdminNavItem[] };

export type AdminNavCounts = {
  leads?: number;
  kyc?: number;
  listings?: number;
  reports?: number;
};

/**
 * The sidebar, per the design's four groups. Settings is not in the design but
 * is kept here deliberately — dropping it would lose admin invites,
 * notification templates and support-contact editing with no replacement.
 */
export function buildAdminNav(counts: AdminNavCounts): AdminNavGroup[] {
  const item = (
    to: string,
    label: string,
    icon: LucideIcon,
    badge = 0,
    badgeTone: AdminNavItem['badgeTone'] = 'amber',
    end = false,
  ): AdminNavItem => ({ to, label, icon, badge: badge > 0 ? badge : 0, badgeTone, end });

  return [
    {
      label: 'Manage',
      items: [
        item('/admin', 'Overview', LayoutGrid, 0, 'amber', true),
        item('/admin/leads', 'Leads', TrendingUp, counts.leads ?? 0, 'amber'),
        item('/admin/owners', 'Owners', Users),
      ],
    },
    {
      label: 'Review',
      items: [
        item('/admin/kyc', 'KYC Approvals', ShieldCheck, counts.kyc ?? 0, 'amber'),
        item('/admin/listings', 'Hostel Listings', Building2, counts.listings ?? 0, 'accent'),
      ],
    },
    {
      label: 'Business',
      items: [
        item('/admin/revenue', 'Revenue & Analytics', BarChart3),
        item('/admin/settlements', 'Settlements', Wallet),
        item('/admin/subscriptions', 'Subscriptions', CreditCard),
      ],
    },
    {
      label: 'Support',
      items: [
        item('/admin/reports', 'Reports & Bugs', Bug, counts.reports ?? 0, 'red'),
        item('/admin/broadcasts', 'Broadcasts', Megaphone),
        item('/admin/settings', 'Settings', Settings),
      ],
    },
  ];
}

export function isNavItemActive(itemPath: string, currentPath: string, end = false): boolean {
  if (end) return currentPath === itemPath;
  return currentPath === itemPath || currentPath.startsWith(`${itemPath}/`);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/platforms/admin/layout/adminNav.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/platforms/admin/theme/palette.ts \
        apps/frontend/src/platforms/admin/layout/adminNav.ts \
        apps/frontend/src/platforms/admin/layout/adminNav.test.ts
git commit -m "feat(admin): add console palette and tested nav model"
```

---

### Task 2: Drawer URL state

The detail drawer is addressable (`?detail=lead:<uuid>`) so an admin can link a colleague to a specific KYC submission and a refresh mid-review does not lose their place. Parsing is pure and therefore tested.

**Files:**
- Create: `apps/frontend/src/platforms/admin/drawer/drawerParam.ts`
- Test: `apps/frontend/src/platforms/admin/drawer/drawerParam.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type DrawerKind = 'lead' | 'owner' | 'kyc' | 'listing' | 'client' | 'settlement'`
  - `type DrawerTarget = { kind: DrawerKind; id: string }`
  - `parseDetailParam(raw: string | null): DrawerTarget | null`
  - `serializeDetail(target: DrawerTarget): string`

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/platforms/admin/drawer/drawerParam.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseDetailParam, serializeDetail } from './drawerParam';

const UUID = '3f2fbde6-3b8f-48cb-969d-b32ea4fda42d';

describe('parseDetailParam', () => {
  it('parses a valid kind and id', () => {
    expect(parseDetailParam(`kyc:${UUID}`)).toEqual({ kind: 'kyc', id: UUID });
  });

  it('returns null for a missing param', () => {
    expect(parseDetailParam(null)).toBeNull();
    expect(parseDetailParam('')).toBeNull();
  });

  it('rejects an unknown kind rather than opening a blank drawer', () => {
    expect(parseDetailParam(`invoice:${UUID}`)).toBeNull();
  });

  it('rejects a malformed value', () => {
    expect(parseDetailParam('kyc')).toBeNull();
    expect(parseDetailParam('kyc:')).toBeNull();
    expect(parseDetailParam(`:${UUID}`)).toBeNull();
  });

  it('keeps ids containing no colon intact and ignores extra segments', () => {
    expect(parseDetailParam(`owner:${UUID}:extra`)).toBeNull();
  });
});

describe('serializeDetail', () => {
  it('round-trips through parse', () => {
    const target = { kind: 'listing' as const, id: UUID };
    expect(parseDetailParam(serializeDetail(target))).toEqual(target);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/platforms/admin/drawer/drawerParam.test.ts`
Expected: FAIL — cannot resolve `./drawerParam`.

- [ ] **Step 3: Write the implementation**

Create `apps/frontend/src/platforms/admin/drawer/drawerParam.ts`:

```ts
/**
 * The detail drawer's identity lives in the URL rather than in component
 * state, so a drawer can be linked to and survives a refresh. An unknown or
 * malformed value resolves to null — opening an empty drawer would look like
 * a loading state that never finishes.
 *
 * PURE MODULE — no I/O, runs under vitest's node environment.
 */
export type DrawerKind = 'lead' | 'owner' | 'kyc' | 'listing' | 'client' | 'settlement';

export type DrawerTarget = { kind: DrawerKind; id: string };

const KINDS: readonly DrawerKind[] = ['lead', 'owner', 'kyc', 'listing', 'client', 'settlement'];

export function parseDetailParam(raw: string | null): DrawerTarget | null {
  if (!raw) return null;
  const parts = raw.split(':');
  if (parts.length !== 2) return null;
  const [kind, id] = parts;
  if (!id || !KINDS.includes(kind as DrawerKind)) return null;
  return { kind: kind as DrawerKind, id };
}

export function serializeDetail(target: DrawerTarget): string {
  return `${target.kind}:${target.id}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/platforms/admin/drawer/drawerParam.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/platforms/admin/drawer/
git commit -m "feat(admin): add addressable drawer URL state"
```

---

### Task 3: Shared UI primitives

Thin renderers, no logic, therefore no tests (vitest here cannot render components). `NotWiredYet` is the load-bearing one — it is how the console stays honest about screens whose backend does not exist.

**Files:**
- Create: `apps/frontend/src/platforms/admin/ui/StatCard.tsx`
- Create: `apps/frontend/src/platforms/admin/ui/SegmentedTabs.tsx`
- Create: `apps/frontend/src/platforms/admin/ui/FilterChips.tsx`
- Create: `apps/frontend/src/platforms/admin/ui/EmptyState.tsx`
- Create: `apps/frontend/src/platforms/admin/ui/NotWiredYet.tsx`
- Create: `apps/frontend/src/platforms/admin/ui/DataTable.tsx`
- Create: `apps/frontend/src/platforms/admin/ui/index.ts`

**Interfaces:**
- Consumes: `ADMIN_CARD`, `ADMIN_PALETTE` from Task 1.
- Produces:
  - `<StatCard label sub value valueTone? delta? deltaTone? />` where tones are `'ink' | 'green' | 'amber' | 'red'`
  - `<SegmentedTabs tabs={{ key, label }[]} active onChange />` — the pill-in-tray control
  - `<FilterChips chips={{ key, label, count? }[]} active onChange />` — the rounded outline chips
  - `<EmptyState title message />`
  - `<NotWiredYet title />` — renders the standard sentence; caller supplies only the subject
  - `<DataTable columns={{ key, label, width }[]} rows onRowClick? renderCell />`

- [ ] **Step 1: Write NotWiredYet**

Create `apps/frontend/src/platforms/admin/ui/NotWiredYet.tsx`:

```tsx
import { ADMIN_CARD } from '../theme/palette';

/**
 * The console's one honest-gap component.
 *
 * Several screens in the design have no backend yet (settlements, reports,
 * the revenue calendar). Rendering a zero or a sample row on those screens
 * would let an admin read an unbuilt feature as a real one saying business is
 * quiet — which is worse than showing nothing. Every such gap routes here so
 * the wording is identical everywhere and impossible to mistake for data.
 */
export function NotWiredYet({ title, className = '' }: { title: string; className?: string }) {
  return (
    <div className={`${ADMIN_CARD} px-5 py-14 text-center ${className}`}>
      <div className="font-display text-[17px] font-bold text-[#221E1A]">{title}</div>
      <div className="mx-auto mt-1.5 max-w-[420px] text-[13px] leading-relaxed text-[#8A7F75]">
        This screen is built and waiting — the data behind it is still being designed.
        Nothing is missing from your queue.
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write StatCard, EmptyState, SegmentedTabs, FilterChips**

Create `apps/frontend/src/platforms/admin/ui/StatCard.tsx`:

```tsx
import { ADMIN_CARD } from '../theme/palette';

const TONE: Record<string, string> = {
  ink: 'text-[#221E1A]',
  green: 'text-[#1F7A52]',
  amber: 'text-[#B8792B]',
  red: 'text-[#B3402F]',
};

export function StatCard({
  label, value, sub, valueTone = 'ink', delta, deltaTone = 'green',
}: {
  label: string; value: string; sub?: string;
  valueTone?: keyof typeof TONE; delta?: string; deltaTone?: keyof typeof TONE;
}) {
  return (
    <div className={`${ADMIN_CARD} px-[17px] py-[15px]`}>
      <div className="flex items-center justify-between gap-2.5">
        <div className="text-[11.5px] font-semibold text-[#8A7F75]">{label}</div>
        {delta ? (
          <span className={`rounded-full px-2 py-[3px] font-display text-[10.5px] font-bold ${TONE[deltaTone]} ${
            deltaTone === 'green' ? 'bg-[#EAF3EE]' : deltaTone === 'red' ? 'bg-[#FBEFE9]' : 'bg-[#FBF1DE]'
          }`}>{delta}</span>
        ) : null}
      </div>
      <div className={`mt-1.5 font-display text-[23px] font-extrabold tracking-[-0.02em] ${TONE[valueTone]}`}>{value}</div>
      {sub ? <div className="mt-px text-[11px] text-[#A2978B]">{sub}</div> : null}
    </div>
  );
}
```

Create `apps/frontend/src/platforms/admin/ui/EmptyState.tsx`:

```tsx
import { ADMIN_CARD } from '../theme/palette';

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className={`${ADMIN_CARD} px-5 py-14 text-center`}>
      <div className="font-display text-[17px] font-bold text-[#221E1A]">{title}</div>
      <div className="mt-1.5 text-[13px] text-[#8A7F75]">{message}</div>
    </div>
  );
}
```

Create `apps/frontend/src/platforms/admin/ui/SegmentedTabs.tsx`:

```tsx
export type SegmentedTab = { key: string; label: string };

export function SegmentedTabs({
  tabs, active, onChange,
}: { tabs: SegmentedTab[]; active: string; onChange: (key: string) => void }) {
  return (
    <div className="flex w-fit gap-[5px] rounded-xl bg-[#EAE1D6] p-1">
      {tabs.map((tab) => {
        const on = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={`rounded-[9px] px-[18px] py-2 text-[12.5px] font-semibold transition ${
              on ? 'bg-white text-[#221E1A] shadow-[0_1px_3px_rgba(40,30,20,.12)]' : 'text-[#7A6F63]'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
```

Create `apps/frontend/src/platforms/admin/ui/FilterChips.tsx`:

```tsx
export type FilterChip = { key: string; label: string; count?: number };

export function FilterChips({
  chips, active, onChange,
}: { chips: FilterChip[]; active: string; onChange: (key: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip) => {
        const on = chip.key === active;
        return (
          <button
            key={chip.key}
            type="button"
            onClick={() => onChange(chip.key)}
            className={`rounded-full border px-[15px] py-2 text-[12.5px] font-semibold transition ${
              on ? 'border-[#221E1A] bg-[#221E1A] text-white' : 'border-[#EAE1D8] bg-white text-[#5A5147]'
            }`}
          >
            {chip.count == null ? chip.label : `${chip.label} · ${chip.count}`}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Write DataTable and the barrel**

Create `apps/frontend/src/platforms/admin/ui/DataTable.tsx`:

```tsx
import type { ReactNode } from 'react';
import { ADMIN_CARD } from '../theme/palette';

export type DataColumn = { key: string; label: string; width: string };

/**
 * The design's list treatment: a header strip over hairline-separated rows,
 * laid out on one shared grid template so header and body always align.
 */
export function DataTable<T extends { id: string }>({
  columns, rows, renderCell, onRowClick, empty,
}: {
  columns: DataColumn[];
  rows: T[];
  renderCell: (row: T, columnKey: string) => ReactNode;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
}) {
  const template = columns.map((c) => c.width).join(' ');
  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <div className={`${ADMIN_CARD} overflow-hidden`}>
      <div
        className="grid gap-3 border-b border-[#EFE6DA] bg-[#FAF6F1] px-5 py-[13px] text-[10.5px] font-bold uppercase tracking-[.05em] text-[#A2978B]"
        style={{ gridTemplateColumns: template }}
      >
        {columns.map((c) => <div key={c.key}>{c.label}</div>)}
      </div>
      {rows.map((row, index) => (
        <div
          key={row.id}
          role={onRowClick ? 'button' : undefined}
          tabIndex={onRowClick ? 0 : undefined}
          onClick={onRowClick ? () => onRowClick(row) : undefined}
          onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(row); } : undefined}
          className={`grid items-center gap-3 px-5 py-3.5 ${index > 0 ? 'border-t border-[#F2ECE5]' : ''} ${
            onRowClick ? 'cursor-pointer hover:bg-[#FCFAF7]' : ''
          }`}
          style={{ gridTemplateColumns: template }}
        >
          {columns.map((c) => <div key={c.key} className="min-w-0">{renderCell(row, c.key)}</div>)}
        </div>
      ))}
    </div>
  );
}
```

Create `apps/frontend/src/platforms/admin/ui/index.ts`:

```ts
export { StatCard } from './StatCard';
export { SegmentedTabs, type SegmentedTab } from './SegmentedTabs';
export { FilterChips, type FilterChip } from './FilterChips';
export { EmptyState } from './EmptyState';
export { NotWiredYet } from './NotWiredYet';
export { DataTable, type DataColumn } from './DataTable';
```

- [ ] **Step 4: Verify it typechecks**

Run: `cd apps/frontend && npm run typecheck`
Expected: PASS (no errors in `src/platforms/admin/ui`).

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/platforms/admin/ui/
git commit -m "feat(admin): add console UI primitives and the NotWiredYet gap component"
```

---

### Task 4: The console shell

Sidebar + topbar + drawer host + toast host. Replaces `AdminAppShell`.

**Files:**
- Create: `apps/frontend/src/platforms/admin/layout/AdminConsoleShell.tsx`
- Create: `apps/frontend/src/platforms/admin/layout/pageHeaders.ts`
- Create: `apps/frontend/src/platforms/admin/drawer/AdminDrawer.tsx`
- Create: `apps/frontend/src/platforms/admin/ui/Toast.tsx`

**Interfaces:**
- Consumes: `buildAdminNav`, `isNavItemActive` (Task 1); `parseDetailParam` (Task 2); `useAdminSession`; `platformAdminService`.
- Produces:
  - `<AdminConsoleShell />` — a route element rendering `<Outlet />`
  - `PAGE_HEADERS: Record<string, { title: string; subtitle: string }>`
  - `<AdminDrawer target onClose>{children}</AdminDrawer>` — chrome only; each screen supplies its own body
  - `useAdminToast()` returning `{ toast, fire }`

- [ ] **Step 1: Write the page headers**

Create `apps/frontend/src/platforms/admin/layout/pageHeaders.ts`, copying the design's `META` block verbatim:

```ts
/** Topbar title + subtitle per route, copied from the design's META block. */
export const PAGE_HEADERS: Record<string, { title: string; subtitle: string }> = {
  '/admin': { title: 'Overview', subtitle: 'Platform health across leads, revenue & operations' },
  '/admin/leads': { title: 'Leads', subtitle: 'Owner sign-ups from the landing page' },
  '/admin/owners': { title: 'Owners', subtitle: 'Every owner and the hostels they hold' },
  '/admin/kyc': { title: 'KYC Approvals', subtitle: 'Verify owner onboarding before they go live' },
  '/admin/listings': { title: 'Hostel Listings', subtitle: 'Review and publish hostels to the Discovery page' },
  '/admin/revenue': { title: 'Revenue & Analytics', subtitle: 'Platform earnings, GMV and commission' },
  '/admin/settlements': { title: 'Settlements', subtitle: 'Pay collected rent out to owners · nightly run' },
  '/admin/subscriptions': { title: 'Subscriptions', subtitle: 'Owner plans and recurring revenue' },
  '/admin/reports': { title: 'Reports & Bugs', subtitle: 'Issues raised by owners, tenants and reservations' },
  '/admin/broadcasts': { title: 'Broadcasts', subtitle: 'Announcements to your owner base' },
  '/admin/settings': { title: 'Settings', subtitle: 'Admins, templates and support details' },
};
```

- [ ] **Step 2: Write the toast**

Create `apps/frontend/src/platforms/admin/ui/Toast.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';

export type ToastKind = 'ok' | 'no';

export function useAdminToast() {
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fire = useCallback((message: string, kind: ToastKind = 'ok') => {
    setToast({ message, kind });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return { toast, fire };
}

export function AdminToast({ toast }: { toast: { message: string; kind: ToastKind } | null }) {
  if (!toast) return null;
  const Icon = toast.kind === 'ok' ? Check : X;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[120] flex justify-center">
      <div className="flex items-center gap-2.5 rounded-full bg-[#221E1A] px-5 py-3 text-white shadow-[0_12px_30px_rgba(34,30,26,.32)]">
        <span className={`flex h-5 w-5 items-center justify-center rounded-full ${
          toast.kind === 'ok' ? 'bg-[#1F7A52]' : 'bg-[#B3402F]'
        }`}>
          <Icon className="h-3 w-3" strokeWidth={3} />
        </span>
        <span className="text-[13px] font-semibold">{toast.message}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write the drawer chrome**

Create `apps/frontend/src/platforms/admin/drawer/AdminDrawer.tsx`:

```tsx
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { X } from 'lucide-react';

/**
 * Drawer chrome only — header, scroll body, optional sticky footer. Each
 * screen supplies its own body, so the drawer never needs to know about
 * every entity it can show.
 */
export function AdminDrawer({
  title, subtitle, initials, tint = '#B46A55', onClose, footer, children,
}: {
  title: string; subtitle?: string; initials: string; tint?: string;
  onClose: () => void; footer?: ReactNode; children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[90] flex justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-[rgba(28,22,18,.44)] animate-[adFade_.2s_ease]"
      />
      <div className="relative flex h-screen w-[580px] max-w-[94vw] flex-col bg-[#F7F3EF] shadow-[-24px_0_60px_rgba(30,20,12,.24)]">
        <div className="flex flex-none items-center gap-3 border-b border-[#E9DFD3] bg-white px-6 py-5">
          <span
            className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-xl font-display text-base font-bold text-white"
            style={{ background: tint }}
          >{initials}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-[17px] font-extrabold tracking-[-0.02em] text-[#221E1A]">{title}</div>
            {subtitle ? <div className="text-[12px] text-[#8A7F75]">{subtitle}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] bg-[#F2ECE5]"
          >
            <X className="h-3.5 w-3.5 text-[#7A6F63]" />
          </button>
        </div>
        <div className="flex-1 overflow-auto px-6 pb-6 pt-[22px]">{children}</div>
        {footer ? <div className="flex-none border-t border-[#E9DFD3] bg-white px-6 py-3.5">{footer}</div> : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write the shell**

Create `apps/frontend/src/platforms/admin/layout/AdminConsoleShell.tsx`. It must:

1. Read `useAdminSession()` for the sidebar footer identity.
2. Fetch nav badge counts with TanStack Query — `platformAdminService.getLeads({ limit: 1 })` for `counts`, `getOwnerDocuments('PENDING')` for KYC, `getHostels({ verification: 'PENDING' })` for listings — each with `staleTime: 30_000, refetchInterval: 60_000`.
3. Build the sidebar from `buildAdminNav(counts)` and `isNavItemActive`, using `useLocation().pathname`.
4. Render the topbar from `PAGE_HEADERS[pathname]`, falling back to `{ title: 'Stayo Admin', subtitle: '' }`.
5. Render `<Outlet />` inside the scrolling body with the design's grid background:
   `bg-[#EFE9E2] [background-image:linear-gradient(#E3D8CB_1px,transparent_1px),linear-gradient(90deg,#E3D8CB_1px,transparent_1px)] [background-size:52px_52px]`
6. Render `<AdminToast toast={toast} />` from `useAdminToast()`.

Sidebar structure per the design: `w-[250px] bg-[#201C18]`, logo block (36px `#B46A55` rounded square with "S", "Stayo" + "ADMIN CONSOLE"), then groups with `text-[9.5px] font-bold uppercase tracking-[.13em] text-[#6B6259]` labels, then items at `rounded-[11px] px-[11px] py-[9px]`, active `bg-[#B46A55] text-white font-bold`, inactive `text-[#A79C90] font-medium hover:bg-white/[.06]`. Badge is a `rounded-full min-w-[19px] h-[19px]` pill in the item's `badgeTone` colour. Footer is the admin identity card on `bg-white/[.04]` with a green presence dot.

Add the design's keyframes to `apps/frontend/src/index.css` if not present: `adFade`, `adUp`, `adToast`, `adDrawer`.

- [ ] **Step 5: Verify it typechecks and the architecture check passes**

Run: `cd apps/frontend && npm run typecheck && npm run check:architecture`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/platforms/admin/layout/ \
        apps/frontend/src/platforms/admin/drawer/AdminDrawer.tsx \
        apps/frontend/src/platforms/admin/ui/Toast.tsx \
        apps/frontend/src/index.css
git commit -m "feat(admin): add console shell, drawer chrome and toast"
```

---

### Task 5: Routes, redirects, and removal of the old console

This is the task that deletes the old console. Placeholder pages are added for the screens later plans build, each rendering `<NotWiredYet>` — so the console never routes to a blank screen.

**Files:**
- Modify: `apps/frontend/src/platforms/admin/router/AdminRoutes.tsx` (full rewrite)
- Delete: `apps/frontend/src/app/layouts/AdminAppShell.tsx`
- Delete: all 9 files in `apps/frontend/src/platforms/admin/pages/`
- Create: 11 new page files in `apps/frontend/src/platforms/admin/pages/`

**Interfaces:**
- Consumes: `AdminConsoleShell` (Task 4), `NotWiredYet` (Task 3).
- Produces: `AdminRoutes()` mounting all eleven routes plus four redirects.

- [ ] **Step 1: Create the eleven page files**

Each of `OverviewPage`, `LeadsPage`, `OwnersPage`, `KycPage`, `ListingsPage`, `RevenuePage`, `SettlementsPage`, `SubscriptionsPage`, `ReportsPage`, `BroadcastsPage`, `SettingsPage` is created as a named export. Tasks 6–8 fill in Owners, Listings and KYC. The rest render a single `<NotWiredYet>` with these exact titles:

- Overview → `"The overview is being rebuilt"`
- Leads → `"The leads pipeline is being rebuilt"`
- Revenue → `"Revenue analytics are being rebuilt"`
- Settlements → `"Settlement runs aren't live yet"`
- Subscriptions → `"Subscriptions are being rebuilt"`
- Reports → `"Reports & bugs aren't live yet"`
- Broadcasts → `"Broadcasts are being rebuilt"`
- Settings → `"Settings are being rebuilt"`

Example — create `apps/frontend/src/platforms/admin/pages/SettlementsPage.tsx`:

```tsx
import { NotWiredYet } from '../ui';

export function SettlementsPage() {
  return <NotWiredYet title="Settlement runs aren't live yet" />;
}
```

- [ ] **Step 2: Rewrite the router**

Replace `apps/frontend/src/platforms/admin/router/AdminRoutes.tsx`:

```tsx
import { lazy } from 'react';
import { Navigate, Route } from 'react-router-dom';

const AdminConsoleShell = lazy(() =>
  import('../layout/AdminConsoleShell').then((m) => ({ default: m.AdminConsoleShell })),
);
const AdminProviderShell = lazy(() =>
  import('./AdminProviderShell').then((m) => ({ default: m.AdminProviderShell })),
);

const page = (name: string, key: string) =>
  lazy(() => import(`../pages/${name}.tsx`).then((m) => ({ default: m[key] })));

const OverviewPage = page('OverviewPage', 'OverviewPage');
const LeadsPage = page('LeadsPage', 'LeadsPage');
const OwnersPage = page('OwnersPage', 'OwnersPage');
const KycPage = page('KycPage', 'KycPage');
const ListingsPage = page('ListingsPage', 'ListingsPage');
const RevenuePage = page('RevenuePage', 'RevenuePage');
const SettlementsPage = page('SettlementsPage', 'SettlementsPage');
const SubscriptionsPage = page('SubscriptionsPage', 'SubscriptionsPage');
const ReportsPage = page('ReportsPage', 'ReportsPage');
const BroadcastsPage = page('BroadcastsPage', 'BroadcastsPage');
const SettingsPage = page('SettingsPage', 'SettingsPage');

/**
 * StayO Platform Admin console, per `Stayo Admin.dc.html` (2026-08-16 rebuild).
 * A desktop sidebar console gated by `RequireAdminSession`.
 *
 * Settlements and Reports & Bugs render honest empty states — their backends
 * are not yet designed. See the spec at
 * docs/superpowers/specs/2026-08-16-admin-console-rebuild-design.md.
 */
export function AdminRoutes() {
  return (
    <Route element={<AdminProviderShell />}>
      <Route element={<AdminConsoleShell />}>
        <Route path="/admin" element={<OverviewPage />} />
        <Route path="/admin/leads" element={<LeadsPage />} />
        <Route path="/admin/owners" element={<OwnersPage />} />
        <Route path="/admin/kyc" element={<KycPage />} />
        <Route path="/admin/listings" element={<ListingsPage />} />
        <Route path="/admin/revenue" element={<RevenuePage />} />
        <Route path="/admin/settlements" element={<SettlementsPage />} />
        <Route path="/admin/subscriptions" element={<SubscriptionsPage />} />
        <Route path="/admin/reports" element={<ReportsPage />} />
        <Route path="/admin/broadcasts" element={<BroadcastsPage />} />
        <Route path="/admin/settings" element={<SettingsPage />} />

        {/* Old paths, kept so existing links and bookmarks do not rot. */}
        <Route path="/admin/documents" element={<Navigate to="/admin/kyc" replace />} />
        <Route path="/admin/hostels" element={<Navigate to="/admin/listings" replace />} />
        <Route path="/admin/marketing-reviews" element={<Navigate to="/admin/listings?tab=content" replace />} />
        <Route path="/admin/more" element={<Navigate to="/admin/settings" replace />} />
      </Route>
    </Route>
  );
}
```

If the dynamic `page()` helper trips Vite's static-analysis for lazy chunks, replace it with eleven explicit `lazy(() => import('../pages/X').then((m) => ({ default: m.X })))` lines. Verify by checking the build output has separate chunks per page.

- [ ] **Step 3: Delete the old console**

```bash
cd /home/sp/Desktop/stayo
git rm apps/frontend/src/app/layouts/AdminAppShell.tsx
git rm apps/frontend/src/platforms/admin/pages/AdminDashboardPage.tsx \
       apps/frontend/src/platforms/admin/pages/AdminOwnersPage.tsx \
       apps/frontend/src/platforms/admin/pages/AdminHostelsPage.tsx \
       apps/frontend/src/platforms/admin/pages/AdminLeadsPage.tsx \
       apps/frontend/src/platforms/admin/pages/AdminMarketingReviewsPage.tsx \
       apps/frontend/src/platforms/admin/pages/AdminDocumentsPage.tsx \
       apps/frontend/src/platforms/admin/pages/AdminRevenuePage.tsx \
       apps/frontend/src/platforms/admin/pages/AdminMorePage.tsx \
       apps/frontend/src/platforms/admin/pages/AdminSettingsPage.tsx
```

Then grep for stragglers and fix any import that still points at a deleted file:

```bash
grep -rn "AdminAppShell\|AdminDashboardPage\|AdminMorePage" apps/frontend/src || echo "clean"
```

Keep `DocumentViewer.tsx`, `documentQueue.ts`, `ownerHealth.ts`, `leadQueue.ts`, `needsAttention.ts`, `revenueFormat.ts` and their tests — Tasks 6–8 and later plans consume them.

- [ ] **Step 4: Verify the whole frontend still builds**

Run: `cd apps/frontend && npm run typecheck && npm test && npm run build`
Expected: typecheck PASS; all existing tests PASS; build PASS (it runs `check:architecture` first).

- [ ] **Step 5: Commit**

```bash
git add -A apps/frontend/src/platforms/admin apps/frontend/src/app
git commit -m "feat(admin)!: replace old admin console with new shell and routes

Deletes AdminAppShell and all 9 legacy pages. Screens whose backend is
not yet designed render NotWiredYet rather than fabricated data."
```

---

### Task 6: Owners screen and owner drawer

The first screen with fully real data — `/platform-admin/owners` already returns hostels, beds, GMV, plan and status.

**Files:**
- Modify: `apps/frontend/src/platforms/admin/pages/OwnersPage.tsx`
- Create: `apps/frontend/src/platforms/admin/owners/ownerRows.ts`
- Test: `apps/frontend/src/platforms/admin/owners/ownerRows.test.ts`
- Create: `apps/frontend/src/platforms/admin/drawer/OwnerDrawerBody.tsx`

**Interfaces:**
- Consumes: `platformAdminService.getOwners`, `getOwner`; `DataTable`, `StatCard`, `EmptyState` (Task 3); `AdminDrawer` (Task 4); `parseDetailParam`/`serializeDetail` (Task 2); existing `features/platform-admin/owners/ownerHealth.ts`.
- Produces:
  - `type OwnerRow = { id, name, city, hostels, beds, gmv, plan, planTone, status, statusTone, initials, tint }`
  - `toOwnerRows(apiOwners: any[]): OwnerRow[]`
  - `ownerStats(rows: OwnerRow[]): { label: string; value: string; sub: string }[]`

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/platforms/admin/owners/ownerRows.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toOwnerRows, ownerStats } from './ownerRows';

const api = [
  { id: 'o1', name: 'Sri Adithya Hostels', city: 'Guntur', hostels: 3, beds: 137,
    monthly_revenue: 820000, plan: 'Pro', is_active: true },
  { id: 'o2', name: 'Coliv Spaces', city: null, hostels: 0, beds: 0,
    monthly_revenue: 0, plan: null, is_active: false },
];

describe('toOwnerRows', () => {
  it('derives two-letter initials from the owner name', () => {
    expect(toOwnerRows(api)[0].initials).toBe('SA');
  });

  it('formats GMV in Indian lakh notation', () => {
    expect(toOwnerRows(api)[0].gmv).toBe('₹8.2L');
  });

  it('falls back to an em dash rather than inventing a city', () => {
    expect(toOwnerRows(api)[1].city).toBe('—');
  });

  it('shows no plan as Unassigned rather than blank', () => {
    expect(toOwnerRows(api)[1].plan).toBe('Unassigned');
  });

  it('maps is_active to a status label and tone', () => {
    const rows = toOwnerRows(api);
    expect(rows[0].status).toBe('Active');
    expect(rows[0].statusTone).toBe('green');
    expect(rows[1].status).toBe('Paused');
    expect(rows[1].statusTone).toBe('muted');
  });

  it('assigns a stable tint per owner id, so a row does not change colour on refetch', () => {
    expect(toOwnerRows(api)[0].tint).toBe(toOwnerRows(api)[0].tint);
  });
});

describe('ownerStats', () => {
  it('totals owners, hostels and beds across the page', () => {
    const stats = ownerStats(toOwnerRows(api));
    expect(stats.find((s) => s.label === 'Total owners')?.value).toBe('2');
    expect(stats.find((s) => s.label === 'Hostels')?.value).toBe('3');
    expect(stats.find((s) => s.label === 'Beds')?.value).toBe('137');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/platforms/admin/owners/ownerRows.test.ts`
Expected: FAIL — cannot resolve `./ownerRows`.

- [ ] **Step 3: Implement `ownerRows.ts`**

Implement `toOwnerRows` and `ownerStats` to satisfy the test. Notes the implementer needs:

- Lakh formatting: `₹` + `(n / 100_000).toFixed(1)` + `L` when `n >= 100_000`; otherwise `₹` + `n.toLocaleString('en-IN')`.
- Initials: first letter of the first two whitespace-separated words, uppercased.
- Tint: pick from `['#B46A55', '#3B5B9E', '#1F7A52', '#B8792B', '#8A7F75']` indexed by a simple deterministic hash of `id` (sum of char codes modulo length) — deterministic so colours do not flicker between refetches.
- `statusTone` is `'green'` when `is_active`, else `'muted'`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/platforms/admin/owners/ownerRows.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Build the screen and drawer body**

`OwnersPage.tsx`: a `useQuery` on `['admin', 'owners', search]` calling `platformAdminService.getOwners({ search })`, four `<StatCard>`s from `ownerStats`, then a `<DataTable>` with the design's columns — Owner (`2fr`), Hostels (`0.9fr`), Beds (`1fr`), Monthly GMV (`1.1fr`), Plan (`1fr`), Status (`0.9fr`). `onRowClick` sets `?detail=owner:<id>` via `useSearchParams`.

`OwnerDrawerBody.tsx`: `useQuery` on `['admin', 'owner', id]` calling `getOwner(id)`; renders the four-metric grid, an "Account & contact" key/value card, and a "Hostels held (n)" list — all from real fields. Any field the API does not return is omitted, never rendered as `—` in a way that implies the data exists and is empty.

- [ ] **Step 6: Verify**

Run: `cd apps/frontend && npm run typecheck && npm test && npm run check:architecture`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/platforms/admin/owners/ \
        apps/frontend/src/platforms/admin/pages/OwnersPage.tsx \
        apps/frontend/src/platforms/admin/drawer/OwnerDrawerBody.tsx
git commit -m "feat(admin): rebuild Owners screen and owner drawer on real data"
```

---

### Task 7: Hostel Listings screen with the Content review tab

Folds marketing reviews (ADR-076) in as a fourth tab rather than a separate nav item.

**Files:**
- Modify: `apps/frontend/src/platforms/admin/pages/ListingsPage.tsx`
- Create: `apps/frontend/src/platforms/admin/listings/listingTabs.ts`
- Test: `apps/frontend/src/platforms/admin/listings/listingTabs.test.ts`
- Create: `apps/frontend/src/platforms/admin/drawer/ListingDrawerBody.tsx`

**Interfaces:**
- Consumes: `platformAdminService.getHostels`, `getHostel`, `approveListing`, `rejectListing`, `getMarketingReviews`; `FilterChips`, `EmptyState` (Task 3).
- Produces:
  - `type ListingTabKey = 'pending' | 'approved' | 'rejected' | 'content'`
  - `resolveListingTab(raw: string | null): ListingTabKey` — defaults to `'pending'`
  - `listingFilterFor(tab: ListingTabKey): { verification?: string; listing?: string } | null` — `null` means "this tab does not query hostels"

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { resolveListingTab, listingFilterFor } from './listingTabs';

describe('resolveListingTab', () => {
  it('defaults to pending, which is the queue that needs work', () => {
    expect(resolveListingTab(null)).toBe('pending');
    expect(resolveListingTab('')).toBe('pending');
  });

  it('accepts the four known tabs', () => {
    expect(resolveListingTab('approved')).toBe('approved');
    expect(resolveListingTab('rejected')).toBe('rejected');
    expect(resolveListingTab('content')).toBe('content');
  });

  it('falls back to pending for an unknown tab rather than rendering nothing', () => {
    expect(resolveListingTab('nonsense')).toBe('pending');
  });
});

describe('listingFilterFor', () => {
  it('maps each hostel tab to its API filter', () => {
    expect(listingFilterFor('pending')).toEqual({ verification: 'PENDING' });
    expect(listingFilterFor('approved')).toEqual({ verification: 'VERIFIED' });
    expect(listingFilterFor('rejected')).toEqual({ verification: 'REJECTED' });
  });

  it('returns null for the content tab, which reads marketing revisions instead', () => {
    expect(listingFilterFor('content')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/frontend && npx vitest run src/platforms/admin/listings/listingTabs.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `listingTabs.ts`, then the screen**

Implement the module to satisfy the test. Then build `ListingsPage.tsx`:

- Tab state from `useSearchParams().get('tab')` through `resolveListingTab`, so `/admin/marketing-reviews`'s redirect to `?tab=content` lands correctly.
- `<FilterChips>` with counts for pending.
- Two-column card grid per the design; each card shows cover, name, owner · city, status pill, and beds / from-price / amenities.
- Pending cards get Reject + Publish buttons wired to `rejectListing(id, reason)` (reason is required server-side — prompt for it, never send an empty string) and `approveListing(id)`, each invalidating `['admin', 'listings']` and firing a toast.
- The `content` tab renders the marketing-revision queue, reusing whatever the deleted `AdminMarketingReviewsPage` called. Recover its API calls from git history if needed:
  `git show HEAD~1:apps/frontend/src/platforms/admin/pages/AdminMarketingReviewsPage.tsx`

- [ ] **Step 4: Verify**

Run: `cd apps/frontend && npm run typecheck && npm test && npm run check:architecture`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/platforms/admin/listings/ \
        apps/frontend/src/platforms/admin/pages/ListingsPage.tsx \
        apps/frontend/src/platforms/admin/drawer/ListingDrawerBody.tsx
git commit -m "feat(admin): rebuild Listings screen with marketing content review as a tab"
```

---

### Task 8: KYC screen

Ships against the three document types that exist today (`AADHAAR`, `PAN`, `PHOTO`). The design's GST certificate, property proof, business details and automated checks are added by the later backend plan; until then they are `<NotWiredYet>` — not blank rows.

**Files:**
- Modify: `apps/frontend/src/platforms/admin/pages/KycPage.tsx`
- Create: `apps/frontend/src/platforms/admin/kyc/kycCards.ts`
- Test: `apps/frontend/src/platforms/admin/kyc/kycCards.test.ts`
- Create: `apps/frontend/src/platforms/admin/drawer/KycDrawerBody.tsx`

**Interfaces:**
- Consumes: `platformAdminService.getOwnerDocuments`, `reviewOwnerDocument`; existing `platforms/admin/documents/documentQueue.ts` and `DocumentViewer.tsx`.
- Produces:
  - `type KycCard = { profileId, name, contact, initials, tint, docs: { docType, status, uploadedAt, id }[], submittedLabel }`
  - `groupDocumentsByOwner(docs: OwnerDocument[]): KycCard[]`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { groupDocumentsByOwner } from './kycCards';

const docs = [
  { id: 'd1', doc_type: 'PAN', status: 'PENDING', uploaded_at: '2026-08-16T09:00:00Z',
    profile: { id: 'p1', name: 'Meghana Rao', phone: '+919000011223', email: null } },
  { id: 'd2', doc_type: 'AADHAAR', status: 'PENDING', uploaded_at: '2026-08-16T10:00:00Z',
    profile: { id: 'p1', name: 'Meghana Rao', phone: '+919000011223', email: null } },
  { id: 'd3', doc_type: 'PAN', status: 'PENDING', uploaded_at: '2026-08-15T10:00:00Z',
    profile: { id: 'p2', name: 'Faizan Ahmed', phone: null, email: 'f@urbanstay.co' } },
] as any[];

describe('groupDocumentsByOwner', () => {
  it('produces one card per owner, not one per document', () => {
    expect(groupDocumentsByOwner(docs)).toHaveLength(2);
  });

  it('collects every document belonging to that owner', () => {
    const card = groupDocumentsByOwner(docs).find((c) => c.profileId === 'p1');
    expect(card?.docs.map((d) => d.docType).sort()).toEqual(['AADHAAR', 'PAN']);
  });

  it('orders owners by their most recent submission first', () => {
    expect(groupDocumentsByOwner(docs).map((c) => c.profileId)).toEqual(['p1', 'p2']);
  });

  it('falls back to email when the owner has no phone', () => {
    const card = groupDocumentsByOwner(docs).find((c) => c.profileId === 'p2');
    expect(card?.contact).toBe('f@urbanstay.co');
  });

  it('returns an empty list rather than throwing when nothing is pending', () => {
    expect(groupDocumentsByOwner([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/frontend && npx vitest run src/platforms/admin/kyc/kycCards.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement and build the screen**

Implement `groupDocumentsByOwner`. Then `KycPage.tsx`: four `<StatCard>`s (pending owners, pending documents, verified this week, rejected this week — all derived from real query data), then the design's two-column card grid. Each card shows the owner, a document tile per submitted doc, and Reject / Approve buttons calling `reviewOwnerDocument(id, 'REJECTED' | 'VERIFIED', note)`.

Rejection requires a note — the owner needs to know what to fix, per the `review_note` column comment. Do not send a rejection without one.

When the queue is empty, render `<EmptyState title="Queue is clear 🎉" message="No owner KYC submissions are waiting for review." />` (the design's own copy).

Below the queue, render `<NotWiredYet title="Business details and automated checks aren't collected yet" />` for the design's GST/property/verification-check panels.

- [ ] **Step 4: Verify**

Run: `cd apps/frontend && npm run typecheck && npm test && npm run check:architecture && npm run build`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/platforms/admin/kyc/ \
        apps/frontend/src/platforms/admin/pages/KycPage.tsx \
        apps/frontend/src/platforms/admin/drawer/KycDrawerBody.tsx
git commit -m "feat(admin): rebuild KYC approvals screen on real document data"
```

---

### Task 9: Documentation

Required by the repo's documentation rule — a change of this size shipping without vault updates counts as incomplete work, not optional follow-up.

**Files:**
- Modify: `docs/obsidian/Features.md`, `Frontend.md`, `Changelog.md`, `Decisions.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the vault**

- `Frontend.md` — replace the admin-console section with the new structure (shell, `ui/`, `drawer/`, eleven routes, the four redirects). Link `[[Features]]` and `[[Decisions]]`.
- `Features.md` — describe the rebuilt console, and state plainly which screens are layout-only.
- `Decisions.md` — add an ADR: *replacing the admin console wholesale rather than migrating it*, recording that Settlements and Reports ship as layout-only, that Settings was kept despite being absent from the design, and that marketing reviews moved to a tab inside Listings (amending ADR-076's location note).
- `Changelog.md` — dated entry for the rebuild.

- [ ] **Step 2: Fix the stale claim in CLAUDE.md**

`CLAUDE.md` states "No test suite in `apps/frontend/` currently." That is wrong — `vitest.config.ts` exists and `npm test` runs. Replace with a note that it is node-environment only, has no jsdom, and matches `src/**/*.test.ts`, so logic is tested as pure modules and components stay thin.

- [ ] **Step 3: Commit**

```bash
git add docs/obsidian/ CLAUDE.md
git commit -m "docs(admin): record console rebuild in vault; fix stale frontend test claim"
```

---

## Self-Review

**Spec coverage.** This plan covers the spec's frontend architecture, routes, redirects, drawer-in-URL decision, palette, the `NotWiredYet` rule, and sequencing steps 3–4 plus the Settings and marketing-review decisions (2 and 3). Deliberately **not** covered here, because they belong to later plans: the lifecycle enum merge and public stage-mapper fix (spec §"The owner lifecycle"), the lead CRM and KYC schema work (spec §"Backend changes"), the trial surfacing, and the Overview/Leads/Revenue/Subscriptions/Broadcasts/Settings screen bodies. Those become **Plan 2 (backend: lifecycle + lead CRM + KYC)** and **Plan 3 (remaining screens)**. Each of the three plans leaves working software.

**Placeholder scan.** No TBDs. Task 4 step 4 and Tasks 6–8 step 5 describe screens in prose plus exact class strings, column widths, query keys and endpoints rather than full JSX — these are large presentational components whose content is fully specified by the design file and the listed interfaces. Every module with logic has literal test code and a literal implementation or an exact algorithm.

**Type consistency.** `AdminNavCounts` keys (`leads`, `kyc`, `listings`, `reports`) match `buildAdminNav`'s reads. `DrawerKind` values match the `?detail=` prefixes used in Tasks 6–8. `DataColumn.width` is a grid-template string in both `DataTable` and its callers. `ADMIN_CARD` is imported from `theme/palette` by every card surface.

**One risk worth flagging to the executor:** Task 5 deletes the old console before Tasks 6–8 rebuild its screens. Between those commits, `/admin/owners`, `/admin/listings` and `/admin/kyc` show `NotWiredYet`. That is intentional and keeps commits small, but do not deploy from a commit between Task 5 and Task 8.
