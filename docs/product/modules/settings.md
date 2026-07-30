# Settings

## What this does

The settings module lets owners configure profile, hostel identity, tenant defaults, billing, payments, notifications, automation, and access documents.

## Screen breakdown

| Screen | Purpose | Data shown |
|---|---|---|
| Settings shell | Provides section navigation | Profile, identity, billing, payments, notifications |
| Profile section | Edits owner identity | Name, phone, email fields |
| Hostel identity | Edits hostel branding | Name, address, logo |
| Tenant defaults | Edits onboarding defaults | Rent, advance, maintenance, rules |
| Billing section | Edits billing rules | Due day, grace, late fee rules |
| Payments section | Edits payment config | UPI and provider settings |
| Notifications section | Edits reminder settings | Reminder timing and channels |
| Automation section | Edits recurring jobs | Auto rent and reminder options |

## Data it needs

- `ownerService.getHostels()` from `/owner/hostels`.
- `ownerService.getProfile()` from `/owner/me/profile`.
- `ownerService.getHostelPreferences(hostelId)` from `/hostels/:id/preferences`.
- `ownerService.updateHostelPolicy(hostelId, patch)` from `/hostels/:id/preferences`.
- `ownerService.updateSectionConfig(hostelId, section, data)` from `/hostels/:id/:section`.

## Data it produces

- Owner profile updates.
- Hostel preference JSON updates.
- Logo uploads and removals.
- Billing, notification, payment, security, and system config updates.

## Key components

- `SettingsView` renders section navigation.
- `ProfileSection` edits owner profile.
- `HostelIdentitySection` edits hostel identity.
- `TenantDefaultsSection` edits invite defaults.
- `BillingSection` edits financial defaults.
- `PaymentsSection` edits payment settings.
- `NotificationsSection` edits reminder settings.
- `AutomationSection` edits automation settings.

## Business logic in this module

- Preferences are stored per hostel.
- Some settings patch `preferences_config`.
- Some settings patch section-specific API routes.
- Settings invalidation refreshes owner profile, hostels, and policy keys.

## How this works (step by step)

1. The owner opens `/settings`.
2. The UI fetches hostels and selects a hostel context.
3. Each settings section loads the relevant preferences.
4. Saves call owner service mutations.
5. Query invalidation refreshes settings and dependent screens.

## How to reuse this for a new client

- Keep settings grouped by operational domain.
- Replace client-facing defaults before tenant invitations.
- Confirm which settings belong to database fields versus JSON preferences.
- Expose fewer sections for a single-hostel, non-technical owner.

**How this works:**
1. Settings convert owner choices into persisted config.
2. Backend services read that config during invites, billing, and reminders.
3. The app changes behavior without code edits.

