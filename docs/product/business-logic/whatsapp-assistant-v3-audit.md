# WhatsApp Assistant V3 Audit

## Product Boundary

HMS remains the control center. WhatsApp should only:

1. Alert the owner.
2. Let the owner take a quick action.
3. Answer a quick question.

Anything that requires more than about 30 seconds should send the owner to HMS.

## Commands

All handlers are in `apps/backend/lib/services/notifications/owner-whatsapp-assistant.ts`.

| Command | Aliases | Handler | Purpose | V3 decision |
|---|---|---|---|---|
| `LINK HMS-XXXX` | none | `handleLink` | Verify an owner phone. | Keep. |
| `HELP` | none | `handleHelp` | Open quick action rows. | Keep, action-first. |
| `COMMANDS` | `?`, `WHAT CAN I ASK` | `handleCommandExamples` | Open the same quick action rows. | Keep, action-first. |
| `SUMMARY` | none | `handleSummary` | Owner dashboard summary. | Deprecate from discovery; candidate removal. |
| `DUES` | none | `handleDues` | Pending rent and reminders. | Keep. |
| `COLLECTIONS` | none | `handleCollections` | Today's payments and pending rent link. | Keep only as quick question. |
| `TODAYS MONEY` | `TODAY'S MONEY`, `TODAY MONEY`, `MONEY TODAY` | `handleTodaysMoney` | Today's collections minus expenses. | Keep as quick question. |
| `VACANCIES` | `OCCUPANCY`, `VACANT ROOMS` | `handleVacancies` | Vacant beds and invite action. | Keep as action-oriented occupancy alert. |
| `WATCHLIST` | none | `handleWatchlist` | Chronic dues and active move-outs. | Candidate removal; replace with alerts/action queue. |
| `INBOX` | `PRIORITIES` | `handlePriorityInbox` | Ranked operational items. | Keep only if framed as action queue. |
| `TODAY` | `ACTIONS`, `OPERATIONS` | `handlePriorityInbox` | Items needing owner action. | Keep, action-first. |
| `REVENUE` | none | `handleRevenueProtection` | Revenue-at-risk report. | Remove from WhatsApp discovery; belongs in HMS. |
| `CLOSING` | none | `handleClosingReport` | End-of-day report. | Remove from WhatsApp discovery; belongs in HMS unless sent as scheduled briefing later. |
| `INSIGHTS` | none | `handleCollectionInsights` | Reminder conversion analytics. | Remove from WhatsApp discovery; belongs in HMS. |
| `ACTIVITY` | none | `handleActivity` | Today's operational feed. | Candidate removal; keep only as alert context if needed. |
| `INVITATIONS` | `INVITES EXPIRING`, `EXPIRING INVITES` | `handleInvitations`, `handleExpiringInvites` | Pending invitation actions. | Keep. |
| `MOVEOUTS` | `MOVE OUTS`, `MOVEOUT PENDING`, `MOVE OUT PENDING`, `MOVE-OUT PENDING` | `handleMoveOuts` | Move-out action queue. | Keep. |
| `TOP DUE` | `WHO OWES MOST` | `handleTopDue` | Highest pending rent list. | Keep as quick question. |
| `RECENT JOINERS` | none | `handleRecentJoiners` | Recent tenant activations. | Candidate removal; HMS reporting. |
| `SEND REMINDERS` | `SEND REMINDER` | `handleSendRemindersRequest` | Stage bulk reminders. | Keep, confirmed write. |
| `CONNECTED` | none | `handleConnectedWhatsAppRequest` | Show verified WhatsApp owner numbers. | Keep. |
| `DISCONNECT` | none | `handleDisconnectWhatsAppRequest` | Stage unlink of current owner phone. | Keep, confirmed write. |
| `SEARCH <query>` | free-form tenant/room/phone text | `handleEntitySearch` | Quick entity lookup. | Keep. |
| `EXPENSES` | `EXPENSES TODAY`, `EXPENSES WEEK`, `EXPENSES MONTH`, `EXPENSES CATEGORY <x>`, `LAST 5 EXPENSES`, `TOP CATEGORIES` | `handleExpenseCenter`, `handleExpenseReport`, `handleTopExpenseCategories` | Expense quick actions and short views. | Keep capture and short views; remove deep reporting from discovery. |
| `UNDO EXPENSE` | none | `handleUndoExpenseRequest` | Stage deletion of recent WhatsApp-created expense. | Keep, confirmed write. |
| Expense capture | `milk 500`, `expense milk 500`, `paid milk 500`, `expenses milk 500` | `handleCreateExpenseRequest` | Stage expense creation. | Keep, confirmed write. |
| `INVITE` | structured and guided invite text | `handleStructuredInviteCommand`, invite state flow | Tenant invitation. | Keep. |

