import { getInitials } from '@features/tenants/utils/normalize';
import { photoThumbnail } from '@shared/lib/photoThumbnail';
import { TenantAvatar } from '@shared/ui/TenantAvatar';
import type { BedSlot, Emphasis } from './buildingModel';

/**
 * One bed, drawn: the tenant's face, a dashed amber square for someone
 * invited, or a dashed "+" for a free bed. Decorative — the room tile's
 * `aria-label` says who is in it.
 *
 * Two sizes: `tile` for the squares packed into a room on the building, and
 * `sheet` for the row of beds at the top of a room's sheet.
 */
const SIZES = {
  tile: { px: 23, box: 'h-[23px] w-[23px]', text: 'text-[8.5px]', dot: 'h-[7px] w-[7px] -right-[3px] -top-[3px] ring-2', radius: 'rounded-[6px]' },
  sheet: { px: 52, box: 'h-[52px] w-[52px]', text: 'text-[15px]', dot: 'h-3 w-3 -right-1 -top-1 ring-[3px]', radius: 'rounded-2xl' },
} as const;

const GLOW: Record<BedSlot['kind'], string> = {
  tenant: 'ring-2 ring-destructive ring-offset-1 ring-offset-card',
  invited: 'ring-2 ring-warning ring-offset-1 ring-offset-card',
  free: 'ring-2 ring-success ring-offset-1 ring-offset-card',
};

export function BedFace({ slot, size = 'tile', emphasis = 'normal' }: { slot: BedSlot; size?: keyof typeof SIZES; emphasis?: Emphasis }) {
  const s = SIZES[size];
  const state = emphasis === 'dim' ? 'opacity-25' : emphasis === 'glow' ? GLOW[slot.kind] : '';
  const base = `relative block flex-none transition-[opacity,box-shadow] duration-200 motion-reduce:transition-none ${s.box} ${s.radius} ${state}`;

  if (slot.kind === 'tenant') {
    return (
      <span aria-hidden="true" className={base}>
        <TenantAvatar
          name={slot.name}
          initials={getInitials(slot.name)}
          photoUrl={photoThumbnail(slot.photoUrl, s.px)}
          shape={size === 'sheet' ? 'square' : 'tile'}
          className={`${s.box} ${s.text}`}
        />
        {slot.overdue && <span className={`absolute rounded-full bg-destructive ring-card ${s.dot}`} />}
      </span>
    );
  }

  if (slot.kind === 'invited') {
    return (
      <span
        aria-hidden="true"
        className={`${base} flex items-center justify-center border-[1.5px] border-dashed border-warning/70 bg-warning-bg font-display font-extrabold text-warning ${s.text}`}
      >
        {slot.name ? getInitials(slot.name) : ''}
      </span>
    );
  }

  const freeGlow = emphasis === 'glow' ? 'border-success text-success bg-success-bg' : 'border-border bg-muted text-muted-foreground/70';
  return (
    <span
      aria-hidden="true"
      className={`${base} flex items-center justify-center border-[1.5px] border-dashed font-semibold ${freeGlow} ${size === 'sheet' ? 'text-xl' : 'text-[12px]'}`}
    >
      +
    </span>
  );
}
