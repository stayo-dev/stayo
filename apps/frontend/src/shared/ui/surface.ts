/**
 * The app's ground: Stayo's graph-paper grid, and the phone-width frame every
 * full-screen surface sits in.
 *
 * Both were copy-pasted as a ~200-character Tailwind arbitrary-value string
 * into every screen that wanted them — `OwnerAppShell`, `TenantAppShell`,
 * `HostelDrilldownLayout`, `WorkQueue`, `HostelBuilderPage`,
 * `PendingVerificationsPage`, `TenantDetailPage`. Two consequences, both
 * observed: the copies had already drifted (the builder omits the frame), and
 * a screen written without one to copy from simply has no grid — which is how
 * the tenant claim flow, the first thing a tenant ever sees, ended up on flat
 * background while every screen around it had the texture.
 *
 * Naming it means a new surface can ask for the ground rather than remember a
 * string, and changing the grid is one edit rather than seven.
 *
 * Kept in `shared/` with no imports: this is a leaf, and the architecture
 * check enforces that `shared/` never reaches into `app`/`features`/
 * `platforms`.
 */

/**
 * The graph-paper texture — `#EBDCCF` hairlines on a 52px pitch.
 *
 * Pair with a `bg-background`: the grid is drawn as a background *image*, so
 * without a colour beneath it the lines sit on whatever the browser paints.
 */
export const APP_GRID =
  '[background-image:linear-gradient(#EBDCCF_1px,transparent_1px),linear-gradient(90deg,#EBDCCF_1px,transparent_1px)] [background-size:52px_52px]';

/**
 * The phone-width column a full-screen surface holds to on a desktop, with
 * edges so it reads as a device rather than a stretched page.
 */
export const APP_FRAME = 'sm:mx-auto sm:max-w-[480px] sm:border-x sm:border-border';

/** The usual combination: full height, brand ground, framed. */
export const APP_SURFACE = `min-h-screen bg-background ${APP_GRID} ${APP_FRAME}`;
