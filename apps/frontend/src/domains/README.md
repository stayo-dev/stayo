# Domains

New business logic belongs here, grouped by product domain.

Each active domain keeps the same migration-safe shape:

- `api/` for backend contracts and service wrappers
- `hooks/` for React Query and domain state hooks
- `model/` for domain state and transformations
- `types/` for domain-specific types only
- `utils/` for pure domain helpers
- `constants/` for stable domain values
- `components/` for domain-aware UI, not generic primitives

The old `src/features/*` folders remain as compatibility providers during the
migration. New imports should prefer `src/domains/*` once a wrapper exists.
