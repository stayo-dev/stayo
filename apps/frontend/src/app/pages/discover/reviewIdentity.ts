/**
 * A reviewer's initials, for the avatar circle. Reviews carry no photo — the
 * author is a privacy-preserving display string like "Sharan K." — so this
 * mirrors `DiscoverProfilePage.tsx`'s own `initials()` helper rather than
 * inventing a second convention for the same idea.
 */
export function reviewerInitials(author: string | undefined | null): string {
  if (!author || !author.trim()) return 'S';
  const initials = author
    .trim()
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return initials || 'S';
}
