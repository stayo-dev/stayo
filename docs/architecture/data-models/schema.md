# Schema

This file documents every Prisma model found in `apps/backend/prisma/schema.prisma`. It is generated from the schema shape, then explained for rebuild use.

**How this works:**
1. Prisma models define the database entities.
2. API services read and write these models through Prisma Client.
3. Screens render the resulting owner, tenant, room, and payment data.

## actionLog

actionLog represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| owner_id | String | yes | Foreign key or scoped identifier. |
| action | String | yes | Domain field persisted by the application. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |

**Relationships:**
- No explicit Prisma relation field is declared in this model.

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## activity_logs

activity_logs represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| user_id | String | yes | Foreign key or scoped identifier. |
| owner_id | String? | no | Foreign key or scoped identifier. |
| action_type | String | yes | Domain field persisted by the application. |
| entity_type | String | yes | Domain field persisted by the application. |
| entity_id | String? | no | Foreign key or scoped identifier. |
| metadata | Json? | no | Flexible JSON configuration or metadata. |
| timestamp | DateTime | no | Domain field persisted by the application. Has a database default. |

**Relationships:**
- No explicit Prisma relation field is declared in this model.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| action_type | See enum docs or service code for accepted values. |
| entity_type | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## bulk_import_batches

bulk_import_batches represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| owner_id | String | yes | Foreign key or scoped identifier. |
| hostel_id | String? | no | Optional hostel reference for search and filtering only. |
| filename | String | yes | Domain field persisted by the application. |
| file_size | Int? | no | Domain field persisted by the application. |
| total_rows | Int | no | Domain field persisted by the application. Has a database default. |
| valid_rows | Int | no | Domain field persisted by the application. Has a database default. |
| failed_rows | Int | no | Domain field persisted by the application. Has a database default. |
| imported_rows | Int | no | Domain field persisted by the application. Has a database default. |
| duplicate_rows | Int | no | Domain field persisted by the application. Has a database default. |
| status | String | no | Domain field persisted by the application. Has a database default. |
| validation_errors | Json? | no | Flexible JSON configuration or metadata. |
| import_summary | Json? | no | Flexible JSON configuration or metadata. |
| import_source_version | String | no | Domain field persisted by the application. Has a database default. |
| uploaded_by | String | yes | Domain field persisted by the application. |
| uploaded_at | DateTime | no | Domain field persisted by the application. Has a database default. |
| validated_at | DateTime? | no | Domain field persisted by the application. |
| imported_at | DateTime? | no | Domain field persisted by the application. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| updated_at | DateTime? | no | Last update timestamp. |
| hostels | hostels | yes | Domain field persisted by the application. Prisma relation field. |
| profiles_bulk_import_batches_uploaded_byToprofiles | profile | yes | Domain field persisted by the application. Prisma relation field. |
| profiles_profiles_import_batch_idTobulk_import_batches | profile[] | no | Domain field persisted by the application. Prisma relation field. |

**Relationships:**
- relates to hostels through hostels.
- relates to profile through profiles_bulk_import_batches_uploaded_byToprofiles.
- relates to profile through profiles_profiles_import_batch_idTobulk_import_batches.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| status | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## complaints

complaints represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| tenant_id | String | yes | Foreign key or scoped identifier. |
| owner_id | String | yes | Foreign key or scoped identifier. |
| title | String | yes | Domain field persisted by the application. |
| description | String | yes | Domain field persisted by the application. |
| category | String | yes | Domain field persisted by the application. |
| status | String | no | Domain field persisted by the application. Has a database default. |
| priority | String | no | Domain field persisted by the application. Has a database default. |
| resolved_at | DateTime? | no | Domain field persisted by the application. |
| comment | String? | no | Domain field persisted by the application. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| updated_at | DateTime? | no | Last update timestamp. |
| hostel_id | String | yes | Foreign key or scoped identifier. |
| hostels | hostels | yes | Domain field persisted by the application. Prisma relation field. |
| tenants | tenants | yes | Domain field persisted by the application. Prisma relation field. |

**Relationships:**
- relates to hostels through hostels.
- relates to tenants through tenants.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| status | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## expenses

expenses represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| owner_id | String | yes | Foreign key or scoped identifier. |
| title | String | yes | Domain field persisted by the application. |
| amount | Decimal | yes | Money or percentage value. |
| date | DateTime | yes | Domain field persisted by the application. |
| category | String | yes | Domain field persisted by the application. |
| status | String? | no | Domain field persisted by the application. Has a database default. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| hostel_id | String | yes | Foreign key or scoped identifier. |
| notes | String? | no | Domain field persisted by the application. |
| vendor_name | String? | no | Domain field persisted by the application. |
| payment_method | String? | no | Domain field persisted by the application. |
| receipt_url | String? | no | Domain field persisted by the application. |
| receipt_uploaded_at | DateTime? | no | Domain field persisted by the application. |
| is_recurring | Boolean | no | Boolean flag. Has a database default. |
| recurring_frequency | String? | no | Domain field persisted by the application. |

**Relationships:**
- belongs to profile via owner_id.
- optionally references hostels via hostel_id.

**How this works:**
1. Expenses belong to the Sri Adithya business account.
2. `hostel_id` can label where a cost happened.
3. Profit, category, and vendor totals do not allocate costs by hostel.

## VisitorLead

VisitorLead represents a hostel admissions prospect before they become a tenant invitation.

| Field | Type | Required | Description |
|---|---|---|---|
| id | string | yes | Unique lead identifier. |
| hostel_id | string | yes | Hostel the visitor scanned or explored. |
| owner_id | string | yes | Owner who manages the lead. |
| student_name | string | yes | Student name entered by the visitor. |
| student_phone | string | yes | Normalized student phone number. |
| student_email | string | no | Optional during capture, required for invitation conversion. |
| parent_name | string | no | Parent or guardian name. |
| parent_phone | string | no | Parent or guardian phone number. |
| decision_maker_type | string | yes | STUDENT, PARENT, or BOTH. |
| source | string | yes | QR, DIRECT, or WALKIN. |
| status | string | yes | Current admissions stage. |
| notes | string | no | General lead notes. |
| lead_score | number | yes | Score derived from activity. |
| first_visited_at | DateTime | yes | First capture timestamp. |
| last_activity_at | DateTime | yes | Latest visitor or owner activity. |
| parent_contacted_at | DateTime | no | Last parent contact timestamp. |
| parent_follow_up_required | boolean | yes | Whether parent follow-up is pending. |
| converted_at | DateTime | no | Time the lead entered invitation flow. |
| converted_tenant_id | string | no | Tenant created by the existing invitation service. |
| lost_reason | string | no | Structured lost reason. |
| lost_note | string | no | Optional custom lost note. |
| preferred_floor_id | string | no | Floor the tenant asked for on the enquiry (migration 077). A preference, never a reservation — no bed is held. |
| preferred_room_id | string | no | Room the tenant asked for on the enquiry (migration 077). Same caveat: a preference only, re-checked for real availability when the owner reviews the lead, never assumed still free. |

**Relationships:**
- belongs to hostels via hostel_id.
- belongs to profile via owner_id.
- has many LeadActivity via lead_id.
- has many LeadNote via lead_id.
- has many RoomReservation via lead_id.
- may connect to tenants via converted_tenant_id.
- may connect to a Floor via preferred_floor_id (`ON DELETE SET NULL`).
- may connect to a Room via preferred_room_id (`ON DELETE SET NULL`).

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| NEW | Visitor submitted basic details. |
| INTERESTED | Visitor expressed interest. |
| FOLLOW_UP | Owner needs to follow up. |
| READY_TO_JOIN | Visitor requested admission or is ready. |
| INVITED | Existing invitation flow has started. |
| JOINED | Tenant activation completed. |
| LOST | Lead did not convert. |

**How this works:**
1. Lead capture creates a prospect without profile or tenant records.
2. Owner conversion calls the existing invitation service.
3. Activation updates the connected lead to JOINED.

## LeadActivity

LeadActivity records visitor behavior and owner-visible engagement.

| Field | Type | Required | Description |
|---|---|---|---|
| id | string | yes | Unique activity identifier. |
| lead_id | string | yes | Lead that performed the activity. |
| activity_type | string | yes | Visitor action type. |
| metadata | Json | no | Room id or context for the activity. |
| created_at | DateTime | yes | Activity timestamp. |

**Relationships:**
- belongs to VisitorLead via lead_id.

**How this works:**
1. Public actions write activity records.
2. Scored actions increment VisitorLead.lead_score.
3. Owner screens use the timeline to prioritize follow-up.

## RoomReservation

RoomReservation represents admission intent, not a room allocation.

| Field | Type | Required | Description |
|---|---|---|---|
| id | string | yes | Unique reservation identifier. |
| lead_id | string | yes | Lead that requested the reservation. |
| room_id | string | yes | Room being held as intent. |
| hostel_id | string | yes | Hostel context for the room. |
| reserved_until | DateTime | yes | Expiry timestamp. |
| status | string | yes | ACTIVE, EXPIRED, CANCELLED, or CONVERTED. |
| approved_by | string | no | Owner who created the hold. |
| converted_at | DateTime | no | Time reservation converted into invitation. |

**Relationships:**
- belongs to VisitorLead via lead_id.
- belongs to rooms via room_id.
- belongs to hostels via hostel_id.
- belongs to profile via approved_by.

**How this works:**
1. Reservation checks existing allocations and active reservations.
2. It never writes RoomAllocation.
3. Invitation conversion may mark the reservation CONVERTED.

## LeadNote

LeadNote stores owner follow-up context.

| Field | Type | Required | Description |
|---|---|---|---|
| id | string | yes | Unique note identifier. |
| lead_id | string | yes | Lead being discussed. |
| owner_id | string | yes | Owner who wrote the note. |
| note | string | yes | Follow-up note text. |
| created_at | DateTime | yes | Note timestamp. |

**Relationships:**
- belongs to VisitorLead via lead_id.
- belongs to profile via owner_id.

**How this works:**
1. Owners record parent calls and concerns.
2. Notes stay attached to the lead workspace.
3. Future developers can rebuild follow-up history from this table.
| created_by | String? | no | Domain field persisted by the application. |
| approved_by | String? | no | Domain field persisted by the application. |
| expense_type | String | no | Domain field persisted by the application. Has a database default. |
| tags | String[] | no | Domain field persisted by the application. Has a database default. |
| metadata | Json? | no | Flexible JSON configuration or metadata. |
| hostels | hostels | yes | Domain field persisted by the application. Prisma relation field. |
| profiles | profile | yes | Domain field persisted by the application. Prisma relation field. |

