# WhatsApp Assistant V3.2 Design

## Theme

V3.2 is a prioritization release.

It does not add new source-of-truth tables, AI behavior, dashboards, or broad report screens.
It ranks existing HMS work so the owner knows what to handle first.

## Product Boundary

WhatsApp should:

1. Surface the highest-value action.
2. Explain the operational reason in one or two lines.
3. Offer a safe quick action.
4. Deep-link to HMS only when WhatsApp cannot safely finish the task.

WhatsApp should not:

1. Replace complex HMS workflows.
2. Edit disputes, settlements, or document review details.
3. Become a dashboard or analytics browser.
4. Create new intelligence sources outside existing HMS tables and services.

## Core Screen

### Priority Action Queue

Entry commands:

- `ACTIONS`
- `WHAT NEEDS ACTION`
- `TODAY`
- `INBOX`
- `PRIORITIES`

Example:

```text
Money At Risk Today

1. Shiva (SAH-1)
Rs. 8,500 overdue
18 days overdue
Recommended: Call
Why: 2 reminders sent, no payment received

2. Rahul (SAH-2)
Invitation expires today
Recommended: Resend
Why: Room is still reserved and activation is incomplete

3. Karthik (SAH-4)
Settlement awaiting approval
Recommended: Review
Why: Rs. 6,500 is blocked until owner approval

4. Room G1 (SAH-3)
2 beds vacant
Money at risk: Rs. 8,000/month
Recommended: Invite Tenant
Why: Vacant for 12 days
```

Buttons:

- `Handle Rent`
- `Handle Invites`
- `More`

If the top item is move-out or vacancy heavy, buttons may become:

- `Move-Outs`
- `Vacancies`
- `More`

## HMS Escalation Policy

The third button should usually be `More`, not `Open HMS`.

Use HMS only when WhatsApp cannot safely complete the task.

| Situation | WhatsApp action | HMS usage |
|---|---|---|
| Chronic due tenant | Call, Reminder, More | Not primary. |
| Expiring invite | Resend, Call, More | Not primary. |
| Move-out review | Review, Call, More | Not primary when review can be safely summarized. |
| Dispute | Explain blocker | Open HMS. |
| Settlement adjustment | Explain blocker | Open HMS. |
| Document review | Explain blocker | Open HMS. |
| Payment investigation | Explain blocker | Open HMS. |

## Ranking Model

The queue is deterministic. No AI and no new tables.

HMS optimizes WhatsApp priority for:

1. Recover money.
2. Protect money.
3. Prevent money loss.

Use `priority type` and `money at risk` separately.

Priority type controls broad ordering:

1. Financial
2. Operational
3. Compliance

Money at risk ranks items inside each priority type.

Examples:

- overdue rent: obligation balance
- vacant bed: vacant beds multiplied by `rooms.base_rent`
- pending settlement: settlement amount blocked
- expiring invite: potential monthly rent for the reserved bed

Internal scoring may still use deterministic weights, but the owner-facing explanation should be money-first.

| Signal | Priority type | Money at risk | Boosts | Recommended action |
|---|---|---|---|---|
| Chronic overdue tenant | Financial | Pending rent amount | Days overdue, reminders ignored | Call |
| Move-out dispute | Financial | Disputed or blocked settlement amount | Dispute age | Open HMS |
| Settlement awaiting approval | Financial | Net settlement amount | Approval age | Review |
| Invitation expiring today | Financial | Potential room/bed rent | Tenant opened invite, room reserved | Resend |
| Vacant bed revenue loss | Financial | Vacant beds * base rent | Vacancy age, number of beds | Invite Tenant |
| Reminder-ready fresh overdue tenant | Financial | Pending rent amount | No recent reminder | Reminder |
| Invitation opened but not activated | Financial | Potential room/bed rent | Days since opened | Call or Resend |
| Payment verification/failure | Financial | Payment amount | Age | Review Payment |
| High-priority complaint | Operational | null | Priority, age | More or Open HMS |
| Inspection missing | Operational | null | Planned exit date, age | Review |
| Document pending/rejected | Compliance | null | Rejection, tenant active | Open HMS |

