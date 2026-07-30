# New Client Checklist

## 1. What to rename

- Sri Adithya Hostels.
- Sri Adithya Boys Hostel.
- `sriadithyahostels.in`.
- `api.sriadithyahostels.in`.
- Sri Adithya email addresses.
- Receipt footer text.
- Legal entity names and addresses.
- Public page metadata and canonical URLs.

**How this works:**
1. Search the repo for the old brand.
2. Replace visible names, domains, and contact details.
3. Rebuild and run the branding check.

## 2. What to reconfigure

- Database URLs.
- Frontend and backend public URLs.
- CORS origins.
- PhonePe credentials and webhook auth.
- Resend key and sender email.
- ImageKit credentials.
- WhatsApp credentials.
- Cron secret.
- Google OAuth client ID and redirect URI.

**How this works:**
1. Backend providers read environment variables.
2. Frontend OAuth reads Vite variables.
3. Payment and webhook redirects must match production domains.

## 3. What to redesign

- Logo and favicon.
- Public site photos.
- Color tokens and brand accents.
- Legal page content.
- Receipt template branding.
- Login and navigation brand labels.
- Pricing and room descriptions.

**How this works:**
1. Public pages establish client trust.
2. App shell repeats the operational brand.
3. Receipts and emails confirm payment authenticity.

## 4. What database records to seed

- At least one owner profile.
- At least one hostel.
- Floors and rooms for the hostel.
- Billing defaults.
- Payment config.
- Notification config.
- Active rule version.
- SaaS plans from `prisma/seed.ts` if platform billing is used.

**How this works:**
1. Owner identity scopes hostel records.
2. Hostel records scope rooms, tenants, payments, and settings.
3. Tenant import works only after rooms and defaults exist.

## 5. What to test before handoff

1. Owner login.
2. Hostel creation and editing.
3. Room creation and occupancy update.
4. Tenant invitation.
5. Tenant activation.
6. Tenant document upload.
7. Owner document verification.
8. Rent generation preview and generation.
9. Offline payment recording.
10. Online payment intent and return flow.
11. Receipt download.
12. Alerts page.
13. Settings save.
14. Move-out request and settlement.
15. Cron endpoint authorization.

**How this works:**
1. These tests follow the real business lifecycle.
2. Each step confirms one critical integration.
3. Handoff is safer when owner and tenant flows both pass.

## 6. Estimated second-client deployment time

| Work | Estimate |
|---|---|
| Brand and legal replacement | 4 to 8 hours |
| Environment and provider setup | 4 to 8 hours |
| Database seed and room setup | 2 to 6 hours |
| Payment and webhook testing | 4 to 8 hours |
| Full acceptance pass | 4 to 8 hours |
| Total after codebase familiarity | 2 to 5 days |

**How this works:**
1. The first rebuild pays the discovery cost.
2. Later rebuilds reuse the same setup sequence.
3. Provider verification usually controls the timeline.

