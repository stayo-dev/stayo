# Notification Triggers

## Trigger types

| Trigger | Why it fires | Likely channel |
|---|---|---|
| Invitation | Owner invites a tenant | Email or WhatsApp |
| Activation nudge | Tenant has not completed activation | Email or WhatsApp |
| Rent reminder | Due date is near or passed | Email or WhatsApp |
| Payment update | Payment status changes | In-app, email, or WhatsApp |
| Document review | Document is approved or rejected | In-app or WhatsApp |
| Move-out update | Exit workflow changes | In-app or WhatsApp |
| Test reminder | Owner tests notification config | Email or WhatsApp |
| Owner assistant command | Verified owner sends a Phase 1A WhatsApp command | WhatsApp |

**How this works:**
1. Business services create or request messages.
2. Notification services select provider behavior.
3. Logs store message attempts and webhook events.

## WhatsApp Owner Assistant Phase 1A

The WhatsApp owner assistant is an operational interface for verified hostel owners.
It is not an AI chatbot. Every write operation requires an explicit confirmation from the same verified owner phone.

| Command | Purpose | Data source |
|---|---|---|
| `LINK HMS-XXXX` | Connects an owner account to one WhatsApp number. Owners may connect multiple verified numbers. | `owner_whatsapp_identities` |
| `HELP` | Opens a short action list: Find Tenant, Record Expense, Invite Tenant, Pending Rent, Move-Outs. | Static response |
| `COMMANDS`, `?`, `WHAT CAN I ASK` | Opens the same short action list instead of a command manual. | Static response |
| Daily briefing | Sends the morning focus and the next action, not a dashboard report. | Existing dashboard and operational services |
| Smart alerts | Sends only actionable alerts such as move-out request, invitation expiring, chronic overdue tenant, payment failure, or owner phone changes. | Existing operational services |
| `DUES` | Opens Pending Rent with quick reminder actions. | Existing payment dues and reminder conversion data |
| `COLLECTIONS` | Answers a quick collection question and links to pending rent. | Existing payments and dues data |
| `TODAYS MONEY`, `TODAY'S MONEY`, `MONEY TODAY` | Shows today's collections, expenses, net cashflow, and quick links. | Existing payments and expense data |
| `VACANCIES`, `OCCUPANCY` | Answers a quick vacancy question and supports invite actions. | Existing room allocation data |
| `TOP DUE`, `MOVEOUT PENDING`, `VACANT ROOMS`, `INVITES EXPIRING` | Opens action-oriented queues without requiring a tenant name. | Existing operational tables |
| `SEND REMINDERS` | Starts a confirmation flow to remind tenants from the current top pending dues list. | Existing reminder service |
| `internet 1000`, `expense gas 1200`, `paid milk 50`, `expenses milk 50` | Creates a pending expense draft for owner confirmation when a positive amount is present. | Existing expense service after confirmation |
| `EXPENSES` | Opens quick expense actions for add, today, and undo. | Existing expense service |
| `expenses today`, `expenses week`, `expenses month` | Shows recent expense totals and capped ledger rows. | Existing expense service |
| `expenses category internet`, `top categories` | Shows category-specific or category summary expenses. | Existing expense service |
| `undo expense` | Creates a pending delete action for the latest recent WhatsApp-created expense. | Existing expense service after confirmation |
| `Rahul`, `9876543210`, `G1`, `SEARCH Rahul` | Resolves tenant, lead, room, or hostel and opens an entity card. | Existing tenant, payment, room, lead, and dashboard data |
| Tenant card buttons | Shows a decision card with the recommended next action: Reminder, Call, Resend, Review, Profile, Room, or Open HMS. | Existing payment, financial, reminder, invitation, agreement, and move-out services |
| Room card buttons | Shows active room tenants, room occupancy, or starts an invite flow with the room preselected. | Existing room allocation and invitation services |
| `INVITATIONS` | Shows pending invitation and activation work across active hostels. | Existing tenant invitation data |
| `MOVEOUTS` | Shows the move-out action queue across active hostels. | Existing move-out, inspection, settlement, and dispute data |
| Open HMS buttons | Return a deep link when the task belongs in the web app. | HMS web app |
| `CONNECTED` | Shows verified owner WhatsApp numbers and connected dates. | `owner_whatsapp_identities` |
| `DISCONNECT` | Starts a confirmation flow to remove the sender's WhatsApp number from the owner assistant. | `owner_whatsapp_identities` after confirmation |
| `CONFIRM` / `CANCEL` | Confirms or cancels a pending owner assistant action. | `owner_assistant_confirmations` |