Release 1 should expose only:

- chronic dues
- fresh dues
- expiring invites
- vacancies
- move-out reviews
- settlements

Keep payment verification failures, document review, and complaints in the ranking engine but do not expose them in the first production queue. They are edge-case signals and can reduce daily signal quality.

Tie breakers:

1. Higher priority type.
2. Higher money at risk inside the same priority type.
3. Older operational age.
4. Tenant-specific items before room-level items.
5. Direct WhatsApp action before HMS-only action.

The queue should return a capped list. Start with 5 items.

## Call Action Policy

`Call` is not a completed business action.
In V3.2 it should only open or reveal the phone number and record lightweight audit evidence.

Do not create call tracking tables.

When an owner taps `Call`, record audit messages in existing `owner_assistant_messages`:

- `CALL_RECOMMENDED`
- `CALL_OPENED`

Use this audit to suppress repeated `Recommended: Call` for the same owner, phone number, and tenant for 24 hours.

During suppression, the same item may still appear lower in the queue, but the recommendation should shift to:

- `Reminder`, if safe and useful
- `More`, if follow-up options exist
- `Open HMS`, only when the item cannot be safely handled in WhatsApp

## Pillars

### 1. Tenant Decision Card V2

Search remains the primary navigation path.

Card shape:

```text
Shiva
Room G1

Rs. 8,500 overdue
18 days overdue

Recommended:
Call Tenant

Why:
2 reminders sent
No payment received

Last payment:
12 days ago
```

Button policy:

| Tenant state | Buttons |
|---|---|
| Chronic overdue or reminder ignored | Call, Reminder, More |
| Fresh overdue | Reminder, Call, More |
| Invited, not activated | Resend, Call, More |
| Move-out active | Review, Call, More |
| Recently paid or clean tenant | Profile, Room, More |

`More` should open a short action list. HMS links belong inside `More` only when the task cannot be completed safely in WhatsApp.

Data sources:

- `tenants`
- `rooms`
- `room_allocations`
- `rent_obligations`
- `payments`
- `reminder_logs`
- `tenant_invitations`
- `move_out_requests`
- `tenant_behavior_scores`

### 2. Collection Intelligence

The rent flow should answer who should be reminded and who should be called.

Buckets:

| Bucket | Definition | Recommendation |
|---|---|---|
| Fresh overdue | Due, no recent reminders | Send reminder |
| Reminded | Reminder sent, still within useful follow-up window | Wait or remind selectively |
| Chronic | 14+ days overdue or 2+ ignored reminders | Call tenant |

Use existing `reminder_logs.converted_to_payment` to avoid wasting credits.

Output example:

```text
Pending Rent

Fresh overdue
8 tenants
Recommended: Send Reminder

Chronic overdue
4 tenants
Recommended: Call
Why: Reminder conversion is low for this group
```

### 3. Invitation Intelligence

Rank invitations by expiry and activation state.

Signals:

- Expires today.
- Opened but not activated.
- Activation started but stalled.
- Reserved room still blocked.

Actions:

- Resend invitation.
- Call tenant.
- More.

Data sources:

- `tenant_invitations`
- `tenant_invitation_reservations`
- `tenants`
- `rooms`

### 4. Move-Out Intelligence

WhatsApp should surface blockers, not manage the whole exit process.

Signals:

- Request waiting for owner review.
- Inspection missing.
- Settlement awaiting approval.
- Payment pending.
- Dispute open.

Actions:

- Review.
- Call tenant.
- More.

Complex settlement edits and dispute resolution stay in HMS.

Data sources:

- `move_out_requests`
- `move_out_inspections`
- `exit_settlement_transactions`
- `exit_disputes`
- `tenants`

### 5. Vacancy Revenue Alerts

Vacancy alerts should frame empty beds as money at risk.

Computation:

```text
vacant_beds * room.base_rent
```

When `base_rent` is missing, show bed count without revenue estimate.

Example:

