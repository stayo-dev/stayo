# Enums

This file documents exact Prisma enum values from `apps/backend/prisma/schema.prisma` plus important string-coded statuses.

## AdvanceLedgerReason

| Value | Meaning |
|---|---|
| DEPOSIT | Tenant deposit or advance entry. |
| TOPUP | Additional advance balance added. |
| ADJUSTMENT | Balance adjusted against another amount. |
| DEDUCTION | Balance reduced for charges or settlement. |
| REFUND | Money returned to tenant. |
| CORRECTION | Manual correction entry. |

**How this works:**
1. Prisma restricts this field to the values listed above.
2. Services write these values during business workflows.
3. UI badges and filters should handle every value exactly as spelled.

## AdvanceLedgerType

| Value | Meaning |
|---|---|
| CREDIT | Adds value to a ledger balance. |
| DEBIT | Removes value from a ledger balance. |

**How this works:**
1. Prisma restricts this field to the values listed above.
2. Services write these values during business workflows.
3. UI badges and filters should handle every value exactly as spelled.

## AttemptStatus

| Value | Meaning |
|---|---|
| CREATED | Record was created. |
| PENDING | Work or payment is waiting. |
| PENDING_VERIFICATION | Verification is waiting. |
| PROCESSING | Provider or service is processing. |
| SUCCESS | Operation succeeded. |
| FAILED | Operation failed. |
| EXPIRED | Record expired. |
| CANCELLED | Record was cancelled. |
| PENDING_MANUAL_CONFIRMATION | Owner or admin confirmation is waiting. |

**How this works:**
1. Prisma restricts this field to the values listed above.
2. Services write these values during business workflows.
3. UI badges and filters should handle every value exactly as spelled.

## PaymentStatus

| Value | Meaning |
|---|---|
| PENDING | Work or payment is waiting. |
| PARTIAL | Part of the amount is paid. |
| PAID | Full amount is paid. |
| WAIVED | Amount was waived. |

**How this works:**
1. Prisma restricts this field to the values listed above.
2. Services write these values during business workflows.
3. UI badges and filters should handle every value exactly as spelled.

## PaymentFrequency

| Value | Meaning |
|---|---|
| MONTHLY | Billed every month. |
| QUARTERLY | Billed every three months. |
| HALF_YEARLY | Billed every six months. |
| ACADEMIC_YEARLY | Billed for the academic year. |
| CUSTOM_INSTALLMENTS | Billed through custom installments. |

**How this works:**
1. Prisma restricts this field to the values listed above.
2. Services write these values during business workflows.
3. UI badges and filters should handle every value exactly as spelled.

## BillingPlanStatus

| Value | Meaning |
|---|---|
| ACTIVE | Currently active. |
| SUPERSEDED | Replaced by a newer record. |
| CANCELLED | Record was cancelled. |
| PENDING | Work or payment is waiting. |

**How this works:**
1. Prisma restricts this field to the values listed above.
2. Services write these values during business workflows.
3. UI badges and filters should handle every value exactly as spelled.

## FrequencyChangeStatus

| Value | Meaning |
|---|---|
| PENDING | Work or payment is waiting. |
| APPROVED | Request was approved. |
| REJECTED | Request was rejected. |
| CANCELLED | Record was cancelled. |

**How this works:**
1. Prisma restricts this field to the values listed above.
2. Services write these values during business workflows.
3. UI badges and filters should handle every value exactly as spelled.

## BillingTransitionStrategy

| Value | Meaning |
|---|---|
| NEXT_BILLING_PERIOD | Change applies at next billing period. |
| NEXT_ACADEMIC_CYCLE | Change applies at next academic cycle. |

**How this works:**
1. Prisma restricts this field to the values listed above.
2. Services write these values during business workflows.
3. UI badges and filters should handle every value exactly as spelled.

## Role

| Value | Meaning |
|---|---|
| ADMIN | Platform admin user. |
| OWNER | Hostel owner user. |
| WARDEN | Operational hostel staff user. |
| TENANT | Tenant portal user. |

**How this works:**
1. Prisma restricts this field to the values listed above.
2. Services write these values during business workflows.
3. UI badges and filters should handle every value exactly as spelled.

