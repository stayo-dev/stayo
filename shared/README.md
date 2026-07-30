# shared

Placeholder for code shared between `apps/frontend` and `apps/backend`.

Nothing lives here yet — today the two apps only communicate over HTTP
(`apps/frontend/src/lib/api-client.ts` → `apps/backend/app/api/*`), so there's no
shared TypeScript to extract. If that changes (e.g. shared Zod schemas or API
contract types), it belongs here.
