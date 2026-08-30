# Configuration — Remove The Dead (Piece A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove everything in the owner configuration section that leads nowhere — 7 unused backend endpoints, 2 dead links, 11 rows advertising settings that do not exist, a duplicate route, and a misspelling of the product name — so the redesign in pieces B and C is not built beside dead code.

**Architecture:** Pure subtraction plus two link repairs. No new screens. All decision logic already lives in pure `.ts` modules (`deriveConfigSections`, `deriveNotificationSections`, `deriveAutomationSections`, `payoutState`) with existing test suites, so every behavioural change here is test-first against those modules.

**Tech Stack:** React 19 + Vite (`apps/frontend`), Next.js 14 App Router (`apps/backend`), Vitest, TanStack Query.

**Spec:** `docs/superpowers/specs/2026-08-30-owner-configuration-redesign-design.md`

## Global Constraints

- **Frontend tests are node-environment only.** Vitest matches `src/**/*.test.ts` — never `.test.tsx`. No jsdom, no component rendering. Put decision logic in pure `.ts` and test that.
- **`npm run build` in `apps/frontend`** runs `check:architecture` then `vite build` then a branding check. It does **not** typecheck — run `npx tsc --noEmit` separately.
- **`npx tsc --noEmit` has a large pre-existing error backlog in both apps.** Never read it as pass/fail. Compare against a `git stash` baseline and confirm your files add nothing new.
- **Backend fast path is `npm run test:pure`** (`vitest.pure.config.ts`, explicit include list). `npm test` is the DB-backed suite and is slow.
- **Do not delete `src/features/owner-more/config/dirtyState.ts`.** Its `hasChanges` is imported by `src/features/owner-food/components/timings/MealTimingsForm.tsx`. Deleting it breaks the food module.
- **Documentation is part of the change, not a follow-up.** Per `CLAUDE.md`, an API removal updates `docs/obsidian/APIs.md`; a bug fix adds to `docs/obsidian/Bugs.md`; every change adds to `docs/obsidian/Changelog.md`.
- **Never push to `main`.** Work on a feature branch and merge to `dev`.
- Product name is **Stayo**. Never "StayO".

---

### Task 1: Point "Room configuration" at the rooms screen that exists

The Hostel module shows a **Room configuration** row with a real room and bed count, routed to `/owner/more/configuration/hostel/rooms` — which is not a route anywhere in the app. The hostel drilldown's Rooms tab (`/owner/hostels/:hostelId/rooms`) already owns rooms. The row needs the real destination.

`ConfigSource.hostel` does not declare an `id`, but the caller already passes one: `useConfigModule.ts:45` passes `policyQuery.data?.hostel`, and that object is `HostelInfo` from `features/settings/settingsHooks.ts`, which has `id: string`. Declaring the field is enough — no call site changes.

**Files:**
- Modify: `apps/frontend/src/features/owner-more/config/deriveConfigSections.ts` (interface at 17-24, row at 144-150)
- Test: `apps/frontend/src/features/owner-more/config/deriveConfigSections.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ConfigSource.hostel.id?: string | null`. Tasks 2-7 do not depend on this.

- [ ] **Step 1: Write the failing test**

Add to `deriveConfigSections.test.ts`:

```ts
describe('room configuration row', () => {
  it('points at the hostel drilldown rooms tab, which is where rooms actually live', () => {
    const sections = deriveHostelSections(
      source({ hostel: { id: 'h-1', name: 'Sunrise Residency', city: 'Guntur' } }),
    );
    expect(find(sections, 'room-configuration').route).toBe('/owner/hostels/h-1/rooms');
  });

  it('offers no route at all when the hostel id is unknown, rather than a broken one', () => {
    // A row that navigates nowhere is worse than a row that does not invite a
    // tap: the old route `/owner/more/configuration/hostel/rooms` was never
    // registered, so tapping it did nothing and said nothing.
    const sections = deriveHostelSections(
      source({ hostel: { name: 'Sunrise Residency' } }),
    );
    expect(find(sections, 'room-configuration').route).toBeUndefined();
  });
});
```