## TenantStatus

| Value | Meaning |
|---|---|
| INVITED | Tenant has an invitation. |
| ACTIVE | Currently active. |
| MOVE_OUT_REQUESTED | Tenant has an active move-out request. |
| LEFT | Tenant has left. |
| EXPIRED | Record expired. |
| CANCELLED | Record was cancelled. |

**How this works:**
1. Prisma restricts this field to the values listed above.
2. Services write these values during business workflows.
3. UI badges and filters should handle every value exactly as spelled.

## MoveOutStatus

| Value | Meaning |
|---|---|
| REQUESTED | Move-out was requested. |
| INSPECTION_PENDING | Inspection is waiting. |
| INSPECTION_DONE | Inspection is complete. |
| SETTLEMENT_APPROVED | Settlement is approved. |
| PAYMENT_PENDING | Payment or refund is waiting. |
| DISPUTED | Settlement is disputed. |
| COMPLETED | Workflow is complete. |
| CANCELLED | Record was cancelled. |
| REJECTED | Request was rejected. |

**How this works:**
1. Prisma restricts this field to the values listed above.
2. Services write these values during business workflows.
3. UI badges and filters should handle every value exactly as spelled.

## MoveOutReason

| Value | Meaning |
|---|---|
| COURSE_COMPLETED | Tenant finished the course. |
| JOB_RELOCATION | Tenant is relocating for work. |
| TOO_EXPENSIVE | Tenant says cost is too high. |
| POOR_MAINTENANCE | Tenant cites maintenance issues. |
| FOOD_QUALITY | Tenant cites food quality. |
| ROOMMATE_ISSUES | Tenant cites roommate issues. |
| BETTER_HOSTEL | Tenant found a better hostel. |
| PERSONAL_REASONS | Tenant cites personal reasons. |
| SAFETY_CONCERNS | Tenant cites safety concerns. |
| RULES_TOO_STRICT | Tenant cites strict rules. |
| MOVING_CLOSER | Tenant is moving closer to another location. |
| OTHER | Reason is not listed. |

**How this works:**
1. Prisma restricts this field to the values listed above.
2. Services write these values during business workflows.
3. UI badges and filters should handle every value exactly as spelled.

## String-coded statuses

| Area | Values seen | Source |
|---|---|---|
| Bulk import | `PENDING` and import workflow strings | `bulk_import_batches.status` |
| Documents | Pending, approved, and rejected style strings | `identificationDocument.document_status` |
| Notifications | Read and delivery status strings | `notifications`, `reminder_logs` |
| Reconciliation | Open and resolved style strings | Financial reconciliation models |
| Expenses | `paid` and other payment status strings | `expenses.status` |
| Admissions leads | `NEW`, `INTERESTED`, `FOLLOW_UP`, `READY_TO_JOIN`, `INVITED`, `JOINED`, `LOST` | `visitor_leads.status` |
| Decision maker | `STUDENT`, `PARENT`, `BOTH` | `visitor_leads.decision_maker_type` |
| Lead activity | `VIEW_HOSTEL`, `VIEW_ROOM`, `VIEW_PRICING`, `VIEW_RULES`, `VIEW_FACILITIES`, `VIEW_FOOD`, `MARK_INTEREST`, `SHARE_LINK`, `REQUEST_JOIN`, `RESERVE_ROOM` | `lead_activities.activity_type` |
| Lost reason | `TOO_EXPENSIVE`, `NO_VACANCY`, `FOOD_CONCERN`, `LOCATION`, `PARENT_REJECTED`, `JOINED_OTHER_HOSTEL`, `NO_RESPONSE`, `COLLEGE_CHANGED`, `OTHER` | `visitor_leads.lost_reason` |
| Room reservation | `ACTIVE`, `EXPIRED`, `CANCELLED`, `CONVERTED` | `room_reservations.status` |

**How this works:**
1. Some statuses are plain strings instead of Prisma enums.
2. Services and UI must agree on exact spelling.
3. A rebuild should convert high-risk strings into enums where possible.

> **Needs clarification:** Several status fields are plain `String` in Prisma. The complete accepted value set must be confirmed from production data before strict validation.
