# Platforms

Role-specific routes, pages, and layout orchestration live here.

- `owner/` owns owner dashboard routes and owner-only page composition.
- `tenant/` owns tenant portal routes. The legacy `src/portal` tree is frozen
  and should be migrated gradually behind these route seams.
- `admin/` is reserved for platform administration routes.
- `warden/` is reserved for future operational staff routes.

Platform folders may compose domain modules and shared UI. They should not
contain raw API calls or reusable business logic.
