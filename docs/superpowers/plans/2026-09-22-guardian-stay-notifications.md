# Guardian Stay Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tell a guardian when their ward leaves the hostel and when they get back — after the tenant has agreed to it once.

**Architecture:** A read model over the existing `stay_events` stream (ADR-194). `applyStayEvent` and the reducer do not change. A new `stay_guardian_consent` table holds the tenant's decision; a pure policy decides whether a given event notifies; a never-throwing sender fires inline after the write transaction commits; a daily cron re-attempts what the inline send lost, deduped on `whatsapp_logs.idempotency_key`.

**Tech Stack:** Next.js 14 App Router · Prisma → Postgres (Supabase) · Vitest (pure config only — see Global Constraints) · Meta WhatsApp Cloud API · React 19 + Vite frontend

**Spec:** [`docs/superpowers/specs/2026-09-22-guardian-stay-notifications-design.md`](../specs/2026-09-22-guardian-stay-notifications-design.md)

## Global Constraints

- **ADR number is `ADR-233`.** Claimed against `origin/main` at `152d29e3`, where ADR-232 is the high-water mark. **Re-check `docs/obsidian/Decisions.md` on `origin/main` at merge time** and renumber if it moved — ADR-193 collided exactly this way.
- **There is no test database.** `npm test` cannot run. Every backend test in this plan goes in `apps/backend/vitest.pure.config.ts`'s `include` array and is run with `npm run test:pure`. That array is an **explicit allowlist, not a glob** — a file not added to it silently never runs.
- **Pure modules import nothing with I/O.** No `@/lib/db`, no provider clients. `Intl` is fine.
- **Backend test command:** `cd apps/backend && npx vitest run --config vitest.pure.config.ts <file>`
- **Frontend test command:** `cd apps/frontend && npx vitest run src/features/stay/stayState.test.ts`
- **Frontend tests are node-only, no jsdom, `src/**/*.test.ts` — never `.test.tsx`.** Decision logic goes in a pure `.ts` module; components render it and decide nothing.
- **New SQL goes in root `migrations/NNN_*.sql`, next number `093`.** Not `apps/backend/prisma/migrations/`. `tests/migration-rls.test.ts` only scans the root directory.
- **Any table a migration creates must `ENABLE ROW LEVEL SECURITY` in that same migration, with no policies.** `tests/migration-rls.test.ts` fails the build otherwise. The Supabase anon key is compiled into the browser bundle.
- **Template names and languages are hard-coded, with no env-var fallback.** ADR-196: a fallback to a name that was never registered at Meta caused weeks of silent `132001` failures.
- **Parameter order is the contract.** A vector of the right length in the wrong order produces a plausible message about the wrong thing, and Meta cannot catch it.
- **`{{2}}` in both templates is a bare tenant name, never a possessive.** Reuse the existing `tenantDisplayName()` from `guardian-activation-template-contract.ts`; do not write a second one.
- **Exact approved copy** — both bodies, verbatim, are in Task 1. Do not paraphrase them anywhere, including in the `body` field of the contract.
- **Footer, both templates:** `Stayo · Reply STOP to pause stay updates`
- **IST is explicit everywhere.** Production `hostels.timezone` is `UTC`; the Stay module never reads it. Use `Asia/Kolkata`.
- **The sender never throws.** A failed WhatsApp send must never unwind or fail a stay event.
- **Commit after every task.** Branch `feat/guardian-stay-notifications`, worktree `.claude/worktrees/guardian-stay`. Never push to `main`.

---

### Task 1: Template contracts

**Files:**
- Create: `apps/backend/lib/services/notifications/providers/whatsapp/stay-guardian-template-contracts.ts`
- Create: `apps/backend/tests/stay-guardian-templates.test.ts`
- Modify: `apps/backend/vitest.pure.config.ts` (add the test to `include`)

**Interfaces:**
- Consumes: `tenantDisplayName` from `./guardian-activation-template-contract` (already exported, pure).
- Produces:
  - `type StayGuardianKind = "DEPARTURE" | "RETURN"`
  - `STAY_GUARDIAN_TEMPLATES: Record<StayGuardianKind, { name: string; language: string; parameters: readonly string[]; body: string }>`
  - `STAY_GUARDIAN_FOOTER: string`
  - `leaveTypeWord(leaveType: string | null | undefined): string`
  - `formatReturnDate(isoDate: string): string`
  - `formatCheckInTime(instant: string | Date): string`
  - `buildStayDeparturePayload(input: { guardianName; tenantName; hostelName; leaveType; returnDate }): string[]`
  - `buildStayReturnPayload(input: { guardianName; tenantName; hostelName; checkInAt }): string[]`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/stay-guardian-templates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  STAY_GUARDIAN_TEMPLATES,
  STAY_GUARDIAN_FOOTER,
  buildStayDeparturePayload,
  buildStayReturnPayload,
  formatCheckInTime,
  formatReturnDate,
  leaveTypeWord,
} from "@/lib/services/notifications/providers/whatsapp/stay-guardian-template-contracts";

describe("stay guardian template contracts", () => {
  it("names both templates exactly as submitted to Meta", () => {
    expect(STAY_GUARDIAN_TEMPLATES.DEPARTURE.name).toBe("stayo_guardian_stay_departure");
    expect(STAY_GUARDIAN_TEMPLATES.RETURN.name).toBe("stayo_guardian_stay_return");
    expect(STAY_GUARDIAN_TEMPLATES.DEPARTURE.language).toBe("en");
    expect(STAY_GUARDIAN_TEMPLATES.RETURN.language).toBe("en");
  });

  it("every body placeholder has a declared parameter, and vice versa", () => {
    for (const kind of ["DEPARTURE", "RETURN"] as const) {
      const { body, parameters } = STAY_GUARDIAN_TEMPLATES[kind];
      const placeholders = new Set(body.match(/\{\{\d+\}\}/g) ?? []);
      expect(placeholders.size, kind).toBe(parameters.length);
      for (let i = 1; i <= parameters.length; i += 1) {
        expect(body, `${kind} {{${i}}}`).toContain(`{{${i}}}`);
      }
    }
  });

  it("carries the one footer both templates were approved with", () => {
    expect(STAY_GUARDIAN_FOOTER).toBe("Stayo · Reply STOP to pause stay updates");
  });
});

describe("leaveTypeWord", () => {
  it("reads naturally after the body's single preposition 'for'", () => {
    expect(leaveTypeWord("GOING_HOME")).toBe("home");
    expect(leaveTypeWord("VACATION")).toBe("a trip");
  });

  it("never returns an empty string — Meta rejects a blank parameter", () => {
    for (const value of [null, undefined, "", "   ", "SABBATICAL"]) {
      expect(leaveTypeWord(value).trim().length, String(value)).toBeGreaterThan(0);
    }
    expect(leaveTypeWord("SABBATICAL")).toBe("a trip");
  });
});

describe("dates are rendered in IST, never the server's zone", () => {
  it("formats a return date as a weekday and a full month", () => {
    expect(formatReturnDate("2026-09-28")).toBe("Sunday, 28 September");
  });

  it("formats a check-in instant in IST", () => {
    // 14:10 UTC = 19:40 IST on the same day.
    expect(formatCheckInTime("2026-09-28T14:10:00.000Z")).toBe("7:40 PM, 28 Sep");
  });

  it("converts rather than relabelling: a UTC instant late in the day rolls the IST date forward", () => {
    // 20:00 UTC on the 28th is 01:30 IST on the 29th.
    expect(formatCheckInTime("2026-09-28T20:00:00.000Z")).toBe("1:30 AM, 29 Sep");
  });
});

