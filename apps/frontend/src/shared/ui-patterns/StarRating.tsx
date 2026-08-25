import { Star } from 'lucide-react';

/**
 * The 5-star row, extracted from three near-identical hand-rolled copies
 * (Discover's `ReviewsSection`, twice, and admin's `ReviewsPage`). A leaf
 * component — no import from `features/`, `app/` or `platforms/` — so it
 * stays usable from both the resident-facing and admin surfaces per
 * `check-architecture.mjs`'s `shared/` constraint.
 */
export function StarRating({
  value,
  size = 14,
  color = '#B46A55',
  emptyColor = '#DFD5C9',
  onRate,
  label,
}: {
  value: number;
  size?: number;
  /** Filled-star color; each surface passes its own theme accent. */
  color?: string;
  emptyColor?: string;
  /** Interactive when provided — renders buttons instead of a static readout. */
  onRate?: (star: number) => void;
  /** Prefix for each star's accessible label, e.g. "Cleanliness". Defaults to "Rating". */
  label?: string;
}) {
  if (!onRate) {
    return (
      <span className="flex items-center gap-0.5" aria-label={`${label ?? 'Rating'}: ${value} out of 5`}>
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className="flex-none"
            style={{
              width: size,
              height: size,
              color: star <= value ? color : emptyColor,
              fill: star <= value ? color : 'transparent',
            }}
            strokeWidth={1.8}
          />
        ))}
      </span>
    );
  }

  return (
    <span className="flex flex-none items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          aria-label={`${label ?? 'Rating'}: ${star} star${star > 1 ? 's' : ''}`}
          aria-pressed={value === star}
          onClick={() => onRate(star)}
          className="p-0.5 transition-transform active:scale-90"
        >
          <Star
            style={{
              width: size,
              height: size,
              color: star <= value ? color : emptyColor,
              fill: star <= value ? color : 'transparent',
            }}
            strokeWidth={1.8}
          />
        </button>
      ))}
    </span>
  );
}