**Relationships:**
- relates to hostels through hostels.
- relates to profile through profiles.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| status | See enum docs or service code for accepted values. |
| recurring_frequency | See enum docs or service code for accepted values. |
| expense_type | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## financial_invariant_failures

financial_invariant_failures represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| invariant_type | String | yes | Domain field persisted by the application. |
| severity | String | yes | Domain field persisted by the application. |
| entity_type | String | yes | Domain field persisted by the application. |
| entity_id | String? | no | Foreign key or scoped identifier. |
| expected_value | String? | no | Domain field persisted by the application. |
| actual_value | String? | no | Domain field persisted by the application. |
| owner_id | String? | no | Foreign key or scoped identifier. |
| hostel_id | String? | no | Foreign key or scoped identifier. |
| reconciliation_attempts | Int | no | Domain field persisted by the application. Has a database default. |
| status | String | no | Domain field persisted by the application. Has a database default. |
| details | Json? | no | Flexible JSON configuration or metadata. |
| detected_at | DateTime | no | Domain field persisted by the application. Has a database default. |
| resolved_at | DateTime? | no | Domain field persisted by the application. |

**Relationships:**
- No explicit Prisma relation field is declared in this model.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| invariant_type | See enum docs or service code for accepted values. |
| entity_type | See enum docs or service code for accepted values. |
| status | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## hostel_daily_snapshots

hostel_daily_snapshots represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| hostel_id | String | yes | Foreign key or scoped identifier. |
| snapshot_date | DateTime | yes | Domain field persisted by the application. |
| occupancy_rate | Decimal | no | Money or percentage value. Has a database default. |
| active_tenants | Int | no | Domain field persisted by the application. Has a database default. |
| expected_revenue | Decimal | no | Money or percentage value. Has a database default. |
| collected_revenue | Decimal | no | Money or percentage value. Has a database default. |
| pending_dues | Decimal | no | Money or percentage value. Has a database default. |
| overdue_count | Int | no | Domain field persisted by the application. Has a database default. |
| collection_rate | Decimal | no | Money or percentage value. Has a database default. |
| expenses | Decimal | no | Money or percentage value. Has a database default. |
| profit | Decimal | no | Money or percentage value. Has a database default. |
| source_hash | String? | no | Domain field persisted by the application. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |

**Relationships:**
- No explicit Prisma relation field is declared in this model.

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## hostel_invariant_checks

hostel_invariant_checks represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| check_type | String | yes | Domain field persisted by the application. |
| entity_type | String | yes | Domain field persisted by the application. |
| entity_id | String? | no | Foreign key or scoped identifier. |
| expected_value | String? | no | Domain field persisted by the application. |
| actual_value | String? | no | Domain field persisted by the application. |
| is_valid | Boolean | no | Boolean flag. Has a database default. |
| details | Json? | no | Flexible JSON configuration or metadata. |
| checked_at | DateTime | no | Domain field persisted by the application. Has a database default. |

**Relationships:**
- No explicit Prisma relation field is declared in this model.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| check_type | See enum docs or service code for accepted values. |
| entity_type | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## hostels

hostels represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | no | Primary identifier. Has a database default. |
| owner_id | String | yes | Foreign key or scoped identifier. |
| name | String | yes | Domain field persisted by the application. |
| phone | String | yes | Domain field persisted by the application. |
| address | String | yes | Domain field persisted by the application. |
| city | String? | no | Domain field persisted by the application. |
| state | String? | no | Domain field persisted by the application. |
| pincode | String? | no | Domain field persisted by the application. |
| upi_id | String? | no | Foreign key or scoped identifier. |
| gst_number | String? | no | Domain field persisted by the application. |
| is_active | Boolean | no | Boolean flag. Has a database default. |
| currency | String | no | Domain field persisted by the application. Has a database default. |
| rent_cycle | String | no | Domain field persisted by the application. Has a database default. |
| receipt_prefix | String | no | Domain field persisted by the application. Has a database default. |
| timezone | String | no | Domain field persisted by the application. Has a database default. |
| auto_rent_day | Int | no | Domain field persisted by the application. Has a database default. |
| phonepe_merchant_id | String? | no | Foreign key or scoped identifier. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| updated_at | DateTime? | no | Last update timestamp. |
| logo_url | String? | no | Domain field persisted by the application. |
| preferences_config | Json? | no | Flexible JSON configuration or metadata. |
| bulk_import_batches | bulk_import_batches[] | no | Domain field persisted by the application. |
| complaints | complaints[] | no | Domain field persisted by the application. |
| rule_acceptances | TenantPolicyAcceptance[] | no | Domain field persisted by the application. |
| expenses | expenses[] | no | Domain field persisted by the application. |
| rule_versions | RuleVersion[] | no | Domain field persisted by the application. |
| profiles | profile | yes | Domain field persisted by the application. Prisma relation field. |
| payments | payments[] | no | Domain field persisted by the application. |
| receipts | receipts[] | no | Domain field persisted by the application. |
| reminder_logs | reminder_logs[] | no | Domain field persisted by the application. |
| rent_obligations | rent_obligations[] | no | Domain field persisted by the application. |
| room_allocations | roomAllocation[] | no | Domain field persisted by the application. |
| rooms | rooms[] | no | Domain field persisted by the application. |
| floors | floors[] | no | Domain field persisted by the application. |
| tenants | tenants[] | no | Domain field persisted by the application. |
| move_out_requests | move_out_requests[] | no | Domain field persisted by the application. |

**Relationships:**
- relates to bulk_import_batches through bulk_import_batches.
- relates to complaints through complaints.
- relates to expenses through expenses.
- relates to profile through profiles.
- relates to payments through payments.
- relates to receipts through receipts.
- relates to reminder_logs through reminder_logs.
- relates to rent_obligations through rent_obligations.
- relates to roomAllocation through room_allocations.
- relates to rooms through rooms.
- relates to floors through floors.
- relates to tenants through tenants.
- relates to move_out_requests through move_out_requests.

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## identity_tokens

identity_tokens represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| jti | String | yes | Primary identifier. |
| user_id | String | yes | Foreign key or scoped identifier. |
| purpose | String | yes | Domain field persisted by the application. |
| action | String | yes | Domain field persisted by the application. |
| expires_at | DateTime | yes | Domain field persisted by the application. |
| used | Boolean | no | Boolean flag. Has a database default. |
| used_at | DateTime? | no | Domain field persisted by the application. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |

**Relationships:**
- No explicit Prisma relation field is declared in this model.

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## identificationDocument

identificationDocument represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | no | Primary identifier. Has a database default. |
| tenant_id | String | yes | Foreign key or scoped identifier. |
| doc_type | String | yes | Domain field persisted by the application. |
| doc_number | String? | no | Domain field persisted by the application. |
| file_url | String | yes | Domain field persisted by the application. |
| file_path | String? | no | Domain field persisted by the application. |
| file_id | String? | no | Foreign key or scoped identifier. |
| mime_type | String | yes | Domain field persisted by the application. |
| file_size | Int | yes | Domain field persisted by the application. |
| document_status | String | no | Domain field persisted by the application. Has a database default. |
| is_verified | Boolean | no | Boolean flag. Has a database default. |
| is_active | Boolean | no | Boolean flag. Has a database default. |
| uploaded_by | String? | no | Domain field persisted by the application. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| updated_at | DateTime? | no | Last update timestamp. |
| rejection_reason | String? | no | Domain field persisted by the application. |
| approved_by | String? | no | Domain field persisted by the application. |
| approved_at | DateTime? | no | Domain field persisted by the application. |
| rejected_by | String? | no | Domain field persisted by the application. |
| rejected_at | DateTime? | no | Domain field persisted by the application. |
| reject_ip | String? | no | Domain field persisted by the application. |
| tenant | tenants | yes | Domain field persisted by the application. Prisma relation field. |

**Relationships:**
- relates to tenants through tenant.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| doc_type | See enum docs or service code for accepted values. |
| mime_type | See enum docs or service code for accepted values. |
| document_status | See enum docs or service code for accepted values. |
| rejection_reason | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## login_attempts

login_attempts represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| identifier | String | yes | Domain field persisted by the application. |
| ip_address | String? | no | Domain field persisted by the application. |
| attempt_type | String | yes | Domain field persisted by the application. |
| success | Boolean | no | Boolean flag. Has a database default. |
| failure_reason | String? | no | Domain field persisted by the application. |
| user_agent | String? | no | Domain field persisted by the application. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |

**Relationships:**
- No explicit Prisma relation field is declared in this model.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| attempt_type | See enum docs or service code for accepted values. |
| failure_reason | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## message_logs

message_logs represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| owner_id | String? | no | Foreign key or scoped identifier. |
| sent_at | DateTime | no | Domain field persisted by the application. Has a database default. |
| channel | String? | no | Domain field persisted by the application. |
| template | String? | no | Domain field persisted by the application. |
| recipient | String? | no | Domain field persisted by the application. |
| success | Boolean? | no | Domain field persisted by the application. |
| status | String | no | Domain field persisted by the application. Has a database default. |
| idempotency_key | String? | no | Domain field persisted by the application. |
| pack_id | String? | no | Foreign key or scoped identifier. |
| deduction | Int | no | Domain field persisted by the application. Has a database default. |
| provider_response | String? | no | Domain field persisted by the application. |

**Relationships:**
- No explicit Prisma relation field is declared in this model.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| status | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## message_packs

message_packs represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| owner_id | String | yes | Foreign key or scoped identifier. |
| purchased_at | DateTime | no | Domain field persisted by the application. Has a database default. |
| messages_total | Int | yes | Domain field persisted by the application. |
| messages_remaining | Int | yes | Domain field persisted by the application. |
| price_inr | Int | yes | Domain field persisted by the application. |
| notes | String? | no | Domain field persisted by the application. |

**Relationships:**
- No explicit Prisma relation field is declared in this model.

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## migration_audit_runs

