/**
 * What `<MasterDetail>` renders, decided purely from viewport + route.
 *
 *   desktop            → 'both'   (list column + detail pane, side by side)
 *   mobile, no detail  → 'list'   (today's full-screen list)
 *   mobile, detail     → 'detail' (today's full-screen takeover)
 *
 * The mobile branches are exactly what the app does now — the list route and
 * the detail route each own the viewport. `<MasterDetail>` at `< lg` is a
 * passthrough that renders one or the other; only at `lg+` does it compose them.
 */
export function masterDetailBranch({
  isDesktop,
  hasSelection,
}: {
  isDesktop: boolean;
  hasSelection: boolean;
}): 'both' | 'list' | 'detail' {
  if (isDesktop) return 'both';
  return hasSelection ? 'detail' : 'list';
}
