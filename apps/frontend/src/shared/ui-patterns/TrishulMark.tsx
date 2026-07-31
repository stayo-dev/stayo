/**
 * Trishul Solutions mark — the three strokes rising from one point
 * (Solve · Simplify · Scale), inlined from the official brand asset
 * (mark/trishul-mark-*.svg). Stroke/fill use `currentColor` so a single
 * component adapts to any surface (white on the dark footer, terracotta on
 * light) — set the colour via a Tailwind text-* class on the element.
 *
 * Kept deliberately small and self-contained (no imports) so it stays a
 * valid leaf under src/shared per scripts/check-architecture.mjs.
 */
interface TrishulMarkProps {
  className?: string;
  title?: string;
}

export function TrishulMark({ className, title = 'Trishul Solutions' }: TrishulMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 80 80"
      role="img"
      aria-label={title}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={8}
      strokeLinecap="round"
    >
      <title>{title}</title>
      <path d="M40 70 L40 12" />
      <path d="M40 70 L20 33" />
      <path d="M40 70 L60 33" />
      <circle cx="40" cy="70" r="4.7" fill="currentColor" stroke="none" />
    </svg>
  );
}
