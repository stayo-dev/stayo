import { useState } from 'react';
import { motion, useMotionValue, useSpring } from 'motion/react';
import { useDrag } from '@use-gesture/react';
import {
  Phone,
  MessageCircle,
  MoreHorizontal,
  Bell,
  Send,
  TrendingDown,
  TrendingUp,
  CircleDollarSign,
  ChevronRight,
  Shield,
  Clock,
  Calendar,
} from 'lucide-react';
import { TenantStatusBadge } from '@features/tenants/components/badges/TenantStatusBadge';
import type { NormalizedTenant } from '@features/tenants/utils/normalize';
import { AttentionChips } from '../shared/AttentionChips';
import { TenantCardMoreSheet } from './TenantCardMoreSheet';
import { useTenantActions } from '@features/tenants/hooks/useTenantActions';

const fmt = (n: number) => `₹${Number(n).toLocaleString('en-IN')}`;

const formatDate = (val: string | null) => {
  if (!val) return '';
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return val;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  } catch (e) {
    return val;
  }
};

interface TenantCardProps {
  tenant: NormalizedTenant;
  mode: 'global' | 'hostel';
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  onSelect?: (tenant: NormalizedTenant) => void;
  onCollect?: (tenant: NormalizedTenant) => void;
  onReminder?: (tenant: NormalizedTenant) => void;
  onResend?: (tenant: NormalizedTenant) => void;
}