`source()` and `find()` are the helpers already defined at the top of this test
file (lines 5 and 25). `source()`'s default hostel has no `id`, which is why the
second case overrides `hostel` rather than relying on the default.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/features/owner-more/config/deriveConfigSections.test.ts -t "room configuration row"`
Expected: FAIL — first case receives `/owner/more/configuration/hostel/rooms`.

- [ ] **Step 3: Write the implementation**

In `deriveConfigSections.ts`, add `id` to the hostel shape (interface at line 17):

```ts
export interface ConfigSource {
  hostel?: {
    id?: string | null;
    name?: string | null;
    phone?: string | null;
    address?: string | null;
    city?: string | null;
    gst_number?: string | null;
  } | null;
```

Replace the `room-configuration` row (around line 144):

```ts
        {
          key: 'room-configuration',
          title: 'Room configuration',
          detail: `${plural(counts.rooms, 'room')} · ${plural(counts.beds, 'bed')}`,
          state: counts.rooms > 0 ? 'configured' : 'attention',
          // The hostel drilldown's Rooms tab owns rooms. This used to point at
          // `/owner/more/configuration/hostel/rooms`, which was never a route,
          // so the row rendered as configured and then did nothing.
          route: hostel?.id ? `/owner/hostels/${hostel.id}/rooms` : undefined,
        },
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/frontend && npx vitest run src/features/owner-more/config/deriveConfigSections.test.ts`
Expected: PASS, whole file.

- [ ] **Step 5: Verify no dead link remains**

Run: `cd apps/frontend && grep -rn "configuration/hostel/rooms" src/`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/features/owner-more/config/deriveConfigSections.ts apps/frontend/src/features/owner-more/config/deriveConfigSections.test.ts
git commit -m "fix(config): point Room configuration at the rooms screen that exists"
```

---

### Task 2: Stop offering a broken button when a payout fails

`payoutState.ts:95` attaches `action: { label: 'Check payout account', to: '/owner/more/payout-account' }` to the **failed payout** voice. That route does not exist. It is shown at the moment an owner is told money did not reach their bank.

The destination is built in Piece B (the *Where your money goes* row). Until it exists, the alert keeps its headline and its reason — which is the part that tells the owner whether their own bank details are at fault — and drops the button. A missing button is honest; a button that does nothing is not.

**Files:**
- Modify: `apps/frontend/src/features/owner-money/payouts/payoutState.ts:88-96`
- Test: `apps/frontend/src/features/owner-money/payouts/payoutState.test.ts:55`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. Piece B restores this action pointing at the real row.

- [ ] **Step 1: Change the existing test to describe the new behaviour**

In `payoutState.test.ts`, replace the assertion at line 55 (`expect(voice.action?.to).toContain('payout-account')`) with:

```ts
    // The destination (`/owner/more/payout-account`) is not a route yet — it
    // arrives with the bank-account row in Piece B. Until then this alert
    // carries no action rather than a button that silently does nothing.
    expect(voice.action).toBeUndefined();
    // The reason still has to survive: it is what tells the owner whether his
    // own bank details are at fault, which only he can correct.
    expect(voice.detail).toContain('rejected');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/features/owner-money/payouts/payoutState.test.ts`
Expected: FAIL — `voice.action` is currently defined.

- [ ] **Step 3: Remove the action**

In `payoutState.ts`, delete the `action:` line from the failed-payout return so it reads:

```ts
    return {
      tone: 'alert',
      headline: `${formatInr(summary.failed.total)} didn't reach your bank`,
      // The reason verbatim from the admin who recorded it, then who is fixing
      // it. "We're on it" alone is a brush-off; the cause is what lets him tell
      // whether it is his bank details at fault, which only he can correct.
      detail: `${summary.failed.reason?.trim() || 'The transfer was rejected'} — your money is safe with Stayo and we're on it.`,
      // No action: `/owner/more/payout-account` was never a route, so this
      // button did nothing at the worst possible moment. Piece B adds the
      // bank-account row and restores it. See the configuration redesign spec.
    };
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/frontend && npx vitest run src/features/owner-money/payouts/payoutState.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the dead route is gone**

