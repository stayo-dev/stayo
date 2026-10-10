# WhatsApp template brief — `stayo_special_meal_question`

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