**How this works:**
1. The owner generates a temporary code from HMS with `/api/owner/whatsapp/link-code`.
2. The owner sends `LINK HMS-XXXX` from WhatsApp.
3. The WhatsApp webhook validates the code, stores the verified phone mapping, and sends a WhatsApp confirmation message.
4. Future owner commands resolve the owner only from that verified phone mapping.
5. WhatsApp uses existing HMS services instead of duplicating calculations.
6. Every handled owner command is logged in `owner_assistant_messages`.
7. The owner dashboard lists verified WhatsApp numbers through `/api/owner/whatsapp/connections` and can disconnect a number through `/api/owner/whatsapp/connections/:connectionId`.
8. New WhatsApp connections notify the owner's other connected WhatsApp numbers with connected count and Settings review path.
9. `SEND REMINDERS`, expense capture, expense undo, and WhatsApp disconnect store 5-minute pending confirmations in `owner_assistant_confirmations`; only `CONFIRM` from the same verified owner phone executes them.
10. Confirmed reminder actions call the existing reminder service instead of sending tenant reminders directly from the assistant.
11. Confirmed expense actions call the existing expense service instead of writing finance rows directly.
12. Confirmed disconnect actions remove only the sender's WhatsApp number and notify the disconnected number plus remaining connected owner numbers.
13. The owner dashboard Automation section shows connected numbers with last seen time and last command type from `owner_assistant_messages`.
14. `whatsapp_owner_sessions` stores per-owner-phone current screen, pending action metadata, and last interaction time, but not hidden hostel scope.
15. Dues, invitations, move-outs, collections, and vacancy screens start from all active hostels and only narrow down when the owner taps an explicit hostel or room row.
16. Unknown verified-owner messages are treated as deterministic entity searches after known commands fail.
17. Entity search returns tenant, room, lead, or hostel cards. WhatsApp buttons and list messages are the primary selection UI; text fallback is only used when interactive delivery fails.
18. Tenant cards choose contextual next actions. Chronic overdue tenants surface `Call`; reminders with no payment conversion recommend calling; recent payers surface `Profile` and `Room`; longer work goes to `Open HMS`.
19. Tenant reminder, invite resend, and move-out actions from cards still require same-phone `CONFIRM` before they call existing HMS services.
20. `HELP`, `COMMANDS`, `?`, and `WHAT CAN I ASK` stay intentionally short and open action rows, not a command encyclopedia.
21. Dashboard-style reports such as revenue, closing, insights, and watchlists are documented in the V3 audit as removal candidates before deletion.
22. Operational search phrases such as `TOP DUE`, `VACANT ROOMS`, and `INVITES EXPIRING` open queues directly.
23. Expense reporting is reserved for exact report commands such as `expenses today`, `expenses week`, `expenses month`, `expenses category internet`, `last 5 expenses`, and `top categories`; amount-bearing phrases such as `expenses milk 50` become expense drafts.
24. `SEARCH <query>` is an explicit entity-search fallback for debugging and deterministic owner use. Search misses return a visible no-results response instead of silently failing.

Unsupported owner commands return `HELP`.
Unlinked numbers are only handled by the owner assistant when they send `LINK`; other messages continue through existing WhatsApp routing.

## WhatsApp Entity Search v1

The owner assistant is person-first, not search-result-first. Owners can send a name, mobile number, or room number and receive an actionable card.

| Input | Result |
|---|---|
| Tenant name or phone | Tenant card with payments, dues, and move-out actions. |
| Invited tenant name or phone | Tenant card with invited status and available actions. |
| Lead name or phone | Lead card, or tenant card when the lead was converted. |
| Room number | Room card with occupancy, tenants, and invite actions. |
| Hostel name | Hostel card with basic occupancy and dues summary. |