Run: `cd apps/frontend && grep -rn "more/payout-account" src/`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/features/owner-money/payouts/payoutState.ts apps/frontend/src/features/owner-money/payouts/payoutState.test.ts
git commit -m "fix(money): drop the broken payout-account button from the failed-payout alert"
```

---

### Task 3: Remove the eleven rows that advertise settings we do not have

Eleven rows render permanently as `unavailable`: room types, amenities, payment methods, the SMS channel, scheduled jobs, activity logs, and five notification events. Labelling them honestly was better than faking them, but the redesign removes the completeness meter they were padding, so they are now pure noise.

**Files:**
- Modify: `apps/frontend/src/features/owner-more/config/deriveConfigSections.ts` (lines 84-89, 151-152, 267)
- Modify: `apps/frontend/src/features/owner-more/config/deriveNotificationSections.ts` (lines 66-70, 101-103, 120-121)
- Modify: `apps/frontend/src/features/owner-more/config/deriveAutomationSections.ts` (lines 74, 152, 186-187)
- Test: the matching `.test.ts` beside each

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Change the tests to assert absence**

In `deriveConfigSections.test.ts`, replace the test at line 86 (`renders room types and amenities as unavailable, not as gaps`) and the one at line 234 (`renders payment methods as unavailable...`) with a single test:

```ts
  it('does not list settings that do not exist', () => {
    // Room types, amenities and payment methods have no implementation. They
    // were rendered as permanently "Not available yet" to pad a completeness
    // meter that the redesign removes.
    const sections = deriveHostelSections(source());
    const keys = sections.flatMap((s) => s.rows).map((r) => r.key);
    expect(keys).not.toContain('room-types');
    expect(keys).not.toContain('amenities');
    expect(keys).not.toContain('payment-methods');
  });

  it('leaves no unavailable rows at all', () => {
    const sections = deriveHostelSections(source());
    expect(sections.flatMap((s) => s.rows).some((r) => r.state === 'unavailable')).toBe(false);
  });
```

Delete the test at line 100 (`keeps unavailable rows out of the area tally`) — with no unavailable rows there is nothing to keep out.

Each of the three test files defines its own `source(overrides?)` helper at the
top; use that one, not a helper from a sibling file.

In `deriveNotificationSections.test.ts`, delete any test asserting an `unavailable` state and add:

```ts
  it('lists only notification events that have a real setting behind them', () => {
    const sections = deriveNotificationSections(source());
    const keys = sections.flatMap((s) => s.rows).map((r) => r.key);
    for (const gone of ['payment-received', 'agreement-ready', 'move-in-out', 'collection-report', 'automation-failure']) {
      expect(keys).not.toContain(gone);
    }
  });
