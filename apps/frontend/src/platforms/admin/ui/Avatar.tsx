import { useState } from 'react';

/**
 * A person's photo when one exists, initials-on-a-tint otherwise.
 *
 * The initials tile is the fallback, never the primary — this exists so
 * every avatar in the console (owner rows, the owner drawer, converted
 * leads) resolves a real photo the same one way, instead of each screen
 * re-deciding when to trust `photoUrl`. A broken/expired image URL falls
 * back to initials rather than showing a broken-image icon.
 */
export function Avatar({
  photoUrl, initials, tint, size = 36, radius = 'rounded-full', className = '',
}: {
  photoUrl?: string | null;
  initials: string;
  tint: string;
  size?: number;
  radius?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (photoUrl && !failed) {
    return (
      <img
        src={photoUrl}
        alt=""
        onError={() => setFailed(true)}
        className={`flex-none object-cover ${radius} ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className={`flex flex-none items-center justify-center font-admin font-bold text-white ${radius} ${className}`}
      style={{ width: size, height: size, background: tint, fontSize: Math.max(10, Math.round(size * 0.34)) }}
    >
      {initials}
    </span>
  );
}
