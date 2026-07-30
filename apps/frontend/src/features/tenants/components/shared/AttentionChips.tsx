import {
  Landmark,
  FileWarning,
  FileSearch,
  LogOut,
  ArrowUpRight,
  ClipboardCheck,
  UserX,
  UserCog,
} from 'lucide-react';
import type { NormalizedTenant } from '@features/tenants/utils/normalize';

interface AttentionChipsProps {
  tenant: NormalizedTenant;
  className?: string;
}

export function AttentionChips({ tenant, className = '' }: AttentionChipsProps) {
  const chips: {
    label: string;
    show: boolean;
    bgColor: string;
    textColor: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    {
      label: 'Deposit Pending',
      show: tenant.securityDeposit > 0 && tenant.depositStatus !== 'PAID',
      bgColor: 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/30',
      textColor: 'text-amber-700 dark:text-amber-400',
      icon: Landmark,
    },
    {
      label: 'Agreement Missing',
      show: tenant.hasAgreement === false && tenant.status === 'ACTIVE',
      bgColor: 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/30',
      textColor: 'text-red-700 dark:text-red-400',
      icon: FileWarning,
    },
    {
      label: 'Documents Pending',
      show: tenant.documentVerified === false,
      bgColor: 'bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900/30',
      textColor: 'text-orange-700 dark:text-orange-400',
      icon: FileSearch,
    },
    {
      label: 'Move Out Requested',
      show: tenant.status === 'MOVE_OUT_REQUESTED',
      bgColor: 'bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/30',
      textColor: 'text-rose-700 dark:text-rose-400',
      icon: LogOut,
    },
    {
      label: 'Advance Credit',
      show: tenant.advanceBalance > 0,
      bgColor: 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/30',
      textColor: 'text-emerald-700 dark:text-emerald-400',
      icon: ArrowUpRight,
    },
    {
      label: 'Partial Payment',
      show: tenant.paymentStatus === 'PARTIAL',
      bgColor: 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/30',
      textColor: 'text-blue-700 dark:text-blue-400',
      icon: ClipboardCheck,
    },
    {
      label: 'Guardian Unverified',
      show: !tenant.guardianPhone,
      bgColor: 'bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-900/30',
      textColor: 'text-yellow-700 dark:text-yellow-400',
      icon: UserX,
    },
    {
      label: 'Profile Incomplete',
      show: tenant.isProfileCompleted === false,
      bgColor: 'bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-900/30',
      textColor: 'text-purple-700 dark:text-purple-400',
      icon: UserCog,
    },
  ];

  const visibleChips = chips.filter((c) => c.show);

  if (visibleChips.length === 0) return null;

  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {visibleChips.map((chip) => {
        const Icon = chip.icon;
        return (
          <div
            key={chip.label}
            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border text-[10px] font-medium leading-none ${chip.bgColor} ${chip.textColor}`}
          >
            <Icon className="w-2.5 h-2.5 shrink-0" />
            <span>{chip.label}</span>
          </div>
        );
      })}
    </div>
  );
}