describe("payload builders", () => {
  it("builds the five departure parameters in the declared order", () => {
    const params = buildStayDeparturePayload({
      guardianName: "Ramesh",
      tenantName: "Aarav",
      hostelName: "Sunrise PG",
      leaveType: "GOING_HOME",
      returnDate: "2026-09-28",
    });
    expect(params).toEqual(["Ramesh", "Aarav", "Sunrise PG", "home", "Sunday, 28 September"]);
    expect(params).toHaveLength(STAY_GUARDIAN_TEMPLATES.DEPARTURE.parameters.length);
  });

  it("builds the four return parameters in the declared order", () => {
    const params = buildStayReturnPayload({
      guardianName: "Ramesh",
      tenantName: "Aarav",
      hostelName: "Sunrise PG",
      checkInAt: "2026-09-28T14:10:00.000Z",
    });
    expect(params).toEqual(["Ramesh", "Aarav", "Sunrise PG", "7:40 PM, 28 Sep"]);
    expect(params).toHaveLength(STAY_GUARDIAN_TEMPLATES.RETURN.parameters.length);
  });

  it("strips a possessive from the tenant name, both apostrophe forms", () => {
    // The body reads "{{2}} has left {{3}}" — "Aarav's has left Sunrise PG" is the bug.
    for (const name of ["Aarav's", "Aarav’s", "Anders'"]) {
      const [, tenantName] = buildStayDeparturePayload({
        guardianName: "Ramesh",
        tenantName: name,
        hostelName: "Sunrise PG",
        leaveType: "VACATION",
        returnDate: "2026-09-28",
      });
      expect(tenantName, name).not.toMatch(/['’]s?$/);
    }
  });

  it("never emits an empty parameter from missing data", () => {
    const departure = buildStayDeparturePayload({
      guardianName: "  ",
      tenantName: null,
      hostelName: undefined,
      leaveType: null,
      returnDate: "2026-09-28",
    });
    const ret = buildStayReturnPayload({
      guardianName: null,
      tenantName: "   ",
      hostelName: "",
      checkInAt: "2026-09-28T14:10:00.000Z",
    });
    expect(departure.every((v) => v.trim().length > 0)).toBe(true);
    expect(ret.every((v) => v.trim().length > 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Register the test, then run it to verify it fails**

Add to the `include` array in `apps/backend/vitest.pure.config.ts`, immediately after the `'tests/whatsapp-guardian-activation-template.test.ts',` line:

```ts
      // ADR-233 — guardian stay notifications. The template contracts and the
      // notify policy are pure so they can be verified without a database.
      'tests/stay-guardian-templates.test.ts',
```

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/stay-guardian-templates.test.ts`
Expected: FAIL — `Failed to resolve import ".../stay-guardian-template-contracts"`

- [ ] **Step 3: Write the implementation**

Create `apps/backend/lib/services/notifications/providers/whatsapp/stay-guardian-template-contracts.ts`:

```ts
import { tenantDisplayName } from "./guardian-activation-template-contract";

/**
 * The two templates a guardian receives about their ward's stay (ADR-233).
 *
 * One tells them the ward has left; the other tells them the ward is back.
 * Nothing else in this family exists, and the copy says so — "Nothing is
 * needed from you" and "We'll message you again when {{2}} returns" are
 * promises about the *set* of messages, not decoration.
 *
 * ── Two properties the rest of the slice depends on ──
 *
 * 1. **Both bodies carry their own date or time.** The sweep that recovers a
 *    lost send (see `/api/cron/stay-guardian-sweep`) can only run daily on
 *    this Vercel plan, so a recovered message may arrive up to a day late.
 *    "checked in at 7:40 PM, 28 Sep" is still true and still legible the next
 *    morning; "checked in just now" would not be. Any future template in this
 *    family must be self-dating for the same reason.
 *
 * 2. **`{{4}}` in DEPARTURE is why both leave types share one template.** The
 *    body's single preposition "for" carries `for home` and `for a trip`
 *    alike. An unrecognised leave type falls back to `a trip` rather than an
 *    empty string, which Meta rejects outright.
 *
 * Names and languages are hard-coded with no environment-variable fallback —
 * ADR-196 records that a fallback to names never registered at Meta cost weeks
 * of silent 132001 failures.
 *
 * PURE MODULE. Imports nothing with I/O, so it runs under
 * vitest.pure.config.ts. Keep it that way.
 */

export type StayGuardianKind = "DEPARTURE" | "RETURN";

export type StayGuardianTemplate = {
  /** Exactly as registered at Meta. */
  name: string;
  language: string;
  /** Parameter names in the order Meta's body reads them. The order is the contract. */
  parameters: readonly string[];
  /** A copy of the approved body. Meta holds the real one; the test asserts this against `parameters`. */
  body: string;
};

export const STAY_GUARDIAN_TEMPLATES: Record<StayGuardianKind, StayGuardianTemplate> = {
  DEPARTURE: {
    name: "stayo_guardian_stay_departure",
    language: "en",
    parameters: ["guardian_name", "tenant_name", "hostel_name", "leave_type", "return_date"],
    body:
      "Hello {{1}}, {{2}} has left {{3}} for {{4}} and is expected back on {{5}}. " +
      "We'll message you again when {{2}} returns.",
  },
  RETURN: {
    name: "stayo_guardian_stay_return",
    language: "en",
    parameters: ["guardian_name", "tenant_name", "hostel_name", "check_in_time"],
    body:
      "Hello {{1}}, {{2}} has returned to {{3}} and checked in at {{4}}. " +
      "Nothing is needed from you — this is just so you know.",
  },
};

/**
 * The footer both templates carry at Meta.
 *
 * STOP is disclosed here rather than in the body because it is an escape
 * hatch, not an instruction — and scoped to *stay* updates, because a parent
 * who wants less location reporting must not silently lose their rent
 * reminders and payment links. `commands.ts` enforces that scope.
 */
export const STAY_GUARDIAN_FOOTER = "Stayo · Reply STOP to pause stay updates";

const IST = "Asia/Kolkata";

/** `{{4}}` of DEPARTURE. Reads after the body's "for". Never empty. */
export function leaveTypeWord(leaveType: string | null | undefined): string {
  return String(leaveType || "").trim().toUpperCase() === "GOING_HOME" ? "home" : "a trip";
}

/** `{{5}}` of DEPARTURE: "Sunday, 28 September". */
export function formatReturnDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "the agreed date";
  // Formatted in UTC: the value is already an IST calendar date, so converting
  // it again would shift it back a day.
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long" }).format(date);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric" }).format(date);
  const month = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long" }).format(date);
  return `${weekday}, ${day} ${month}`;
}

/** `{{4}}` of RETURN: "7:40 PM, 28 Sep", always IST. */
export function formatCheckInTime(instant: string | Date): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return "today";
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: IST,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: IST, day: "numeric" }).format(date);
  const month = new Intl.DateTimeFormat("en-GB", { timeZone: IST, month: "short" }).format(date);
  return `${time}, ${day} ${month}`;
}

function nonEmpty(value: string | null | undefined, fallback: string): string {
  return String(value || "").trim() || fallback;
}

export type StayDepartureInput = {
  guardianName: string | null | undefined;
  tenantName: string | null | undefined;
  hostelName: string | null | undefined;
  leaveType: string | null | undefined;
  returnDate: string;
};

export function buildStayDeparturePayload(input: StayDepartureInput): string[] {
  return [
    nonEmpty(input.guardianName, "there"),
    tenantDisplayName(String(input.tenantName || "")),
    nonEmpty(input.hostelName, "the hostel"),
    leaveTypeWord(input.leaveType),
    formatReturnDate(input.returnDate),
  ];
}

export type StayReturnInput = {
  guardianName: string | null | undefined;
  tenantName: string | null | undefined;
  hostelName: string | null | undefined;
  checkInAt: string | Date;
};

export function buildStayReturnPayload(input: StayReturnInput): string[] {
  return [
    nonEmpty(input.guardianName, "there"),
    tenantDisplayName(String(input.tenantName || "")),
    nonEmpty(input.hostelName, "the hostel"),
    formatCheckInTime(input.checkInAt),
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/stay-guardian-templates.test.ts`
Expected: PASS, 12 tests.

If `formatCheckInTime` returns `7:40 pm` (lowercase) on your Node build, the ICU data differs — normalise with `.replace(/ /g, " ")` and `.toUpperCase()` on the meridiem only; do **not** change the test's expectation, because the approved copy is what a guardian reads.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/lib/services/notifications/providers/whatsapp/stay-guardian-template-contracts.ts apps/backend/tests/stay-guardian-templates.test.ts apps/backend/vitest.pure.config.ts
git commit -m "feat(guardian-stay): template contracts for the two stay updates

Both bodies are self-dating, which is what makes a swept late send
survivable — the sweep can only run daily on this plan.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The consent state function and the notify policy

Both pure. `consentStateOf` is the single place a stored row becomes a state, so the API and the policy can never disagree about what a row means.

**Files:**
- Create: `apps/backend/src/services/stay/stay-guardian-consent-state.ts`
- Create: `apps/backend/lib/services/notifications/command-center/stay-guardian-policy.ts`
- Create: `apps/backend/tests/stay-guardian-policy.test.ts`
- Modify: `apps/backend/vitest.pure.config.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type ConsentState = "UNASKED" | "GRANTED" | "DECLINED" | "REVOKED" | "STOPPED" | "PHONE_CHANGED"`
  - `interface ConsentRecord { granted: boolean; guardianPhone: string; revokedAt: Date | string | null; stoppedAt: Date | string | null }`
  - `consentStateOf(row: ConsentRecord | null, currentGuardianPhone: string | null | undefined, normalise: (p: string) => string): ConsentState`
  - `type StayGuardianReason` (11 members, listed below)
  - `decideStayGuardianNotice(input: { eventType: string; consentState: ConsentState; guardianPhone: string | null | undefined; residentPhone: string; guardianVerified: boolean; normalise: (p: string) => string }): { notify: boolean; reason: StayGuardianReason }`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/stay-guardian-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  consentStateOf,
  type ConsentRecord,
} from "@/src/services/stay/stay-guardian-consent-state";
import { decideStayGuardianNotice } from "@/lib/services/notifications/command-center/stay-guardian-policy";

/** Stands in for normalizeWhatsAppPhone: digits only, last 10. */
const normalise = (phone: string) => String(phone || "").replace(/\D/g, "").slice(-10);

const row = (over: Partial<ConsentRecord> = {}): ConsentRecord => ({
  granted: true,
  guardianPhone: "9876543210",
  revokedAt: null,
  stoppedAt: null,
  ...over,
});

describe("consentStateOf", () => {
  it("is UNASKED when there is no row at all", () => {
    expect(consentStateOf(null, "9876543210", normalise)).toBe("UNASKED");
  });

  it("is GRANTED for a live yes", () => {
    expect(consentStateOf(row(), "9876543210", normalise)).toBe("GRANTED");
  });

  it("is DECLINED for a stored no — the row is the memory of having asked", () => {
    expect(consentStateOf(row({ granted: false }), "9876543210", normalise)).toBe("DECLINED");
  });

  it("is REVOKED when the tenant switched it off", () => {
    expect(consentStateOf(row({ revokedAt: new Date() }), "9876543210", normalise)).toBe("REVOKED");
  });

  it("is STOPPED when the guardian said STOP, and STOP outranks a later re-grant", () => {
    const reGranted = row({ granted: true, revokedAt: null, stoppedAt: new Date() });
    expect(consentStateOf(reGranted, "9876543210", normalise)).toBe("STOPPED");
  });

  it("is STOPPED even when the tenant also revoked — the stricter fact wins", () => {
    const both = row({ revokedAt: new Date(), stoppedAt: new Date() });
    expect(consentStateOf(both, "9876543210", normalise)).toBe("STOPPED");
  });

  it("is PHONE_CHANGED when the guardian number no longer matches the snapshot", () => {
    // Consent was given to tell a person, not to tell a field.
    expect(consentStateOf(row(), "9000000001", normalise)).toBe("PHONE_CHANGED");
  });

  it("is NOT PHONE_CHANGED for the same number written differently", () => {
    // The schema stores phone numbers inconsistently; comparison is on digits.
    expect(consentStateOf(row(), "+91 98765 43210", normalise)).toBe("GRANTED");
    expect(consentStateOf(row(), "09876543210", normalise)).toBe("GRANTED");
  });

  it("is UNASKED when the guardian number was removed entirely", () => {
    expect(consentStateOf(row(), null, normalise)).toBe("UNASKED");
    expect(consentStateOf(row(), "  ", normalise)).toBe("UNASKED");
  });
});

describe("decideStayGuardianNotice", () => {
  const base = {
    eventType: "LEAVE_STARTED",
    consentState: "GRANTED" as const,
    guardianPhone: "9876543210",
    residentPhone: "9123456789",
    guardianVerified: true,
    normalise,
  };

  it("notifies on the two notifiable events", () => {
    expect(decideStayGuardianNotice(base)).toEqual({ notify: true, reason: "LEAVE" });
    expect(decideStayGuardianNotice({ ...base, eventType: "RETURNED" })).toEqual({
      notify: true,
      reason: "RETURN",
    });
  });

  it("is silent on every other event type", () => {
    for (const eventType of ["RETURN_DATE_CHANGED", "LEAVE_CANCELLED", "PRESENCE_CONFIRMED", "LATE"]) {
      expect(decideStayGuardianNotice({ ...base, eventType }), eventType).toEqual({
        notify: false,
        reason: "NOT_NOTIFIABLE",
      });
    }
  });

  it("refuses when there is no guardian number", () => {
    for (const guardianPhone of [null, undefined, "", "   "]) {
      expect(decideStayGuardianNotice({ ...base, guardianPhone }), String(guardianPhone)).toEqual({
        notify: false,
        reason: "NO_GUARDIAN_PHONE",
      });
    }
  });

  it("refuses when one handset is in both fields, however it is written", () => {
    // Two identical messages seconds apart reads as a malfunction, and is the
    // fastest way to get a WhatsApp number reported as spam.
    expect(
      decideStayGuardianNotice({ ...base, guardianPhone: "+91 91234 56789", residentPhone: "9123456789" }),
    ).toEqual({ notify: false, reason: "SAME_AS_RESIDENT" });
  });

  it("maps each consent state to its own reason", () => {
    const cases = [
      ["UNASKED", "NO_CONSENT"],
      ["DECLINED", "DECLINED"],
      ["REVOKED", "REVOKED"],
      ["STOPPED", "STOPPED_BY_GUARDIAN"],
      ["PHONE_CHANGED", "PHONE_CHANGED_SINCE_CONSENT"],
    ] as const;
    for (const [consentState, reason] of cases) {
      expect(decideStayGuardianNotice({ ...base, consentState }), consentState).toEqual({
        notify: false,
        reason,
      });
    }
  });

  it("refuses an unverified guardian, even with consent", () => {
    // A resident's movements are more sensitive than a rent balance, and
    // guardian_phone is typed by hand. ADR-212 deferral leaves real tenancies
    // with an unproved number.
    expect(decideStayGuardianNotice({ ...base, guardianVerified: false })).toEqual({
      notify: false,
      reason: "GUARDIAN_UNVERIFIED",
    });
  });

  it("checks the event type before anything else, so an unrelated event is never a consent question", () => {
    expect(
      decideStayGuardianNotice({
        ...base,
        eventType: "PRESENCE_CONFIRMED",
        consentState: "UNASKED",
        guardianPhone: null,
      }),
    ).toEqual({ notify: false, reason: "NOT_NOTIFIABLE" });
  });
});
```

- [ ] **Step 2: Register the test, then run it to verify it fails**

Add to `apps/backend/vitest.pure.config.ts`'s `include`, directly below the Task 1 entry:

```ts
      'tests/stay-guardian-policy.test.ts',
```

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/stay-guardian-policy.test.ts`
Expected: FAIL — cannot resolve `stay-guardian-consent-state`.

- [ ] **Step 3: Write the consent state function**

Create `apps/backend/src/services/stay/stay-guardian-consent-state.ts`:

```ts
/**
 * What a stored consent row means right now (ADR-233).
 *
 * The single place a row becomes a state. The tenant API renders this for the
 * consent sheet and the notify policy branches on it, so the two cannot drift
 * into disagreeing about whether someone has been asked.
 *
 * PURE MODULE. Takes the row as an argument and reads nothing itself.
 */

export type ConsentState =
  | "UNASKED"
  | "GRANTED"
  | "DECLINED"
  | "REVOKED"
  | "STOPPED"
  | "PHONE_CHANGED";

export interface ConsentRecord {
  granted: boolean;
  /** The guardian number consented to, as stored. Compared on normalised digits. */
  guardianPhone: string;
  revokedAt: Date | string | null;
  stoppedAt: Date | string | null;
}

/**
 * `currentGuardianPhone` is the number on the tenancy *now*.
 *
 * Consent was given to tell a person, not to tell a field: if the number has
 * changed, the stored decision is about somebody else and the tenant is asked
 * again. This is the same rule `guardian-activation` applies when deciding
 * whether a new number has been told anything at all.
 */
export function consentStateOf(
  row: ConsentRecord | null,
  currentGuardianPhone: string | null | undefined,
  normalise: (phone: string) => string,
): ConsentState {
  // No guardian to speak of: there is nothing to have consented to, and the
  // question becomes askable again the moment a number is added.
  if (!currentGuardianPhone || !String(currentGuardianPhone).trim()) return "UNASKED";
  if (!row) return "UNASKED";

  // A guardian who asked to be left alone outranks everything below,
  // including a tenant who later switches the feature back on.
  if (row.stoppedAt) return "STOPPED";

  if (normalise(row.guardianPhone) !== normalise(String(currentGuardianPhone))) {
    return "PHONE_CHANGED";
  }

  if (row.revokedAt) return "REVOKED";
  return row.granted ? "GRANTED" : "DECLINED";
}
```

- [ ] **Step 4: Write the policy**

Create `apps/backend/lib/services/notifications/command-center/stay-guardian-policy.ts`:

```ts
import type { ConsentState } from "@/src/services/stay/stay-guardian-consent-state";

/**
 * Whether one stay event tells a guardian anything (ADR-233).
 *
 * The shape follows `guardian-reminder-policy.ts` deliberately: the rule is a
 * pure function returning its own reason, so "why did / didn't they get this"
 * is answerable from a log line rather than a re-run. With no test database in
 * this repo, a pure module is also the only part of this slice that is
 * genuinely verified before it ships.
 *
 * ── Why only two event types ──
 *
 * `RETURN_DATE_CHANGED` and `LEAVE_CANCELLED` are amendments to a plan, and
 * forwarding every amendment is how a reassuring channel becomes a noisy one.
 *
 * `LATE` is the important one, and it is deliberately absent. Silence =
 * Present is trust-based and self-reported: a resident who came back at 2am
 * and never tapped *I'm back* is indistinguishable from one who did not come
 * back at all. A late template turns that ambiguity into "your child is not
 * where they said they would be", sent to a parent, on the strength of a
 * missed tap — and no phone has ever scanned the Stay QR in production, so
 * the real missed-tap rate is not merely unmeasured, it is unobserved. Late
 * returns stay on the owner's board, where a human reads them in context.
 */

const NOTIFIABLE: Record<string, "LEAVE" | "RETURN"> = {
  LEAVE_STARTED: "LEAVE",
  RETURNED: "RETURN",
};

export type StayGuardianReason =
  | "LEAVE"
  | "RETURN"
  | "NOT_NOTIFIABLE"
  | "NO_GUARDIAN_PHONE"
  | "SAME_AS_RESIDENT"
  | "NO_CONSENT"
  | "DECLINED"
  | "REVOKED"
  | "STOPPED_BY_GUARDIAN"
  | "PHONE_CHANGED_SINCE_CONSENT"
  | "GUARDIAN_UNVERIFIED";

export type StayGuardianDecision = { notify: boolean; reason: StayGuardianReason };

const CONSENT_REFUSALS: Record<string, StayGuardianReason> = {
  UNASKED: "NO_CONSENT",
  DECLINED: "DECLINED",
  REVOKED: "REVOKED",
  STOPPED: "STOPPED_BY_GUARDIAN",
  PHONE_CHANGED: "PHONE_CHANGED_SINCE_CONSENT",
};

export function decideStayGuardianNotice(input: {
  eventType: string;
  consentState: ConsentState;
  guardianPhone: string | null | undefined;
  residentPhone: string;
  guardianVerified: boolean;
  /** Compares normalised digits — the schema stores phone numbers inconsistently. */
  normalise: (phone: string) => string;
}): StayGuardianDecision {
  const { eventType, consentState, guardianPhone, residentPhone, guardianVerified, normalise } = input;

  // First, so an unrelated event never becomes a consent question.
  const kind = NOTIFIABLE[eventType];
  if (!kind) return { notify: false, reason: "NOT_NOTIFIABLE" };

  if (!guardianPhone || !String(guardianPhone).trim()) {
    return { notify: false, reason: "NO_GUARDIAN_PHONE" };
  }

  // One handset listed in both fields must not receive the same message twice.
  if (residentPhone && normalise(String(guardianPhone)) === normalise(residentPhone)) {
    return { notify: false, reason: "SAME_AS_RESIDENT" };
  }

  const refusal = CONSENT_REFUSALS[consentState];
  if (refusal) return { notify: false, reason: refusal };

  // Same rule as every financial answer: an unverified number is not told
  // this family's business — and movements are more sensitive than a balance.
  if (!guardianVerified) return { notify: false, reason: "GUARDIAN_UNVERIFIED" };

  return { notify: true, reason: kind };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/stay-guardian-policy.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/services/stay/stay-guardian-consent-state.ts apps/backend/lib/services/notifications/command-center/stay-guardian-policy.ts apps/backend/tests/stay-guardian-policy.test.ts apps/backend/vitest.pure.config.ts
git commit -m "feat(guardian-stay): consent state and the notify policy, both pure

STOP outranks a later re-grant, and a changed guardian number lapses
consent rather than inheriting it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Migration and Prisma model

**Files:**
- Create: `migrations/093_stay_guardian_consent.sql`
- Modify: `apps/backend/prisma/schema.prisma` (append a model; place it directly after `model stay_leaves`)
- Create: `apps/backend/tests/stay-guardian-schema.test.ts`
- Modify: `apps/backend/vitest.pure.config.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the Prisma delegate `prisma.stay_guardian_consent` with fields `tenant_id`, `hostel_id`, `granted`, `guardian_phone`, `decided_at`, `revoked_at`, `stopped_at`, `source`, `updated_at`.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/stay-guardian-schema.test.ts`. It reads the two files as text — no client, no database:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SCHEMA = readFileSync(join(__dirname, "../prisma/schema.prisma"), "utf8");
const MIGRATION = readFileSync(
  join(__dirname, "../../../migrations/093_stay_guardian_consent.sql"),
  "utf8",
);

/**
 * ADR-233. Guards the two ways this table can ship broken: a Prisma field the
 * database does not have, and a table the public anon key can read.
 */
describe("stay_guardian_consent schema", () => {
  const model = SCHEMA.match(/model stay_guardian_consent \{[\s\S]*?\n\}/)?.[0] ?? "";

  it("declares the model", () => {
    expect(model).not.toBe("");
  });

  it("declares exactly the columns the migration creates", () => {
    for (const column of [
      "tenant_id",
      "hostel_id",
      "granted",
      "guardian_phone",
      "decided_at",
      "revoked_at",
      "stopped_at",
      "source",
      "updated_at",
    ]) {
      expect(model, column).toMatch(new RegExp(`\\b${column}\\b`));
      expect(MIGRATION, column).toMatch(new RegExp(`"${column}"`));
    }
  });

  it("keys on tenant_id — one consent decision per tenancy", () => {
    expect(model).toMatch(/tenant_id\s+String\s+@id/);
    expect(MIGRATION).toMatch(/PRIMARY KEY/i);
  });

  it("enables RLS, because the anon key is in the browser bundle", () => {
    // tests/migration-rls.test.ts enforces this across all migrations; asserted
    // here too so a failure names this table rather than the whole convention.
    expect(MIGRATION).toMatch(
      /ALTER TABLE\s+"public"\."stay_guardian_consent"\s+ENABLE ROW LEVEL SECURITY/i,
    );
  });

  it("revokes the default PostgREST grants rather than relying on RLS alone", () => {
    expect(MIGRATION).toMatch(/REVOKE ALL[\s\S]*?FROM\s+anon/i);
  });

  it("is re-runnable by hand — these migrations are applied by psql, not a tool", () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS/i);
  });
});
```

- [ ] **Step 2: Register the test, then run it to verify it fails**

Add `'tests/stay-guardian-schema.test.ts',` to `include` below the Task 2 entry.

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/stay-guardian-schema.test.ts`
Expected: FAIL — `ENOENT ... migrations/093_stay_guardian_consent.sql`

- [ ] **Step 3: Write the migration**

Create `migrations/093_stay_guardian_consent.sql`:

```sql
-- 093_stay_guardian_consent.sql
--
-- ADR-233 — a guardian is told when their ward leaves the hostel and when
-- they get back, once the tenant has agreed to it.
--
-- APPLY THIS *AFTER* DEPLOYING THE CODE THAT DECLARES THE MODEL.
--
-- That is the opposite of the usual order here, and it is safe only because
-- this table is additive: no existing query reads it, and with no rows the
-- notify policy returns NO_CONSENT and nothing sends. The usual rule (migrate
-- first) exists because Prisma selects every declared scalar column on a read
-- with no explicit `select`, so a column declared ahead of its migration 500s
-- every query against that table — which is what took production down on
-- 2026-08-14 via `tenants`. A brand-new table has no such reader, so the
-- deploy is inert until this runs.
--
-- Deliberately NOT columns on `tenants`: getSession() reads that table with no
-- explicit select on every authenticated request, for every role, so a
-- declared-but-missing column there 500s the entire authenticated API rather
-- than one screen.
--
-- Applied by hand via psql or the Supabase SQL editor — `prisma migrate
-- deploy` is unusable against this project, whose `_prisma_migrations` history
-- was never populated. Safe to re-run.

CREATE TABLE IF NOT EXISTS "public"."stay_guardian_consent" (
  "tenant_id"      UUID PRIMARY KEY,
  "hostel_id"      UUID NOT NULL,
  "granted"        BOOLEAN NOT NULL,
  "guardian_phone" TEXT NOT NULL,
  "decided_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "revoked_at"     TIMESTAMPTZ(6),
  "stopped_at"     TIMESTAMPTZ(6),
  "source"         TEXT NOT NULL,
  "updated_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE "public"."stay_guardian_consent" IS
  'ADR-233. One row per tenancy: whether the tenant agreed to have their guardian told when they leave and return. A granted=false row is the memory of HAVING ASKED, which is what stops the sheet reappearing on every trip.';
COMMENT ON COLUMN "public"."stay_guardian_consent"."guardian_phone" IS
  'ADR-233. The guardian number consented to, snapshotted. Consent was given to tell a person, not a field: if tenants.guardian_phone later differs, the decision is about somebody else and the tenant is asked again.';
COMMENT ON COLUMN "public"."stay_guardian_consent"."revoked_at" IS
  'ADR-233. The TENANT switched it off. Distinct from stopped_at on purpose.';
COMMENT ON COLUMN "public"."stay_guardian_consent"."stopped_at" IS
  'ADR-233. The GUARDIAN replied STOP. Outranks a later re-grant by the tenant — someone who asked to be left alone must not be silently re-subscribed.';
COMMENT ON COLUMN "public"."stay_guardian_consent"."source" IS
  'ADR-233. APP or QR — where the tenant was standing when asked.';

-- The sweep's only filter: live consents, so events belonging to tenants who
-- never consented are never loaded.
CREATE INDEX IF NOT EXISTS "stay_guardian_consent_live_idx"
  ON "public"."stay_guardian_consent" ("hostel_id")
  WHERE "granted" AND "revoked_at" IS NULL AND "stopped_at" IS NULL;

-- ── Lockdown ────────────────────────────────────────────────────────────────
-- VITE_SUPABASE_ANON_KEY is compiled into the browser bundle and is public by
-- construction. This table records which residents are being reported on and
-- to which phone number; it must not be the sixth table reachable with it.
-- No policies, deliberately: the backend connects as the owning role and
-- bypasses RLS, so enabling it with no policy is a clean lockout of the anon
-- key, not a change to how the application reads its own data.
ALTER TABLE "public"."stay_guardian_consent" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."stay_guardian_consent" FROM anon;
REVOKE ALL ON TABLE "public"."stay_guardian_consent" FROM authenticated;
```

- [ ] **Step 4: Declare the Prisma model**

In `apps/backend/prisma/schema.prisma`, insert directly after the closing `}` of `model stay_leaves`:

```prisma
/// ADR-233. Whether the tenant agreed to have their guardian told when they
/// leave the hostel and when they return. A `granted = false` row is the
/// memory of having asked — without it the consent sheet reappears on every
/// trip, for exactly the tenants who said no.
model stay_guardian_consent {
  tenant_id      String    @id @db.Uuid
  hostel_id      String    @db.Uuid
  granted        Boolean
  /// The number consented to, snapshotted. If `tenants.guardian_phone` later
  /// differs, consent is about somebody else and lapses.
  guardian_phone String
  decided_at     DateTime  @default(now()) @db.Timestamptz(6)
  /// The tenant switched it off.
  revoked_at     DateTime? @db.Timestamptz(6)
  /// The guardian replied STOP. Outranks a later re-grant.
  stopped_at     DateTime? @db.Timestamptz(6)
  /// APP | QR
  source         String
  updated_at     DateTime  @default(now()) @updatedAt @db.Timestamptz(6)
}
```

Note the partial index from the migration is **not** declared here: Prisma cannot express a `WHERE` clause on an index, and declaring a plain one would leave `schema.prisma` permanently out of step with the database. The same reasoning is written out in `migrations/…_guardian_verification_policy`.

- [ ] **Step 5: Regenerate the client and run the tests**

```bash
cd apps/backend && npm run prisma:generate
npx vitest run --config vitest.pure.config.ts tests/stay-guardian-schema.test.ts tests/migration-rls.test.ts
```
Expected: both PASS. `migration-rls.test.ts` must still pass — it scans every migration from 083 and would now fail if the RLS line were missing.

- [ ] **Step 6: Commit**

```bash
git add migrations/093_stay_guardian_consent.sql apps/backend/prisma/schema.prisma apps/backend/tests/stay-guardian-schema.test.ts apps/backend/vitest.pure.config.ts
git commit -m "feat(guardian-stay): stay_guardian_consent table

A separate table, not two columns on tenants: getSession reads tenants
with no explicit select on every authenticated request.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Consent repository and the tenant API

**Files:**
- Create: `apps/backend/src/services/stay/stay-guardian-consent.ts`
- Create: `apps/backend/app/api/tenant/stay/guardian-consent/route.ts`
- Modify: `apps/backend/src/services/stay/stay-service.ts` (add `guardian` to `MyStay`)
- Create: `apps/backend/tests/stay-guardian-consent-service.test.ts`
- Modify: `apps/backend/vitest.pure.config.ts`

**Interfaces:**
- Consumes: `consentStateOf`, `ConsentState`, `ConsentRecord` (Task 2); `isGuardianVerified` from `@/lib/services/notifications/command-center/guardian-access`; `normalizeWhatsAppPhone` from `@/lib/services/notifications/providers/whatsapp`.
- Produces:
  - `interface GuardianConsentView { eligible: boolean; name: string | null; consent: "UNASKED" | "GRANTED" | "DECLINED" | "REVOKED" | "STOPPED" }`
  - `readGuardianConsentRow(tenantId: string): Promise<ConsentRecord | null>`
  - `guardianViewFor(tenantId: string): Promise<GuardianConsentView | null>`
  - `recordGuardianConsent(input: { tenantId: string; granted: boolean; source: "APP" | "QR" }): Promise<GuardianConsentView | null>`
  - `revokeGuardianConsent(tenantId: string): Promise<void>`
  - `stopGuardianConsent(tenantId: string): Promise<void>`
  - `MyStay` gains `guardian: GuardianConsentView | null`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/stay-guardian-consent-service.test.ts`. It mocks `@/lib/db`, so no client is constructed:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const findTenant = vi.fn();
const upsert = vi.fn();
const updateMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    stay_guardian_consent: { findUnique, upsert, updateMany },
    tenants: { findUnique: findTenant },
  },
}));