migration_audit_runs represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| audit_date | DateTime | no | Domain field persisted by the application. Has a database default. |
| artifact_path | String | yes | Domain field persisted by the application. |
| orphan_count | Int | no | Domain field persisted by the application. Has a database default. |
| mismatch_count | Int | no | Domain field persisted by the application. Has a database default. |
| unresolved_records_count | Int | no | Domain field persisted by the application. Has a database default. |
| corrected_records_count | Int | no | Domain field persisted by the application. Has a database default. |
| corruption_candidates_count | Int | no | Domain field persisted by the application. Has a database default. |
| hostel_rollup_validation | Json? | no | Flexible JSON configuration or metadata. |
| summary | Json? | no | Flexible JSON configuration or metadata. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |

**Relationships:**
- No explicit Prisma relation field is declared in this model.

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## notifications

notifications represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| profile_id | String | yes | Foreign key or scoped identifier. |
| title | String | yes | Domain field persisted by the application. |
| message | String | yes | Domain field persisted by the application. |
| type | String | yes | Domain field persisted by the application. |
| is_read | Boolean | no | Boolean flag. Has a database default. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| profiles | profile | yes | Domain field persisted by the application. Prisma relation field. |

**Relationships:**
- relates to profile through profiles.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| type | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## owner_dashboard_snapshots

owner_dashboard_snapshots represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| owner_id | String | yes | Primary identifier. |
| snapshot_month | DateTime | yes | Domain field persisted by the application. |
| tenant_count | Int | no | Domain field persisted by the application. Has a database default. |
| active_tenant_count | Int | no | Domain field persisted by the application. Has a database default. |
| total_room_count | Int | no | Domain field persisted by the application. Has a database default. |
| total_capacity | Int | no | Domain field persisted by the application. Has a database default. |
| vacant_beds | Int | no | Domain field persisted by the application. Has a database default. |
| occupancy_rate | Int | no | Domain field persisted by the application. Has a database default. |
| rent_collected_month | Decimal | no | Money or percentage value. Has a database default. |
| expenses_month | Decimal | no | Money or percentage value. Has a database default. |
| pending_dues | Decimal | no | Money or percentage value. Has a database default. |
| overdue_total | Decimal | no | Money or percentage value. Has a database default. |
| overdue_count | Int | no | Domain field persisted by the application. Has a database default. |
| collection_rate | Int | no | Domain field persisted by the application. Has a database default. |
| monthly_trend | Json? | no | Flexible JSON configuration or metadata. |
| monthly_trend_months | Int | no | Domain field persisted by the application. Has a database default. |
| stats_computed_at | DateTime? | no | Domain field persisted by the application. |
| monthly_computed_at | DateTime? | no | Domain field persisted by the application. |
| is_stale | Boolean | no | Boolean flag. Has a database default. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| updated_at | DateTime | yes | Last update timestamp. |

**Relationships:**
- No explicit Prisma relation field is declared in this model.

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## payment_attempt_obligations

payment_attempt_obligations represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| payment_attempt_id | String | yes | Foreign key or scoped identifier. |
| obligation_id | String | yes | Foreign key or scoped identifier. |
| amount | Decimal | yes | Money or percentage value. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| rent_obligations | rent_obligations | yes | Domain field persisted by the application. Prisma relation field. |
| payment_attempts | paymentAttempt | yes | Domain field persisted by the application. Prisma relation field. |

**Relationships:**
- relates to rent_obligations through rent_obligations.
- relates to paymentAttempt through payment_attempts.

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## payment_attempt_status_events

payment_attempt_status_events represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| payment_attempt_id | String | yes | Foreign key or scoped identifier. |
| transition_sequence | Int | yes | Domain field persisted by the application. |
| from_status | String? | no | Domain field persisted by the application. |
| to_status | String | yes | Domain field persisted by the application. |
| reason | String? | no | Domain field persisted by the application. |
| source | String | yes | Domain field persisted by the application. |
| actor_id | String? | no | Foreign key or scoped identifier. |
| operational_owner_id | String? | no | Foreign key or scoped identifier. |
| financial_owner_id | String? | no | Foreign key or scoped identifier. |
| hostel_id | String? | no | Foreign key or scoped identifier. |
| metadata | Json? | no | Flexible JSON configuration or metadata. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |

**Relationships:**
- No explicit Prisma relation field is declared in this model.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| from_status | See enum docs or service code for accepted values. |
| to_status | See enum docs or service code for accepted values. |
| reason | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## paymentAttempt

paymentAttempt represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| obligation_id | String? | no | Foreign key or scoped identifier. |
| tenant_id | String? | no | Foreign key or scoped identifier. |
| owner_id | String | yes | Foreign key or scoped identifier. |
| provider | String | yes | Domain field persisted by the application. |
| merchant_txn_id | String | yes | Foreign key or scoped identifier. |
| gateway_txn_id | String? | no | Foreign key or scoped identifier. |
| amount | Decimal | yes | Money or percentage value. |
| status | AttemptStatus | no | Domain field persisted by the application. Has a database default. |
| upi_intent_url | String? | no | Domain field persisted by the application. |
| qr_payload | String? | no | Domain field persisted by the application. |
| expires_at | DateTime? | no | Domain field persisted by the application. |
| confirmed_at | DateTime? | no | Domain field persisted by the application. |
| raw_create_response | Json? | no | Flexible JSON configuration or metadata. |
| raw_webhook_payload | Json? | no | Flexible JSON configuration or metadata. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| updated_at | DateTime? | no | Last update timestamp. |
| checkout_url | String? | no | Domain field persisted by the application. |
| payment_type | String | no | Domain field persisted by the application. Has a database default. |
| addon_pack | String? | no | Domain field persisted by the application. |
| manual_confirmed_by | String? | no | Domain field persisted by the application. |
| manual_confirmed_at | DateTime? | no | Domain field persisted by the application. |
| manual_confirm_ip | String? | no | Domain field persisted by the application. |
| hostel_id | String? | no | Foreign key or scoped identifier. |
| payment_domain | String? | no | Domain field persisted by the application. |
| scope_type | String? | no | Domain field persisted by the application. |
| flow_type | String? | no | Domain field persisted by the application. |
| merchant_context_type | String? | no | Domain field persisted by the application. |
| merchant_context_id | String? | no | Foreign key or scoped identifier. |
| settlement_status | String? | no | Domain field persisted by the application. |
| settled_at | DateTime? | no | Domain field persisted by the application. |
| merchant_transaction_id | String? | no | Foreign key or scoped identifier. |
| provider_transaction_id | String? | no | Foreign key or scoped identifier. |
| provider_order_id | String? | no | Foreign key or scoped identifier. |
| provider_reference_id | String? | no | Foreign key or scoped identifier. |
| obligations | payment_attempt_obligations[] | no | Domain field persisted by the application. |
| rent_obligations | rent_obligations? | no | Domain field persisted by the application. Prisma relation field. |
| tenants | tenants? | no | Domain field persisted by the application. Prisma relation field. |
| payments | payments[] | no | Domain field persisted by the application. |

**Relationships:**
- relates to payment_attempt_obligations through obligations.
- relates to rent_obligations through rent_obligations.
- relates to tenants through tenants.
- relates to payments through payments.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| status | See enum docs or service code for accepted values. |
| payment_type | See enum docs or service code for accepted values. |
| scope_type | See enum docs or service code for accepted values. |
| flow_type | See enum docs or service code for accepted values. |
| merchant_context_type | See enum docs or service code for accepted values. |
| settlement_status | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## payment_operational_anomalies

payment_operational_anomalies represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| anomaly_type | String | yes | Domain field persisted by the application. |
| severity | String | yes | Domain field persisted by the application. |
| payment_domain | String? | no | Domain field persisted by the application. |
| flow_type | String? | no | Domain field persisted by the application. |
| payment_attempt_id | String? | no | Foreign key or scoped identifier. |
| payment_id | String? | no | Foreign key or scoped identifier. |
| webhook_event_id | String? | no | Foreign key or scoped identifier. |
| reconciliation_run_id | String? | no | Foreign key or scoped identifier. |
| operational_owner_id | String? | no | Foreign key or scoped identifier. |
| financial_owner_id | String? | no | Foreign key or scoped identifier. |
| hostel_id | String? | no | Foreign key or scoped identifier. |
| status | String | no | Domain field persisted by the application. Has a database default. |
| detected_at | DateTime | no | Domain field persisted by the application. Has a database default. |
| resolved_at | DateTime? | no | Domain field persisted by the application. |
| metadata | Json? | no | Flexible JSON configuration or metadata. |

**Relationships:**
- No explicit Prisma relation field is declared in this model.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| anomaly_type | See enum docs or service code for accepted values. |
| flow_type | See enum docs or service code for accepted values. |
| status | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## payment_provider_verification_snapshots

payment_provider_verification_snapshots represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| provider | String | yes | Domain field persisted by the application. |
| payment_domain | String? | no | Domain field persisted by the application. |
| flow_type | String? | no | Domain field persisted by the application. |
| source | String | yes | Domain field persisted by the application. |
| payment_attempt_id | String? | no | Foreign key or scoped identifier. |
| webhook_event_id | String? | no | Foreign key or scoped identifier. |
| reconciliation_run_id | String? | no | Foreign key or scoped identifier. |
| merchant_transaction_id | String? | no | Foreign key or scoped identifier. |
| provider_transaction_id | String? | no | Foreign key or scoped identifier. |
| provider_order_id | String? | no | Foreign key or scoped identifier. |
| provider_reference_id | String? | no | Foreign key or scoped identifier. |
| provider_status | String? | no | Domain field persisted by the application. |
| normalized_status | String | yes | Domain field persisted by the application. |
| amount | Decimal? | no | Domain field persisted by the application. |
| raw_response | Json? | no | Flexible JSON configuration or metadata. |
| raw_response_hash | String | yes | Domain field persisted by the application. |
| verified_at | DateTime | no | Domain field persisted by the application. Has a database default. |
| operational_owner_id | String? | no | Foreign key or scoped identifier. |
| financial_owner_id | String? | no | Foreign key or scoped identifier. |
| hostel_id | String? | no | Foreign key or scoped identifier. |

**Relationships:**
- No explicit Prisma relation field is declared in this model.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| flow_type | See enum docs or service code for accepted values. |
| provider_status | See enum docs or service code for accepted values. |
| normalized_status | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## payment_reconciliation_items

