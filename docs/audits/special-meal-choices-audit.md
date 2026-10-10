# Special-meal choices — audit

**Date:** 2026-10-10 · **Branch:** `feat/special-meal-choices` · **Design under audit:** `docs/superpowers/specs/2026-10-10-special-meal-choices-design.md`
**Scope:** checks the design's assumptions against the code on `origin/dev` (`63394fce`). **The production data half is not done**: the read-only queries were blocked by this session's permission policy. They are listed in §6, ready to run.

Related: [[Food]] · [[Decisions#ADR-194|ADR-194]] · [[Decisions#ADR-195|ADR-195]] · [[Decisions#ADR-234|ADR-234]]

---

## 1. Verdict

The design holds, but the audit changes it in four places:

| # | Design assumed | Code says | Change |
|---|---|---|---|
| A1 | An owner-configurable ask time (6 pm) and cutoff, each driven by a cron | Vercel Hobby crons run **once a day, ±59 min**. A sub-daily cron fails the deploy (ADR-179, `vercel.json`) | **Fixed platform slots for scheduled sends** (one daily "ask" cron, one daily "reminder" cron). The **cutoff needs no cron**: it is a timestamp checked when a tap arrives, the same way `food_polls.closes_at` already works. Per-owner ask times wait for Pro. |
| A2 | `STOP` = "ask me every time" | `STOP` / `UNSUBSCRIBE` already stop **guardian stay updates** (ADR-234, `command-center/commands.ts:114`) | Use **`ASK ME`** for meals. Never overload `STOP`. |
| A3 | Per-send button payload might be a Meta limitation (flagged by the Stay Status memory) | Meta supports a per-send `quick_reply` payload. Our code just never uses one: every template so far has a **static** button, and the webhook turns `button.payload` into a *text* event (`whatsapp-webhook-event-service.ts:232`) | Not a blocker. It needs a new payload prefix (e.g. `MEAL:<occasionDateId>:<choice>`) recognised **before** the text-command vocabulary. A typed "veg" can't carry the date, so it maps to the tenant's one open occasion only. |
| A4 | Four templates (question / heads-up / reminder / "make it usual?") | A tenant's tap opens the 24-hour customer-service window, and `sendButtonMessage` (`meta-provider.ts:529`) already sends free-form interactive buttons with per-send ids | **Two templates only:** *question* (also used for the reminder) and *heads-up*. The ✓ confirmation and "Make it your usual?" are sent inside the window as interactive messages, with no Meta review. |

## 2. What already exists — reuse, don't rebuild

| Need | Existing piece | Notes |
|---|---|---|
| Who is away on the meal date | `stay_leaves` (`start_date`, `expected_return_date`, `status`), and `headcountOn` / `isHereTonight` in `src/services/stay/stay-board.ts` | Convention: counted **on** the return date. That is the design's "returning on the meal day" case, and it is the one case the design asks about even with a standing order. |
| Who lives here | `stayService`'s resident list: occupying room allocations (`OCCUPYING_ALLOCATION_WHERE`, `lib/services/room-capacity-service.ts:73`), one per tenant, plus active `stay_leaves` (`src/services/stay/stay-service.ts:~216`) | The ADR-195 forecast composes exactly this. **Also exclude `tenants.exit_date < meal date`**: a future-dated move-out keeps its allocation until the release cron runs. (`liveTenancyWhere` is *profile*-scoped, for a tenant's own session, so it is the wrong tool here.) The poll routes' inline `status: "ACTIVE"` count is a third, older formula. Do not copy it. |
| Serving times (for the cutoff default) | `preferences_config.meal_timings` via `lib/services/food/meal-timings.ts` (`normalizeMealTimings`, defaults per meal) | Never blank, because it falls back to defaults. |
| Dish names for the message | `food_schedule_meals` + `food_schedule_meal_items`, keyed by weekday and meal, through the `WeekGrid` contract | **No date column and no veg/non-veg flag**, so the menu can name the dishes but can't tell which is which. The owner maps option → label when creating the occasion. |
| Phone → tenant | `routing/identity-resolver.ts` `resolveSenderIdentity` | It already handles one phone covering several residents (the picker). |
| Template send / buttons | `meta-provider.ts` `sendTemplate` (304), `sendButtonMessage` (529) | The template quick-reply *parameter* (per-send payload) is new code in `sendTemplate`'s component builder. |
| Served counts per meal | `meal_service_logs` (ADR-195) + kitchen sheet | Phase 3 needs **per option** served counts, which this table can't hold (one row per hostel × date × meal). That will need a sibling table. Don't widen this one. |

## 3. The nearest existing feature: ad-hoc food polls

`food_polls` / `food_poll_options` / `food_poll_votes` with routes under `app/api/food/polls` and `app/api/food/tenant/polls`. A poll is dated (`poll_date`), per meal, single choice, and closes at `closes_at`. A tenant's vote replaces their previous one. An owner could create "Sunday lunch: Veg / Non-veg / Skip" today.

**Why the feature should not be built on polls:**
- Polls are **in-app only** (an in-app notification on create). There is no WhatsApp path.
- Every poll is created **by hand**. Nothing recurs.
- The eligible count is every `ACTIVE` tenant with a login. It **ignores leave**, which is the design's first rule.
- `is_anonymous` defaults to true. Results show totals and never who voted, so there's no room list and no per-tenant history.
- A vote has no source (confirmed / usual / warden), so standing orders can't sit in it.
- Making polls fit would mean new columns on three existing models, the deploy-before-migrate hazard ([[Database]], the 2026-08-22 outage).

**Recommendation:** new tables only, and leave polls untouched. Polls stay the right tool for one-off questions ("rate today's biryani"). The owner Food tab should show special meals and polls as **separate** things, so an owner never runs the same question twice.

## 4. Constraints the spec must state

1. **Scheduling granularity (A1).** Proposed slots: **ask ≈ 18:00 IST** for the next day's occasions, and a **reminder ≈ 08:00 IST** for that day's lunch/dinner occasions. Each fires anywhere in its hour. Two crons, both idempotent on `whatsapp_logs.idempotency_key` (the `stay-guardian-sweep` pattern). The owner chooses only the cutoff. Its default is 3 hours before the serving window opens.
2. **Leave is only as good as reporting.** The design is only as good as how reliably tenants record leave. ADR-195 §10 said this already. As of the 2026-09-23 memory note, prod held 5 `stay_events` rows (2 QR, both leaves RETURNED). **This needs re-checking (§6).** If leave reporting stays near zero, "away" tenants get messaged and stay silent. The design then degrades into "No answer", which is honest but weaker. A **[I'm away]** button on the question (it records a leave, and absence then wins) would make the meal message help fill in leave records too. Recommend adding it, with three buttons max: **Veg · Non-veg · I'm away**. "Skip" then becomes a typed reply / heads-up button. *This one needs the user's decision.*
3. **WhatsApp's 3-button ceiling.** Quick replies allow up to 10 buttons on a template, but interactive (non-template) messages allow 3. The heads-up template needs 2 (switch, skip/away). Fine.
4. **Sensitive data.** No RLS policy and no anon read (follow [[rls-disabled-tables-prod]]'s lesson: `ENABLE ROW LEVEL SECURITY` in the same migration file). Owner and admin read only. Excluded from tenant exports.
5. **Migrations** go in the root `migrations/` directory (`095_tenant_payment_claims.sql` is taken on `origin/main`, so next is **096**. Re-check at merge). The test DB is dead ([[stayo-test-db-dead]]), so DB-backed tests won't run. Logic stays in pure modules under `vitest.pure.config.ts`'s **explicit include list**.

## 5. Must-not-rebuild list

- The stay presence formula (`stayService` residents + `headcountOn`). Compose them.
- `food_polls` and its routes. Leave them alone.
- `meal_service_logs` and the ADR-195 ratio. Untouched. Special meals are a separate count. Don't let the ordinary forecast and this one quietly disagree on the same kitchen-sheet row. Show special meals as their own line.
- The text-command vocabulary in `command-center/commands.ts`. Add `MEALS` and `ASK ME`. Change nothing else.

## 6. Production checks still to run (blocked here)

Read-only. Run them through the raw `pg` recipe or the Supabase SQL editor against `qgfyfbdccjnibdhhvnsr`:

```sql
-- live tenants, phones, logins
select status, count(*) n, count(*) filter (where coalesce(phone_1,'')<>'') with_phone,
       count(*) filter (where profile_id is not null) with_login
from tenants group by 1 order by 2 desc;
-- hostels with meal timings / published menus
select count(*) hostels, count(*) filter (where preferences_config ? 'meal_timings') with_timings from hostels;
select status, count(*) n, count(distinct hostel_id) hostels from food_schedules group by 1;
-- is anyone using polls (the closest proxy for "tenants answer food questions")?
select poll_type, status, count(*) n, count(distinct hostel_id) hostels, max(created_at) latest from food_polls group by 1,2;
select count(*) votes, count(distinct tenant_id) voters from food_poll_votes;
-- is leave being reported?
select type, source, count(*) n, max(created_at) latest from stay_events group by 1,2 order by 3 desc;
select status, count(*) n, max(created_at) latest from stay_leaves group by 1;
-- do tenants reply on WhatsApp at all?
select count(*) inbound_30d from whatsapp_webhook_events where created_at > now() - interval '30 days';
```

What each answer decides:
- **Leave reporting near zero** → the [I'm away] button (§4.2) becomes essential.
- **Few phones** → the warden-entry path is the main path, not a fallback.
- **Zero poll votes** → tenants have never answered a food question in-app. WhatsApp is then the only realistic channel, which supports the design.