const isGuardianVerified = vi.fn();
vi.mock("@/lib/services/notifications/command-center/guardian-access", () => ({
  isGuardianVerified: (phone: string) => isGuardianVerified(phone),
}));

// `normalizeWhatsAppPhone` lives in meta-provider.ts, which the barrel
// re-exports along with the provider class and several template contracts.
// Mocked so this test pulls in none of that.
vi.mock("@/lib/services/notifications/providers/whatsapp", () => ({
  normalizeWhatsAppPhone: (raw: string) => String(raw || "").replace(/\D/g, "").slice(-10),
}));

import {
  guardianViewFor,
  recordGuardianConsent,
  revokeGuardianConsent,
  stopGuardianConsent,
} from "@/src/services/stay/stay-guardian-consent";

const tenant = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  hostel_id: "h1",
  phone_1: "9123456789",
  phone_2: null,
  guardian_name: "Ramesh",
  guardian_phone: "9876543210",
  profiles: { name: "Aarav", phone: "9123456789" },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  isGuardianVerified.mockResolvedValue(true);
  findUnique.mockResolvedValue(null);
});

describe("guardianViewFor", () => {
  it("is eligible and UNASKED for a verified guardian with no row yet", async () => {
    findTenant.mockResolvedValue(tenant());
    expect(await guardianViewFor("t1")).toEqual({
      eligible: true,
      name: "Ramesh",
      consent: "UNASKED",
    });
  });

  it("is null when the tenancy has no guardian number at all", async () => {
    findTenant.mockResolvedValue(tenant({ guardian_phone: null, phone_2: null }));
    expect(await guardianViewFor("t1")).toBeNull();
  });

  it("is ineligible when the guardian number is the resident's own", async () => {
    findTenant.mockResolvedValue(tenant({ guardian_phone: "+91 91234 56789" }));
    const view = await guardianViewFor("t1");
    expect(view?.eligible).toBe(false);
  });

  it("is ineligible when the guardian was never OTP-verified (ADR-212 deferral)", async () => {
    findTenant.mockResolvedValue(tenant());
    isGuardianVerified.mockResolvedValue(false);
    const view = await guardianViewFor("t1");
    expect(view?.eligible).toBe(false);
    expect(view?.consent).toBe("UNASKED");
  });

  it("reports PHONE_CHANGED as UNASKED, so the tenant is asked about the new person", async () => {
    findTenant.mockResolvedValue(tenant({ guardian_phone: "9000000001" }));
    findUnique.mockResolvedValue({
      granted: true,
      guardian_phone: "9876543210",
      revoked_at: null,
      stopped_at: null,
    });
    const view = await guardianViewFor("t1");
    expect(view?.consent).toBe("UNASKED");
  });

  it("surfaces a guardian STOP distinctly from a tenant revocation", async () => {
    findTenant.mockResolvedValue(tenant());
    findUnique.mockResolvedValue({
      granted: true,
      guardian_phone: "9876543210",
      revoked_at: null,
      stopped_at: new Date(),
    });
    expect((await guardianViewFor("t1"))?.consent).toBe("STOPPED");
  });

  it("falls back to phone_2 when guardian_phone is unset", async () => {
    // tenant-service keeps the two in step, but activation writes phone_2
    // first on some paths — guardian-activation.ts reads both for this reason.
    findTenant.mockResolvedValue(tenant({ guardian_phone: null, phone_2: "9876543210" }));
    expect((await guardianViewFor("t1"))?.eligible).toBe(true);
  });
});

