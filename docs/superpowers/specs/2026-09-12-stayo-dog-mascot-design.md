# Stayo Dog — the login companion (sub-project 1 of 4)

**Status:** approved 2026-09-12. The feel was signed off on the interactive prototype
(`https://claude.ai/code/artifact/b3c85896-61d5-4ce1-bd48-a8851719a5b8`) at its default tuning.

## Why

Brand delivered a golden-retriever mascot (`Stayo-Brand-Assetes/MascotStayoDog/`): six poses
(neutral, happy, waving, thinking, celebrating, sleepy), each a 300×300 SVG drawn on **one shared
rig** with named groups (`head-group`, `eye-*`, `eyebrow-*`, `ear-*`, `mouth`, `tail`, `paws`). The
goal is a companion that makes people feel Stayo is on their side, reacting to their cursor, their
typing and the outcome, starting at login.

## Presence policy (applies to all four sub-projects)

| Surface | Dog |
|---|---|
| Login, onboarding, empty / error / 404 / success moments | Yes, in both apps |
| Tenant home | A live seat by the greeting (sub-project 3) |
| Owner app | **Moments only.** It removed its greeting deliberately for density (`OwnerHomeDashboard.tsx`) |
| Loaders (`StayoLoader`, `StayoLoadingScreen`) | **Never.** "One gesture per wait" stays the four-window mark |
| A floating dog on every screen | Never. It collides with the owner FAB and bottom nav, and it becomes a nag |

Roadmap: (1) the rig + interactive login companion, this spec; (2) moments across both apps;
(3) tenant home seat + tour narration; (4) relationship features that need the backend (streaks,
anniversaries, naming the dog). Each gets its own spec.

## Design principles (acceptance criteria)

The dog's job: *make Stayo feel like someone is on your side, without ever costing a second or a tap.*

1. **Never in the way.** Never overlaps an input, button, error or the close button; no tab stop; the
   layout doesn't shift when it appears or hides; at most one bounded beat on the critical path.
2. **Caused by you.** Every reaction traces to a user action. Idle is only breath and a blink.
3. **Honest emotion.** Sympathy on error, joy only on real success. Covering the eyes on the
   password *is* the privacy message, so **nothing outranks it**.
4. **Words carry the meaning.** The dog is `aria-hidden`; every state it shows is also in text.
   Delete the dog and the form works identically.
5. **Respect the body.** Reduced motion gives still poses, instant swaps and no tracking. A touch
   pointer means gaze follows the focused field. Too little vertical room means the dog hides.
6. **One character.** One rig, one personality, the six-colour brand palette only.

## Login behaviour

Priority, highest first: **success › submitting › password (covering / peeking) › error hold ›
boop › startle › reading › sleepy › attentive › neutral.**

| Trigger | Dog |
|---|---|
| Modal opens | Rises from behind the card's top rim; paws settle on the rim |
| Pointer moves (fine pointer, motion allowed) | Pupils track the cursor; the head tilts toward it; the ears follow a beat late |
| Email field focused | *Reading*: head dips, pupils follow the end of the typed text |
| Password field focused | *Covering*: both paws rise over the eyes |
| "Show password" on | *Peeking*: one paw lowers, one eye opens and looks at the field |
| Caps Lock on in the password field | Brows go up (a **modifier** layered on covering or peeking, since the brows are the only visible part above the paws), **plus** a text hint "Caps Lock is on" (`role="status"`) |
| Submit / Google | *Thinking*: head tilt, thought bubble |
| Login fails | *Concerned*: ears droop, brows slant, small head shake, held for `errorHoldMs` |
| Login succeeds | *Celebrating* for `successBeatMs`, then `onSuccess` runs |
| No input for `idleSleepS` | *Sleepy*; the next input startles it into *curious* briefly |
| Tap on the head | *Happy* (boop), pointer-only |

