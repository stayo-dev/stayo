# Activation Onboarding

## What this does

Activation onboarding turns an invited tenant into an active tenant account. It collects account credentials, rule acknowledgements, profile details, and optional photo data.

## Screen breakdown

| Screen | Purpose | Data shown |
|---|---|---|
| Activation page | Completes invitation | Hostel, room, rent, rules, profile steps |
| Complete profile page | Finishes tenant profile | Personal, guardian, education, contact fields |
| Activation progress | Shows step state | Account, rules, profile, activate |

## Data it needs

- `tenantService.getActivationContext(token)` from `/tenants/activate/context`.
- `tenantService.updateActivationWorkflow({ token, step, data })` from `/tenants/activate`.
- `tenantService.uploadActivationPhoto(token, file)` from `/tenants/activate/photo`.
- `tenantService.completeMyProfile(data, file)` from `/tenants/me/complete-profile`.
- Invitation data on `profile` and `tenants`.

## Data it produces

- Password hash and active login credentials.
- Rule acceptance records.
- Tenant profile completion fields.
- Tenant photo upload.
- Tenant status transition to active.
- Activation timestamps and event logs.

## Key components

- `ActivateAccountPage` renders token-based activation.
- `CompleteProfilePage` renders authenticated profile completion.
- `Progress` renders the activation step state.
- `RuleIcon` renders rule category icons.
- `Field` and `TextArea` render reusable activation inputs.

## Business logic in this module

- Activation requires a valid invitation token.
- Expired, cancelled, active, and invalid invitations return distinct errors.
- Required acknowledgements include fee, discipline, late fee, damage, and hostel rule acceptance.
- Default rules are created when no active hostel rule version exists.

## How this works (step by step)

1. The tenant opens `/activate/:token`.
2. The frontend requests activation context.
3. The backend resolves the token to an invited tenant.
4. The tenant completes account, rules, and profile steps.
5. The backend marks the tenant active and records rule acceptance.

## How to reuse this for a new client

- Replace default hostel rules and acknowledgements.
- Replace hardcoded late-fee language if the policy changes.
- Confirm token expiry policy.
- Confirm mandatory profile fields for the client.

**How this works:**
1. Invitation creates a pending tenant.
2. Activation proves the tenant controls the invitation link.
3. The final step opens tenant portal access.

