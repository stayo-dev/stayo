# Legacy Tenant Portal

This tree is intentionally frozen.

As of the 2026-07-26 tenant-app rebuild, `src/platforms/tenant` owns all 5 tenant
tabs directly. Only pages still reached by a real route remain here — everything
else that was salvaged into the new tenant app (Home/Money/Room/dashboard) has
been deleted. Remaining files and why each is still live:

- `pages/ActivateAccountPage.tsx`, `pages/CompleteProfilePage.tsx` — public onboarding routes.
- `pages/TenantProfilePortalPage.tsx` — mounted at `/tenant/profile/details`.
- `pages/TenantMoveOutPage.tsx` — mounted at `/tenant/move-out`.
- `pages/TenantPaymentReturnPage.tsx` — mounted at `/payment-return` (PhonePe checkout redirect target).
- `components/QrCodeImage.tsx` — reused by the unrelated owner-side Admissions QR feature.
- `components/profile/ProfileSection.tsx` — used by `TenantProfilePortalPage`.
- `utils/payableObligations.ts` — reused by the owner-side Quick Collect modal.

Do not add new tenant pages or business logic in `src/portal`; place new tenant
work under `src/platforms/tenant` and `src/domains/*`. The allowlist in
`scripts/check-architecture.mjs` enforces this file list exactly — update both
in the same change if a file here is ever added or removed.