payment_reconciliation_items represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| reconciliation_run_id | String | yes | Foreign key or scoped identifier. |
| payment_attempt_id | String? | no | Foreign key or scoped identifier. |
| payment_id | String? | no | Foreign key or scoped identifier. |
| anomaly_type | String | yes | Domain field persisted by the application. |
| severity | String | yes | Domain field persisted by the application. |
| action | String | yes | Domain field persisted by the application. |
| result | String | yes | Domain field persisted by the application. |
| operational_owner_id | String? | no | Foreign key or scoped identifier. |
| financial_owner_id | String? | no | Foreign key or scoped identifier. |
| hostel_id | String? | no | Foreign key or scoped identifier. |
| metadata | Json? | no | Flexible JSON configuration or metadata. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |

**Relationships:**
- No explicit Prisma relation field is declared in this model.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| anomaly_type | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## payment_reconciliation_runs

payment_reconciliation_runs represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| payment_domain | String | yes | Domain field persisted by the application. |
| scope_type | String? | no | Domain field persisted by the application. |
| operational_owner_id | String? | no | Foreign key or scoped identifier. |
| financial_owner_id | String? | no | Foreign key or scoped identifier. |
| hostel_id | String? | no | Foreign key or scoped identifier. |
| status | String | no | Domain field persisted by the application. Has a database default. |
| started_at | DateTime | no | Domain field persisted by the application. Has a database default. |
| completed_at | DateTime? | no | Domain field persisted by the application. |
| summary | Json? | no | Flexible JSON configuration or metadata. |
| error_message | String? | no | Domain field persisted by the application. |

**Relationships:**
- No explicit Prisma relation field is declared in this model.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| scope_type | See enum docs or service code for accepted values. |
| status | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## payment_webhook_events

payment_webhook_events represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| provider | String | yes | Domain field persisted by the application. |
| payment_domain | String? | no | Domain field persisted by the application. |
| flow_type | String? | no | Domain field persisted by the application. |
| merchant_context_type | String? | no | Domain field persisted by the application. |
| merchant_context_id | String? | no | Foreign key or scoped identifier. |
| merchant_transaction_id | String? | no | Foreign key or scoped identifier. |
| provider_transaction_id | String? | no | Foreign key or scoped identifier. |
| provider_order_id | String? | no | Foreign key or scoped identifier. |
| provider_reference_id | String? | no | Foreign key or scoped identifier. |
| event_hash | String | yes | Domain field persisted by the application. |
| raw_payload | Json | yes | Flexible JSON configuration or metadata. |
| headers_redacted | Json? | no | Flexible JSON configuration or metadata. |
| received_at | DateTime | no | Domain field persisted by the application. Has a database default. |
| processing_status | String | no | Domain field persisted by the application. Has a database default. |
| processing_result | Json? | no | Flexible JSON configuration or metadata. |
| payment_attempt_id | String? | no | Foreign key or scoped identifier. |
| operational_owner_id | String? | no | Foreign key or scoped identifier. |
| financial_owner_id | String? | no | Foreign key or scoped identifier. |
| hostel_id | String? | no | Foreign key or scoped identifier. |
| signature_verified | Boolean | no | Boolean flag. Has a database default. |
| signature_algorithm | String? | no | Domain field persisted by the application. |
| signature_failure_reason | String? | no | Domain field persisted by the application. |
| error_message | String? | no | Domain field persisted by the application. |
| processed_at | DateTime? | no | Domain field persisted by the application. |

**Relationships:**
- No explicit Prisma relation field is declared in this model.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| flow_type | See enum docs or service code for accepted values. |
| merchant_context_type | See enum docs or service code for accepted values. |
| processing_status | See enum docs or service code for accepted values. |
| signature_failure_reason | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## payments

payments represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | no | Primary identifier. Has a database default. |
| obligation_id | String | yes | Foreign key or scoped identifier. |
| tenant_id | String | yes | Foreign key or scoped identifier. |
| owner_id | String? | no | Foreign key or scoped identifier. |
| amount_paid | Decimal | yes | Money or percentage value. |
| payment_method | String | yes | Domain field persisted by the application. |
| reference_number | String? | no | Domain field persisted by the application. |
| payment_date | DateTime | yes | Domain field persisted by the application. |
| payment_attempt_id | String? | no | Foreign key or scoped identifier. |
| payment_group_id | String? | no | Foreign key or scoped identifier. |
| idempotency_key | String? | no | Domain field persisted by the application. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| offline_recorded_by | String? | no | Domain field persisted by the application. |
| offline_recorded_at | DateTime? | no | Domain field persisted by the application. |
| offline_recorded_ip | String? | no | Domain field persisted by the application. |
| offline_note | String? | no | Domain field persisted by the application. |
| hostel_id | String | yes | Foreign key or scoped identifier. |
| hostels | hostels | yes | Domain field persisted by the application. Prisma relation field. |
| obligation | rent_obligations | yes | Domain field persisted by the application. Prisma relation field. |
| payment_attempts | paymentAttempt? | no | Domain field persisted by the application. Prisma relation field. |
| tenants | tenants | yes | Domain field persisted by the application. Prisma relation field. |
| receipts | receipts? | no | Domain field persisted by the application. |

**Relationships:**
- relates to hostels through hostels.
- relates to rent_obligations through obligation.
- relates to paymentAttempt through payment_attempts.
- relates to tenants through tenants.
- relates to receipts through receipts.

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## profile

profile represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| email | String | yes | Domain field persisted by the application. |
| name | String | yes | Domain field persisted by the application. |
| phone | String? | no | Domain field persisted by the application. |
| password_hash | String? | no | Domain field persisted by the application. |
| role | Role | yes | Domain field persisted by the application. |
| is_active | Boolean | no | Boolean flag. Has a database default. |
| is_profile_completed | Boolean | no | Boolean flag. Has a database default. |
| address | String? | no | Domain field persisted by the application. |
| city | String? | no | Domain field persisted by the application. |
| state | String? | no | Domain field persisted by the application. |
| pincode | String? | no | Domain field persisted by the application. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| updated_at | DateTime? | no | Last update timestamp. |
| invitation_token | String? | no | Domain field persisted by the application. |
| invitation_expires_at | DateTime? | no | Domain field persisted by the application. |
| id | String | yes | Primary identifier. |
| owner_id | String? | no | Foreign key or scoped identifier. |
| emergency_contact | String? | no | Domain field persisted by the application. |
| password_reset_required | Boolean | no | Boolean flag. Has a database default. |
| password_reset_at | DateTime? | no | Domain field persisted by the application. |
| is_imported | Boolean | no | Boolean flag. Has a database default. |
| import_batch_id | String? | no | Foreign key or scoped identifier. |
| onboarding_expires_at | DateTime? | no | Domain field persisted by the application. |
| mobile_verified | Boolean | no | Boolean flag. Has a database default. |
| phone_verified | Boolean | no | Boolean flag. Has a database default. |
| bulk_import_batches_bulk_import_batches_uploaded_byToprofiles | bulk_import_batches[] | no | Domain field persisted by the application. Prisma relation field. |
| expenses | expenses[] | no | Domain field persisted by the application. |
| rule_versions | RuleVersion[] | no | Domain field persisted by the application. |
| hostels | hostels[] | no | Domain field persisted by the application. |
| notifications | notifications[] | no | Domain field persisted by the application. |
| bulk_import_batches_profiles_import_batch_idTobulk_import_batches | bulk_import_batches? | no | Domain field persisted by the application. Prisma relation field. |
| profiles | profile? | no | Domain field persisted by the application. Prisma relation field. |
| other_profiles | profile[] | no | Domain field persisted by the application. Prisma relation field. |
| refresh_tokens | refresh_tokens[] | no | Domain field persisted by the application. |
| tenants | tenants? | no | Domain field persisted by the application. |

**Relationships:**
- relates to bulk_import_batches through bulk_import_batches_bulk_import_batches_uploaded_byToprofiles.
- relates to expenses through expenses.
- relates to hostels through hostels.
- relates to notifications through notifications.
- relates to bulk_import_batches through bulk_import_batches_profiles_import_batch_idTobulk_import_batches.
- relates to profile through profiles.
- relates to profile through other_profiles.
- relates to refresh_tokens through refresh_tokens.
- relates to tenants through tenants.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| role | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## PhoneVerificationOtp

PhoneVerificationOtp represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | no | Primary identifier. Has a database default. |
| phone | String | yes | Domain field persisted by the application. |
| otp_hash | String | yes | Domain field persisted by the application. |
| purpose | String | yes | Domain field persisted by the application. |
| status | String | no | Domain field persisted by the application. Has a database default. |
| attempts | Int | no | Domain field persisted by the application. Has a database default. |
| max_attempts | Int | no | Domain field persisted by the application. Has a database default. |
| expires_at | DateTime | yes | Domain field persisted by the application. |
| verified_at | DateTime? | no | Domain field persisted by the application. |
| meta_message_id | String? | no | Foreign key or scoped identifier. |
| provider_status | String? | no | Domain field persisted by the application. |
| failure_reason | String? | no | Domain field persisted by the application. |
| request_ip | String? | no | Domain field persisted by the application. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |

**Relationships:**
- No explicit Prisma relation field is declared in this model.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| status | See enum docs or service code for accepted values. |
| provider_status | See enum docs or service code for accepted values. |
| failure_reason | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## reactivation_requests

reactivation_requests represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| tenant_id | String | yes | Foreign key or scoped identifier. |
| owner_id | String | yes | Foreign key or scoped identifier. |
| requested_by_profile_id | String | yes | Foreign key or scoped identifier. |
| current_status | String | yes | Domain field persisted by the application. |
| status | String | no | Domain field persisted by the application. Has a database default. |
| notes | String? | no | Domain field persisted by the application. |
| processed_at | DateTime? | no | Domain field persisted by the application. |
| processed_by | String? | no | Domain field persisted by the application. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| tenants | tenants | yes | Domain field persisted by the application. Prisma relation field. |

**Relationships:**
- relates to tenants through tenants.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| current_status | See enum docs or service code for accepted values. |
| status | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## receipts