**Refinements found while prototyping** (they change the plan's first draft):
- Focusing any field ends the error hold, and the password rung outranks it. Before this, retyping a
  password inside the sympathy window left the dog looking.
- The reveal button counts as part of the password field. Focus is tracked with `focusin` and
  `focusout` on a wrapper, and the button calls `preventDefault` on `mousedown` so the caret stays in
  the input. Pressing "show" never uncovers the eyes.
- Over the rim, only the raised tail (celebrating) is drawn; the resting tails poke out as a stray
  spike beside the shoulder.

**Phone (bottom sheet):** the same rim composition sits on the sheet's top edge; the gaze follows
the focused field. The dog hides at `(max-height: 560px)`, so a raised keyboard or landscape phone
never pushes the sheet off screen.

**"Signed in" handoff overlays** (`LandingPage.tsx`, `DiscoverAuthContext.tsx`): a small waving dog
above "Signed in". No timing change.

## Tuning (signed off on the prototype)

| Constant | Value | Unit |
|---|---|---|
| `pupilRange` | 3 | SVG units |
| `headTiltMax` | 6 | degrees |
| `headStiffness` | 170 | spring k |
| `headDamping` | 0.72 | damping ratio ζ |
| `earFollow` | 0.45 | × head stiffness |
| `pawStiffness` | 220 | spring k |
| `wagHz` | 2.5 | Hz |
| `blinkEveryS` | 4 | s, plus a random 0–4 s |
| `errorHoldMs` | 2400 | ms |
| `successBeatMs` | 600 | ms; 0 under reduced motion |
| `idleSleepS` | 30 | s |

## Architecture

**Code-rigged inline SVG** driven by a small in-house spring integrator on `requestAnimationFrame`,
writing SVG `transform` attributes directly, so there are no React renders per frame. `motion` is
installed, but the rig needs a dozen coupled springs (ears chase the head, paws rise along their
own lean), and a tested pure integrator is simpler than coordinating a dozen `useSpring` values.
There are no new dependencies; Rive is the upgrade path if a designer wants to hand-animate later.

`apps/frontend/src/shared/ui/brand/mascot/`: self-contained, imports only `react` and
`@shared/lib`, which keeps `shared/` a leaf (`scripts/check-architecture.mjs`).

| File | Kind | Responsibility |
|---|---|---|
| `dogTuning.ts` | pure | `DOG_TUNING`, the table above |
| `dogExpressions.ts` | pure | Expression → part variants; arm poses; `EXPRESSION_NAMES` |
| `dogMood.ts` | pure | Event reducer + `resolveExpression(state, now, context)`, the priority ladder and caps modifier |
| `dogGaze.ts` | pure | `pupilOffset`, `headTiltFor`, `caretTarget`, `armTransform`, `nextBlinkDelay` |
| `dogSpring.ts` | pure | `stepSpring`: a semi-implicit damped spring |
| `dogMotionProfile.ts` | pure | `{pointerFine, reducedMotion} → {trackPointer, animate}` |
| `dogParts.tsx` | view | The SVG markup: rig parts with every variant (C2PA metadata stripped) |
| `StayoDog.tsx` | view | Mounts the SVG, runs the frame loop, exposes an imperative handle |
| `useDogCompanion.ts` | hook | Pointer, idle clock and field bindings for a form; returns `{dogRef, bind, …}` |

**New v1 art, derived from existing parts** (flagged for the designer to refine): *covering*,
*peeking*, *concerned*, *curious*, plus the *rim* framing. The source files in
`Stayo-Brand-Assetes/` stay untouched.

**`LoginModal.tsx`:** `Dialog.Content` had `overflow-y-auto`, which would clip a dog placed above
the card. It is split into an outer positioned shell and an inner scroll body holding today's
content unchanged. Auth calls, validation, error copy, the claim link and Google are all unchanged.

## Verification

- `npx vitest run src/shared/ui/brand/mascot`: the pure suites pass.
- `tsc --noEmit`, filtered to the changed files (`npm run build` does not typecheck).
- `npm run build`: architecture, legal and branding checks green.
- Manual at `/login`:
  - desktop: tracking, reading, cover/peek, caps, error, success, sleep
  - a 375×667 phone, and 375×500 (the dog hides)
  - reduced motion
  - a keyboard-only pass (no new tab stops)
  - a screen reader (the dog is silent)
- Usability, with 3–5 owners and tenants on their own phones:
  - nobody feels slowed down
  - the dog never covers anything they need
  - at least half react to the eye-covering
  - errors read as friendly
