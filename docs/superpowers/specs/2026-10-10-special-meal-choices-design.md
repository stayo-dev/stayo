# Special-meal choices (veg / non-veg) — product design

**Date:** 2026-10-10 · **Status:** product design approved, not audited, not built · **ADR:** none yet (claim the next free number on `origin/main` at merge)
**Builds on:** [[Decisions#ADR-194|ADR-194]] (Stay Status) · [[Decisions#ADR-195|ADR-195]] (meal forecast) · [[Food]]

> **Audited 2026-10-10** — `docs/audits/special-meal-choices-audit.md` changes four things in this design (§1 there): fixed daily send slots instead of per-owner ask times (Vercel Hobby crons are once-daily), `ASK ME` instead of `STOP` (taken by ADR-234), per-send button payloads are supported by Meta and only need new code, and only two Meta templates are needed. The production-data half of the audit is still pending.

## Context

Many hostels serve a **special meal on fixed days, e.g. Wednesday and Sunday**, cooked in a veg version and a non-veg version. Today a warden goes door to door the evening before and asks each room how many want veg and how many want non-veg, then adds up the totals on paper. The aim is to replace that round with WhatsApp, and over time stop asking people whose answer is already known, while never counting tenants who are away.

The pasted write-up gets the fundamentals right: absence beats preference, an explicit answer beats a learned one, and "predicted" must be kept separate from "confirmed". This plan keeps those points, fixes four gaps in it, and fits the idea into what Stayo already has.

### What already exists (checked in code, so we reuse it instead of rebuilding it)
- **Stay Status (ADR-194)**: `stay_leaves` holds `start_date` and `expected_return_date`. The rule "counted on the day they return" already exists as `isHereTonight` / `headcountOn`. Absence filtering comes free from this.
- **Meal forecast (ADR-195)**: `meal_service_logs` records the served count per meal, and `/owner/food/kitchen` is the cook's screen. The special-meal count belongs on that screen too.
- **Food schedule**: each weekday + meal cell holds named dishes (for example, Sunday lunch = Chicken Biryani / Veg Biryani). Dishes have **no veg/non-veg flag**, and **there is no date column**.
- **WhatsApp webhook**: `extractMessageEvents` already parses `button_reply` and `list_reply` IDs. Template quick-reply taps arrive as type `button`, a path that was fixed for guardians.
- **Live tenancy**: `liveTenancyWhere` covers tenants who have moved out.

### A tension to settle openly
ADR-195 (D1) **rejected "tenant-declared skips"** on the grounds that a daily decision for every resident breaks the two-second rule. This feature is different. It covers only 2 meals a week, the choice changes cost (non-veg costs more), and the warden already asks the question by hand. So it does not reverse D1. It is a narrow, opt-in exception for occasions the owner configures. The ADR should say this.

---

## Where I'd change the pasted design

1. **Add a third answer: "I'm away".** With only veg and non-veg, a tenant who is out for that meal gets counted anyway, and if they don't reply they look the same as someone who ignored the message. The buttons are **Veg · Non-veg · I'm away** (decided 2026-10-10, see Decisions). "I'm away" is a **meal-specific declaration**: it removes the tenant from *that* meal's count and is recorded as such. It does **not** create a `stay_leaves` record, because missing one meal is not a hostel leave. Right after the tap, inside the 24-hour window, Stayo can *offer* to record a longer absence (*"Away for a few days? Record it so we don't ask"*), and the tenant chooses. **Skip** stays as a *typed* reply ("skip") for someone who is here but won't eat the special meal. It is counted as *Skipping*, never as *Away*.
2. **Make it a standing order the tenant agrees to, not a prediction.** The pasted doc's hardest problem is that silence isn't consent, so predictions can never be trusted. The fix is to have the tenant set the default themselves:
   > After 3 matching answers for the same occasion: *"You've picked Non-veg for the last 3 Sundays. Make it your usual?"* **[Yes, my usual] [Keep asking me]**

   Once the tenant taps Yes, silence really does mean non-veg, because they chose that. The owner sees three honest groups: **Confirmed** (answered this week), **Usual** (standing order, didn't change it), and **No answer**. Stayo makes no guesses in the count. Learning only decides *when to offer* a standing order.
3. **Name the dish.** "Sunday lunch: Chicken Biryani or Veg Biryani?" reads better than "veg or non-veg", and it explains why the same person switches between weeks (the menu changed). The names come from the existing Food schedule cell. Plain option labels are the fallback when no menu exists.
4. **Close the loop with what was actually served.** After the meal, the cook enters served counts per option on the kitchen sheet (the same habit as ADR-195). Comparing the final count with what was served is the only real accuracy measure, and it is the data any later forecasting would need.

---

## The flow

### Owner setup (once)
In Food, under **Special meals**, the owner adds an occasion: *day* (Wed / Sun), *meal* (lunch / dinner), *options* (Veg / Non-veg, renameable), *cutoff* (default: 3 hours before the meal timing). There is no per-owner ask time: the question goes out from a fixed daily slot (≈ 18:00 IST the day before) and the reminder from another (≈ 08:00 IST), because Vercel Hobby crons run once a day ±59 min (audit A1). A hostel can have several occasions, and each is learned separately.

### Ask time: who gets a message
For each live tenant of the hostel, checked in this order:
1. **Moved out by the meal date, or leaving before it** → no message, not counted.
2. **On leave covering the meal date** (`start ≤ date < expected_return`) → no message, listed as *Away*. The tenant is never bothered.
3. **Returning on the meal day** → asked, with a note: *"Welcome back Sunday — will you be here for lunch?"* This case is uncertain, so the tenant is asked even if they have a standing order.
4. **Has a standing order for this occasion** → a heads-up only (the user's message): *"Sunday lunch is Chicken Biryani — we've got you down for Non-veg 🍗. Change?"* **[Switch to Veg] [I'm away]**. No reply needed.
5. **Everyone else** → the question: **[Veg] [Non-veg] [I'm away]**.

### Between ask time and cutoff
- One tap records the answer and sends a short ✓ reply. A later tap replaces the earlier one, so the latest answer wins.
- **One reminder** goes out about 2 hours before cutoff, and only to tenants in group 5 who haven't answered.
- If the tenant **records a leave after answering**, they drop out of the count automatically. Absence wins.
- Typed replies also work: "veg", "nv", "non veg", "skip".
- The button payload carries the occasion and date, so a tap on **last week's** message can't change this week's answer.

### At cutoff
- The count **locks**. A late tap gets: *"Orders for Sunday closed at 10 am — please tell the warden."* The warden can still edit by hand, and the edit is labelled.
- The owner/cook get a **final count**: on the kitchen sheet, plus one optional WhatsApp to the owner: *"Sunday lunch: 57 non-veg · 28 veg · 6 skipping · 15 away · 4 no answer."*
- **No-answer policy** (owner setting, chosen once): count them as their *last choice* (default), as *the hostel's usual split*, or *leave them out*. Each policy is labelled in the count, so it never looks like a confirmed answer.

### After the meal
The cook enters served veg / non-veg on the kitchen sheet. That closes the loop.

---

## How the system learns (rules, not ML)

Each tenant's history is kept **separately for each occasion** (Wed dinner ≠ Sun lunch).

| State | Trigger | Experience |
|---|---|---|
| **New** | < 3 answers for this occasion | Asked every time |
| **Consistent** | Last 3 answers match, no standing order | Answer recorded, then offered *"Make it your usual?"* (offered once; after a "Keep asking me", offered again only after 6 more matching answers) |
| **Standing order** | Tenant tapped Yes | Heads-up only |
| **Drifting** | Tenant switches away from the standing order in 2 of the last 4 weeks | Standing order paused, back to asking: *"You've switched a few times lately — we'll ask each week for now."* |
| **Back from long absence** | Away ≥ 2 consecutive occasions | Asked once before the standing order resumes |

Only **explicit taps** count as evidence. Away weeks, no-answers, and silent standing-order weeks teach the system nothing. "I'm away" and a typed "skip" are answers for that meal only. They never count as evidence of a preference and never become a standing order. The tenant app gets a small **My meals** card where the tenant can see and cancel each standing order. The same can be done over WhatsApp: `MEALS` → list, `ASK ME` → ask every time. (`STOP` is taken: it stops guardian stay updates, ADR-234, and stays that way.)

---

## The owner's screen (one question: "how much do I cook?")

```
Sunday lunch · Chicken Biryani / Veg Biryani      locks 10:00 am
  Non-veg 57      Veg 28                 ← the numbers to cook
  ─────────────────────────────────────────
  Confirmed 61 · Usual 20 · No answer 4 (counted as last choice)
  Skipping 6 · Away 15 (11 on leave · 4 said "I'm away") · Moved out —
  [Remind the 4]  [View by room]  [Edit a tenant]
```
- Every number opens the list of names behind it. The room view helps the warden or the serving counter.
- After a meal is served, the screen shows *Counted 85 · Served 82* per option. Over the weeks this becomes "we over-cook non-veg by ~4 on Sundays".
- If the owner has extra knowledge, they edit a tenant's answer or add a manual adjustment line. Both are labelled and never become tenant evidence.

---

## Rules (binding)
1. Absence and moving out decide whether a tenant is counted. Preference never overrides them.
2. This week's answer beats the standing order, and the standing order beats nothing. Stayo never invents an answer.
3. Every count shows where it came from: Confirmed / Usual / No-answer policy / Manual.
4. A message is sent only when there is something to ask or confirm. Tenants who are away or have moved out get nothing.
5. **Dietary choice is sensitive** (in India it can reveal religion or caste). The owner and assigned staff can see it, other tenants never can, it is never used outside meal planning, and the tenant can always see and change it.

## Edge cases to cover in the spec
A tenant who joins between ask time and cutoff (asked on joining). Opted out of WhatsApp or no number (only the warden can record their answer). Guests (manual adjustment line). Meal timing missing (cutoff falls back to owner config). Kitchen closed or occasion cancelled that week (owner taps *Skip this week*, which sends nobody a message and counts as nobody's evidence). Two hostels, one owner (occasions are per hostel). Meta template rejected or paused (fall back to warden entry on the same screen).

---

## Phasing
- **Phase 1: Collect.** Occasion setup, ask with Veg / Non-veg / I'm away (typed skip), leave and move-out filtering, one reminder, cutoff lock, the owner count with names and rooms, warden edits, the no-answer policy (default *last choice*), and the kitchen-sheet line. *By itself this already ends the door-to-door round.*
- **Phase 2: Standing orders.** The "Make it your usual?" offer, the heads-up message, drift detection, the My meals card, and `MEALS`/`ASK ME`.
- **Phase 3: Accuracy.** Served counts per option, counted-vs-served trends, and per-occasion over/under hints for the owner.

**Success metrics:** share of eligible tenants with a confirmed or usual answer at cutoff (target ≥ 90%), messages per tenant per month going down *without* the counted-vs-served gap growing, warden time saved, and fewer "no answer" tenants over time.

---

## Fit with the architecture (for the spec, not decided yet)
- Answers are per tenant per dated occasion, and corrections replace earlier answers. That points to their own table (like `meal_service_logs`), plus a standing-order table. Both are **new tables only**, with RLS on, under the root `migrations/` (next number 096 — 095 is taken; see the audit). No new column on an existing model.
- Eligibility comes from composing `stayService` residents/leaves (occupying allocations + leaves) plus `tenants.exit_date`. It is not a new presence formula.
- Two daily crons (ask, reminder), idempotent on `whatsapp_logs.idempotency_key`. The cutoff is checked when a reply arrives, not by a cron.
- **Two Meta templates:** *question* (also used as the reminder) and *heads-up*. Both carry per-send quick-reply payloads (`MEAL:<occasion-date id>:<choice>`). The ✓ reply, "Make it your usual?" and the "record a longer absence?" offer are interactive messages inside the 24-hour window, so they need no Meta review. Submit the templates early; approval is the long pole.
- ADR: the next free number on `origin/main` (currently 235 is the latest), claimed at merge time.

## Decisions (2026-10-10)
- [x] Fixed daily ask and reminder slots; cutoff validated when a response arrives.
- [x] `ASK ME` for meal preferences; existing `STOP` behaviour preserved.
- [x] Two Meta templates, with per-meal button payloads.
- [x] New special-meal tables; existing food polls untouched.
- [x] Third button **I'm away**, a meal-specific declaration that does not create a leave record; Skip as a typed reply.
- [x] Production data validated 2026-10-10 (audit §7): **tenant self-service first** (29/29 tenants have phones); warden edit is the correction path. Leave reporting is near zero (2 leaves ever), so "I'm away" carries absence. Only 5 tenants messaged the number in 30 days, so expect many no-answers early.

## Next steps
1. ~~Save this design~~ — done (this file), with a TODO entry and a link from `docs/obsidian/Food.md`.
2. Run the usual **audit-first** pass: check against prod how many hostels have Food meal timings, live tenants with WhatsApp numbers, any `stay_leaves` usage, and the template payload question above.
3. Then a written plan for Phase 1 → TDD → verification.

## Verification (of this design step)
Read the spec back against the existing Stay Status / meal forecast specs, so nothing contradicts ADR-194/195 without the conflict being named. No code changes in this step.
