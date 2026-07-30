# Shared

Framework-agnostic primitives live here.

- `ui/` exposes design-system primitives only.
- `hooks/`, `utils/`, and `lib/` must stay generic.
- `types/` contains cross-domain contracts and stable enums.
- `layouts/` is for reusable layout primitives, not role-specific pages.

Shared code must not import from `platforms`, `domains`, `features`, `portal`,
or backend API services.