```

In `deriveAutomationSections.test.ts`, replace the tests at lines 65 (`renders SMS as unavailable...`), 83 (`gives unavailable rows no path...`) and 147 (`refuses to build a patch for an unavailable row`) with:

```ts
  it('lists only workflows that exist', () => {
    const rows = deriveAutomationSections(source()).flatMap((s) => s.rows);
    const keys = rows.map((r) => r.key);
    expect(keys).not.toContain('channel_sms');
    expect(keys).not.toContain('scheduled_jobs');
    expect(keys).not.toContain('activity_logs');
    // Every remaining row is writable — that is now the whole rule.
    for (const row of rows) expect(row.path).toBeTruthy();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/frontend && npx vitest run src/features/owner-more/config/`
Expected: FAIL — the removed rows are still present.

- [ ] **Step 3: Delete the rows and their helpers**

In `deriveConfigSections.ts`: delete the `unavailable` helper (lines 84-89) and the three call sites (`room-types`, `amenities` at 151-152; `payment-methods` at 267).

In `deriveNotificationSections.ts`: delete the `unavailable` helper (lines 66-70) and its five call sites (101-103, 120-121).

In `deriveAutomationSections.ts`: delete the `unavailableRow` helper (line 74) and its three call sites (152, 186-187).

Remove any import left unused by those deletions — in particular `UNAVAILABLE_LABEL` from `./configRows`.

- [ ] **Step 4: Run the tests**

Run: `cd apps/frontend && npx vitest run src/features/owner-more/config/`
Expected: PASS.

- [ ] **Step 5: Remove the now-unreferenced state, if it is unreferenced**

Run: `cd apps/frontend && grep -rn "unavailable" src/features/owner-more/`

If `UNAVAILABLE_LABEL` (`config/configRows.ts:53`) and the `'unavailable'` member of the state union (`config/configRows.ts:18`) have no remaining references, delete both, plus any rendering branch that only handled them in `components/ConfigSettingRow.tsx` and `components/ConfigWorkflowRow.tsx`. If anything still references them, leave them and note it in the commit body — do not force it.

- [ ] **Step 6: Typecheck against baseline**

```bash
cd apps/frontend
npx tsc --noEmit 2>&1 | grep "owner-more" > /tmp/after.txt
git stash && npx tsc --noEmit 2>&1 | grep "owner-more" > /tmp/before.txt; git stash pop
diff /tmp/before.txt /tmp/after.txt
```

Expected: no new errors (line-number shifts are fine).

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/features/owner-more/
git commit -m "refactor(config): stop listing eleven settings that do not exist"
```

---

### Task 4: Delete the duplicate hub route

`/owner/more` and `/owner/more/configuration` both render `MoreConfigurationHubPage`, so back-navigation depends on how the owner arrived. The bottom nav points at `/owner/more` (`OwnerAppShell.tsx:37`); `/owner/more/configuration` is referenced by nothing. Its children (`/owner/more/configuration/finance`, etc.) are separate routes and stay.

**Files:**
- Modify: `apps/frontend/src/platforms/owner/router/OwnerRoutes.tsx:215`

- [ ] **Step 1: Confirm nothing links to it**

```bash
cd apps/frontend
grep -rn "'/owner/more/configuration'" src/
grep -rn '"/owner/more/configuration"' src/
```

Expected: no output from either. If there is output, change those links to `/owner/more` before continuing.

- [ ] **Step 2: Delete the route**

Remove this line from `OwnerRoutes.tsx` (line 215):

```tsx
        <Route path="/owner/more/configuration" element={<MoreConfigurationHubPage />} />
```

- [ ] **Step 3: Verify the children still resolve**

```bash
cd apps/frontend
grep -n "owner/more/configuration/" src/platforms/owner/router/OwnerRoutes.tsx | head
```

Expected: the child routes (`/finance`, `/hostel`, `/agreements`, `/notifications`, `/account`, and the finance and agreement sub-pages) are all still listed.

- [ ] **Step 4: Build**

Run: `cd apps/frontend && npm run build`
Expected: architecture check passes, build succeeds, branding check passes.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/platforms/owner/router/OwnerRoutes.tsx
git commit -m "fix(config): give the configuration hub one URL instead of two"
```

---

### Task 5: Spell the product's name correctly

"About StayO" is user-visible in two places. The product is Stayo.

**Files:**
- Modify: `apps/frontend/src/features/owner-more/pages/MoreAboutPage.tsx:21,28`
- Modify: `apps/frontend/src/features/owner-more/pages/MoreConfigurationHubPage.tsx:218,235`

There is no test for this — the frontend suite renders no components. Verification is grep plus the build's branding check.

- [ ] **Step 1: Fix the visible strings**

In `MoreAboutPage.tsx`, change the `title="About StayO"` prop on `MoreScreenHeader` (line 28) to `title="About Stayo"`, and the doc comment on line 21 to match.

In `MoreConfigurationHubPage.tsx`, change `title="About StayO"` (line 218) to `title="About Stayo"`.

- [ ] **Step 2: Remove the version footer**

`MoreConfigurationHubPage.tsx:235` renders `Stayo v2.0 · Manage. Automate. Grow.` A version number is not something an owner can act on. Delete that line.

- [ ] **Step 3: Verify**

```bash
cd apps/frontend && grep -rn "StayO" src/features/owner-more/
```

Expected: no output. (`StayO` still appears in unrelated code comments elsewhere in `src/` — those are out of scope for this task and are not user-visible.)

- [ ] **Step 4: Build**

Run: `cd apps/frontend && npm run build`
Expected: passes, including the branding check.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/features/owner-more/pages/
git commit -m "fix(config): spell Stayo correctly, and drop the version footer"
```

---

### Task 6: Delete the seven config endpoints nothing calls

Seven routes under `/api/hostels/[id]/` have **no reference anywhere outside their own file** — not the frontend, not a test, not another service. They were superseded by the single `preferences` endpoint and never removed, and they still accept writes, so anything that did call them would diverge from what the UI reads.

This is its own commit so it can be reverted independently of the UI work.

**Files:**
- Delete: `apps/backend/app/api/hostels/[id]/automation-config/route.ts` (36 lines)
- Delete: `apps/backend/app/api/hostels/[id]/billing-config/route.ts` (39)
- Delete: `apps/backend/app/api/hostels/[id]/notification-config/route.ts` (39)
- Delete: `apps/backend/app/api/hostels/[id]/payment-config/route.ts` (34)
- Delete: `apps/backend/app/api/hostels/[id]/receipt-config/route.ts` (34)
- Delete: `apps/backend/app/api/hostels/[id]/security-config/route.ts` (34)
- Delete: `apps/backend/app/api/hostels/[id]/system-config/route.ts` (39)

- [ ] **Step 1: Re-verify each is unreferenced before deleting**

```bash
cd /home/sp/Desktop/stayo
for ep in automation-config billing-config notification-config payment-config receipt-config security-config system-config; do
  n=$(grep -rl "$ep" --include=*.ts --include=*.tsx apps/backend/app apps/backend/src apps/backend/lib apps/backend/tests apps/frontend/src 2>/dev/null \
      | grep -v "app/api/hostels/\[id\]/$ep/route.ts" | wc -l)
  echo "$ep: $n"
done
```

Expected: every line reads `0`. **If any is non-zero, stop and do not delete that one** — report it instead.

- [ ] **Step 2: Delete the directories**

```bash
cd /home/sp/Desktop/stayo/apps/backend/app/api/hostels/\[id\]
rm -r automation-config billing-config notification-config payment-config receipt-config security-config system-config
```

- [ ] **Step 3: Confirm `preferences` and the still-used siblings survive**

```bash
ls /home/sp/Desktop/stayo/apps/backend/app/api/hostels/\[id\]/
```

Expected: `preferences`, `billing-defaults`, `invite-defaults`, `logo`, and the other live routes are present; none of the seven remain.

- [ ] **Step 4: Run the backend pure suite**

Run: `cd apps/backend && npm run test:pure`
Expected: same result as before your change. There are **2 known pre-existing failures** in `tests/agreement-requirement.test.ts` — those are not yours. No new failures.

- [ ] **Step 5: Typecheck against baseline**

```bash
cd apps/backend
npx tsc --noEmit 2>&1 | sed 's/([0-9]*,[0-9]*)//' | sort -u > /tmp/b-after.txt
git stash && npx tsc --noEmit 2>&1 | sed 's/([0-9]*,[0-9]*)//' | sort -u > /tmp/b-before.txt; git stash pop
diff /tmp/b-before.txt /tmp/b-after.txt
```

Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add -A apps/backend/app/api/hostels/
git commit -m "chore(api): delete seven config endpoints with no callers

Superseded by the single hostel preferences endpoint and never removed.
Verified to have zero references outside their own files — no frontend
caller, no test, no other service. They still accepted writes, so any
caller would have diverged from what the UI reads."
```

---

### Task 7: Update the vault

`CLAUDE.md` requires documentation in the same change, not as a follow-up. An API removal updates `APIs.md`; the dead links were real bugs, so they belong in `Bugs.md`; everything gets a `Changelog.md` entry.

**Files:**
- Modify: `docs/obsidian/APIs.md`
- Modify: `docs/obsidian/Bugs.md`
- Modify: `docs/obsidian/Changelog.md`
- Modify: `docs/obsidian/TODO.md`

- [ ] **Step 1: Record the endpoint removal in `APIs.md`**

Find the hostel-config listing (search for `automation-config`) and replace the removed names with a note:

```markdown
**Removed 2026-08-30:** `automation-config`, `billing-config`, `notification-config`,
`payment-config`, `receipt-config`, `security-config` and `system-config` under
`/api/hostels/[id]/` are deleted. They were superseded by `preferences` and had
zero references anywhere in the repo — no frontend caller, no test, no other
service — while still accepting writes. All hostel policy is read and written
through `GET/PATCH /api/hostels/[id]/preferences`.
```

- [ ] **Step 2: Record the two dead links in `Bugs.md`**

Add above the most recent entry:

```markdown
## 2026-08-30 — Two configuration links pointed at routes that did not exist (fixed)

**Symptom.** Tapping "Room configuration" in the Hostel module did nothing. The
row showed a real room and bed count and rendered as *configured*, so nothing
suggested it was broken. Separately, the "Check payout account" button on the
failed-payout alert also did nothing — and that alert appears only when an
owner has just been told money did not reach their bank.

**Root cause.** Both targets were never registered as routes.
`/owner/more/configuration/hostel/rooms` never existed; the hostel drilldown's
Rooms tab (`/owner/hostels/:hostelId/rooms`) has always owned rooms.
`/owner/more/payout-account` never existed either, although its API
(`GET/PATCH /api/owner/payout-account`) does and works — the configuration
section simply had no screen for the owner's bank account.

**Fix.** The rooms row now points at the drilldown tab, and returns no route at
all when the hostel id is unknown rather than a broken one. The payout button is
removed until Piece B of the configuration redesign builds its destination — a
missing button is honest, a button that does nothing at that moment is not.

**What made it findable.** Diffing every `/owner/more/...` path linked in the
source against every path actually registered in the router. See the
configuration redesign spec.
```

- [ ] **Step 3: Add the `Changelog.md` entry**

Add at the top of `## [Unreleased]`:

```markdown
- **2026-08-30**: **The configuration section stops leading owners nowhere.** First piece of the configuration redesign, and pure subtraction. **Seven backend endpoints deleted** — `automation-config`, `billing-config`, `notification-config`, `payment-config`, `receipt-config`, `security-config`, `system-config` — each verified to have zero references anywhere in the repo while still accepting writes; all hostel policy goes through `preferences`. **Two dead links fixed:** "Room configuration" now points at the hostel drilldown's Rooms tab instead of a route that never existed, and the failed-payout alert's "Check payout account" button is removed until its destination exists (its API is built and unwired — see [[TODO]]). **Eleven rows that advertised settings we do not have** — room types, amenities, payment methods, SMS, scheduled jobs, activity logs and five notification events — are gone; they existed to pad a completeness meter the redesign removes. The hub had **two URLs** and now has one. "About StayO" is spelled correctly, and the version footer is dropped. See the configuration redesign spec, [[Bugs]], [[APIs]].
```

- [ ] **Step 4: Record what Piece B must restore, in `TODO.md`**

```markdown
## Piece B must restore the payout-account action (2026-08-30)

- [ ] The failed-payout alert (`payoutState.ts`) lost its "Check payout account"
      button because `/owner/more/payout-account` was never a route. When Piece B
      builds the *Where your money goes* row, restore the action pointing at it,
      and restore the assertion in `payoutState.test.ts` that the alert offers a
      way to fix the bank details.
```

- [ ] **Step 5: Commit**

```bash
git add docs/obsidian/
git commit -m "docs: record the configuration dead-code removal"
```

---

## Verification

- [ ] `cd apps/frontend && npx vitest run` — all files pass.
- [ ] `cd apps/frontend && npm run build` — architecture check, build and branding check all pass.
- [ ] `cd apps/backend && npm run test:pure` — no new failures beyond the 2 known ones in `tests/agreement-requirement.test.ts`.
- [ ] `grep -rn "configuration/hostel/rooms\|more/payout-account" apps/frontend/src` — no output.
- [ ] `grep -rn "StayO" apps/frontend/src/features/owner-more` — no output.
- [ ] Open `/owner/more` in the running app: no progress-ring rows reading "Not available yet", and tapping "Room configuration" lands on the hostel's Rooms tab.
