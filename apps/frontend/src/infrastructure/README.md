# Infrastructure

Low-level adapters live here.

- `api/` wraps the HTTP client.
- `query/` wraps React Query setup.
- `auth/` is reserved for storage/session adapters.
- `storage/` is reserved for browser storage adapters.

Feature code should depend on infrastructure adapters rather than constructing
network clients directly in components.
