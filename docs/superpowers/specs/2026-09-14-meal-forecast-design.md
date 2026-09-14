# Meal forecast — Stay Status Phase 2a design

**Date:** 2026-09-14 · **Status:** approved, not yet built · **Branch:** to be cut from `origin/dev`
**Builds on:** [[Decisions#ADR-193|ADR-193]] (Stay Status Phase 1) · **Spec:** this file · **Food audit:** `docs/audits/stay-status-audit.md` §Food

## 1. The question this answers

> "How many do I cook for?"

The PRD's Phase 2 headline. Today the kitchen guesses, and the guess is the single most expensive recurring decision in a hostel: cook too much and it is thrown away, too little and residents go without.

Phase 1 gave us a live headcount (`here tonight`) and an event stream. **That is not a meal count.** A hostel's participation is lopsided — nearly everyone eats dinner, far fewer eat lunch, because most residents are at college — so showing the headcount as a meal number would overstate lunch every single day and be quietly abandoned.

**Nothing in Stayo records how many people actually eat.** The Food module has menus, timings and polls, but no headcount, no opt-out and no served count (see the audit). So this slice's first job is to *create* the ground truth, and only then to forecast from it.

## 2. The rule this design protects

> **Forecast from what actually happened, and say so when you don't know yet.**

Two consequences, both binding:
- A number shown to a cook is either **learned from that hostel's own history** or **honestly labelled as a headcount**. Never a guess dressed as a forecast.
- The learning costs the kitchen **one number per meal**, entered where they already stand. No new screen, no tenant-facing chore.

It stays inside ADR-193's architecture: a new read model plus one new table, with no change to `stay_events` or the reducer.

## 3. Decisions taken with the user (2026-09-14)

| # | Decision | Why |
|---|---|---|
| D1 | **Learn the ratio from actual served counts.** The cook logs how many were served; we divide by that day's headcount. | It is the only source that reflects this hostel, and it compounds — it is also exactly the data a future prediction model would need. Rejected: owner-set ratios (never improve, go stale) and tenant-declared skips (a daily decision for every resident, against the two-second rule, and only as good as participation). |
| D2 | **Away Today is dropped, not deferred again.** | Phase 1 deferred it "until meals exist". With ratios learned from actuals, the population's day-out pattern is already inside the lunch ratio, and an overnight absence is leave, which already reduces the headcount. It would add a third tenant state to buy accuracy we get for free. |
| D3 | **Served counts live in their own table**, not on `stay_events`. | They are a hostel-and-date fact; `stay_events.tenant_id` is `NOT NULL`, and widening the event stream to carry non-tenant facts would corrupt the one thing ADR-193 protects. |
| D4 | **Median over the last 14 logged days, minimum 3.** | Median so one festival dinner or one exam-week lunch cannot move the number. 14 days so a hostel's term-time rhythm dominates. 3 so it starts helping within a week. |
| D5 | **Entry lives on the kitchen sheet.** | `/owner/food/kitchen` is already the cook's screen — deliberately the dumbest screen in the product, big type, no navigation. The number is entered where the meal was served. |
| D6 | **Per-weekday ratios are out of scope.** | Sunday lunch genuinely differs, but 4 meals × 7 days = 28 buckets needs far more history than 4. Revisit once logs accumulate. |

## 4. Data

### `meal_service_logs` (new table)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `hostel_id` | uuid → `hostels` ON DELETE CASCADE | |
| `serve_date` | date | The **IST** calendar date the meal was served. |
| `meal_type` | text | `BREAKFAST` / `LUNCH` / `SNACKS` / `DINNER` — matches `FoodMealTypeKey`. |
| `served_count` | int | What the kitchen actually served. `0` is meaningful (nobody came); null is not allowed. |
| `headcount_at_log` | int | **The denominator, frozen at entry.** The `stay_leaves` projection keeps moving — a leave cancelled next week must not silently rewrite last Tuesday's ratio. |
| `recorded_by` | uuid null | The profile that entered it. |
| `created_at`, `updated_at` | timestamptz | |

- **Unique on `(hostel_id, serve_date, meal_type)`** — one truth per meal. Re-entering a number **corrects** it (an `upsert`), because a cook fixing a typo is normal; this table is a measurement, not an event log, and that is the deliberate difference from `stay_events`.
- Index `(hostel_id, meal_type, serve_date DESC)` — the exact shape of the ratio query.
- **New table only.** No column is added to any existing model (the 2026-08-22 outage rule).
- RLS enabled with no policies, like the Stay tables.

## 5. The model (pure)

```
headcountOn(date, residents, activeLeaves) → number
  residents minus everyone whose leave covers `date`
  (start_date <= date AND expected_return_date > date)
```

A leave's return date means "back that day", so the person **is** counted on their return date. This is the same convention as `isHereTonight` in Phase 1, and it is what makes *tomorrow* answerable rather than only tonight.

```
mealRatio(logs) → { ratio: number, samples: number, confidence: 'learning' | 'learned' }
  samples  = logs from the last 14 serve_dates with headcount_at_log > 0
  ratio    = median(served_count / headcount_at_log)
  confidence = samples >= 3 ? 'learned' : 'learning'

forecastMeal({ headcount, ratio, confidence }) → { expected: number, basis }
  learned  → round(headcount * ratio),  basis: 'learned'
  learning → headcount,                 basis: 'headcount'
```

- A ratio above 1 is kept, not clamped: guests and staff eat too, and a hostel that consistently serves 1.1× its residents should be told 1.1×.
- `headcount_at_log = 0` rows are excluded from the ratio (a divide-by-zero, and a day with no residents teaches nothing).

## 6. Surfaces

**Kitchen sheet (`/owner/food/kitchen`)** — the only screen that changes shape:
- Each meal in today's and tomorrow's columns gains its expected number.
- Meals whose serving window has **closed today** (from `meal_timings`, and yesterday's if never logged) gain an inline **"How many did you serve?"** number entry. One field, a keypad, done.
- Which meals appear is unchanged: the sheet iterates `slotsInUse(weekGrid)` (menu-driven, lowercase `MealSlotKey`). The API answers in uppercase `FoodMealTypeKey`, so the page maps between them — this mismatch already exists in the codebase and is not being fixed here.

**Owner Home Tonight card** — the caption becomes the learned dinner forecast instead of the raw headcount.

**Stay board headline** — `≈ N for dinner & breakfast` becomes the forecast, with the honesty label below it.

**Tenants see nothing new.** No new state, no new decision, no extra tap.

**Copy:**
- Learning: `31 here tonight · still learning what people actually eat`
- Learned: `≈ 34 dinners · from the last 2 weeks`

## 7. API

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/api/hostels/[id]/meals/forecast?from=&to=` | OWNER | Per date and meal: `expected`, `basis`, `ratio`, `samples`, `headcount`. Defaults to today + tomorrow. |
| PUT | `/api/hostels/[id]/meals/served` | OWNER | `{ serveDate, mealType, servedCount }` → upsert. Rejects a future `serveDate`, a negative count, and a count implausibly above the headcount (> 3×, which is a typo, not a feast). |

Owner scoping is Phase 1's: `resolveOwnerScope` → `requireHostelBelongsToOwner`. Both folders go into `architectural-invariants-check.ts`'s scan roots, as Stay's did.

## 8. Code layout

**Backend** (`apps/backend`):

| File | Responsibility |
|---|---|
| `src/services/meals/meal-ratio.ts` | `mealRatio`, `forecastMeal`, the median helper. Pure. |
| `src/services/meals/meal-forecast-service.ts` | Composes `stayService`'s residents/leaves with the logs; `getForecast`, `recordServed`. |
| `src/services/stay/stay-board.ts` | + `headcountOn(date)` — pure, reusing the existing `BoardResident`/`BoardLeave` shapes. |
| `prisma/migrations/20260915090000_meal_service_logs/migration.sql` + `schema.prisma` | the new table |
| `app/api/hostels/[id]/meals/{forecast,served}/route.ts` | thin routes |

**Frontend** (`apps/frontend/src`):

| File | Responsibility |
|---|---|
| `features/owner-food/mealForecast.ts` (+ `.test.ts`) | The copy and display model: expected label, honesty line, which meals can still be logged today. Pure. |
| `features/owner-food/hooks/useMealForecast.ts` | Query + upsert mutation, invalidating the forecast and the Stay summary. |
| `features/owner-food/pages/KitchenSheetPage.tsx` | The expected numbers and the inline entry. |
| `features/stay/stayState.ts`, `features/owner-stay/*` | The board headline and Home caption read the forecast when it is learned. |

## 9. Testing

- **Pure, backend:** the median (even/odd counts, one outlier), the 14-day window, the 3-sample threshold, `headcount_at_log = 0` exclusion, ratios above 1, and `headcountOn` across a leave's start and return date.
- **Pure, frontend:** the two copy states, and which meals offer entry given `meal_timings` and the clock.
- **Mocked service:** upsert corrects rather than duplicates; the implausible-count and future-date rejections; the forecast composes residents + leaves + logs.
- **DB-backed:** the `(hostel_id, serve_date, meal_type)` uniqueness under a double submit. **Expected to remain unrun** — the test Supabase project is paused or deleted and Prisma cannot reach a pooler from the dev machine (raw `pg` can; see ADR-193's consequences).
- Gates as before: `check:invariants`, `test:pure`, frontend `npm test`, `check:architecture`, `vite build`, filtered `tsc`.

## 10. Honest limits

- **It learns nothing until someone logs a meal.** Every hostel starts in the `learning` state and shows a headcount.
- **The forecast inherits the headcount's accuracy**, which depends on residents reporting leave — something that has never happened in production, since no QR has been scanned yet. A hostel where nobody reports leave will see a flat headcount times a ratio, which is still better than today's guess but is not occupancy intelligence.
- **One ratio per meal, not per weekday** (D6), so Sunday will read wrong until the follow-up.
- **`hostels.food_included` is still read by no Food code** (the audit's finding, unchanged here). Whether a hostel serves food is inferred from menus and meal timings, as the rest of the module already does.