receipts represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| receipt_number | String | yes | Domain field persisted by the application. |
| payment_id | String | yes | Foreign key or scoped identifier. |
| tenant_id | String | yes | Foreign key or scoped identifier. |
| owner_id | String? | no | Foreign key or scoped identifier. |
| amount | Decimal | yes | Money or percentage value. |
| payment_method | String | yes | Domain field persisted by the application. |
| transaction_id | String? | no | Foreign key or scoped identifier. |
| hostel_name | String? | no | Domain field persisted by the application. |
| tenant_name | String? | no | Domain field persisted by the application. |
| rent_month | DateTime? | no | Domain field persisted by the application. |
| issued_at | DateTime | no | Domain field persisted by the application. Has a database default. |
| invoice_pdf_url | String? | no | Domain field persisted by the application. |
| invoice_template_version | Int? | no | Domain field persisted by the application. |
| receipt_pdf_url | String? | no | Domain field persisted by the application. |
| receipt_template_version | Int? | no | Domain field persisted by the application. |
| hostel_id | String | yes | Foreign key or scoped identifier. |
| hostels | hostels | yes | Domain field persisted by the application. Prisma relation field. |
| payments | payments | yes | Domain field persisted by the application. Prisma relation field. |
| tenants | tenants | yes | Domain field persisted by the application. Prisma relation field. |

**Relationships:**
- relates to hostels through hostels.
- relates to payments through payments.
- relates to tenants through tenants.

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## refresh_tokens

refresh_tokens represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| user_id | String | yes | Foreign key or scoped identifier. |
| session_id | String? | no | Groups rotated refresh tokens into one login session. |
| token_hash | String | yes | Domain field persisted by the application. |
| expires_at | DateTime | yes | Domain field persisted by the application. |
| absolute_expires_at | DateTime? | no | Maximum allowed session end time. |
| last_activity_at | DateTime | no | Last trusted server-side activity time. Has a database default. |
| revoked_at | DateTime? | no | Timestamp when this refresh token or session was revoked. |
| rotated_at | DateTime? | no | Timestamp when this refresh token was exchanged for a new token. |
| device_info | String? | no | User-agent snapshot for session review and audit. |
| ip_address | String? | no | IP snapshot captured when the session token was issued. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| profiles | profile | yes | Domain field persisted by the application. Prisma relation field. |

**Relationships:**
- relates to profile through profiles.

**How this works:**
1. Login creates a session group and stores only a hashed refresh token.
2. Refresh rotates the token by revoking the old row and creating a new row.
3. Inactivity, absolute expiry, and suspicious reuse revoke the session server-side.

## reminder_logs

reminder_logs represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| obligation_id | String | yes | Foreign key or scoped identifier. |
| tenant_id | String | yes | Foreign key or scoped identifier. |
| reminder_type | String | yes | Domain field persisted by the application. |
| channel | String | no | Domain field persisted by the application. Has a database default. |
| sent_at | DateTime | no | Domain field persisted by the application. Has a database default. |
| converted_at | DateTime? | no | Domain field persisted by the application. |
| converted_to_payment | Boolean | no | Boolean flag. Has a database default. |
| hostel_id | String | yes | Foreign key or scoped identifier. |
| hostels | hostels | yes | Domain field persisted by the application. Prisma relation field. |
| rent_obligations | rent_obligations | yes | Domain field persisted by the application. Prisma relation field. |
| tenants | tenants | yes | Domain field persisted by the application. Prisma relation field. |

**Relationships:**
- relates to hostels through hostels.
- relates to rent_obligations through rent_obligations.
- relates to tenants through tenants.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| reminder_type | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## rent_generation_ledgers

rent_generation_ledgers represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | no | Primary identifier. Has a database default. |
| owner_id | String | yes | Foreign key or scoped identifier. |
| hostel_id | String | yes | Foreign key or scoped identifier. |
| rent_month | DateTime | yes | Domain field persisted by the application. |
| obligation_type | String | yes | Domain field persisted by the application. |
| status | String | yes | Domain field persisted by the application. |
| trigger_type | String? | no | Domain field persisted by the application. |
| generated_by | String? | no | Domain field persisted by the application. |
| created_count | Int | no | Domain field persisted by the application. Has a database default. |
| skipped_count | Int | no | Domain field persisted by the application. Has a database default. |
| failure_reason | String? | no | Domain field persisted by the application. |
| started_at | DateTime? | no | Domain field persisted by the application. |
| completed_at | DateTime? | no | Domain field persisted by the application. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| updated_at | DateTime? | no | Last update timestamp. |

**Relationships:**
- No explicit Prisma relation field is declared in this model.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| obligation_type | See enum docs or service code for accepted values. |
| status | See enum docs or service code for accepted values. |
| trigger_type | See enum docs or service code for accepted values. |
| failure_reason | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## rent_generation_logs

rent_generation_logs represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | no | Primary identifier. Has a database default. |
| rent_month | DateTime | yes | Domain field persisted by the application. |
| trigger_type | String | yes | Domain field persisted by the application. |
| triggered_by | String? | no | Domain field persisted by the application. |
| total_allocations | Int | no | Domain field persisted by the application. Has a database default. |
| obligations_created | Int | no | Domain field persisted by the application. Has a database default. |
| obligations_skipped | Int | no | Domain field persisted by the application. Has a database default. |
| obligations_failed | Int | no | Domain field persisted by the application. Has a database default. |
| duration_ms | Int? | no | Domain field persisted by the application. |
| errors | String? | no | Domain field persisted by the application. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |

**Relationships:**
- No explicit Prisma relation field is declared in this model.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| trigger_type | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## rent_obligations

rent_obligations represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | no | Primary identifier. Has a database default. |
| tenant_id | String | yes | Foreign key or scoped identifier. |
| allocation_id | String? | no | Foreign key or scoped identifier. |
| owner_id | String? | no | Foreign key or scoped identifier. |
| rent_month | DateTime | yes | Domain field persisted by the application. |
| amount | Decimal | yes | Money or percentage value. |
| late_fee | Decimal? | no | Domain field persisted by the application. Has a database default. |
| total_amount | Decimal | yes | Money or percentage value. |
| due_date | DateTime | yes | Domain field persisted by the application. |
| status | PaymentStatus | no | Domain field persisted by the application. Has a database default. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| updated_at | DateTime? | no | Last update timestamp. |
| obligation_type | String | no | Domain field persisted by the application. Has a database default. |
| hostel_id | String | yes | Foreign key or scoped identifier. |
| billing_period_start | DateTime? | no | Domain field persisted by the application. |
| billing_period_end | DateTime? | no | Domain field persisted by the application. |
| installment_label | String? | no | Domain field persisted by the application. |
| installment_sequence | Int? | no | Domain field persisted by the application. |
| billing_plan_id | String? | no | Foreign key or scoped identifier. |
| is_superseded | Boolean | no | Boolean flag. Has a database default. |
| superseded_at | DateTime? | no | Domain field persisted by the application. |
| superseded_by_request_id | String? | no | Foreign key or scoped identifier. |
| payment_attempt_obligations | payment_attempt_obligations[] | no | Domain field persisted by the application. |
| payment_attempts | paymentAttempt[] | no | Domain field persisted by the application. |
| payments | payments[] | no | Domain field persisted by the application. |
| reminder_logs | reminder_logs[] | no | Domain field persisted by the application. |
| room_allocations | roomAllocation? | no | Domain field persisted by the application. Prisma relation field. |
| hostels | hostels | yes | Domain field persisted by the application. Prisma relation field. |
| tenants | tenants | yes | Domain field persisted by the application. Prisma relation field. |
| tenant_billing_plans | tenant_billing_plans? | no | Domain field persisted by the application. Prisma relation field. |
| superseded_by_request | payment_frequency_change_requests? | no | Domain field persisted by the application. Prisma relation field. |

**Relationships:**
- relates to payment_attempt_obligations through payment_attempt_obligations.
- relates to paymentAttempt through payment_attempts.
- relates to payments through payments.
- relates to reminder_logs through reminder_logs.
- relates to roomAllocation through room_allocations.
- relates to hostels through hostels.
- relates to tenants through tenants.
- relates to tenant_billing_plans through tenant_billing_plans.
- relates to payment_frequency_change_requests through superseded_by_request.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| status | See enum docs or service code for accepted values. |
| obligation_type | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## room_activity_logs

room_activity_logs represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| room_id | String | yes | Foreign key or scoped identifier. |
| owner_id | String | yes | Foreign key or scoped identifier. |
| action | String | yes | Domain field persisted by the application. |
| previous_value | String? | no | Domain field persisted by the application. |
| new_value | String? | no | Domain field persisted by the application. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| rooms | rooms | yes | Domain field persisted by the application. Prisma relation field. |

**Relationships:**
- relates to rooms through rooms.

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## roomAllocation

roomAllocation represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| tenant_id | String | yes | Foreign key or scoped identifier. |
| room_id | String | yes | Foreign key or scoped identifier. |
| start_date | DateTime | yes | Domain field persisted by the application. |
| end_date | DateTime? | no | Domain field persisted by the application. |
| is_active | Boolean | no | Boolean flag. Has a database default. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| updated_at | DateTime? | no | Last update timestamp. |
| hostel_id | String | yes | Foreign key or scoped identifier. |
| rent_obligations | rent_obligations[] | no | Domain field persisted by the application. |
| hostel | hostels | yes | Domain field persisted by the application. Prisma relation field. |
| room | rooms | yes | Domain field persisted by the application. Prisma relation field. |
| tenant | tenants | yes | Domain field persisted by the application. Prisma relation field. |

**Relationships:**
- relates to rent_obligations through rent_obligations.
- relates to hostels through hostel.
- relates to rooms through room.
- relates to tenants through tenant.

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## rooms

rooms represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | no | Primary identifier. Has a database default. |
| hostel_id | String | yes | Foreign key or scoped identifier. |
| room_no | String | yes | Domain field persisted by the application. |
| floor | Int? | no | Domain field persisted by the application. |
| floor_id | String? | no | Foreign key or scoped identifier. |
| capacity | Int | yes | Domain field persisted by the application. |
| room_type | String? | no | Domain field persisted by the application. |
| is_active | Boolean | no | Boolean flag. Has a database default. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| updated_at | DateTime? | no | Last update timestamp. |
| base_rent | Int? | no | Domain field persisted by the application. |
| wifi_name | String? | no | Domain field persisted by the application. |
| wifi_password | String? | no | Domain field persisted by the application. |
| notes | String? | no | Domain field persisted by the application. |
| room_activity_logs | room_activity_logs[] | no | Domain field persisted by the application. |
| room_allocations | roomAllocation[] | no | Domain field persisted by the application. |
| hostels | hostels | yes | Domain field persisted by the application. Prisma relation field. |
| floor_ref | floors? | no | Domain field persisted by the application. Prisma relation field. |

