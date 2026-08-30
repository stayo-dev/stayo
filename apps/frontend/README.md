# Stayo — owner app, tenant portal and public site

The canonical UI for Stayo, an AI-powered hostel management platform by
Trishul Solutions. Vite + React 19 SPA covering three audiences from one build:

- **Owner app** (`src/platforms/owner`) — the hostel operator's day-to-day tool.
- **Tenant portal** (`src/platforms/tenant`) — residents: dues, agreements, food.
- **Public site** (`src/app/pages/public`, `src/app/pages/discover`) — marketing
  and hostel listings.

The API this talks to is `apps/backend`. See the repository root `CLAUDE.md` for
which trees are live — `frontend/` and `temp-ui/` at the root are legacy and are
not deploy targets.

## Running the code

```bash
npm i        # install dependencies
npm run dev  # Vite dev server
npm test     # vitest — node environment only, `src/**/*.test.ts`
npm run build
```

`npm run build` runs `check:architecture`, then `vite build`, then the branding
check — the build fails if any of them do.

**`npm run build` does not typecheck.** Vite builds with esbuild, which skips
type checking entirely, so run `npx tsc --noEmit -p tsconfig.json
--ignoreDeprecations 6.0` before pushing and filter the output to your own
files.

## Brand

Assets, colour tokens and typography live in `Stayo-Brand-Assetes/` at the
repository root — open its `index.html` for a visual overview.