**Resolution order:**
1. Exact room number match for room-like inputs.
2. Active tenant by name or phone.
3. Invited tenant by name or phone.
4. Admissions lead by name or phone.
5. Room number contains match.
6. Hostel name contains match.

**How this works:**
1. The webhook extracts text messages, button replies, and list replies.
2. Button/list payloads route to deterministic actions such as `TENANT_CARD:<id>` or `ROOM_TENANTS:<id>`.
3. Every payload re-checks owner access before returning data.
4. Multi-match searches store only result IDs in short-lived `OWNER_ENTITY_SEARCH` session state.
5. Tenant cards reuse `tenantService.getOwnerTenantOverview`.
6. Payment cards reuse existing tenant payment history.
7. Dues cards reuse `financialService.getTenantDues`.
8. Reminder buttons create a confirmation and reuse `reminderService.sendManualReminder`.
9. Move-out buttons ask for planned exit date, create a confirmation, and reuse `moveOutService.createRequest`.
10. Room invite buttons reuse the existing invite flow with the room preselected.
11. Tenant action lists expose the full tenant action center while the card keeps the most likely next actions visible.
12. Dues screens bucket tenants into fresh, reminded, and chronic groups and preview reminder cost before confirmation.

## Cron jobs

The canonical scheduler inventory lives in [Cron Registry](../operations/cron-registry.md).
Every `/api/cron/*` route must be listed there before it is scheduled.

**How this works:**
1. Vercel calls cron routes on schedule.
2. Routes check `CRON_SECRET`.
3. Services process eligible records in bounded or naturally scoped batches.
4. Deprecated, Dormant, and Frozen routes remain unscheduled unless the registry is updated with owner, criticality, schedule, and recovery details.

## Redis queue and cache invalidation map

| Event | Redis action |
|---|---|
| Payment recorded | Invalidate owner, hostel, portfolio, and tenant dashboard tags. |
| Rent generated | Invalidate owner and hostel dashboard tags. |
| Expense changed | Invalidate owner, optional hostel, analytics, and portfolio tags. |
| Tenant activated, transferred, moved out, or reactivated | Invalidate owner, hostel, and tenant dashboard tags. |
| Room allocated, released, created, updated, or deleted | Invalidate owner and hostel dashboard tags. |
| Reminder or late fee creates financial state | Invalidate owner, hostel, and portfolio tags. |

**How this works:**
1. Redis tag sets remember cache keys created for each owner, hostel, or tenant.
2. Domain events delete tagged keys after mutations.
3. Short TTLs protect users if a rare invalidation path is missed.
4. Business expenses invalidate owner totals even when no hostel is referenced.

## Redis queue primitives

| Queue | Intended work |
|---|---|
| `whatsapp-reminders` | WhatsApp rent and activation reminders. |
| `email-notifications` | Email reminders and operational notifications. |
| `receipt-generation` | Deferred receipt or invoice rendering. |
| `rent-generation` | Coordination around scheduled rent work. |
| `late-fee-processing` | Deferred late-fee jobs. |

**How this works:**
1. Jobs enter Redis sorted sets with a `runAfter` score.
2. Cron drains bounded batches and retries failed jobs.
3. Dead-letter sets keep terminal failures inspectable.

## Logs

| Model | Purpose |
|---|---|
| `notifications` | In-app notification records. |
| `reminder_logs` | Rent reminder attempts. |
| `message_logs` | General message tracking. |
| `whatsapp_logs` | WhatsApp delivery events. |
| `whatsapp_webhook_events` | Raw WhatsApp webhook events. |
| `owner_whatsapp_identities` | Verified owner phone mappings and temporary link codes. |
| `owner_assistant_messages` | Owner assistant command audit records. |
| `owner_assistant_confirmations` | Short-lived confirmation records for assistant-triggered actions. |
| `whatsapp_owner_sessions` | Per-owner-phone current screen, pending action metadata, and last interaction time. |

**How this works:**
1. Logs preserve delivery evidence.
2. Webhook events allow provider replay analysis.
3. Owners can trust reminders were attempted.

> **Needs clarification:** Exact notification templates and provider fallback order are not fully centralized. Confirm production message copy before a new-client launch.