**Relationships:**
- relates to room_activity_logs through room_activity_logs.
- relates to roomAllocation through room_allocations.
- relates to hostels through hostels.
- relates to floors through floor_ref.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| room_type | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## floors

floors represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | no | Primary identifier. Has a database default. |
| hostel_id | String | yes | Foreign key or scoped identifier. |
| owner_id | String | yes | Foreign key or scoped identifier. |
| name | String | yes | Domain field persisted by the application. |
| sort_order | Int | no | Domain field persisted by the application. Has a database default. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| hostel | hostels | yes | Domain field persisted by the application. Prisma relation field. |
| rooms | rooms[] | no | Domain field persisted by the application. |

**Relationships:**
- relates to hostels through hostel.
- relates to rooms through rooms.

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## systemEventLog

systemEventLog represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| event_type | String | yes | Domain field persisted by the application. |
| owner_id | String? | no | Foreign key or scoped identifier. |
| tenant_id | String? | no | Foreign key or scoped identifier. |
| metadata | Json? | no | Flexible JSON configuration or metadata. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |

**Relationships:**
- No explicit Prisma relation field is declared in this model.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| event_type | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## system_locks

system_locks represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| key | String | yes | Primary identifier. |
| locked_at | DateTime | no | Domain field persisted by the application. Has a database default. |
| expires_at | DateTime | yes | Domain field persisted by the application. |

**Relationships:**
- No explicit Prisma relation field is declared in this model.

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## tenant_advance_ledger

tenant_advance_ledger represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| tenant_id | String | yes | Foreign key or scoped identifier. |
| owner_id | String | yes | Foreign key or scoped identifier. |
| type | AdvanceLedgerType | yes | Domain field persisted by the application. |
| reason | AdvanceLedgerReason | yes | Domain field persisted by the application. |
| amount | Decimal | yes | Money or percentage value. |
| balance_after | Decimal | yes | Money or percentage value. |
| notes | String? | no | Domain field persisted by the application. |
| reference_id | String? | no | Foreign key or scoped identifier. |
| reference_type | String? | no | Domain field persisted by the application. |
| refund_status | String? | no | Domain field persisted by the application. |
| created_by | String | yes | Domain field persisted by the application. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| hostel_id | String | yes | Foreign key or scoped identifier. |
| tenants | tenants | yes | Domain field persisted by the application. Prisma relation field. |

**Relationships:**
- relates to tenants through tenants.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| type | See enum docs or service code for accepted values. |
| reason | See enum docs or service code for accepted values. |
| reference_type | See enum docs or service code for accepted values. |
| refund_status | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## tenant_behavior_scores

tenant_behavior_scores represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| tenant_id | String | yes | Primary identifier. |
| score | Int | no | Domain field persisted by the application. Has a database default. |
| last_calculated | DateTime | no | Domain field persisted by the application. Has a database default. |
| metadata | Json? | no | Flexible JSON configuration or metadata. |
| tenants | tenants | yes | Domain field persisted by the application. Prisma relation field. |

**Relationships:**
- relates to tenants through tenants.

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## tenant_transfer_logs

tenant_transfer_logs represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| tenant_id | String | yes | Foreign key or scoped identifier. |
| from_hostel_id | String | yes | Foreign key or scoped identifier. |
| to_hostel_id | String | yes | Foreign key or scoped identifier. |
| old_allocation_id | String? | no | Foreign key or scoped identifier. |
| new_allocation_id | String? | no | Foreign key or scoped identifier. |
| transferred_by | String | yes | Domain field persisted by the application. |
| transferred_at | DateTime | no | Domain field persisted by the application. Has a database default. |
| reason | String? | no | Domain field persisted by the application. |
| notes | String? | no | Domain field persisted by the application. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |

**Relationships:**
- No explicit Prisma relation field is declared in this model.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| reason | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## tenants

tenants represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | no | Primary identifier. Has a database default. |
| profile_id | String | yes | Foreign key or scoped identifier. |
| profile_type | String | no | Domain field persisted by the application. Has a database default. |
| monthly_rent | Decimal? | no | Domain field persisted by the application. |
| joined_on | DateTime? | no | Domain field persisted by the application. |
| status | TenantStatus | no | Domain field persisted by the application. Has a database default. |
| owner_id | String? | no | Foreign key or scoped identifier. |
| payment_frequency | PaymentFrequency | no | Domain field persisted by the application. Has a database default. |
| payment_frequency_effective_from | DateTime? | no | Domain field persisted by the application. |
| payment_frequency_updated_at | DateTime? | no | Last update timestamp. |
| profile_completed | Boolean | no | Boolean flag. Has a database default. |
| photo_url | String? | no | Domain field persisted by the application. |
| phone_1 | String? | no | Domain field persisted by the application. |
| phone_2 | String? | no | Domain field persisted by the application. |
| phone_3 | String? | no | Domain field persisted by the application. |
| guardian_name | String? | no | Domain field persisted by the application. |
| guardian_phone | String? | no | Domain field persisted by the application. |
| guardian_relation | String? | no | Domain field persisted by the application. |
| personal_email | String? | no | Domain field persisted by the application. |
| college_name | String? | no | Domain field persisted by the application. |
| roll_number | String? | no | Domain field persisted by the application. |
| course | String? | no | Domain field persisted by the application. |
| year_of_study | Int? | no | Domain field persisted by the application. |
| section | String? | no | Domain field persisted by the application. |
| branch | String? | no | Domain field persisted by the application. |
| office_name | String? | no | Domain field persisted by the application. |
| office_location | String? | no | Domain field persisted by the application. |
| job_role | String? | no | Domain field persisted by the application. |
| gender | String? | no | Domain field persisted by the application. |
| date_of_birth | DateTime? | no | Domain field persisted by the application. |
| advance_deposit | Decimal | no | Money or percentage value. Has a database default. |
| maintenance_charge | Decimal | no | Money or percentage value. Has a database default. |
| maintenance_type | String | no | Domain field persisted by the application. Has a database default. |
| billing_start_date | DateTime? | no | Domain field persisted by the application. |
| permanent_address | String? | no | Domain field persisted by the application. |
| temporary_address | String? | no | Domain field persisted by the application. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| updated_at | DateTime? | no | Last update timestamp. |
| activation_started_at | DateTime? | no | Domain field persisted by the application. |
| activation_completed_at | DateTime? | no | Domain field persisted by the application. |
| onboarding_last_activity_at | DateTime? | no | Domain field persisted by the application. |
| exit_date | DateTime? | no | Domain field persisted by the application. |
| exit_notes | String? | no | Domain field persisted by the application. |
| exit_reason | String? | no | Domain field persisted by the application. |
| hostel_id | String | yes | Foreign key or scoped identifier. |
| mobile_verified | Boolean | no | Boolean flag. Has a database default. |
| document_verified | Boolean | no | Boolean flag. Has a database default. |
| complaints | complaints[] | no | Domain field persisted by the application. |
| rule_acceptances | TenantPolicyAcceptance[] | no | Domain field persisted by the application. |
| payment_attempts | paymentAttempt[] | no | Domain field persisted by the application. |
| payments | payments[] | no | Domain field persisted by the application. |
| reactivation_requests | reactivation_requests[] | no | Domain field persisted by the application. |
| receipts | receipts[] | no | Domain field persisted by the application. |
| reminder_logs | reminder_logs[] | no | Domain field persisted by the application. |
| rent_obligations | rent_obligations[] | no | Domain field persisted by the application. |
| room_allocations | roomAllocation[] | no | Domain field persisted by the application. |
| tenant_advance_ledger | tenant_advance_ledger[] | no | Domain field persisted by the application. |
| tenant_behavior_scores | tenant_behavior_scores? | no | Domain field persisted by the application. |
| move_out_requests | move_out_requests[] | no | Domain field persisted by the application. |
| identification_documents | identificationDocument[] | no | Domain field persisted by the application. |
| tenant_billing_plans | tenant_billing_plans[] | no | Domain field persisted by the application. |
| payment_frequency_change_requests | payment_frequency_change_requests[] | no | Domain field persisted by the application. |
| hostels | hostels | yes | Domain field persisted by the application. Prisma relation field. |
| profiles | profile | yes | Domain field persisted by the application. Prisma relation field. |

**Relationships:**
- relates to complaints through complaints.
- relates to paymentAttempt through payment_attempts.
- relates to payments through payments.
- relates to reactivation_requests through reactivation_requests.
- relates to receipts through receipts.
- relates to reminder_logs through reminder_logs.
- relates to rent_obligations through rent_obligations.
- relates to roomAllocation through room_allocations.
- relates to tenant_advance_ledger through tenant_advance_ledger.
- relates to tenant_behavior_scores through tenant_behavior_scores.
- relates to move_out_requests through move_out_requests.
- relates to identificationDocument through identification_documents.
- relates to tenant_billing_plans through tenant_billing_plans.
- relates to payment_frequency_change_requests through payment_frequency_change_requests.
- relates to hostels through hostels.
- relates to profile through profiles.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| profile_type | See enum docs or service code for accepted values. |
| status | See enum docs or service code for accepted values. |
| payment_frequency | See enum docs or service code for accepted values. |
| payment_frequency_effective_from | See enum docs or service code for accepted values. |
| payment_frequency_updated_at | See enum docs or service code for accepted values. |
| job_role | See enum docs or service code for accepted values. |
| maintenance_type | See enum docs or service code for accepted values. |
| exit_reason | See enum docs or service code for accepted values. |
| payment_frequency_change_requests | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## tenant_billing_plans

