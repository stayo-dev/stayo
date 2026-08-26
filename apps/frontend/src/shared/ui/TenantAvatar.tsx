import { useState } from 'react';

/**
 * A tenant's face, wherever they appear.
 *
 * Owners recognise the people in their hostel by face long before they recall
 * a name or a room number, so the photo is the identity — not decoration. It
 * is uploaded at onboarding, has been on `tenants.photo_url` and on every list
 * endpoint the whole time, and was rendered nowhere.
 *
 * Falls back to initials when there is no photo *and* when the image fails to
 * load. A broken-image icon where a person's face should be reads as a broken
 * product, and these URLs point at a third-party CDN that can fail
 * independently of us.
 */

interface TenantAvatarProps {
  name: string;
  initials: string;
  photoUrl?: string | null;
  /** Tailwind sizing classes — the caller owns the scale. */
  className?: string;
  /** Rounded-square by default; circular where the surrounding rhythm is round. */
  shape?: 'square' | 'circle';
}

export function TenantAvatar({
  name,
  initials,
  photoUrl,
  className = 'h-11 w-11',
  shape = 'square',
}: TenantAvatarProps) {
  const [failed, setFailed] = useState(false);
  const radius = shape === 'circle' ? 'rounded-full' : 'rounded-2xl';

  if (photoUrl && !failed) {
    return (
      <span className={`flex-none overflow-hidden border border-border ${radius} ${className}`}>
        <img
          src={photoUrl}
          alt={name}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      </span>
    );
  }

  return (
    <span
      aria-label={name}
      className={`flex flex-none items-center justify-center bg-gradient-to-br from-primary to-foreground font-display font-extrabold text-primary-foreground ${radius} ${className}`}
    >
      {initials}
    </span>
  );
}
