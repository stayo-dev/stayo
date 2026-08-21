import type { ReactNode } from 'react';

/**
 * The title block at the top of a tenant screen — My Room, My Menu, Payments.
 *
 * **Sticky, not scrolled away.** Each page used to render its own title as the
 * first item in the scrolling column, so "My Room" left the screen the moment
 * you looked at anything in the room, and a resident scrolling their payment
 * history had nothing telling them which screen they were on. The tab bar at
 * the bottom says where you are going; this says where you are.
 *
 * It sits on the page's own paper ground rather than a slab of colour — the
 * dark header this replaces cost 120px of a phone screen to say one word.
 * `backdrop-blur` plus a translucent ground keeps the graph-paper texture
 * visible underneath while content passes behind it legibly.
 */
export function TenantPageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: ReactNode;
  /** The date on Food, the room chip on Payments — screen-specific context. */
  right?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-20 border-b border-border/60 bg-background/85 px-5 pb-3 pt-[max(1.25rem,env(safe-area-inset-top))] backdrop-blur-md sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate font-display text-[22px] font-extrabold tracking-[-0.03em] text-foreground">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-0.5 truncate text-[12px] font-medium text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {right && <div className="flex-none">{right}</div>}
      </div>
    </div>
  );
}
