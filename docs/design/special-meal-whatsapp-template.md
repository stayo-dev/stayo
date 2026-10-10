# WhatsApp template briefs — special meals (4 templates)

> **Submitted 2026-10-10.** Status as reported by the user that day:
>
> | Template | Category Meta gave it | Status |
> |---|---|---|
> | `stayo_special_meal_question` | **Marketing** (re-classified from Utility) | Active – quality pending |
> | `stayo_meal_ready_hot` | **Marketing** (re-classified from Utility) | Active – quality pending |
> | `stayo_meal_ready_wait_over` | Utility | In review |
> | `stayo_meal_ready_ding` | Utility | In review |
>
> Submitted copy differs slightly from the drafts below (bold/italic, "Non Veg", "Dining Hall"); the code's copy in `special-meal-template-contract.ts` was synced to the submitted text. Names, variable counts and button order all match, so sending is unaffected. While a rotated "ready" template is still in review, the code falls back to `stayo_meal_ready_hot`.
>
> **Why the re-classification matters for the question.** Marketing messages cost several times more per message, and Meta caps how many marketing messages one person receives across all businesses, so some residents may silently not get the question (error 131049). The ready alert can live with that; the question is the core of the feature. A neutrally worded Utility version is drafted at the end of this file for resubmission.

For submission in Meta Business Manager → WhatsApp Manager → Message templates. Used by [[Decisions#ADR-238|ADR-238]] (special-meal choices). The code that sends it lives in `apps/backend/lib/services/notifications/providers/whatsapp/special-meal-template-contract.ts`. **Name, language, body and button order must match that file exactly**, or sends fail (Meta error 132001 for a wrong name; 132000 for a wrong parameter count).

| Field | Value |
|---|---|
| Name | `stayo_special_meal_question` |
| Category | Utility |
| Language | English (`en`) |
| Header | none |
| Footer | `Stayo Property Management` |

**Body** (exactly):

```
Hi {{1}}! {{2}} is a special meal: {{3}}.
What would you like? Please answer by {{4}}.

If you won't be at the hostel for this meal, tap I'm away and we won't cook for you.
```

**Sample values:** `{{1}}` Rahul · `{{2}}` Sunday lunch, 11 Oct · `{{3}}` Chicken Biryani or Veg Biryani · `{{4}}` 9:30 AM

**Buttons:** three **Quick reply** buttons, in this order:

1. `Veg`
2. `Non-veg`
3. `I'm away`

They must be *quick reply*, not "Visit website" or "Call phone number": the code attaches a per-send payload to each (`MEAL:<occasion>:<date>:<resident>:<choice>`), which only quick-reply buttons carry.

The same template is sent twice per serving: as the question (≈18:00 IST the day before) and as the reminder to anyone still silent (≈08:00 IST on the day). Both read correctly because the body names the day, date and cutoff.


---

# The "food's ready" templates (3, rotating weekly)

Sent when the cook taps **Ready** on the kitchen sheet or the special-meals page, **only** to residents that dish was cooked for, at most once per dish per serving. One wording is used for a whole week (Sunday–Saturday) and the next week rotates to the next one. **Submit all three.** If a rotated one isn't approved, the code falls back to `stayo_meal_ready_hot`, so that one matters most.

Common to all three:

| Field | Value |
|---|---|
| Category | Utility (it is a status update on a meal the resident ordered — see the note below) |
| Language | English (`en`) |
| Header | none |
| Footer | `Stayo Property Management` |
| Button | one **Quick reply**: `I'm on my way` |
| Samples | `{{1}}` Rahul · `{{2}}` Chicken Biryani · `{{3}}` Sri Adithya Boys Hostel |

**1. `stayo_meal_ready_hot`**

```
🔥 It's ready, {{1}}! {{2}} is hot and being served now at {{3}}.

Grab your plate before the first round runs out.
```

**2. `stayo_meal_ready_wait_over`**

```
The wait is over, {{1}} 🍽️ {{2}} just came off the stove at {{3}}.

Your plate is waiting. Come and get it!
```

**3. `stayo_meal_ready_ding`**

```
Ding ding! 🔔 {{1}}, {{2}} is ready to serve at {{3}}.

Hungry? This one's for you. See you at the counter!
```

**On the Utility category.** Meta can re-classify a playful template as Marketing, which costs more per message and only reaches people who haven't opted out of marketing. Two things argue for Utility, and are worth putting in the submission's description field: the message only goes to a resident who **chose that meal** (it is effectively an order-status update, like "your order is ready"), and it is sent once, when the food is actually ready. If Meta re-classifies it anyway, the feature still works; it just costs more.

**What the [I'm on my way] tap does:** the resident gets an instant, friendly reply ("🏃 See you at the counter, Rahul!"). It needs no extra template, because a tap opens WhatsApp's 24-hour reply window.


---

# Resubmission draft: a Utility version of the question

Meta's classifier reacts to promotional tone ("special meal", "What would you like?"). This version reads as a confirmation request for a meal the resident is already part of. **Submit it under a new name** (an approved template's category can't be changed by editing). Once it's approved, the code switches to it with a one-line change (`SPECIAL_MEAL_QUESTION_TEMPLATE.name`).

| Field | Value |
|---|---|
| Name | `stayo_meal_choice_request` |
| Category | Utility |
| Language | English |
| Footer | `Stayo Property Management` |
| Buttons | Quick reply, in order: `Veg`, `Non Veg`, `I'm away` |
| Samples | `{{1}}` Shiva · `{{2}}` Sunday lunch, 11 Oct · `{{3}}` Chicken Biryani or Veg Biryani · `{{4}}` 9:30 AM |

```
Hi {{1}}, please confirm your meal for {{2}}: {{3}}.
Reply by {{4}} using the buttons below.

If you won't be at the hostel for this meal, tap I'm away.
```

In the submission's description: *"Sent to a hostel resident the evening before a scheduled meal they are enrolled in, asking them to confirm veg or non-veg so the kitchen cooks the right quantity. Not promotional."*
