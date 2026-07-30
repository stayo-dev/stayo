import { Users, UserCheck, Mail, DoorOpen, Percent, Wallet, AlertTriangle } from 'lucide-react';

const fmt = (n: number) => `₹${Number(n).toLocaleString('en-IN')}`;

interface DashboardProps {
  stats: {
    total: number;
    active: number;
    pendingInvites: number;
    moveOutRequests: number;
    occupancyRate: number;
    pendingDues: number;
    overdueTenants: number;
  };
}

export function TenantsDashboard({ stats }: DashboardProps) {
  const cards = [
    { label: 'Total tenants', value: stats.total, icon: Users },
    { label: 'Active', value: stats.active, icon: UserCheck },
    { label: 'Pending invites', value: stats.pendingInvites, icon: Mail },
    { label: 'Move-out requests', value: stats.moveOutRequests, icon: DoorOpen },
    {
      label: 'Occupancy',
      value: `${Math.round(stats.occupancyRate)}%`,
      icon: Percent,
    },
    { label: 'Pending dues', value: fmt(stats.pendingDues), icon: Wallet },
    { label: 'Overdue', value: stats.overdueTenants, icon: AlertTriangle, warn: true },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map(({ label, value, icon: Icon, warn }) => (
        <div
          key={label}
          className="bg-card border border-border rounded-xl p-3 min-w-0 backdrop-blur-sm"
        >
          <div className="flex items-center gap-2 mb-1">
            <Icon
              className={`w-3.5 h-3.5 shrink-0 ${warn ? 'text-destructive' : 'text-accent'}`}
            />
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide truncate">
              {label}
            </span>
          </div>
          <p
            className={`text-lg font-bold truncate ${warn && Number(stats.overdueTenants) > 0 ? 'text-destructive' : 'text-foreground'}`}
          >
            {value}
          </p>
        </div>
      ))}
    </div>
  );
}