describe("recordGuardianConsent", () => {
  it("snapshots the guardian number it was given for", async () => {
    findTenant.mockResolvedValue(tenant());
    await recordGuardianConsent({ tenantId: "t1", granted: true, source: "APP" });

    const args = upsert.mock.calls[0][0];
    expect(args.where).toEqual({ tenant_id: "t1" });
    expect(args.create.guardian_phone).toBe("9876543210");
    expect(args.create.granted).toBe(true);
    expect(args.create.source).toBe("APP");
  });

  it("clears a previous revocation when consent is granted afresh", async () => {
    findTenant.mockResolvedValue(tenant());
    await recordGuardianConsent({ tenantId: "t1", granted: true, source: "QR" });
    expect(upsert.mock.calls[0][0].update.revoked_at).toBeNull();
  });

  it("never clears stopped_at — a guardian's STOP is not the tenant's to undo", async () => {
    findTenant.mockResolvedValue(tenant());
    await recordGuardianConsent({ tenantId: "t1", granted: true, source: "APP" });
    const { update, create } = upsert.mock.calls[0][0];
    expect(Object.keys(update)).not.toContain("stopped_at");
    expect(create.stopped_at ?? null).toBeNull();
  });

  it("refuses when there is no guardian to consent about", async () => {
    findTenant.mockResolvedValue(tenant({ guardian_phone: null, phone_2: null }));
    expect(await recordGuardianConsent({ tenantId: "t1", granted: true, source: "APP" })).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("revoke and stop write different columns", () => {
  it("revoke sets revoked_at only", async () => {
    await revokeGuardianConsent("t1");
    expect(updateMany.mock.calls[0][0].data).toHaveProperty("revoked_at");
    expect(updateMany.mock.calls[0][0].data).not.toHaveProperty("stopped_at");
  });

  it("stop sets stopped_at only", async () => {
    await stopGuardianConsent("t1");
    expect(updateMany.mock.calls[0][0].data).toHaveProperty("stopped_at");
    expect(updateMany.mock.calls[0][0].data).not.toHaveProperty("revoked_at");
  });
});
```

- [ ] **Step 2: Register the test, then run it to verify it fails**

Add `'tests/stay-guardian-consent-service.test.ts',` to `include`.

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/stay-guardian-consent-service.test.ts`
Expected: FAIL — cannot resolve `stay-guardian-consent`.

- [ ] **Step 3: Write the consent service**

Create `apps/backend/src/services/stay/stay-guardian-consent.ts`:

```ts
import { prisma } from "@/lib/db";
import { isGuardianVerified } from "@/lib/services/notifications/command-center/guardian-access";
import { normalizeWhatsAppPhone } from "@/lib/services/notifications/providers/whatsapp";
import { consentStateOf, type ConsentRecord, type ConsentState } from "./stay-guardian-consent-state";

/**
 * The tenant's decision about guardian stay updates (ADR-233).
 *
 * Stay owns the consent record; `notifications/` owns the sending. This module
 * is the boundary between them.
 */

/** `normalizeWhatsAppPhone` throws on malformed input; comparison must not. */
export function safeNormalize(phone: string): string {
  try {
    return normalizeWhatsAppPhone(phone);
  } catch {
    return String(phone || "").replace(/\D/g, "");
  }
}

/** What the tenant app needs to decide whether to show the consent sheet. */
export interface GuardianConsentView {
  /** There is a guardian we could actually message: present, verified, not the resident. */
  eligible: boolean;
  name: string | null;
  /**
   * `PHONE_CHANGED` is reported as `UNASKED`: the stored decision is about a
   * different person, so the tenant must be asked again. The policy keeps the
   * distinction for its logs; the UI only needs to know whether to ask.
   */
  consent: "UNASKED" | "GRANTED" | "DECLINED" | "REVOKED" | "STOPPED";
}

type TenantGuardianFields = {
  id: string;
  hostel_id: string | null;
  phone_1: string | null;
  phone_2: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  profiles: { name: string | null; phone: string | null } | null;
};

async function loadTenant(tenantId: string): Promise<TenantGuardianFields | null> {
  return (await (prisma as any).tenants.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      hostel_id: true,
      phone_1: true,
      phone_2: true,
      guardian_name: true,
      guardian_phone: true,
      profiles: { select: { name: true, phone: true } },
    },
  })) as TenantGuardianFields | null;
}

/**
 * `phone_2` and `guardian_phone` are kept in step by `tenant-service`, but
 * activation writes `phone_2` first on some paths — `guardian-activation.ts`
 * reads both for the same reason.
 */
export function guardianPhoneOf(tenant: TenantGuardianFields): string {
  return (tenant.guardian_phone || tenant.phone_2 || "").trim();
}

export function residentPhoneOf(tenant: TenantGuardianFields): string {
  return (tenant.phone_1 || tenant.profiles?.phone || "").trim();
}

export async function readGuardianConsentRow(tenantId: string): Promise<ConsentRecord | null> {
  const row = await (prisma as any).stay_guardian_consent.findUnique({
    where: { tenant_id: tenantId },
    select: { granted: true, guardian_phone: true, revoked_at: true, stopped_at: true },
  });
  if (!row) return null;
  return {
    granted: row.granted,
    guardianPhone: row.guardian_phone,
    revokedAt: row.revoked_at,
    stoppedAt: row.stopped_at,
  };
}

function viewFrom(state: ConsentState): GuardianConsentView["consent"] {
  return state === "PHONE_CHANGED" ? "UNASKED" : state;
}

export async function guardianViewFor(tenantId: string): Promise<GuardianConsentView | null> {
  const tenant = await loadTenant(tenantId);
  if (!tenant) return null;

  const guardianPhone = guardianPhoneOf(tenant);
  // No guardian on file: there is nothing to consent about, and no sheet to show.
  if (!guardianPhone) return null;

  const row = await readGuardianConsentRow(tenantId);
  const consent = viewFrom(consentStateOf(row, guardianPhone, safeNormalize));

  const residentPhone = residentPhoneOf(tenant);
  const sameHandset = Boolean(residentPhone) && safeNormalize(guardianPhone) === safeNormalize(residentPhone);
  // Only ask the verification question when it can change the answer — it is a
  // database round trip on a route the QR screen hits on every scan.
  const verified = sameHandset ? false : await isGuardianVerified(guardianPhone);

  return {
    eligible: !sameHandset && verified,
    name: (tenant.guardian_name || "").trim() || null,
    consent,
  };
}

export async function recordGuardianConsent(input: {
  tenantId: string;
  granted: boolean;
  source: "APP" | "QR";
}): Promise<GuardianConsentView | null> {
  const tenant = await loadTenant(input.tenantId);
  if (!tenant || !tenant.hostel_id) return null;

  const guardianPhone = guardianPhoneOf(tenant);
  if (!guardianPhone) return null;

  const now = new Date();
  await (prisma as any).stay_guardian_consent.upsert({
    where: { tenant_id: input.tenantId },
    create: {
      tenant_id: input.tenantId,
      hostel_id: tenant.hostel_id,
      granted: input.granted,
      guardian_phone: guardianPhone,
      decided_at: now,
      source: input.source,
      updated_at: now,
    },
    update: {
      granted: input.granted,
      // Re-consenting after the number changed is consent about the new person.
      guardian_phone: guardianPhone,
      decided_at: now,
      // A fresh decision clears the tenant's own revocation …
      revoked_at: null,
      // … but never `stopped_at`. A guardian who asked to be left alone is not
      // re-subscribed by the tenant changing their mind.
      source: input.source,
      updated_at: now,
    },
  });

  return guardianViewFor(input.tenantId);
}

/** The tenant switched it off. `updateMany` so a missing row is a no-op, not a throw. */
export async function revokeGuardianConsent(tenantId: string): Promise<void> {
  const now = new Date();
  await (prisma as any).stay_guardian_consent.updateMany({
    where: { tenant_id: tenantId },
    data: { revoked_at: now, updated_at: now },
  });
}

/** The guardian replied STOP. */
export async function stopGuardianConsent(tenantId: string): Promise<void> {
  const now = new Date();
  await (prisma as any).stay_guardian_consent.updateMany({
    where: { tenant_id: tenantId },
    data: { stopped_at: now, updated_at: now },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/stay-guardian-consent-service.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Add the `guardian` block to `MyStay`**

In `apps/backend/src/services/stay/stay-service.ts`:

Add to the imports at the top:

```ts
import { guardianViewFor, type GuardianConsentView } from "./stay-guardian-consent";
```

Change the `MyStay` interface:

```ts
export interface MyStay {
  tenantId: string | null;
  hostel: { id: string; name: string } | null;
  resident: boolean;
  stay: TenantStay | null;
  /** ADR-233. Null when there is no guardian on file to speak of. */
  guardian: GuardianConsentView | null;
}
```

In `getMyStay`, add `guardian: null` to both early returns, and resolve it on the resident path:

```ts
  async function getMyStay(profileId: string, now: Date = new Date()): Promise<MyStay> {
    const tenancy = await db.tenants.findFirst({
      where: liveTenancyWhere(profileId),
      select: { id: true, hostel_id: true, hostels: { select: { id: true, name: true } } },
    });
    if (!tenancy?.hostel_id || !tenancy.hostels) {
      return { tenantId: null, hostel: null, resident: false, stay: null, guardian: null };
    }
    const hostel = { id: tenancy.hostels.id, name: tenancy.hostels.name };
    const residency = await findResidency(tenancy.id, tenancy.hostel_id);
    if (!residency) {
      return { tenantId: tenancy.id, hostel, resident: false, stay: null, guardian: null };
    }
    const [stay, guardian] = await Promise.all([
      tenantStay(tenancy.id, istDateOf(now)),
      guardianViewFor(tenancy.id),
    ]);
    return { tenantId: tenancy.id, hostel, resident: true, stay, guardian };
  }
```

- [ ] **Step 6: Write the consent route**

Create `apps/backend/app/api/tenant/stay/guardian-consent/route.ts`:

```ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { stayService } from "@/src/services/stay/stay-service";
import { recordGuardianConsent, revokeGuardianConsent } from "@/src/services/stay/stay-guardian-consent";
import { stayErrorResponse } from "@/src/services/stay/stay-errors";

const SOURCES = new Set(["QR", "APP"]);

/**
 * POST /api/tenant/stay/guardian-consent
 * Body: { granted: boolean, source: "QR" | "APP" }
 *
 * ADR-233. Separate from the stay event on purpose: a declined consent must be
 * recorded even when the leave that prompted it then fails, or the tenant is
 * asked again next time having already said no.
 *
 * The tenant comes from the session, never the body. Returns { guardian }.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden: Only tenants can access this endpoint", "FORBIDDEN", 403);
  }
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.granted !== "boolean") {
      return apiError("granted must be true or false", "INVALID_REQUEST", 400);
    }
    if (!SOURCES.has(body?.source)) {
      return apiError("source must be QR or APP", "INVALID_REQUEST", 400);
    }

    const me = await stayService.getMyStay(session.sub);
    if (!me.resident || !me.tenantId) {
      return apiError("Only a current resident can set this.", "STAY_INELIGIBLE", 409);
    }

    // Turning it off after it was on is a revocation, which is a different
    // column from a guardian's STOP and must not overwrite one.
    if (!body.granted && me.guardian?.consent === "GRANTED") {
      await revokeGuardianConsent(me.tenantId);
      const after = await stayService.getMyStay(session.sub);
      return apiResponse({ guardian: after.guardian });
    }

    const guardian = await recordGuardianConsent({
      tenantId: me.tenantId,
      granted: body.granted,
      source: body.source,
    });
    if (!guardian) {
      return apiError("There is no guardian on file for this tenancy.", "STAY_INELIGIBLE", 409);
    }
    return apiResponse({ guardian });
  } catch (error) {
    return stayErrorResponse(error);
  }
}
```

- [ ] **Step 7: Typecheck and commit**

```bash
cd apps/backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "stay|guardian" || echo "no stay/guardian type errors"
npx vitest run --config vitest.pure.config.ts tests/stay-guardian-consent-service.test.ts
git add apps/backend/src/services/stay/stay-guardian-consent.ts apps/backend/app/api/tenant/stay/guardian-consent/route.ts apps/backend/src/services/stay/stay-service.ts apps/backend/tests/stay-guardian-consent-service.test.ts apps/backend/vitest.pure.config.ts
git commit -m "feat(guardian-stay): consent record, tenant API and the guardian block

Consent posts separately from the stay event, so a declined consent
survives a leave that then fails.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The sender, and the inline hook

**Files:**
- Create: `apps/backend/lib/services/notifications/command-center/stay-guardian-updates.ts`
- Modify: `apps/backend/src/services/stay/stay-service.ts` (fire after commit)
- Create: `apps/backend/tests/stay-guardian-send.test.ts`
- Modify: `apps/backend/vitest.pure.config.ts`

**Interfaces:**
- Consumes: `decideStayGuardianNotice` (Task 2); `readGuardianConsentRow`, `guardianPhoneOf`, `residentPhoneOf`, `safeNormalize` (Task 4); `consentStateOf` (Task 2); the template contracts (Task 1); `whatsAppTemplateDeliveryService`; `isGuardianVerified`.
- Produces: `sendStayGuardianUpdate(input: { eventId: string; tenantId: string; eventType: string; leaveType: string | null; expectedReturnDate: string | null; occurredAt: string }): Promise<{ sent: boolean; reason: StayGuardianReason | "SEND_FAILED" | "ALREADY_SENT" | "TENANT_NOT_FOUND" }>`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/stay-guardian-send.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const findTenant = vi.fn();
const findConsent = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    tenants: { findUnique: findTenant },
    stay_guardian_consent: { findUnique: findConsent },
  },
}));

const send = vi.fn();
vi.mock("@/lib/services/notifications/whatsapp-template-delivery", () => ({
  whatsAppTemplateDeliveryService: { send: (args: unknown) => send(args) },
}));

const isGuardianVerified = vi.fn();
vi.mock("@/lib/services/notifications/command-center/guardian-access", () => ({
  isGuardianVerified: (phone: string) => isGuardianVerified(phone),
}));

import { sendStayGuardianUpdate } from "@/lib/services/notifications/command-center/stay-guardian-updates";

const LEAVE = {
  eventId: "e1",
  tenantId: "t1",
  eventType: "LEAVE_STARTED",
  leaveType: "GOING_HOME",
  expectedReturnDate: "2026-09-28",
  occurredAt: "2026-09-25T09:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  isGuardianVerified.mockResolvedValue(true);
  send.mockResolvedValue({ sent: true, skipped: false, providerMessageId: "wamid.1" });
  findTenant.mockResolvedValue({
    id: "t1",
    owner_id: "o1",
    hostel_id: "h1",
    phone_1: "9123456789",
    phone_2: null,
    guardian_name: "Ramesh",
    guardian_phone: "9876543210",
    profiles: { name: "Aarav", phone: "9123456789" },
    hostels: { name: "Sunrise PG" },
  });
  findConsent.mockResolvedValue({
    granted: true,
    guardian_phone: "9876543210",
    revoked_at: null,
    stopped_at: null,
  });
});

describe("sendStayGuardianUpdate", () => {
  it("sends the departure template with the event's own id as the idempotency key", async () => {
    const result = await sendStayGuardianUpdate(LEAVE);
    expect(result).toEqual({ sent: true, reason: "LEAVE" });

    const args = send.mock.calls[0][0];
    expect(args.templateName).toBe("stayo_guardian_stay_departure");
    expect(args.languageCode).toBe("en");
    expect(args.phone).toBe("9876543210");
    // Keying on the EVENT id is what lets the inline send and the daily sweep
    // both attempt without the guardian being messaged twice.
    expect(args.idempotencyKey).toBe("stay_guardian:e1");
    expect(args.bodyParameters).toEqual([
      "Ramesh",
      "Aarav",
      "Sunrise PG",
      "home",
      "Sunday, 28 September",
    ]);
  });

  it("sends the return template on RETURNED", async () => {
    const result = await sendStayGuardianUpdate({
      ...LEAVE,
      eventId: "e2",
      eventType: "RETURNED",
      leaveType: null,
      expectedReturnDate: null,
      occurredAt: "2026-09-28T14:10:00.000Z",
    });
    expect(result).toEqual({ sent: true, reason: "RETURN" });
    expect(send.mock.calls[0][0].templateName).toBe("stayo_guardian_stay_return");
    expect(send.mock.calls[0][0].bodyParameters).toEqual([
      "Ramesh",
      "Aarav",
      "Sunrise PG",
      "7:40 PM, 28 Sep",
    ]);
  });

  it("sends nothing when consent was never given", async () => {
    findConsent.mockResolvedValue(null);
    expect(await sendStayGuardianUpdate(LEAVE)).toEqual({ sent: false, reason: "NO_CONSENT" });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing when the guardian said STOP", async () => {
    findConsent.mockResolvedValue({
      granted: true,
      guardian_phone: "9876543210",
      revoked_at: null,
      stopped_at: new Date(),
    });
    expect(await sendStayGuardianUpdate(LEAVE)).toEqual({
      sent: false,
      reason: "STOPPED_BY_GUARDIAN",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing for an unverified guardian", async () => {
    isGuardianVerified.mockResolvedValue(false);
    expect(await sendStayGuardianUpdate(LEAVE)).toEqual({
      sent: false,
      reason: "GUARDIAN_UNVERIFIED",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("ignores an event type outside the family without touching the database twice", async () => {
    expect(await sendStayGuardianUpdate({ ...LEAVE, eventType: "PRESENCE_CONFIRMED" })).toEqual({
      sent: false,
      reason: "NOT_NOTIFIABLE",
    });
    expect(findTenant).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("reports a duplicate as ALREADY_SENT rather than a send", async () => {
    send.mockResolvedValue({ sent: false, skipped: true });
    expect(await sendStayGuardianUpdate(LEAVE)).toEqual({ sent: false, reason: "ALREADY_SENT" });
  });

  it("never throws when the provider does — a stay event must not fail for WhatsApp", async () => {
    send.mockRejectedValue(new Error("Meta 500"));
    await expect(sendStayGuardianUpdate(LEAVE)).resolves.toEqual({
      sent: false,
      reason: "SEND_FAILED",
    });
  });

  it("never throws when the tenant lookup itself fails", async () => {
    findTenant.mockRejectedValue(new Error("connection terminated"));
    await expect(sendStayGuardianUpdate(LEAVE)).resolves.toEqual({
      sent: false,
      reason: "SEND_FAILED",
    });
  });
});
```

- [ ] **Step 2: Register the test, then run it to verify it fails**

Add `'tests/stay-guardian-send.test.ts',` to `include`.

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/stay-guardian-send.test.ts`
Expected: FAIL — cannot resolve `stay-guardian-updates`.

- [ ] **Step 3: Write the sender**

Create `apps/backend/lib/services/notifications/command-center/stay-guardian-updates.ts`:

```ts
import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { whatsAppTemplateDeliveryService } from "../whatsapp-template-delivery";
import { isGuardianVerified } from "./guardian-access";
import { decideStayGuardianNotice, type StayGuardianReason } from "./stay-guardian-policy";
import { consentStateOf } from "@/src/services/stay/stay-guardian-consent-state";
import { safeNormalize } from "@/src/services/stay/stay-guardian-consent";
import {
  STAY_GUARDIAN_TEMPLATES,
  buildStayDeparturePayload,
  buildStayReturnPayload,
} from "../providers/whatsapp/stay-guardian-template-contracts";

const logger = getLogger("whatsapp.command-center.stay-guardian");

/**
 * "Your ward has left" / "your ward is back" — the two messages of ADR-233.
 *
 * Called twice for the same event by design: once inline when the stay event
 * commits, and again by `/api/cron/stay-guardian-sweep` if that inline send
 * was lost. Both are deduped on `whatsapp_logs.idempotency_key`, keyed by the
 * *event* id, so whichever arrives first sends and the other skips.
 *
 * NEVER THROWS. A stay event is the tenant's own record of where they are; it
 * must not fail, or roll back, because WhatsApp did.
 */

export type StayGuardianSendResult = {
  sent: boolean;
  reason: StayGuardianReason | "SEND_FAILED" | "ALREADY_SENT" | "TENANT_NOT_FOUND";
};

export type StayGuardianSendInput = {
  /** `stay_events.id` — the idempotency key, and why a replay cannot double-send. */
  eventId: string;
  tenantId: string;
  eventType: string;
  leaveType: string | null;
  expectedReturnDate: string | null;
  occurredAt: string;
};

export async function sendStayGuardianUpdate(
  input: StayGuardianSendInput,
): Promise<StayGuardianSendResult> {
  // Cheapest check first: most stay events are not in this family at all, and
  // this runs on the write path.
  if (input.eventType !== "LEAVE_STARTED" && input.eventType !== "RETURNED") {
    return { sent: false, reason: "NOT_NOTIFIABLE" };
  }

  try {
    const tenant = await (prisma as any).tenants.findUnique({
      where: { id: input.tenantId },
      select: {
        id: true,
        owner_id: true,
        hostel_id: true,
        phone_1: true,
        phone_2: true,
        guardian_name: true,
        guardian_phone: true,
        profiles: { select: { name: true, phone: true } },
        hostels: { select: { name: true } },
      },
    });
    if (!tenant) return { sent: false, reason: "TENANT_NOT_FOUND" };

    const guardianPhone = (tenant.guardian_phone || tenant.phone_2 || "").trim();
    const residentPhone = (tenant.phone_1 || tenant.profiles?.phone || "").trim();

    const consentRow = await (prisma as any).stay_guardian_consent.findUnique({
      where: { tenant_id: input.tenantId },
      select: { granted: true, guardian_phone: true, revoked_at: true, stopped_at: true },
    });

    const consentState = consentStateOf(
      consentRow
        ? {
            granted: consentRow.granted,
            guardianPhone: consentRow.guardian_phone,
            revokedAt: consentRow.revoked_at,
            stoppedAt: consentRow.stopped_at,
          }
        : null,
      guardianPhone,
      safeNormalize,
    );

    // Only ask the verification question when nothing cheaper has already
    // refused — it is a database round trip.
    const cheap = decideStayGuardianNotice({
      eventType: input.eventType,
      consentState,
      guardianPhone,
      residentPhone,
      guardianVerified: true,
      normalise: safeNormalize,
    });
    if (!cheap.notify) {
      logger.info("stay_guardian.skipped", {
        tenant_id: input.tenantId,
        event_id: input.eventId,
        reason: cheap.reason,
      });
      return { sent: false, reason: cheap.reason };
    }

    const decision = decideStayGuardianNotice({
      eventType: input.eventType,
      consentState,
      guardianPhone,
      residentPhone,
      guardianVerified: await isGuardianVerified(guardianPhone),
      normalise: safeNormalize,
    });
    if (!decision.notify) {
      logger.info("stay_guardian.skipped", {
        tenant_id: input.tenantId,
        event_id: input.eventId,
        reason: decision.reason,
      });
      return { sent: false, reason: decision.reason };
    }

    const kind = decision.reason === "LEAVE" ? "DEPARTURE" : "RETURN";
    const template = STAY_GUARDIAN_TEMPLATES[kind];
    const bodyParameters =
      kind === "DEPARTURE"
        ? buildStayDeparturePayload({
            guardianName: tenant.guardian_name,
            tenantName: tenant.profiles?.name,
            hostelName: tenant.hostels?.name,
            leaveType: input.leaveType,
            returnDate: input.expectedReturnDate || "",
          })
        : buildStayReturnPayload({
            guardianName: tenant.guardian_name,
            tenantName: tenant.profiles?.name,
            hostelName: tenant.hostels?.name,
            checkInAt: input.occurredAt,
          });

    const result = await whatsAppTemplateDeliveryService.send({
      phone: guardianPhone,
      templateName: template.name,
      languageCode: template.language,
      bodyParameters,
      idempotencyKey: `stay_guardian:${input.eventId}`,
      tenantId: tenant.id,
      hostelId: tenant.hostel_id || undefined,
      ownerId: tenant.owner_id || undefined,
    });

    if (result.skipped) {
      // The other path got there first. Not an error.
      return { sent: false, reason: "ALREADY_SENT" };
    }

    logger.info("stay_guardian.sent", {
      tenant_id: tenant.id,
      event_id: input.eventId,
      template: template.name,
      provider_message_id: result.providerMessageId || null,
    });
    return { sent: true, reason: decision.reason };
  } catch (error: any) {
    // The sweep will try again. Losing the message is bad; unwinding the
    // tenant's own record of where they are would be worse.
    logger.error("stay_guardian.failed", {
      tenant_id: input.tenantId,
      event_id: input.eventId,
      error: error?.message || String(error),
    });
    return { sent: false, reason: "SEND_FAILED" };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/stay-guardian-send.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Fire it inline, after the transaction commits**

In `apps/backend/src/services/stay/stay-service.ts`, add the import:

```ts
import { sendStayGuardianUpdate } from "@/lib/services/notifications/command-center/stay-guardian-updates";
```

In `recordStayEvent`, inside the `if (result.kind === "record") { … }` block, **after** the `try { await db.$transaction(...) } catch { … }` and before the closing brace of that block, add:

```ts
      // ADR-233 — tell the guardian, if the tenant agreed to it. Deliberately
      // outside the transaction and deliberately un-awaited for its result:
      // this is a notification about a fact that is already recorded, and it
      // must never extend, fail or roll back the write above. A lost send is
      // recovered by /api/cron/stay-guardian-sweep.
      void sendStayGuardianUpdate({
        eventId: event.id,
        tenantId: event.tenantId,
        eventType: event.type,
        leaveType: event.leaveType,
        expectedReturnDate: event.expectedReturnDate,
        occurredAt: event.occurredAt,
      });
```

Note: this sits after the `catch` that swallows `P2002` and `LostRace`. That is correct — when the duplicate lost the race, the *other* write already fired its own notification with the same idempotency key, so a second attempt here skips at the delivery layer rather than double-messaging.

- [ ] **Step 6: Verify the reducer is untouched**

Run: `cd apps/backend && git diff --stat src/services/stay/stay-events.ts src/services/stay/stay-status.ts`
Expected: **no output.** ADR-194 requires follow-ups to add read models, not change the core. If either file shows a diff, revert it.

Run the existing stay tests that are pure-safe:
```bash
npx vitest run --config vitest.pure.config.ts tests/stay-guardian-send.test.ts tests/stay-guardian-policy.test.ts
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/lib/services/notifications/command-center/stay-guardian-updates.ts apps/backend/src/services/stay/stay-service.ts apps/backend/tests/stay-guardian-send.test.ts apps/backend/vitest.pure.config.ts
git commit -m "feat(guardian-stay): the sender, fired inline after the event commits

Keyed on the stay event id, so the inline send and the daily sweep can
both attempt without messaging a guardian twice. Never throws.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The daily sweep

**Files:**
- Create: `apps/backend/src/services/stay/stay-guardian-sweep.ts`
- Create: `apps/backend/app/api/cron/stay-guardian-sweep/route.ts`
- Modify: `apps/backend/vercel.json`
- Create: `apps/backend/tests/stay-guardian-sweep.test.ts`
- Modify: `apps/backend/vitest.pure.config.ts`

**Interfaces:**
- Consumes: `sendStayGuardianUpdate` (Task 5).
- Produces:
  - `isStaleDeparture(input: { leaveStatus: string | null; expectedReturnDate: string | null; today: string }): boolean` — **pure**
  - `runStayGuardianSweep(now?: Date): Promise<{ considered: number; sent: number; skipped: number; stale: number }>`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/stay-guardian-sweep.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const findEvents = vi.fn();
const findLeaves = vi.fn();
const findConsents = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    stay_events: { findMany: findEvents },
    stay_leaves: { findMany: findLeaves },
    stay_guardian_consent: { findMany: findConsents },
  },
}));

const sendStayGuardianUpdate = vi.fn();
vi.mock("@/lib/services/notifications/command-center/stay-guardian-updates", () => ({
  sendStayGuardianUpdate: (args: unknown) => sendStayGuardianUpdate(args),
}));

import { isStaleDeparture, runStayGuardianSweep } from "@/src/services/stay/stay-guardian-sweep";

describe("isStaleDeparture", () => {
  const today = "2026-09-28";

  it("is fresh while the leave is still active and the return date is ahead", () => {
    expect(isStaleDeparture({ leaveStatus: "ACTIVE", expectedReturnDate: "2026-09-30", today })).toBe(false);
  });

  it("is fresh on the return date itself", () => {
    expect(isStaleDeparture({ leaveStatus: "ACTIVE", expectedReturnDate: today, today })).toBe(false);
  });

  it("is stale once the return date has passed", () => {
    // "expected back on Sunday" must not arrive on Monday, to a parent who has
    // already seen their child.
    expect(isStaleDeparture({ leaveStatus: "ACTIVE", expectedReturnDate: "2026-09-27", today })).toBe(true);
  });

  it("is stale once the ward is already back", () => {
    expect(isStaleDeparture({ leaveStatus: "RETURNED", expectedReturnDate: "2026-09-30", today })).toBe(true);
  });

  it("is stale once the leave was cancelled", () => {
    expect(isStaleDeparture({ leaveStatus: "CANCELLED", expectedReturnDate: "2026-09-30", today })).toBe(true);
  });

  it("is stale when the leave cannot be found at all", () => {
    expect(isStaleDeparture({ leaveStatus: null, expectedReturnDate: "2026-09-30", today })).toBe(true);
  });
});

describe("runStayGuardianSweep", () => {
  const now = new Date("2026-09-28T04:30:00.000Z"); // 10:00 IST

  beforeEach(() => {
    vi.clearAllMocks();
    sendStayGuardianUpdate.mockResolvedValue({ sent: true, reason: "RETURN" });
    findLeaves.mockResolvedValue([]);
    findConsents.mockResolvedValue([{ tenant_id: "t1" }, { tenant_id: "t2" }]);
  });

  it("considers only the two notifiable event types", async () => {
    findEvents.mockResolvedValue([]);
    await runStayGuardianSweep(now);
    expect(findEvents.mock.calls[0][0].where.type.in.sort()).toEqual(["LEAVE_STARTED", "RETURNED"]);
  });

  it("asks only for live consents — granted, not revoked, not stopped", async () => {
    findEvents.mockResolvedValue([]);
    await runStayGuardianSweep(now);
    expect(findConsents.mock.calls[0][0].where).toEqual({
      granted: true,
      revoked_at: null,
      stopped_at: null,
    });
  });

  it("scopes the event query to those tenants", async () => {
    // Otherwise every run reloads every leave in the system to reach the same
    // NO_CONSENT it reached yesterday.
    findEvents.mockResolvedValue([]);
    await runStayGuardianSweep(now);
    expect(findEvents.mock.calls[0][0].where.tenant_id).toEqual({ in: ["t1", "t2"] });
  });

  it("does not query events at all when nobody has consented", async () => {
    findConsents.mockResolvedValue([]);
    const result = await runStayGuardianSweep(now);
    expect(findEvents).not.toHaveBeenCalled();
    expect(result).toEqual({ considered: 0, sent: 0, skipped: 0, stale: 0 });
  });

  it("re-attempts a return and counts the send", async () => {
    findEvents.mockResolvedValue([
      {
        id: "e1",
        tenant_id: "t1",
        type: "RETURNED",
        leave_type: null,
        expected_return_date: null,
        occurred_at: new Date("2026-09-27T18:00:00.000Z"),
      },
    ]);
    const result = await runStayGuardianSweep(now);
    expect(result).toEqual({ considered: 1, sent: 1, skipped: 0, stale: 0 });
    expect(sendStayGuardianUpdate.mock.calls[0][0].eventId).toBe("e1");
  });

  it("drops a departure whose return date has already passed", async () => {
    findEvents.mockResolvedValue([
      {
        id: "e2",
        tenant_id: "t2",
        type: "LEAVE_STARTED",
        leave_type: "GOING_HOME",
        expected_return_date: new Date("2026-09-27T00:00:00.000Z"),
        occurred_at: new Date("2026-09-26T10:00:00.000Z"),
      },
    ]);
    findLeaves.mockResolvedValue([{ id: "e2", status: "ACTIVE" }]);
    const result = await runStayGuardianSweep(now);
    expect(result).toEqual({ considered: 1, sent: 0, skipped: 0, stale: 1 });
    expect(sendStayGuardianUpdate).not.toHaveBeenCalled();
  });

  it("a return never goes stale — it is a completed fact", async () => {
    findEvents.mockResolvedValue([
      {
        id: "e3",
        tenant_id: "t3",
        type: "RETURNED",
        leave_type: null,
        expected_return_date: null,
        occurred_at: new Date("2026-09-26T18:00:00.000Z"),
      },
    ]);
    const result = await runStayGuardianSweep(now);
    expect(result.stale).toBe(0);
    expect(result.sent).toBe(1);
  });

  it("counts an already-sent event as skipped, not sent", async () => {
    findEvents.mockResolvedValue([
      {
        id: "e4",
        tenant_id: "t4",
        type: "RETURNED",
        leave_type: null,
        expected_return_date: null,
        occurred_at: new Date("2026-09-27T18:00:00.000Z"),
      },
    ]);
    sendStayGuardianUpdate.mockResolvedValue({ sent: false, reason: "ALREADY_SENT" });
    const result = await runStayGuardianSweep(now);
    expect(result).toEqual({ considered: 1, sent: 0, skipped: 1, stale: 0 });
  });

  it("one failing event does not abandon the rest of the run", async () => {
    findEvents.mockResolvedValue([
      { id: "e5", tenant_id: "t5", type: "RETURNED", leave_type: null, expected_return_date: null, occurred_at: now },
      { id: "e6", tenant_id: "t6", type: "RETURNED", leave_type: null, expected_return_date: null, occurred_at: now },
    ]);
    sendStayGuardianUpdate
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ sent: true, reason: "RETURN" });
    const result = await runStayGuardianSweep(now);
    expect(result.considered).toBe(2);
    expect(result.sent).toBe(1);
  });
});
```

- [ ] **Step 2: Register the test, then run it to verify it fails**

Add `'tests/stay-guardian-sweep.test.ts',` to `include`.

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/stay-guardian-sweep.test.ts`
Expected: FAIL — cannot resolve `stay-guardian-sweep`.

- [ ] **Step 3: Write the sweep**

Create `apps/backend/src/services/stay/stay-guardian-sweep.ts`:

```ts
import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { istDateOf } from "@/lib/timezone";
import { sendStayGuardianUpdate } from "@/lib/services/notifications/command-center/stay-guardian-updates";
import { fromDbDate } from "./stay-rows";

const logger = getLogger("stay.guardian-sweep");

/**
 * The backstop for guardian stay updates (ADR-233).
 *
 * ── Why it is daily, and what that costs ──
 *
 * This account is on Vercel Hobby, where a sub-daily cron *fails the
 * deployment outright rather than degrading* — see the header of
 * `app/api/cron/partner-lead-fallback/route.ts`. Every cron in `vercel.json`
 * is daily for that reason, and a `*/30` schedule here would not run late; it
 * would break the deploy. A GitHub Actions schedule could tick faster, but
 * ADR-179 deliberately moved all six business crons out of Actions and into
 * `vercel.json`, and reversing that for a secondary path is the wrong trade.
 *
 * So two things follow, and both are load-bearing:
 *
 * 1. **The inline send is the real delivery path.** This recovers messages
 *    that would otherwise be lost forever; it is not a substitute for prompt
 *    delivery and must not be reasoned about as one.
 * 2. **Both templates are self-dating**, which is what makes a late send
 *    survivable: "checked in at 7:40 PM, 28 Sep" is still true the next
 *    morning. A template saying "just now" could not be swept.
 *
 * The 48-hour window is slack around a daily run, not a delivery promise.
 * `isStaleDeparture` is what actually decides.
 */

const LOOKBACK_HOURS = 48;

/**
 * A departure notice expires; a return notice does not.
 *
 * "has left and is expected back on Sunday" must not reach a parent on Monday,
 * or reach one whose child is already home. A return is a completed fact and
 * reads correctly whenever it lands.
 */
export function isStaleDeparture(input: {
  leaveStatus: string | null;
  expectedReturnDate: string | null;
  today: string;
}): boolean {
  if (input.leaveStatus !== "ACTIVE") return true;
  if (!input.expectedReturnDate) return true;
  return input.expectedReturnDate < input.today;
}

export async function runStayGuardianSweep(
  now: Date = new Date(),
): Promise<{ considered: number; sent: number; skipped: number; stale: number }> {
  const today = istDateOf(now);
  const since = new Date(now.getTime() - LOOKBACK_HOURS * 60 * 60 * 1000);

  // Only tenants with a live consent. Without this the sweep reloads every
  // leave in the system daily to reach the same NO_CONSENT as yesterday.
  const consents: Array<{ tenant_id: string }> = await (prisma as any).stay_guardian_consent.findMany({
    where: { granted: true, revoked_at: null, stopped_at: null },
    select: { tenant_id: true },
  });
  if (consents.length === 0) return { considered: 0, sent: 0, skipped: 0, stale: 0 };

  const events = await (prisma as any).stay_events.findMany({
    where: {
      type: { in: ["LEAVE_STARTED", "RETURNED"] },
      occurred_at: { gte: since },
      tenant_id: { in: consents.map((row) => row.tenant_id) },
    },
    select: {
      id: true,
      tenant_id: true,
      type: true,
      leave_type: true,
      expected_return_date: true,
      occurred_at: true,
    },
    orderBy: { seq: "asc" },
  });

  const result = { considered: events.length, sent: 0, skipped: 0, stale: 0 };
  if (events.length === 0) return result;

  // A LEAVE_STARTED event's id IS its leave's id — see applyStayEvent.
  const departureIds = events
    .filter((e: any) => e.type === "LEAVE_STARTED")
    .map((e: any) => e.id);
  const leaves: Array<{ id: string; status: string }> = departureIds.length
    ? await (prisma as any).stay_leaves.findMany({
        where: { id: { in: departureIds } },
        select: { id: true, status: true },
      })
    : [];
  const statusById = new Map(leaves.map((l) => [l.id, l.status]));

  for (const event of events as any[]) {
    if (event.type === "LEAVE_STARTED") {
      const stale = isStaleDeparture({
        leaveStatus: statusById.get(event.id) ?? null,
        expectedReturnDate: event.expected_return_date ? fromDbDate(event.expected_return_date) : null,
        today,
      });
      if (stale) {
        result.stale += 1;
        continue;
      }
    }

    try {
      const outcome = await sendStayGuardianUpdate({
        eventId: event.id,
        tenantId: event.tenant_id,
        eventType: event.type,
        leaveType: event.leave_type ?? null,
        expectedReturnDate: event.expected_return_date ? fromDbDate(event.expected_return_date) : null,
        occurredAt: new Date(event.occurred_at).toISOString(),
      });
      if (outcome.sent) result.sent += 1;
      else result.skipped += 1;
    } catch (error: any) {
      // One bad row must not abandon the rest of the run.
      logger.warn("stay_guardian_sweep.event_failed", {
        event_id: event.id,
        error: error?.message || String(error),
      });
    }
  }

  logger.info("stay_guardian_sweep.done", result);
  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/stay-guardian-sweep.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Write the cron route**

Create `apps/backend/app/api/cron/stay-guardian-sweep/route.ts`:

```ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { runStayGuardianSweep } from "@/src/services/stay/stay-guardian-sweep";

/**
 * 🕐 CRON — guardian stay updates backstop (ADR-233)
 * GET /api/cron/stay-guardian-sweep
 *
 * Re-attempts the guardian message for any LEAVE_STARTED or RETURNED event in
 * the last 48 hours whose inline send was lost — a crash, a cold start, a
 * provider outage. Deduped on `whatsapp_logs.idempotency_key`
 * (`stay_guardian:{eventId}`), so re-running is safe and an already-delivered
 * event costs one skipped reservation.
 *
 * Runs **once daily**, like every other cron here: Vercel's Hobby plan allows
 * exactly one run per day and rejects anything more frequent at deploy time.
 * The delay this implies is survivable only because both templates carry their
 * own date — see `stay-guardian-sweep.ts`.
 *
 * Protected by CRON_SECRET bearer token, same as every other cron here.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runStayGuardianSweep();
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 6: Schedule it**

In `apps/backend/vercel.json`, add to the `crons` array (06:00 UTC = 11:30 IST; no other cron occupies that hour):

```json
    {
      "path": "/api/cron/stay-guardian-sweep",
      "schedule": "0 6 * * *"
    }
```

⚠️ **Do not use a sub-daily schedule.** `*/30 * * * *` or similar fails the Vercel deploy outright on this plan.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/services/stay/stay-guardian-sweep.ts apps/backend/app/api/cron/stay-guardian-sweep/route.ts apps/backend/vercel.json apps/backend/tests/stay-guardian-sweep.test.ts apps/backend/vitest.pure.config.ts
git commit -m "feat(guardian-stay): daily sweep recovers a lost guardian send

Daily because Vercel Hobby rejects a sub-daily cron at deploy time. A
stale departure notice is dropped rather than delivered late.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: STOP, scoped to stay updates

**Files:**
- Modify: `apps/backend/lib/services/notifications/command-center/commands.ts`
- Modify: `apps/backend/lib/services/notifications/command-center/service.ts`
- Create: `apps/backend/tests/stay-guardian-stop.test.ts`
- Modify: `apps/backend/vitest.pure.config.ts`

**Interfaces:**
- Consumes: `stopGuardianConsent` (Task 4); `COMMANDS`, `resolveCommand`, `PUBLISHED_COMMANDS` (existing).
- Produces: `COMMANDS.STOP`; `stayUpdatesStoppedMessage(wardName: string): string` exported from `commands.ts`.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/stay-guardian-stop.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  COMMANDS,
  PUBLISHED_COMMANDS,
  resolveCommand,
  stayUpdatesStoppedMessage,
} from "@/lib/services/notifications/command-center/commands";
import { STAY_GUARDIAN_FOOTER } from "@/lib/services/notifications/providers/whatsapp/stay-guardian-template-contracts";

describe("STOP resolves from what the footer actually tells people to send", () => {
  it("resolves the bare word, in any case, with surrounding whitespace", () => {
    for (const text of ["STOP", "stop", "  Stop  ", "STOP."]) {
      expect(resolveCommand(text), text).toBe(COMMANDS.STOP);
    }
  });

  it("resolves the phrasings a parent actually types", () => {
    for (const text of ["STOP UPDATES", "stop stay updates", "unsubscribe"]) {
      expect(resolveCommand(text), text).toBe(COMMANDS.STOP);
    }
  });

  it("the footer's instruction resolves — the copy and the vocabulary agree", () => {
    expect(STAY_GUARDIAN_FOOTER).toContain("STOP");
    expect(resolveCommand("STOP")).toBe(COMMANDS.STOP);
  });

  it("does not hijack a message that merely contains the word", () => {
    // "stop sending me the rent link" is a complaint, not this command; it
    // should fall through rather than silently unsubscribing one feature.
    expect(resolveCommand("please stop sending me the rent link")).not.toBe(COMMANDS.STOP);
  });
});

describe("STOP is not advertised", () => {
  it("is absent from the HELP menu", () => {
    // The menu is about rent. Advertising an opt-out there invites a parent to
    // switch off the payment channel while trying to switch off location
    // updates — the same reasoning that keeps CONFIRM out of the menu.
    expect(PUBLISHED_COMMANDS.some((c) => c.name === COMMANDS.STOP)).toBe(false);
  });
});

describe("the reply states the scope rather than assuming it", () => {
  const message = stayUpdatesStoppedMessage("Aarav");

  it("names the ward, in the third person", () => {
    expect(message).toContain("Aarav");
  });

  it("says what stopped", () => {
    expect(message.toLowerCase()).toMatch(/leav|return/);
  });

  it("says what did NOT stop, so nobody silently loses the payment link", () => {
    expect(message.toLowerCase()).toContain("rent");
  });

  it("leaves a way back in", () => {
    expect(message).toContain("HELP");
  });
});
```

- [ ] **Step 2: Register the test, then run it to verify it fails**

Add `'tests/stay-guardian-stop.test.ts',` to `include`.

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/stay-guardian-stop.test.ts`
Expected: FAIL — `stayUpdatesStoppedMessage` is not exported.

- [ ] **Step 3: Add the command**

In `apps/backend/lib/services/notifications/command-center/commands.ts`:

Add to the `COMMANDS` object, after `CONFIRM`:

```ts
  /**
   * Stop stay updates (ADR-233) — what the footer of
   * `stayo_guardian_stay_departure` / `_return` tells a guardian to send.
   *
   * In `VOCABULARY` because people type it, and deliberately absent from
   * `PUBLISHED_COMMANDS` because the HELP menu is about rent: advertising an
   * opt-out there invites a parent to switch off the payment channel while
   * trying to switch off location updates.
   */
  STOP: "STOP",
```

Add to `VOCABULARY`, as a new block before the `// ── HELP ──` block:

```ts
  // ── STOP (stay updates only — ADR-233) ─────────────────
  STOP: COMMANDS.STOP,
  "STOP UPDATES": COMMANDS.STOP,
  "STOP STAY UPDATES": COMMANDS.STOP,
  UNSUBSCRIBE: COMMANDS.STOP,
```

Append to the end of the file:

```ts
/**
 * The reply to STOP.
 *
 * It states the scope rather than assuming it. A blanket STOP is the more
 * conventional reading and the wrong one here: a parent who wanted less
 * reporting on their child's movements would silently lose the rent reminders
 * and the payment link, and nobody — not the parent, not the owner, not the
 * tenant — would find out until rent was late. Saying so in the same breath
 * makes the narrower behaviour disclosed rather than assumed.
 *
 * Third person about the ward, like every other guardian-facing line.
 */
export function stayUpdatesStoppedMessage(wardName: string): string {
  const ward = String(wardName || "").trim() || "your ward";
  return [
    `Done — you won't get updates about ${ward} leaving or returning.`,
    "",
    "Rent reminders and payment receipts are unaffected.",
    "Reply HELP for what else this number can do.",
  ].join("\n");
}
```

⚠️ `resolveCommand` matches a leading token as well as the whole message (see its body). `"please stop sending me the rent link"` must **not** resolve — verify the test for that case passes; if it does not, the entry belongs only as a whole-message key, in the same manner as the greeting openers already handled separately in that file.

- [ ] **Step 4: Handle it in dispatch**

In `apps/backend/lib/services/notifications/command-center/service.ts`:

Add to the existing import from `./commands`:

```ts
import { COMMANDS, CommandName, resolveCommand, stayUpdatesStoppedMessage } from "./commands";
```

Add:

```ts
import { stopGuardianConsent } from "@/src/services/stay/stay-guardian-consent";
```

In `dispatch`, insert the STOP branch **immediately after the `COMMANDS.CONFIRM` branch and before the `if (audience === "GUARDIAN")` verification gate**:

```ts
    // ADR-233. Ahead of the guardian gate, for the same reason CONFIRM is:
    // answering "please stop messaging me" with "prove who you are first" is
    // indefensible, and an OTP challenge is not a precondition for being left
    // alone.
    //
    // Scoped to `guardianResidents`, NOT `tenantIds`. A phone can hold both
    // relationships at once — a resident whose own number is also listed as
    // their younger sibling's guardian contact — and only the guardian side
    // receives these messages. Using `tenantIds` would let a resident's STOP
    // silently switch off updates their own guardian consented to.
    if (command === COMMANDS.STOP) {
      const wards = identity.guardianResidents.filter(
        (resident) => !tenantId || resident.tenantId === tenantId,
      );
      for (const ward of wards) {
        await stopGuardianConsent(ward.tenantId);
      }
      await this.provider.sendTextMessage(
        phone,
        stayUpdatesStoppedMessage(wards.length === 1 ? (wards[0].name ?? "") : ""),
      );
      return {
        handled: true,
        command,
        tenantId: wards.length === 1 ? wards[0].tenantId : null,
        outcome: "STAY_UPDATES_STOPPED",
      };
    }
```

`ResolvedResident` is `{ tenantId; hostelId; name: string | null; status; matchedVia }` — verified in `lib/services/notifications/routing/types.ts:101`. `guardianResidents` is the subset whose `matchedVia === "GUARDIAN_PHONE"`, built in `identity-resolver.ts:185`.

A guardian of two wards who sends a bare STOP stops **both**, and the reply falls back to "your ward" rather than naming one of them. That is deliberate: someone asking to be left alone should not have to ask twice, and naming one ward while silently stopping the other would be worse than naming neither. It is recorded as an open question in §14 of the spec.

- [ ] **Step 5: Run the tests**

```bash
cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/stay-guardian-stop.test.ts tests/whatsapp-command-center-vocabulary.test.ts
```
Expected: both PASS. The existing vocabulary test must still pass — it asserts the shape of `PUBLISHED_COMMANDS` and the retired aliases.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/lib/services/notifications/command-center/commands.ts apps/backend/lib/services/notifications/command-center/service.ts apps/backend/tests/stay-guardian-stop.test.ts apps/backend/vitest.pure.config.ts
git commit -m "feat(guardian-stay): STOP, scoped to stay updates and never gated on an OTP

The reply names what stopped and what did not, so a parent does not
silently lose the payment link.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: The consent sheet

**Files:**
- Modify: `apps/frontend/src/features/stay/types.ts`
- Modify: `apps/frontend/src/features/stay/stayState.ts`
- Modify: `apps/frontend/src/features/stay/stayState.test.ts`
- Modify: `apps/frontend/src/features/stay/api/index.ts`
- Modify: `apps/frontend/src/features/stay/hooks/useMyStay.ts`
- Create: `apps/frontend/src/features/stay/components/GuardianConsentSheet.tsx`
- Modify: `apps/frontend/src/features/stay/components/StayActionPanel.tsx`

**Interfaces:**
- Consumes: the `guardian` block from `GET /api/tenant/stay` (Task 4); `POST /api/tenant/stay/guardian-consent`.
- Produces:
  - `interface GuardianConsent { eligible: boolean; name: string | null; consent: 'UNASKED' | 'GRANTED' | 'DECLINED' | 'REVOKED' | 'STOPPED' }`
  - `MyStay` gains `guardian: GuardianConsent | null`
  - `shouldAskGuardianConsent(guardian: GuardianConsent | null | undefined): boolean`
  - `guardianConsentCopy(name: string | null): { title: string; body: string; accept: string; decline: string }`
  - `stayApi.setGuardianConsent(granted: boolean, source: 'QR' | 'APP'): Promise<GuardianConsent | null>`
  - `useMyStay()` gains `setGuardianConsent` and `isSettingConsent`

- [ ] **Step 1: Write the failing test**

Append to `apps/frontend/src/features/stay/stayState.test.ts`:

```ts
import { guardianConsentCopy, shouldAskGuardianConsent } from './stayState';
import type { GuardianConsent } from './types';

const guardian = (over: Partial<GuardianConsent> = {}): GuardianConsent => ({
  eligible: true,
  name: 'Ramesh',
  consent: 'UNASKED',
  ...over,
});

describe('shouldAskGuardianConsent', () => {
  it('asks once, when there is an eligible guardian and no decision yet', () => {
    expect(shouldAskGuardianConsent(guardian())).toBe(true);
  });

  it('never asks again once the tenant has decided, either way', () => {
    for (const consent of ['GRANTED', 'DECLINED', 'REVOKED', 'STOPPED'] as const) {
      expect(shouldAskGuardianConsent(guardian({ consent })), consent).toBe(false);
    }
  });

  it('does not ask when there is no guardian to ask about', () => {
    expect(shouldAskGuardianConsent(null)).toBe(false);
    expect(shouldAskGuardianConsent(undefined)).toBe(false);
  });

  it('does not ask when the guardian is unverified or is the resident themselves', () => {
    expect(shouldAskGuardianConsent(guardian({ eligible: false }))).toBe(false);
  });
});

describe('guardianConsentCopy', () => {
  it('names the guardian — the tenant is consenting to a person, not a role', () => {
    const copy = guardianConsentCopy('Ramesh');
    expect(copy.title).toContain('Ramesh');
    expect(copy.accept).toContain('Ramesh');
  });

  it('states the limit, which is what makes this not a tracker', () => {
    expect(guardianConsentCopy('Ramesh').body.toLowerCase()).toContain('never where you are');
  });

  it('falls back to a neutral word when the guardian has no name on file', () => {
    const copy = guardianConsentCopy(null);
    expect(copy.title).toContain('your guardian');
    expect(copy.title).not.toContain('null');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/features/stay/stayState.test.ts`
Expected: FAIL — `shouldAskGuardianConsent` is not exported.

- [ ] **Step 3: Add the wire types**

In `apps/frontend/src/features/stay/types.ts`, add:

```ts
/** ADR-233. Mirrors `GuardianConsentView` in the backend stay service. */
export interface GuardianConsent {
  /** There is a guardian we could actually message: present, verified, not the resident. */
  eligible: boolean;
  name: string | null;
  consent: 'UNASKED' | 'GRANTED' | 'DECLINED' | 'REVOKED' | 'STOPPED';
}
```

and add the field to `MyStay`:

```ts
export interface MyStay {
  tenantId: string | null;
  hostel: { id: string; name: string } | null;
  resident: boolean;
  stay: TenantStay | null;
  guardian: GuardianConsent | null;
}
```

- [ ] **Step 4: Add the pure decisions**

In `apps/frontend/src/features/stay/stayState.ts`, add the import and append:

```ts
import type { GuardianConsent } from './types';

/**
 * Ask once, on the first leave — never again (ADR-233).
 *
 * `DECLINED` is as final as `GRANTED`. A stored no is what stops the sheet
 * reappearing on every trip, for exactly the tenants who least want it; that
 * is the whole reason the backend keeps a `granted = false` row rather than
 * deleting it.
 */
export function shouldAskGuardianConsent(guardian: GuardianConsent | null | undefined): boolean {
  if (!guardian || !guardian.eligible) return false;
  return guardian.consent === 'UNASKED';
}

/**
 * The sheet names the guardian, because the tenant is consenting to a person
 * rather than to a setting.
 *
 * "never where you are" is a true statement about what the two templates
 * contain, and it is the sentence that separates this feature from a tracker.
 * If a future event type makes it false, this copy changes in the same commit.
 */
export function guardianConsentCopy(name: string | null): {
  title: string;
  body: string;
  accept: string;
  decline: string;
} {
  const who = (name || '').trim() || 'your guardian';
  return {
    title: `Keep ${who} in the loop?`,
    body: `We'll tell ${who} when you leave and when you're back. That's all — never where you are, and never anything else.`,
    accept: `Yes, tell ${who}`,
    decline: 'No thanks',
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/features/stay/stayState.test.ts`
Expected: PASS, including the pre-existing cases.

- [ ] **Step 6: Wire the API and the hook**

In `apps/frontend/src/features/stay/api/index.ts`, add to the `stayApi` object and extend the type import to include `GuardianConsent`:

```ts
  setGuardianConsent: async (granted: boolean, source: 'QR' | 'APP'): Promise<GuardianConsent | null> =>
    body<{ guardian: GuardianConsent | null }>(
      await api.post('/tenant/stay/guardian-consent', { granted, source }),
    ).guardian,
```

In `apps/frontend/src/features/stay/hooks/useMyStay.ts`, add a second mutation and return it:

```ts
  const consent = useMutation({
    mutationFn: ({ granted, source }: { granted: boolean; source: 'QR' | 'APP' }) =>
      stayApi.setGuardianConsent(granted, source),
    // Same pattern as `record`: the server answers with the new state, so
    // write it into the cache rather than refetching.
    onSuccess: (guardian) => {
      queryClient.setQueryData<MyStay>(queryKeys.stay.mine(), (prev) => (prev ? { ...prev, guardian } : prev));
    },
  });
```

and add to the returned object:

```ts
    setGuardianConsent: consent.mutateAsync,
    isSettingConsent: consent.isPending,
```

- [ ] **Step 7: Build the sheet**

Create `apps/frontend/src/features/stay/components/GuardianConsentSheet.tsx`. It renders `guardianConsentCopy` and decides nothing:

```tsx
import { guardianConsentCopy } from '../stayState';

interface GuardianConsentSheetProps {
  guardianName: string | null;
  busy: boolean;
  onDecide: (granted: boolean) => void;
}

/**
 * Asked once, after the return date is picked on the tenant's first leave.
 * Two buttons, no default, no third option — a consent question with a
 * pre-selected answer is not a consent question. See ADR-233.
 */
export function GuardianConsentSheet({ guardianName, busy, onDecide }: GuardianConsentSheetProps) {
  const copy = guardianConsentCopy(guardianName);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-t-3xl border border-border bg-card p-6">
        <p className="font-display text-xl font-extrabold tracking-tight text-foreground">{copy.title}</p>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{copy.body}</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecide(true)}
          className="mt-6 h-12 w-full rounded-xl bg-primary font-bold text-primary-foreground disabled:opacity-60"
        >
          {copy.accept}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecide(false)}
          className="mt-2 h-12 w-full rounded-xl border border-border bg-card font-semibold text-foreground disabled:opacity-60"
        >
          {copy.decline}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Sequence it in the action panel**

In `apps/frontend/src/features/stay/components/StayActionPanel.tsx`:

Add to the props interface:

```ts
  guardian: GuardianConsent | null;
  onGuardianConsent: (granted: boolean) => Promise<unknown>;
```

Add the imports:

```ts
import { GuardianConsentSheet } from './GuardianConsentSheet';
import { MORE_ACTION_LABEL, screenFor, shouldAskGuardianConsent, type MoreAction, type ReturnDateMode } from '../stayState';
import type { GuardianConsent, TenantStay, TenantStayEventInput } from '../types';
```

Add state, and hold the pending leave while the consent sheet is up:

```ts
  const [pendingLeave, setPendingLeave] = useState<{ type: ReturnDateMode; date: string } | null>(null);
```

Change `pickDate` so a first leave routes through the sheet, and everything else is unchanged — the two-tap path must stay two taps:

```ts
  /**
   * D6: a channel that reports on you is never invisible to you. Shown on
   * every leave that actually notifies, not only on the trip where consent
   * was given.
   */
  const notedGuardian = () => {
    if (guardian?.consent !== 'GRANTED') return;
    stayoToast.success(`${(guardian.name || '').trim() || 'Your guardian'} will be told.`);
  };

  const pickDate = (date: string) => {
    const mode = sheet;
    setSheet(null);
    if (mode === 'CHANGE_DATE') {
      // Silent by design — a changed date does not reach the guardian.
      void send({ type: 'RETURN_DATE_CHANGED', expectedReturnDate: date });
      return;
    }
    if (!mode) return;
    if (shouldAskGuardianConsent(guardian)) {
      setPendingLeave({ type: mode, date });
      return;
    }
    void send({ type: 'LEAVE_STARTED', leaveType: mode, expectedReturnDate: date }).then((sent) => {
      if (sent) notedGuardian();
    });
  };

  const decideConsent = async (granted: boolean) => {
    const leave = pendingLeave;
    setPendingLeave(null);
    // The decision is recorded first and separately: a declined consent must
    // survive a leave that then fails, or the tenant is asked again next time
    // having already said no.
    try {
      await onGuardianConsent(granted);
    } catch {
      // Recording the decision failed. The leave is still what they asked for,
      // so it goes ahead; they will simply be asked once more next time.
    }
    if (leave) {
      const sent = await send({ type: 'LEAVE_STARTED', leaveType: leave.type, expectedReturnDate: leave.date });
      if (sent && granted) {
        stayoToast.success(`${(guardian?.name || '').trim() || 'Your guardian'} will be told.`);
      }
    }
  };
```

Render the sheet alongside the date sheet:

```tsx
      {pendingLeave && (
        <GuardianConsentSheet
          guardianName={guardian?.name ?? null}
          busy={busy}
          onDecide={(granted) => void decideConsent(granted)}
        />
      )}
```

⚠️ Both call sites of `StayActionPanel` must pass the two new props. Find them with `grep -rn "StayActionPanel" apps/frontend/src` and wire each from `useMyStay()`'s `mine.guardian` and `setGuardianConsent`, passing the same `source` that call site already passes for events.

- [ ] **Step 9: Verify the build and the architecture check**

```bash
cd apps/frontend && npx vitest run src/features/stay/stayState.test.ts && npm run check:architecture && npm run build
```
Expected: tests PASS, architecture check PASS, build succeeds. The architecture check fails on any raw `fetch`/`axios` outside `@lib/api-client` — the new call goes through `stayApi`, which is correct.

- [ ] **Step 10: Commit**

```bash
git add apps/frontend/src/features/stay/
git commit -m "feat(guardian-stay): the consent sheet, asked once on the first leave

Every later trip is unchanged: two taps. The decision posts separately
from the event so a declined consent survives a failed leave.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Documentation

Per CLAUDE.md this is not optional follow-up — a feature that ships without it is incomplete work.

**Files:**
- Modify: `docs/obsidian/Features.md`, `APIs.md`, `Database.md`, `Business-Rules.md`, `Decisions.md`, `Changelog.md`, `README.md`

- [ ] **Step 1: Re-check the ADR number**

```bash
git fetch origin && git show origin/main:docs/obsidian/Decisions.md | grep -oE "ADR-[0-9]+" | sort -u -t- -k2 -n | tail -3
```

If the highest is still ADR-232, this is **ADR-233**. If it moved, renumber throughout — including the comments already written into the code in Tasks 1–8. ADR-193 collided exactly this way; claim the number against `origin/main` at merge time, not at start time.

- [ ] **Step 2: Write the ADR**

Add to `docs/obsidian/Decisions.md`, covering: opt-in consent asked once on the first leave; a separate table rather than `tenants` columns and why; `LATE` deliberately silent; STOP scoped to stay updates; `stopped_at` outranking a re-grant; the daily sweep and the Hobby-plan constraint that forces it; unverified guardians excluded. Link `[[Business-Rules]]`, `[[Database]]`, `[[APIs]]`, `[[Features]]`.

- [ ] **Step 3: Update the other pages**

- **`Features.md`** — a guardian stay-updates entry under the Stay module, cross-linked to `[[Decisions]]`.
- **`APIs.md`** — `POST /api/tenant/stay/guardian-consent`, `GET /api/cron/stay-guardian-sweep`, and the `guardian` block now on `GET /api/tenant/stay`.
- **`Database.md`** — the `stay_guardian_consent` model, the partial index, RLS-on-no-policies, and why it is a table rather than columns on `tenants`.
- **`Business-Rules.md`** — a "Guardian stay updates" section beside the existing guardian reminder escalation, carrying the §6.2 decision table verbatim and the reasoning for `LATE` being silent.
- **`Changelog.md`** — a Keep-a-Changelog entry under today's date.

- [ ] **Step 4: Correct the vault's claim about `migrations/`**

`docs/obsidian/README.md`'s repo-orientation table says:

> `migrations/` | Legacy hand-written SQL, archived — Prisma (`apps/backend/prisma/migrations/`) is now the single source of truth for schema changes

That is **wrong**, and this task proves it: `migrations/092_rls_on_exposed_tables.sql` is recent, `tests/migration-rls.test.ts` scans only that directory, and 093 is where this feature's table lives. Correct the row to say that root `migrations/NNN_*.sql` is the live, hand-applied sequence and that `tests/migration-rls.test.ts` enforces RLS on anything it creates.

CLAUDE.md's rule 7 requires resolving a stale vault claim in the same change as the work that revealed it.

- [ ] **Step 5: Verify no broken wiki links**

```bash
cd /home/sp/Desktop/stayo/.claude/worktrees/guardian-stay && grep -ohE "\[\[[^]|#]+" docs/obsidian/*.md | sed 's/\[\[//' | sort -u | while read -r page; do
  [ -f "docs/obsidian/${page}.md" ] || echo "BROKEN: [[${page}]]"
done
```
Expected: no `BROKEN:` lines beyond any that already existed on `origin/main` (check by running the same command against a clean checkout if unsure).

- [ ] **Step 6: Commit**

```bash
git add docs/obsidian/
git commit -m "docs: ADR-233 and the vault updates for guardian stay notifications

Also corrects the README's claim that root migrations/ is archived — it
is the live sequence, and 093 lands there.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Run the whole pure suite** — not just the new files, since `vitest.pure.config.ts` was edited eight times:

```bash
cd apps/backend && npm run test:pure
```
Expected: PASS. Pay attention to `tests/migration-rls.test.ts`, `tests/whatsapp-command-center-vocabulary.test.ts`, `tests/whatsapp-prisma-accessors.test.ts` and `tests/prisma-transaction-accessors.test.ts` — all four are guards this work could trip. If the accessor guards enumerate models, add `stay_guardian_consent`.

- [ ] **Confirm the Stay core is untouched:**

```bash
git diff origin/main --stat -- apps/backend/src/services/stay/stay-events.ts apps/backend/src/services/stay/stay-status.ts
```
Expected: no output.

- [ ] **Frontend build:**

```bash
cd apps/frontend && npm run build
```

- [ ] **Write the PR description stating plainly what is NOT verified:** the send path, the sweep, the STOP round trip, and both templates end to end. There is no test database, no server-side staging, and no phone has ever scanned the Stay QR in production. Do not describe this feature as working — describe it as built.

- [ ] **Do not apply migration 093 as part of the merge.** Deploy the code first (it is inert without the table), then hand-apply 093 to `qgfyfbdccjnibdhhvnsr` with a raw `pg` client over the 6543 pooler — `prisma db execute` fails from this machine because it dials `DIRECT_URL` — and verify object by object: 9 columns, the partial index, RLS on, 0 policies, 0 rows.