tenant_billing_plans represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | no | Primary identifier. Has a database default. |
| tenant_id | String | yes | Foreign key or scoped identifier. |
| owner_id | String | yes | Foreign key or scoped identifier. |
| hostel_id | String | yes | Foreign key or scoped identifier. |
| frequency | PaymentFrequency | yes | Domain field persisted by the application. |
| effective_from | DateTime | yes | Domain field persisted by the application. |
| effective_to | DateTime? | no | Domain field persisted by the application. |
| installment_count | Int | yes | Domain field persisted by the application. |
| total_contract_amount | Decimal | no | Money or percentage value. Has a database default. |
| transition_strategy | BillingTransitionStrategy | no | Domain field persisted by the application. Has a database default. |
| schedule_snapshot | Json | yes | Flexible JSON configuration or metadata. |
| status | BillingPlanStatus | no | Domain field persisted by the application. Has a database default. |
| approved_by | String? | no | Domain field persisted by the application. |
| approved_at | DateTime? | no | Domain field persisted by the application. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| updated_at | DateTime? | no | Last update timestamp. |
| tenants | tenants | yes | Domain field persisted by the application. Prisma relation field. |
| rent_obligations | rent_obligations[] | no | Domain field persisted by the application. |

**Relationships:**
- relates to tenants through tenants.
- relates to rent_obligations through rent_obligations.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| frequency | See enum docs or service code for accepted values. |
| transition_strategy | See enum docs or service code for accepted values. |
| status | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## payment_frequency_change_requests

payment_frequency_change_requests represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | no | Primary identifier. Has a database default. |
| tenant_id | String | yes | Foreign key or scoped identifier. |
| owner_id | String | yes | Foreign key or scoped identifier. |
| hostel_id | String | yes | Foreign key or scoped identifier. |
| current_frequency | PaymentFrequency | yes | Domain field persisted by the application. |
| requested_frequency | PaymentFrequency | yes | Domain field persisted by the application. |
| requested_on | DateTime | no | Domain field persisted by the application. Has a database default. |
| effective_from | DateTime | yes | Domain field persisted by the application. |
| transition_strategy | BillingTransitionStrategy | no | Domain field persisted by the application. Has a database default. |
| reason | String? | no | Domain field persisted by the application. |
| settlement_snapshot | Json | yes | Flexible JSON configuration or metadata. |
| projection_snapshot | Json | yes | Flexible JSON configuration or metadata. |
| risk_snapshot | Json | yes | Flexible JSON configuration or metadata. |
| status | FrequencyChangeStatus | no | Domain field persisted by the application. Has a database default. |
| approved_by | String? | no | Domain field persisted by the application. |
| approved_at | DateTime? | no | Domain field persisted by the application. |
| rejection_reason | String? | no | Domain field persisted by the application. |
| cancelled_at | DateTime? | no | Domain field persisted by the application. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| updated_at | DateTime? | no | Last update timestamp. |
| tenants | tenants | yes | Domain field persisted by the application. Prisma relation field. |
| superseded_obligations | rent_obligations[] | no | Domain field persisted by the application. Prisma relation field. |

**Relationships:**
- relates to tenants through tenants.
- relates to rent_obligations through superseded_obligations.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| current_frequency | See enum docs or service code for accepted values. |
| requested_frequency | See enum docs or service code for accepted values. |
| transition_strategy | See enum docs or service code for accepted values. |
| reason | See enum docs or service code for accepted values. |
| status | See enum docs or service code for accepted values. |
| rejection_reason | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## token_blacklist

token_blacklist represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | Int | no | Primary identifier. Has a database default. |
| token | String | yes | Domain field persisted by the application. |
| expires_at | DateTime | yes | Domain field persisted by the application. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |

**Relationships:**
- No explicit Prisma relation field is declared in this model.

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## usage_tracking

usage_tracking represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| owner_id | String | yes | Primary identifier. |
| tenants_count | Int | no | Domain field persisted by the application. Has a database default. |
| hostels_count | Int | no | Domain field persisted by the application. Has a database default. |

**Relationships:**
- No explicit Prisma relation field is declared in this model.

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## whatsapp_logs

whatsapp_logs represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| phone | String | yes | Domain field persisted by the application. |
| template | String | yes | Domain field persisted by the application. |
| obligation_id | String? | no | Foreign key or scoped identifier. |
| status | String | yes | Domain field persisted by the application. |
| error_message | String? | no | Domain field persisted by the application. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| template_name | String? | no | Domain field persisted by the application. |
| owner_id | String? | no | Foreign key or scoped identifier. |
| tenant_id | String? | no | Foreign key or scoped identifier. |
| hostel_id | String? | no | Foreign key or scoped identifier. |
| delivery_status | String | no | Domain field persisted by the application. Has a database default. |
| provider_message_id | String? | no | Foreign key or scoped identifier. |
| idempotency_key | String? | no | Domain field persisted by the application. |
| provider_error_code | String? | no | Domain field persisted by the application. |
| provider_error_message | String? | no | Domain field persisted by the application. |
| attempt_count | Int | no | Domain field persisted by the application. Has a database default. |
| provider_response | Json? | no | Flexible JSON configuration or metadata. |

**Relationships:**
- No explicit Prisma relation field is declared in this model.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| status | See enum docs or service code for accepted values. |
| delivery_status | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## whatsapp_webhook_events

whatsapp_webhook_events represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | yes | Primary identifier. |
| provider | String | no | Domain field persisted by the application. Has a database default. |
| event_hash | String | yes | Domain field persisted by the application. |
| event_type | String? | no | Domain field persisted by the application. |
| provider_message_id | String? | no | Foreign key or scoped identifier. |
| raw_payload | Json | yes | Flexible JSON configuration or metadata. |
| headers_redacted | Json? | no | Flexible JSON configuration or metadata. |
| signature_verified | Boolean | no | Boolean flag. Has a database default. |
| signature_algorithm | String? | no | Domain field persisted by the application. |
| signature_failure_reason | String? | no | Domain field persisted by the application. |
| processing_status | String | no | Domain field persisted by the application. Has a database default. |
| processing_result | Json? | no | Flexible JSON configuration or metadata. |
| error_message | String? | no | Domain field persisted by the application. |
| received_at | DateTime | no | Domain field persisted by the application. Has a database default. |
| processed_at | DateTime? | no | Domain field persisted by the application. |

**Relationships:**
- No explicit Prisma relation field is declared in this model.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| event_type | See enum docs or service code for accepted values. |
| signature_failure_reason | See enum docs or service code for accepted values. |
| processing_status | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## move_out_requests

move_out_requests represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | no | Primary identifier. Has a database default. |
| tenant_id | String | yes | Foreign key or scoped identifier. |
| hostel_id | String | yes | Foreign key or scoped identifier. |
| owner_id | String | yes | Foreign key or scoped identifier. |
| status | MoveOutStatus | no | Domain field persisted by the application. Has a database default. |
| reason | MoveOutReason | yes | Domain field persisted by the application. |
| reason_text | String? | no | Domain field persisted by the application. |
| planned_exit_date | DateTime | yes | Domain field persisted by the application. |
| actual_exit_date | DateTime? | no | Domain field persisted by the application. |
| financial_completion_date | DateTime? | no | Domain field persisted by the application. |
| physical_exit_date | DateTime? | no | Domain field persisted by the application. |
| room_release_date | DateTime? | no | Domain field persisted by the application. |
| notice_period_days | Int | no | Domain field persisted by the application. Has a database default. |
| notice_period_violation | Boolean | no | Boolean flag. Has a database default. |
| initiated_by | String | yes | Domain field persisted by the application. |
| initiated_by_role | String | no | Domain field persisted by the application. Has a database default. |
| is_eviction | Boolean | no | Boolean flag. Has a database default. |
| eviction_reason | String? | no | Domain field persisted by the application. |
| reviewed_by | String? | no | Domain field persisted by the application. |
| reviewed_at | DateTime? | no | Domain field persisted by the application. |
| review_notes | String? | no | Domain field persisted by the application. |
| cancelled_at | DateTime? | no | Domain field persisted by the application. |
| cancelled_by | String? | no | Domain field persisted by the application. |
| cancellation_reason | String? | no | Domain field persisted by the application. |
| completed_at | DateTime? | no | Domain field persisted by the application. |
| freeze_room_transfer | Boolean | no | Boolean flag. Has a database default. |
| freeze_rent_generation | Boolean | no | Boolean flag. Has a database default. |
| freeze_profile_edits | Boolean | no | Boolean flag. Has a database default. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| updated_at | DateTime? | no | Last update timestamp. |
| tenant | tenants | yes | Domain field persisted by the application. Prisma relation field. |
| hostel | hostels | yes | Domain field persisted by the application. Prisma relation field. |
| inspection | move_out_inspections? | no | Domain field persisted by the application. |
| inspection_items | move_out_inspection_items[] | no | Domain field persisted by the application. |
| settlement | exit_settlement_transactions? | no | Domain field persisted by the application. |
| feedback | exit_feedbacks? | no | Domain field persisted by the application. |
| disputes | exit_disputes[] | no | Domain field persisted by the application. |

**Relationships:**
- relates to tenants through tenant.
- relates to hostels through hostel.
- relates to move_out_inspections through inspection.
- relates to move_out_inspection_items through inspection_items.
- relates to exit_settlement_transactions through settlement.
- relates to exit_feedbacks through feedback.
- relates to exit_disputes through disputes.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| status | See enum docs or service code for accepted values. |
| reason | See enum docs or service code for accepted values. |
| reason_text | See enum docs or service code for accepted values. |
| initiated_by_role | See enum docs or service code for accepted values. |
| eviction_reason | See enum docs or service code for accepted values. |
| cancellation_reason | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## move_out_inspections

move_out_inspections represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | no | Primary identifier. Has a database default. |
| request_id | String | yes | Foreign key or scoped identifier. |
| inspected_by | String | yes | Domain field persisted by the application. |
| room_condition | String | no | Domain field persisted by the application. Has a database default. |
| cleaning_status | String | no | Domain field persisted by the application. Has a database default. |
| damages_amount | Decimal | no | Money or percentage value. Has a database default. |
| cleaning_fee | Decimal | no | Money or percentage value. Has a database default. |
| missing_items_fee | Decimal | no | Money or percentage value. Has a database default. |
| other_deductions | Decimal | no | Money or percentage value. Has a database default. |
| total_deductions | Decimal | no | Money or percentage value. Has a database default. |
| deduction_notes | String? | no | Domain field persisted by the application. |
| evidence_urls | String[] | no | Domain field persisted by the application. Has a database default. |
| notes | String? | no | Domain field persisted by the application. |
| inspected_at | DateTime | no | Domain field persisted by the application. Has a database default. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| updated_at | DateTime? | no | Last update timestamp. |
| request | move_out_requests | yes | Domain field persisted by the application. Prisma relation field. |

