# Public Site

## What this does

The public site markets the hostel and exposes SEO pages for visitors. It includes home, about, facilities, rooms, gallery, location, contact, rules, pricing, and legal pages.

## Screen breakdown

| Screen | Purpose | Data shown |
|---|---|---|
| Home | Introduces hostel | Hero, highlights, calls to action |
| About | Explains story | Hostel background and trust copy |
| Facilities | Lists amenities | Food, security, Wi-Fi, laundry, study |
| Rooms | Shows room types | Pricing and sharing options |
| Gallery | Shows hostel photos | Facility imagery |
| Location | Gives directions | Address and landmarks |
| Contact | Captures inquiries | Phone, email, address |
| Rules | Shows hostel policy | Behavior and fee rules |
| Legal | Shows policy text | Terms, privacy, refund content |
| Pricing | Shows payment policy | Rent payment instructions |

## Data it needs

- Static page content from `apps/frontend/src/app/pages/public`.
- Legal content from `apps/frontend/src/content/legal.ts`.
- Browser metadata updates in page effects.

## Data it produces

- SEO metadata updates.
- Visitor navigation.
- Contact links through mail and phone.

## Key components

- `PublicRoutes` defines public route mapping.
- `PublicLayout` wraps public pages.
- `HomePage` renders the landing page.
- `LegalPage` renders legal content.
- `PricingPage` renders pricing and payment policy.

## Business logic in this module

- Public pages are not protected by auth.
- Canonical URLs and metadata are hardcoded to Sri Adithya domains.
- Legal text is client-specific.

## How this works (step by step)

1. A visitor opens a public URL.
2. `PublicRoutes` renders the matching page.
3. The page sets document title and metadata.
4. The visitor navigates to contact, login, or pricing.

## How to reuse this for a new client

- Replace every Sri Adithya name, address, phone, email, and domain.
- Replace legal text with the client's entity and jurisdiction.
- Replace facility descriptions and gallery images.
- Confirm SEO titles for the new city and hostel type.

**How this works:**
1. Public pages are static React screens.
2. They do not require API data.
3. Client identity must be replaced before deployment.