## Interactive Flows

| Entry point | Actions | Follow-up screens | Write operations | Confirmation |
|---|---|---|---|---|
| Help/commands | Find Tenant, Record Expense, Invite Tenant, Pending Rent, Move-Outs | Quick action rows | None | Not required. |
| Entity search | Tenant, room, lead, hostel card | Card actions | None directly | Not required. |
| Tenant card | Recommended next action, call, reminder, resend invite, review move-out, profile, room, Open HMS | Short action responses or HMS link | Reminder, resend invite, move-out | Required for writes. |
| Room card | Tenants, invite, occupancy | Room tenants/list or invite flow | Invite | Required before final invite write. |
| Pending rent | Bucket rows, reminder preview | Reminder confirmation | Reminder queue/send | Required. |
| Expense draft | Confirm, cancel | Created expense or cancelled draft | Expense create/delete | Required. |
| Invitations | Resend invitation | Resend preview | Invitation resend | Required. |
| Move-outs | Review/start move-out | Date prompt and confirmation | Move-out request/settlement actions | Required. |
| Connected/disconnect | Disconnect | Disconnect warning | Owner WhatsApp unlink | Required. |

## Notifications

| Trigger | Message type | Buttons | Destination | V3 decision |
|---|---|---|---|---|
| Owner phone linked | Assistant updated notice | Review path text | Existing verified owner numbers | Keep. |
| Owner phone disconnected | Disconnect notice | None or review path text | Disconnected and remaining owner numbers | Keep. |
| Daily briefing | Morning operational briefing | Pending Rent, Move-Outs, Search | Verified owner numbers | Keep, simplify to daily focus. |
| Rent reminder action | Confirmation/result notice | Confirm/cancel or result text | Owner phone | Keep. |
| Expense draft/result | Draft confirmation/result | Confirm/cancel | Owner phone | Keep. |
| Invitation resend/action | Confirmation/result | Confirm/cancel | Owner phone | Keep. |
| Move-out action | Confirmation/result | Confirm/cancel | Owner phone | Keep. |

## Daily Briefings

Current briefing behavior includes priority-type branches for collections, onboarding, occupancy, profitability, and operations. V3.1 keeps only a morning focus that tells the owner what to do next:

- Pending rent: open pending rent to call or send reminders.
- Onboarding: open invitations to resend or review.
- Empty beds: open vacancies to invite tenants.
- Expense review: open HMS for full finance review.
- Operations: open move-outs or pending invitations.

Buttons should be limited to `Pending Rent`, `Move-Outs`, and `Search`.

## V3.1 Action-First Changes

The assistant should feel like an operations control surface, not a report browser.

| Area | V3.1 behavior |
|---|---|
| `HELP`, `COMMANDS`, `?` | Show one quick-action list: Find Tenant, Record Expense, Invite Tenant, Pending Rent, Move-Outs. |
| Daily briefing | Says the focus and next action, not a pile of metrics. |
| Tenant card | Shows a recommendation. Overdue tenants with stale reminders surface `Call`; normal dues surface `Send Reminder`; invited tenants surface `Resend Invite`; active move-outs surface `Review Move-Out`. |
| Reminder intelligence | Uses reminder count and `converted_to_payment` to avoid pushing repeated reminders when calling is the better next action. |
| Expense center | Opens Add Expense, Today, and Undo Last only. Category reports still work via exact report commands but are not primary quick actions. |
| Action queue | `TODAY`, `ACTIONS`, `OPERATIONS`, `INBOX`, and `PRIORITIES` converge on `What Needs Action`. |

The remaining dashboard-style commands are compatibility routes. They should not be promoted in WhatsApp discovery.

## Search

Supported search:

- tenant name
- tenant phone
- room number
- invited tenant name/phone
- lead name/phone, if lead data exists
- hostel name

V3 decision: keep free-form search as the WhatsApp homepage. Unknown verified-owner messages should attempt search after quick-action and expense parsing.

## Expense Flows

Kept flows:

- fast capture: `milk 500`, `salary ramu 15000`, `internet 1200`
- confirmation before create
- cancel draft
- undo recent WhatsApp-created expense
- short expense views for today/month/category

Candidate removal from WhatsApp discovery:

- deep expense analytics
- long category trends
- any expense workflow better completed in HMS

## Removal Report

