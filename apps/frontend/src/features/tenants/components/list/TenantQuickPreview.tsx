import {
  X,
  Phone,
  MessageCircle,
  Copy,
  ExternalLink,
  Shield,
  FileText,
  DollarSign,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/app/components/ui/drawer';
import { getInitials, type NormalizedTenant } from '@features/tenants/utils/normalize';
import { AttentionChips } from '../shared/AttentionChips';
import { ContactActionRow } from '../shared/ContactActionRow';
import type { useTenantActions } from '@features/tenants/hooks/useTenantActions';

const fmt = (n: number) => `₹${Number(n).toLocaleString('en-IN')}`;

interface TenantQuickPreviewProps {
  open: boolean;
  onClose: () => void;
  tenant: NormalizedTenant;
  actions: ReturnType<typeof useTenantActions>;
  onFullProfile: () => void;
  onCollect?: () => void;
  onReminder?: () => void;
}

export function TenantQuickPreview({
  open,
  onClose,
  tenant,
  actions,
  onFullProfile,
  onCollect,
  onReminder,
}: TenantQuickPreviewProps) {
  const isHighRisk = tenant.score !== null && tenant.score < 70;

  return (
    <Drawer open={open} onOpenChange={(v) => !v && onClose()} direction="right">
      <DrawerContent className="h-full w-full sm:max-w-md border-l border-border bg-background shadow-2xl flex flex-col focus:outline-none">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <DrawerHeader className="p-0">
            <DrawerTitle className="text-lg font-bold text-foreground">
              Quick Tenant Details
            </DrawerTitle>
          </DrawerHeader>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-hide">
          {/* Tenant Card Hero */}
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-full bg-accent/15 overflow-hidden flex items-center justify-center text-lg font-semibold text-accent shrink-0">
              {tenant.photoUrl ? (
                <img
                  src={tenant.photoUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                getInitials(tenant.name)
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-bold text-foreground truncate">{tenant.name}</h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                Room {tenant.room} · Rent {fmt(tenant.rent)}/mo
              </p>
              {tenant.hostelName && (
                <span className="inline-block text-xs px-2 py-0.5 mt-1.5 rounded-md bg-secondary text-secondary-foreground font-medium border border-border">
                  {tenant.hostelName}
                </span>
              )}
            </div>
          </div>

          {/* Attention Chips */}
          <div className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Attention items
            </span>
            <AttentionChips tenant={tenant} />
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3.5 rounded-xl border border-border bg-card">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                <DollarSign className="w-3.5 h-3.5" />
                <span>Outstanding Dues</span>
              </div>
              <p
                className={`text-xl font-bold mt-1 ${
                  tenant.outstandingAmount > 0 ? 'text-destructive' : 'text-emerald-600'
                }`}
              >
                {fmt(tenant.outstandingAmount)}
              </p>
              {tenant.overdueDays > 0 && (
                <p className="text-xs text-rose-500 font-medium mt-0.5">
                  {tenant.overdueDays} Days Overdue
                </p>
              )}
            </div>

            <div className="p-3.5 rounded-xl border border-border bg-card">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                <Shield className="w-3.5 h-3.5" />
                <span>Reliability Score</span>
              </div>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-xl font-bold text-foreground">
                  {tenant.score !== null ? `${tenant.score}/100` : 'N/A'}
                </span>
                {tenant.score !== null && (
                  <span>
                    {isHighRisk ? (
                      <TrendingDown className="w-4 h-4 text-rose-500 inline shrink-0 align-text-bottom" />
                    ) : (
                      <TrendingUp className="w-4 h-4 text-emerald-500 inline shrink-0 align-text-bottom" />
                    )}
                  </span>
                )}
              </div>
              {tenant.score !== null && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isHighRisk ? 'Needs Attention' : 'Excellent payer'}
                </p>
              )}
            </div>
          </div>

          {/* Contact Details */}
          <div className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">
              Contact Details
            </span>
            <div className="space-y-2">
              <ContactActionRow
                label="Tenant"
                name={tenant.name}
                phone={tenant.phone}
                onCall={actions.callTenant}
                onWhatsApp={actions.whatsAppTenant}
                onCopy={actions.copyPhone}
              />
              {tenant.guardianPhone && (
                <ContactActionRow
                  label="Guardian"
                  phone={tenant.guardianPhone}
                  onCall={actions.callTenant}
                  onWhatsApp={actions.whatsAppTenant}
                  onCopy={actions.copyPhone}
                />
              )}
            </div>
          </div>

          {/* Agreement Status */}
          <div className="p-3.5 rounded-xl border border-border bg-card space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-foreground">Lease Agreement</span>
              </div>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  tenant.hasAgreement
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400'
                    : 'bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400'
                }`}
              >
                {tenant.hasAgreement ? 'Active Lease' : 'No Agreement'}
              </span>
            </div>
            {tenant.lastPaymentDate && (
              <div className="text-xs text-muted-foreground flex justify-between border-t border-border/50 pt-2">
                <span>Last Payment:</span>
                <span className="font-medium text-foreground">{tenant.lastPaymentDate}</span>
              </div>
            )}
          </div>
        </div>

        {/* Action Footer */}
        <div className="p-4 border-t border-border bg-secondary/20 flex flex-col gap-2 shrink-0">
          <div className="flex gap-2">
            {onCollect && tenant.outstandingAmount > 0 && (
              <button
                type="button"
                onClick={onCollect}
                className="flex-1 py-2.5 rounded-xl bg-accent text-accent-foreground hover:bg-accent/90 transition-all font-semibold text-sm shadow-sm"
              >
                Record Payment
              </button>
            )}
            {onReminder && tenant.outstandingAmount > 0 && tenant.status === 'ACTIVE' && (
              <button
                type="button"
                onClick={() => onReminder(tenant)}
                className="flex-1 py-2.5 rounded-xl bg-secondary text-foreground hover:bg-secondary/80 border border-border transition-all font-medium text-sm"
              >
                Send Reminder
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onFullProfile}
            className="w-full py-2.5 rounded-xl bg-secondary text-foreground hover:bg-secondary/80 border border-border transition-all font-medium text-sm flex items-center justify-center gap-1.5"
          >
            <span>Go to Operations Dashboard</span>
            <ExternalLink className="w-4 h-4" />
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