**Relationships:**
- relates to move_out_requests through request.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| cleaning_status | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## move_out_inspection_items

move_out_inspection_items represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | no | Primary identifier. Has a database default. |
| request_id | String | yes | Foreign key or scoped identifier. |
| item_name | String | yes | Domain field persisted by the application. |
| item_category | String | no | Domain field persisted by the application. Has a database default. |
| condition | String | no | Domain field persisted by the application. Has a database default. |
| charge_amount | Decimal | no | Money or percentage value. Has a database default. |
| notes | String? | no | Domain field persisted by the application. |
| evidence_url | String? | no | Domain field persisted by the application. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| request | move_out_requests | yes | Domain field persisted by the application. Prisma relation field. |

**Relationships:**
- relates to move_out_requests through request.

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## exit_settlement_transactions

exit_settlement_transactions represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | no | Primary identifier. Has a database default. |
| request_id | String | yes | Foreign key or scoped identifier. |
| tenant_id | String | yes | Foreign key or scoped identifier. |
| owner_id | String | yes | Foreign key or scoped identifier. |
| hostel_id | String | yes | Foreign key or scoped identifier. |
| security_deposit_amount | Decimal | no | Money or percentage value. Has a database default. |
| advance_balance | Decimal | no | Money or percentage value. Has a database default. |
| pending_rent_dues | Decimal | no | Money or percentage value. Has a database default. |
| pending_late_fees | Decimal | no | Money or percentage value. Has a database default. |
| pending_utility_dues | Decimal | no | Money or percentage value. Has a database default. |
| damages_deduction | Decimal | no | Money or percentage value. Has a database default. |
| cleaning_deduction | Decimal | no | Money or percentage value. Has a database default. |
| missing_items_deduction | Decimal | no | Money or percentage value. Has a database default. |
| other_deductions | Decimal | no | Money or percentage value. Has a database default. |
| total_deductions | Decimal | no | Money or percentage value. Has a database default. |
| total_dues | Decimal | no | Money or percentage value. Has a database default. |
| net_settlement_amount | Decimal | no | Money or percentage value. Has a database default. |
| settlement_direction | String | no | Domain field persisted by the application. Has a database default. |
| payment_status | String | no | Domain field persisted by the application. Has a database default. |
| payment_method | String? | no | Domain field persisted by the application. |
| payment_reference | String? | no | Domain field persisted by the application. |
| payment_notes | String? | no | Domain field persisted by the application. |
| settled_at | DateTime? | no | Domain field persisted by the application. |
| settled_by | String? | no | Domain field persisted by the application. |
| confirmed_by_tenant | Boolean | no | Boolean flag. Has a database default. |
| confirmed_by_owner | Boolean | no | Boolean flag. Has a database default. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| updated_at | DateTime? | no | Last update timestamp. |
| request | move_out_requests | yes | Domain field persisted by the application. Prisma relation field. |

**Relationships:**
- relates to move_out_requests through request.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| payment_status | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## exit_disputes

exit_disputes represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | no | Primary identifier. Has a database default. |
| request_id | String | yes | Foreign key or scoped identifier. |
| raised_by | String | yes | Domain field persisted by the application. |
| raised_by_role | String | yes | Domain field persisted by the application. |
| dispute_type | String | yes | Domain field persisted by the application. |
| description | String | yes | Domain field persisted by the application. |
| disputed_amount | Decimal? | no | Domain field persisted by the application. |
| evidence_urls | String[] | no | Domain field persisted by the application. Has a database default. |
| status | String | no | Domain field persisted by the application. Has a database default. |
| resolution_notes | String? | no | Domain field persisted by the application. |
| resolved_by | String? | no | Domain field persisted by the application. |
| resolved_at | DateTime? | no | Domain field persisted by the application. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| updated_at | DateTime? | no | Last update timestamp. |
| request | move_out_requests | yes | Domain field persisted by the application. Prisma relation field. |

**Relationships:**
- relates to move_out_requests through request.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| raised_by_role | See enum docs or service code for accepted values. |
| dispute_type | See enum docs or service code for accepted values. |
| status | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## exit_feedbacks

exit_feedbacks represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | no | Primary identifier. Has a database default. |
| request_id | String | yes | Foreign key or scoped identifier. |
| tenant_id | String | yes | Foreign key or scoped identifier. |
| hostel_id | String | yes | Foreign key or scoped identifier. |
| rating_cleanliness | Int? | no | Domain field persisted by the application. |
| rating_food | Int? | no | Domain field persisted by the application. |
| rating_wifi | Int? | no | Domain field persisted by the application. |
| rating_management | Int? | no | Domain field persisted by the application. |
| rating_maintenance | Int? | no | Domain field persisted by the application. |
| rating_safety | Int? | no | Domain field persisted by the application. |
| rating_value | Int? | no | Domain field persisted by the application. |
| rating_noise | Int? | no | Domain field persisted by the application. |
| overall_rating | Int? | no | Domain field persisted by the application. |
| would_recommend | Boolean? | no | Domain field persisted by the application. |
| improvement_text | String? | no | Domain field persisted by the application. |
| experience_text | String? | no | Domain field persisted by the application. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| request | move_out_requests | yes | Domain field persisted by the application. Prisma relation field. |

**Relationships:**
- relates to move_out_requests through request.

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## financial_reconciliation_issues

financial_reconciliation_issues represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | no | Primary identifier. Has a database default. |
| issue_type | String | yes | Domain field persisted by the application. |
| severity | String | yes | Domain field persisted by the application. |
| status | String | no | Domain field persisted by the application. Has a database default. |
| owner_id | String? | no | Foreign key or scoped identifier. |
| hostel_id | String? | no | Foreign key or scoped identifier. |
| payment_id | String? | no | Foreign key or scoped identifier. |
| ledger_entry_id | String? | no | Foreign key or scoped identifier. |
| batch_id | String? | no | Foreign key or scoped identifier. |
| batch_item_id | String? | no | Foreign key or scoped identifier. |
| fingerprint | String | yes | Domain field persisted by the application. |
| description | String | yes | Domain field persisted by the application. |
| metadata | Json | no | Flexible JSON configuration or metadata. Has a database default. |
| detected_at | DateTime | no | Domain field persisted by the application. Has a database default. |
| acknowledged_at | DateTime? | no | Domain field persisted by the application. |
| acknowledged_by | String? | no | Domain field persisted by the application. |
| resolved_at | DateTime? | no | Domain field persisted by the application. |
| resolved_by | String? | no | Domain field persisted by the application. |
| resolution_notes | String? | no | Domain field persisted by the application. |

**Relationships:**
- No explicit Prisma relation field is declared in this model.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| issue_type | See enum docs or service code for accepted values. |
| status | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## admin_financial_audit_log

admin_financial_audit_log represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | no | Primary identifier. Has a database default. |
| admin_id | String | yes | Foreign key or scoped identifier. |
| action_type | String | yes | Domain field persisted by the application. |
| subject_type | String | yes | Domain field persisted by the application. |
| subject_id | String | yes | Foreign key or scoped identifier. |
| owner_id | String? | no | Foreign key or scoped identifier. |
| hostel_id | String? | no | Foreign key or scoped identifier. |
| before_state | Json? | no | Flexible JSON configuration or metadata. |
| after_state | Json? | no | Flexible JSON configuration or metadata. |
| reason | String? | no | Domain field persisted by the application. |
| ip_address | String? | no | Domain field persisted by the application. |
| user_agent | String? | no | Domain field persisted by the application. |
| metadata | Json | no | Flexible JSON configuration or metadata. Has a database default. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |

**Relationships:**
- No explicit Prisma relation field is declared in this model.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| action_type | See enum docs or service code for accepted values. |
| subject_type | See enum docs or service code for accepted values. |
| reason | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## RuleVersion

RuleVersion represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | no | Primary identifier. Has a database default. |
| hostel_id | String | yes | Foreign key or scoped identifier. |
| version | String | yes | Domain field persisted by the application. |
| title | String | no | Domain field persisted by the application. Has a database default. |
| content | Json? | no | Flexible JSON configuration or metadata. |
| content_snapshot | Json | yes | Flexible JSON configuration or metadata. |
| is_active | Boolean | no | Boolean flag. Has a database default. |
| active | Boolean | no | Boolean flag. Has a database default. |
| created_at | DateTime | no | Creation timestamp. Has a database default. |
| hostel | hostels | yes | Domain field persisted by the application. Prisma relation field. |
| acceptances | TenantPolicyAcceptance[] | no | Domain field persisted by the application. |
| profile | profile? | no | Domain field persisted by the application. Prisma relation field. |
| profileId | String? | no | Domain field persisted by the application. |

**Relationships:**
- relates to hostels through hostel.
- relates to profile through profile.

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.

## TenantPolicyAcceptance

TenantPolicyAcceptance represents a persisted HMS domain record.

| Field | Type | Required | Description |
|---|---|---|---|
| id | String | no | Primary identifier. Has a database default. |
| tenant_id | String | yes | Foreign key or scoped identifier. |
| hostel_id | String | yes | Foreign key or scoped identifier. |
| rule_version_id | String | yes | Foreign key or scoped identifier. |
| rules_version | String | yes | Domain field persisted by the application. |
| rules_snapshot | Json | no | Flexible JSON configuration or metadata. Has a database default. |
| accepted_at | DateTime | no | Domain field persisted by the application. Has a database default. |
| accepted_ip | String? | no | Domain field persisted by the application. |
| accepted_user_agent | String? | no | Domain field persisted by the application. |
| typed_signature_name | String? | no | Domain field persisted by the application. |
| tenant | tenants | yes | Domain field persisted by the application. Prisma relation field. |
| hostel | hostels | yes | Domain field persisted by the application. Prisma relation field. |
| rule_version | RuleVersion | yes | Domain field persisted by the application. Prisma relation field. |

**Relationships:**
- relates to tenants through tenant.
- relates to hostels through hostel.
- relates to RuleVersion through rule_version.

**Status values (if applicable):**
| Value | Meaning |
|---|---|
| typed_signature_name | See enum docs or service code for accepted values. |

**How this works:**
1. The database stores this record with the fields listed above.
2. Backend services apply business rules before creating or changing it.
3. UI screens receive normalized versions through API routes.