| Feature | Reason | Replacement | Risk |
|---|---|---|---|
| `REVENUE` screen | Monitoring/reporting, not quick action. | HMS dashboard; daily briefing can mention urgent revenue leakage. | Owners who learned the command may lose a shortcut. |
| `CLOSING` screen | End-of-day reporting belongs in HMS unless scheduled as a push. | HMS dashboard or future approved utility template. | Low. |
| `INSIGHTS` screen | Deep analytics and conversion reporting belongs in HMS. | Show recommendation on tenant/dues cards only. | Medium if owners rely on reminder conversion stats in WhatsApp. |
| `REPORTS` menu | Creates a second dashboard navigation tree. | Short `COMMANDS` examples and HMS links. | Low. |
| `WATCHLIST` screen | Monitoring screen; vague ownership action. | Action queue and targeted alerts. | Medium; chronic tenant list may be useful if reframed as action queue. |
| `ACTIVITY` screen | Activity feed can become passive monitoring. | Use only when owner asks a quick question or from HMS. | Low. |
| `SUMMARY` command | Recreates dashboard summary. | Daily briefing and quick search/actions. | Medium; keep temporarily for backward compatibility. |

No candidate has been deleted yet. The current implementation removes these from primary discovery surfaces first, then they can be deleted after production usage is reviewed.

## Remaining WhatsApp Model

| Pillar | Kept capabilities |
|---|---|
| Daily briefing | Morning focus with pending rent, occupancy, vacancies, and move-outs. |
| Smart alerts | Owner phone changes, move-outs, invitation expiry, chronic dues, payment failures. |
| Quick search | Tenant, phone, room, invitation, lead, hostel lookup. |
| Quick actions | Expense capture, invite, reminders, move-out/settlement review, call, Open HMS. |

## Implementation Result

| Area | Result |
|---|---|
| Removed from primary discovery | `SUMMARY`, `REVENUE`, `CLOSING`, `INSIGHTS`, `WATCHLIST`, `ACTIVITY`, report-style menu rows. |
| Soft-removed commands | Dashboard-style commands now return an HMS redirect instead of opening a WhatsApp report screen. |
| Remaining commands | `HELP`, `COMMANDS`, `?`, `WHAT CAN I ASK`, free-form search, `SEARCH`, `DUES`, `COLLECTIONS`, `TODAYS MONEY`, `VACANCIES`, `OCCUPANCY`, `TOP DUE`, `MOVEOUT PENDING`, `VACANT ROOMS`, `INVITES EXPIRING`, `TODAY`, `ACTIONS`, `OPERATIONS`, `INBOX`, `PRIORITIES`, `SEND REMINDERS`, expense capture/report/undo, `INVITE`, `INVITATIONS`, `MOVEOUTS`, `CONNECTED`, `DISCONNECT`, `CONFIRM`, `CANCEL`. |
| Remaining notifications | Daily briefing, smart owner alerts, owner phone connected/disconnected, confirmation/result messages for expense, invite, reminder, and move-out actions. |
| Remaining quick actions | Search, call tenant, send reminder, resend invite, review move-out, invite tenant, add expense, undo expense, Open HMS. |

## Command Fit

| Command | Why it exists | Realistic owner use | Why WhatsApp |
|---|---|---|---|
| Free-form search / `SEARCH` | Find a tenant, phone, room, or invitation. | Very high. | Fast answer in seconds. |
| `DUES` / `TOP DUE` | Identify who needs collection action. | Very high. | Immediate reminder/call action. |
| `SEND REMINDERS` | Trigger rent follow-up. | High. | One-tap action after review. |
| Expense capture | Record cash spent before forgetting. | Very high. | Faster than opening HMS. |
| `UNDO EXPENSE` | Correct a recent WhatsApp-created mistake. | Medium. | Keeps quick capture safe. |
| `INVITE` / invitation actions | Send or resend an activation path. | High during admissions. | Fast tenant onboarding action. |
| `MOVEOUTS` / move-out actions | Review operational blockers. | Medium. | Alerts and approvals are time-sensitive. |
| `VACANCIES` / `OCCUPANCY` | Answer empty-bed questions. | Medium. | Quick occupancy check and invite path. |
| `TODAYS MONEY` / `COLLECTIONS` | Answer today's cashflow question. | High. | Quick answer, not deep finance reporting. |
| `CONNECTED` / `DISCONNECT` | Manage owner WhatsApp access. | Low but important. | WhatsApp-specific control. |
| `HELP` / `COMMANDS` / `?` | Open the action list. | Medium. | Reduces command-memory burden. |