export function TenantCard({
  tenant,
  mode,
  selected = false,
  onToggleSelect,
  onSelect,
  onCollect,
  onReminder,
  onResend,
}: TenantCardProps) {
  const actions = useTenantActions(tenant.hostelId);
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  // Swipe gesture setup
  const x = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 400, damping: 40 });
  const [swipedDir, setSwipedDir] = useState<'none' | 'left' | 'right'>('none');

  const bind = useDrag(
    ({ down, movement: [mx], cancel, active }) => {
      // Don't swipe on desktop/mouse unless it's a touch emulation or explicitly dragged
      if (Math.abs(mx) > 120 && cancel) {
        cancel();
      }

      // If active (dragging), update x
      if (active) {
        // Cap movement to prevent infinite sliding
        const cappedX = Math.max(-140, Math.min(140, mx));
        x.set(cappedX);
      } else {
        // Drag ended
        if (mx < -70) {
          x.set(-140);
          setSwipedDir('left');
        } else if (mx > 70) {
          x.set(140);
          setSwipedDir('right');
        } else {
          x.set(0);
          setSwipedDir('none');
        }
      }
    },
    {
      axis: 'x',
      filterTaps: true,
      pointer: { touch: true },
    }
  );

  const resetSwipe = () => {
    x.set(0);
    setSwipedDir('none');
  };

  const handleCardClick = () => {
    if (swipedDir !== 'none') {
      resetSwipe();
      return;
    }
    if (onSelect) {
      onSelect(tenant);
    }
  };

  const isInactive = tenant.status === 'INACTIVE';
  const isOverdue = tenant.outstandingAmount > 0;
  const isInvited = tenant.status === 'INVITED';

  // Computed reliability risk
  const isHighRisk = tenant.score !== null && tenant.score < 70;

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card select-none">
      {/* Swipe actions background (left side - swipe right to reveal) */}
      <div className="absolute inset-0 flex items-center justify-start pl-4 bg-emerald-50 dark:bg-emerald-950/20 z-0">
        <div className="flex gap-4 text-emerald-700 dark:text-emerald-400">
          <button
            type="button"
            onClick={() => {
              actions.callTenant(tenant.phone);
              resetSwipe();
            }}
            className="flex flex-col items-center gap-1 hover:scale-105 active:scale-95 transition-all"
          >
            <Phone className="w-5 h-5" />
            <span className="text-[10px] font-bold uppercase">Call</span>
          </button>
          <button
            type="button"
            onClick={() => {
              actions.whatsAppTenant(tenant.phone);
              resetSwipe();
            }}
            className="flex flex-col items-center gap-1 hover:scale-105 active:scale-95 transition-all"
          >
            <MessageCircle className="w-5 h-5" />
            <span className="text-[10px] font-bold uppercase">WhatsApp</span>
          </button>
        </div>
      </div>

      {/* Swipe actions background (right side - swipe left to reveal) */}
      <div className="absolute inset-0 flex items-center justify-end pr-4 bg-accent/15 z-0">
        <div className="flex gap-4 text-accent">
          {onCollect && isOverdue && (
            <button
              type="button"
              onClick={() => {
                onCollect(tenant);
                resetSwipe();
              }}
              className="flex flex-col items-center gap-1 hover:scale-105 active:scale-95 transition-all"
            >
              <CircleDollarSign className="w-5 h-5" />
              <span className="text-[10px] font-bold uppercase">Collect</span>
            </button>
          )}
          {onReminder && isOverdue && tenant.status === 'ACTIVE' && (
            <button
              type="button"
              onClick={() => {
                onReminder(tenant);
                resetSwipe();
              }}
              className="flex flex-col items-center gap-1 hover:scale-105 active:scale-95 transition-all"
            >
              <Bell className="w-5 h-5" />
              <span className="text-[10px] font-bold uppercase">Remind</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Card Content */}
      <motion.div
        {...bind()}
        style={{ x: springX }}
        onClick={handleCardClick}
        className={`relative z-10 bg-card border-none p-2.5 sm:p-3 cursor-pointer select-none touch-pan-y transition-opacity ${
          isInactive ? 'opacity-60 pointer-events-none' : ''
        }`}
      >
        <div className="flex items-start gap-2">
          {/* Checkbox for batch actions */}
          {onToggleSelect && !isInactive && (
            <div
              className="mt-1.5 shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelect(tenant.id);
              }}
            >
              <input
                type="checkbox"
                checked={selected}
                readOnly
                className="h-4 w-4 rounded border-border text-accent focus:ring-accent cursor-pointer"
                aria-label={`Select ${tenant.name}`}
              />
            </div>
          )}

          {/* Avatar / Initials */}
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-accent/15 overflow-hidden flex items-center justify-center text-xs sm:text-sm font-semibold text-accent shrink-0">
            {tenant.photoUrl ? (
              <img src={tenant.photoUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : (
              tenant.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
            )}
          </div>

          {/* Info Details */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-foreground truncate text-sm sm:text-base">{tenant.name}</span>
              <TenantStatusBadge status={tenant.status} />
            </div>

            {/* Room, Rent, and Hostel Badge (if global mode) */}
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className="text-xs text-muted-foreground font-medium">
                Room {tenant.room} · {fmt(tenant.rent)}/mo
              </span>
              {mode === 'global' && tenant.hostelName && (
                <span className="inline-block text-[10px] px-1.5 py-0.2 rounded bg-secondary text-secondary-foreground font-semibold border border-border">
                  {tenant.hostelName}
                </span>
              )}
            </div>

            {/* Operational Priority Context Strip */}
            {!isInactive && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pt-1.5 border-t border-border/50 text-[10.5px] text-muted-foreground">
                {/* Due Amount Context */}
                <span className="flex items-center gap-0.5 font-semibold text-foreground shrink-0">
                  <CircleDollarSign className="w-3 h-3 text-muted-foreground shrink-0" />
                  <span className={isOverdue ? 'text-destructive font-bold' : 'text-emerald-600 font-bold'}>
                    {fmt(tenant.outstandingAmount)} Due
                  </span>
                </span>

                {/* Overdue / Due Date */}
                {tenant.overdueDays > 0 ? (
                  <span className="text-rose-500 font-semibold shrink-0">
                    {tenant.overdueDays}d overdue
                  </span>
                ) : tenant.dueDate ? (
                  <span className="flex items-center gap-0.5 shrink-0">
                    <Calendar className="w-3.5 h-3.5 shrink-0" />
                    <span>Next: {formatDate(tenant.dueDate)}</span>
                  </span>
                ) : (
                  <span className="shrink-0">No active dues</span>
                )}

                {/* Reliability Score */}
                {tenant.score !== null ? (
                  <span className="flex items-center gap-0.5 font-semibold text-foreground shrink-0">
                    <Shield className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span>Trust: {tenant.score}%</span>
                    {isHighRisk ? (
                      <TrendingDown className="w-2.5 h-2.5 text-rose-500 shrink-0" />
                    ) : (
                      <TrendingUp className="w-2.5 h-2.5 text-emerald-500 shrink-0" />
                    )}
                  </span>
                ) : (
                  <span className="font-semibold text-foreground shrink-0">Score: N/A</span>
                )}

                {/* Last Payment */}
                {tenant.lastPaymentDate ? (
                  <span className="flex items-center gap-0.5 text-muted-foreground shrink-0">
                    <Clock className="w-3 h-3 shrink-0" />
                    <span>Last: {formatDate(tenant.lastPaymentDate)}</span>
                  </span>
                ) : (
                  <span className="shrink-0">No pay history</span>
                )}
              </div>
            )}

            {/* Reusable Attention Chips */}
            {!isInactive && (
              <AttentionChips tenant={tenant} className="mt-1.5" />
            )}
          </div>
        </div>

        {/* Action Bar (Buttons for single-click actions) */}
        {!isInactive && (
          <div
            className="flex items-center justify-between gap-1.5 mt-2 pt-1.5 border-t border-border"
            onClick={(e) => e.stopPropagation()}
          >
            {isOverdue && tenant.status === 'ACTIVE' ? (
              <>
                {onCollect && (
                  <button
                    type="button"
                    onClick={() => onCollect(tenant)}
                    className="flex-1 py-1 sm:py-1.5 rounded-lg bg-accent text-accent-foreground text-xs font-semibold hover:bg-accent/90 active:scale-98 transition-all shrink-0"
                  >
                    Collect
                  </button>
                )}
                {onReminder && (
                  <button
                    type="button"
                    onClick={() => onReminder(tenant)}
                    className="flex-1 py-1 sm:py-1.5 rounded-lg bg-secondary text-foreground text-xs font-medium hover:bg-secondary/80 active:scale-98 transition-all shrink-0"
                  >
                    Remind
                  </button>
                )}
              </>
            ) : isInvited ? (
              <>
                {onResend && (
                  <button
                    type="button"
                    onClick={() => onResend(tenant)}
                    className="flex-1 py-1 sm:py-1.5 rounded-lg bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400 text-xs font-semibold hover:bg-amber-100 dark:hover:bg-amber-950/30 active:scale-98 transition-all shrink-0 flex items-center justify-center gap-1"
                  >
                    <Send className="w-3 h-3" />
                    <span>Resend Invite</span>
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => actions.callTenant(tenant.phone)}
                  className="flex-1 py-1 sm:py-1.5 rounded-lg bg-secondary text-foreground text-xs font-medium hover:bg-secondary/80 active:scale-98 transition-all shrink-0"
                >
                  Call Tenant
                </button>
              </>
            )}

            {/* Quick call/whatsapp buttons for active/invited tenants */}
            {(isOverdue || isInvited) && (
              <>
                <button
                  type="button"
                  onClick={() => actions.callTenant(tenant.phone)}
                  className="p-1.5 sm:p-2 rounded-lg bg-secondary text-foreground hover:bg-secondary/80 active:scale-95 transition-all shrink-0"
                  title="Call Tenant"
                >
                  <Phone className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => actions.whatsAppTenant(tenant.phone)}
                  className="p-1.5 sm:p-2 rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/20 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/30 active:scale-95 transition-all shrink-0"
                  title="WhatsApp Tenant"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                </button>
              </>
            )}

            {/* More Menu Sheet Trigger */}
            <button
              type="button"
              onClick={() => setIsMoreOpen(true)}
              className="p-1.5 sm:p-2 rounded-lg bg-secondary text-foreground hover:bg-secondary/80 active:scale-95 transition-all shrink-0 flex items-center gap-0.5"
              title="More Actions"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </motion.div>

      {/* More actions sheet */}
      {!isInactive && (
        <TenantCardMoreSheet
          open={isMoreOpen}
          onClose={() => setIsMoreOpen(false)}
          tenant={tenant}
          actions={actions}
          onSelect={() => onSelect?.(tenant)}
          onCollect={onCollect ? () => onCollect(tenant) : undefined}
          onReminder={onReminder ? () => onReminder(tenant) : undefined}
          onResend={onResend ? () => onResend(tenant) : undefined}
        />
      )}
    </div>
  );
}
