# WhatsApp template briefs — special meals (4 templates)

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
