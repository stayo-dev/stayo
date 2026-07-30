import {
  Phone,
  MessageCircle,
  CircleDollarSign,
  Bell,
  Send,
  LogOut,
  History,
  FileCheck,
  MoreVertical,
} from 'lucide-react';
import { useTenantActions } from '@features/tenants/hooks/useTenantActions';

interface StickyOpsBarProps {
  tenantId: string;
  phone: string;
  status: string;
  outstandingAmount: number;
  isOverdue: boolean;
  onCollect?: () => void;
  onRemind?: () => void;
  onResend?: () => void;
  onMoveOut?: () => void;
  onSettlement?: () => void;
  onReceipt?: () => void;
  onHistory?: () => void;
}

export function StickyOpsBar({
  tenantId,
  phone,
  status,
  outstandingAmount,
  isOverdue,
  onCollect,
  onRemind,
  onResend,
  onMoveOut,
  onSettlement,
  onReceipt,
  onHistory,
}: StickyOpsBarProps) {
  const actions = useTenantActions(tenantId);
  const isInvited = status === 'INVITED';
  const isMoveOutRequested = status === 'MOVE_OUT_REQUESTED';
  const isInactive = ['LEFT', 'CANCELLED', 'EXPIRED'].includes(status);

  if (isInactive) return null;

  // Determine actions configuration based on tenant state
  const renderActions = () => {
    if (isInvited) {
      return (
        <>
          {onResend && (
            <button
              type="button"
              onClick={onResend}
              className="flex-1 min-w-[120px] md:flex-initial flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 text-sm font-semibold active:scale-95 transition-transform"
            >
              <Send className="w-4 h-4" />
              <span>Resend Invite</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => actions.callTenant(phone)}
            className="flex-1 min-w-[80px] md:flex-initial flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-secondary text-foreground text-sm font-medium active:scale-95 transition-transform"
          >
            <Phone className="w-4 h-4 text-muted-foreground" />
            <span>Call</span>
          </button>
          <button
            type="button"
            onClick={() => actions.whatsAppTenant(phone)}
            className="flex-1 min-w-[100px] md:flex-initial flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 text-sm font-medium active:scale-95 transition-transform"
          >
            <MessageCircle className="w-4 h-4" />
            <span>WhatsApp</span>
          </button>
        </>
      );
    }

    if (isMoveOutRequested) {
      return (
        <>
          {onSettlement && (
            <button
              type="button"
              onClick={onSettlement}
              className="flex-1 min-w-[120px] md:flex-initial flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-rose-500 text-rose-foreground text-sm font-semibold active:scale-95 transition-transform"
            >
              <LogOut className="w-4 h-4" />
              <span>Settlement</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => actions.callTenant(phone)}
            className="flex-1 min-w-[80px] md:flex-initial flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-secondary text-foreground text-sm font-medium active:scale-95 transition-transform"
          >
            <Phone className="w-4 h-4 text-muted-foreground" />
            <span>Call</span>
          </button>
          <button
            type="button"
            onClick={() => actions.whatsAppTenant(phone)}
            className="flex-1 min-w-[100px] md:flex-initial flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 text-sm font-medium active:scale-95 transition-transform"
          >
            <MessageCircle className="w-4 h-4" />
            <span>WhatsApp</span>
          </button>
        </>
      );
    }

    if (isOverdue) {
      return (
        <>
          {onCollect && (
            <button
              type="button"
              onClick={onCollect}
              className="flex-1 min-w-[100px] md:flex-initial flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-accent text-accent-foreground text-sm font-semibold active:scale-95 transition-transform"
            >
              <CircleDollarSign className="w-4 h-4" />
              <span>Collect</span>
            </button>
          )}
          {onRemind && (
            <button
              type="button"
              onClick={onRemind}
              className="flex-1 min-w-[100px] md:flex-initial flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-secondary text-foreground text-sm font-semibold active:scale-95 transition-transform"
            >
              <Bell className="w-4 h-4 text-muted-foreground" />
              <span>Remind</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => actions.callTenant(phone)}
            className="p-2.5 rounded-xl bg-secondary text-foreground hover:bg-secondary/80 active:scale-95 transition-all shrink-0"
            title="Call"
          >
            <Phone className="w-4.5 h-4.5" />
          </button>
          <button
            type="button"
            onClick={() => actions.whatsAppTenant(phone)}
            className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/20 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/30 active:scale-95 transition-all shrink-0"
            title="WhatsApp"
          >
            <MessageCircle className="w-4.5 h-4.5" />
          </button>
        </>
      );
    }

    // Default: Paid up / normal active tenant
    return (
      <>
        <button
          type="button"
          onClick={() => actions.callTenant(phone)}
          className="flex-1 min-w-[100px] md:flex-initial flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-secondary text-foreground text-sm font-medium active:scale-95 transition-transform"
        >
          <Phone className="w-4 h-4 text-muted-foreground" />
          <span>Call</span>
        </button>
        <button
          type="button"
          onClick={() => actions.whatsAppTenant(phone)}
          className="flex-1 min-w-[110px] md:flex-initial flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 text-sm font-medium active:scale-95 transition-transform"
        >
          <MessageCircle className="w-4 h-4" />
          <span>WhatsApp</span>
        </button>
        {onReceipt && (
          <button
            type="button"
            onClick={onReceipt}
            className="p-2.5 rounded-xl bg-secondary text-foreground hover:bg-secondary/80 active:scale-95 transition-all shrink-0"
            title="Receipt"
          >
            <FileCheck className="w-4.5 h-4.5" />
          </button>
        )}
        {onHistory && (
          <button
            type="button"
            onClick={onHistory}
            className="p-2.5 rounded-xl bg-secondary text-foreground hover:bg-secondary/80 active:scale-95 transition-all shrink-0"
            title="History"
          >
            <History className="w-4.5 h-4.5" />
          </button>
        )}
      </>
    );
  };

  return (
    <div className="sticky bottom-4 md:bottom-auto md:top-20 z-40 w-full">
      <div className="mx-4 md:mx-0 p-3 rounded-2xl border border-border/80 bg-background/85 dark:bg-card/90 backdrop-blur-xl shadow-lg md:shadow-sm flex items-center justify-between gap-3 overflow-x-auto scrollbar-hide">
        <div className="flex items-center gap-3 flex-1 min-w-0 md:flex-initial">
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
              Status Workspace
            </span>
            <span className="text-sm font-bold text-foreground truncate">
              {outstandingAmount > 0 ? `₹${outstandingAmount.toLocaleString('en-IN')} Outstanding` : 'Paid Up'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 max-w-full overflow-x-auto scrollbar-hide">
          {renderActions()}
          <button
            type="button"
            onClick={onMoveOut}
            className="p-2.5 rounded-xl bg-secondary text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 active:scale-95 transition-all shrink-0"
            title="Move Out Workflow"
          >
            <LogOut className="w-4.5 h-4.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