```text
Vacancy Opportunity

Room G1
2 beds vacant
Money at risk Rs. 8,000/month
Vacant for 21 days

Recommended:
Invite Tenant

Why:
Vacant for 12 days
```

Data sources:

- `rooms`
- `room_allocations`
- `hostels`

### 6. Daily Briefing V2

The morning briefing should show one primary action.
It should use the top item from the Priority Action Queue instead of separate briefing logic.

Example:

```text
Good Morning

Today's Biggest Opportunity

Rs. 38,000 pending from 4 chronic tenants.

Recommended:
Call these tenants today.

Why:
Repeated reminders are unlikely to recover this group.

Also waiting:
1 settlement approval
2 invitations expiring
```

Buttons:

- `View Tenants`

The briefing should use the same ranking model as the Priority Action Queue.

All-clear mode:

```text
Good Morning

Everything looks healthy today.

No chronic dues
No pending settlements
No expiring invitations

Today's focus:
Monitor new admissions.
```

Buttons:

- `Open HMS`

Use all-clear mode when there are no P0 or P1 action items.

## Data Ownership

| Area | Existing source of truth |
|---|---|
| Rent due | `rent_obligations`, `payments` |
| Reminder history | `reminder_logs` |
| Tenant risk | `tenant_behavior_scores` |
| Invitations | `tenant_invitations`, `tenant_invitation_reservations` |
| Move-outs | `move_out_requests`, inspections, settlements, disputes |
| Vacancies | `rooms`, `room_allocations` |
| Message credits | `message_packs`, `message_logs` |
| WhatsApp audit | `whatsapp_logs`, `owner_assistant_messages` |

No V3.2 feature should require a new table.

## Release Order

### Release 1: Priority Action Queue

Ship `ACTIONS`, `TODAY`, `INBOX`, and `PRIORITIES` as aliases for the ranked queue.

Minimum signals:

- chronic overdue tenant
- invitation expiring today
- move-out awaiting owner action
- vacant room with estimated revenue loss

### Release 2: Collection Intelligence

Upgrade `DUES` to rank collection work:

- fresh overdue
- reminded
- chronic
- reminder conversion context
- credit cost preview

### Release 3: Tenant Decision Card V2

Upgrade tenant cards to show:

- recommended action
- why this is important
- money at risk when available
- dynamic buttons

### Release 4: Invitation Intelligence

Upgrade `INVITATIONS` and invite-related action rows:

- expiring today
- opened but not activated
- activation started but stalled

Deploy and observe real owner usage for 1-2 weeks after Release 4.

Do not continue to Release 5 until collections and admissions are excellent in production.

### Release 5: Move-Out Intelligence

Surface move-out blockers:

- review required
- inspection missing
- settlement awaiting approval
- dispute open

### Release 6: Vacancy Revenue Alerts

Upgrade `VACANCIES` and priority queue vacancy rows with:

- vacant beds
- estimated revenue loss
- invite action

### Release 7: Daily Briefing V2

Make the scheduled briefing use the single top priority from `ACTIONS`.

## Scope Freeze

V3.2 scope is frozen to the seven releases above.

Reject new WhatsApp Assistant ideas until these releases ship:

1. Priority Action Queue
2. Collection Intelligence
3. Tenant Decision Card V2
4. Invitation Intelligence
5. Move-Out Intelligence
6. Vacancy Revenue Alerts
7. Daily Briefing V2

Allowed changes during V3.2 are limited to implementation details needed to ship these releases safely.

## Non-Goals

V3.2 must not include:

- AI chatbot behavior
- predictive scoring
- new database tables
- dashboard reports
- revenue dashboards
- occupancy dashboards
- analytics screens
- complaint management workflows
- document review workflows
- complex settlement editing

When work is complex, WhatsApp should explain why it matters and send the owner to HMS.

## Success Criteria

V3.2 succeeds when an owner can:

1. Open WhatsApp.
2. Type `ACTIONS` or read the morning briefing.
3. See the highest-priority work first.
4. Take the recommended action in one tap.
5. Move to the next item without opening HMS unless the task requires it.
