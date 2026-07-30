import { Clock, CheckCircle2, XCircle, Timer, Hourglass, Ban, Replace, CalendarClock, FileEdit } from 'lucide-react';

/**
 * Universal Change Status vocabulary.
 * Maps internal backend statuses to human-readable labels, colors, and icons.
 * Owner and Tenant see different labels for the same status.
 */

export type ChangeStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'APPLIED'
  | 'REJECTED'
  | 'SUPERSEDED'
  | 'EXPIRED'
  | 'CANCELLED';

export interface StatusConfig {
  ownerLabel: string;
  tenantLabel: string;
  color: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
  icon: typeof Clock;
}

export const STATUS_CONFIG: Record<ChangeStatus, StatusConfig> = {
  DRAFT: {
    ownerLabel: 'Draft',
    tenantLabel: 'Draft',
    color: 'gray',
    bgClass: 'bg-zinc-100 dark:bg-zinc-800/40',
    textClass: 'text-zinc-600 dark:text-zinc-400',
    borderClass: 'border-zinc-200 dark:border-zinc-700',
    icon: FileEdit,
  },
  PENDING: {
    ownerLabel: 'Waiting for Approval',
    tenantLabel: 'Review Required',
    color: 'amber',
    bgClass: 'bg-amber-50 dark:bg-amber-950/30',
    textClass: 'text-amber-700 dark:text-amber-400',
    borderClass: 'border-amber-200 dark:border-amber-800',
    icon: Clock,
  },
  APPROVED: {
    ownerLabel: 'Approved',
    tenantLabel: 'Approved',
    color: 'blue',
    bgClass: 'bg-blue-50 dark:bg-blue-950/30',
    textClass: 'text-blue-700 dark:text-blue-400',
    borderClass: 'border-blue-200 dark:border-blue-800',
    icon: CheckCircle2,
  },
  SCHEDULED: {
    ownerLabel: 'Scheduled',
    tenantLabel: 'Scheduled',
    color: 'violet',
    bgClass: 'bg-violet-50 dark:bg-violet-950/30',
    textClass: 'text-violet-700 dark:text-violet-400',
    borderClass: 'border-violet-200 dark:border-violet-800',
    icon: CalendarClock,
  },
  APPLIED: {
    ownerLabel: 'Completed',
    tenantLabel: 'Completed',
    color: 'emerald',
    bgClass: 'bg-emerald-50 dark:bg-emerald-950/30',
    textClass: 'text-emerald-700 dark:text-emerald-400',
    borderClass: 'border-emerald-200 dark:border-emerald-800',
    icon: CheckCircle2,
  },
  REJECTED: {
    ownerLabel: 'Declined',
    tenantLabel: 'Declined',
    color: 'rose',
    bgClass: 'bg-rose-50 dark:bg-rose-950/30',
    textClass: 'text-rose-700 dark:text-rose-400',
    borderClass: 'border-rose-200 dark:border-rose-800',
    icon: XCircle,
  },
  SUPERSEDED: {
    ownerLabel: 'Replaced',
    tenantLabel: 'Replaced',
    color: 'slate',
    bgClass: 'bg-slate-100 dark:bg-slate-800/40',
    textClass: 'text-slate-500 dark:text-slate-400',
    borderClass: 'border-slate-200 dark:border-slate-700',
    icon: Replace,
  },
  EXPIRED: {
    ownerLabel: 'Expired',
    tenantLabel: 'Expired',
    color: 'gray',
    bgClass: 'bg-zinc-100 dark:bg-zinc-800/40',
    textClass: 'text-zinc-500 dark:text-zinc-400',
    borderClass: 'border-zinc-200 dark:border-zinc-700',
    icon: Hourglass,
  },
  CANCELLED: {
    ownerLabel: 'Cancelled',
    tenantLabel: 'Cancelled',
    color: 'gray',
    bgClass: 'bg-zinc-100 dark:bg-zinc-800/40',
    textClass: 'text-zinc-500 dark:text-zinc-400',
    borderClass: 'border-zinc-200 dark:border-zinc-700',
    icon: Ban,
  },
};

/** Map change_type to a human-readable intent label */
export const CHANGE_TYPE_LABELS: Record<string, string> = {
  profile_update: 'Personal Information',
  contract_amendment: 'Agreement Amendment',
  financial_correction: 'Financial Correction',
  administrative_correction: 'Administrative Correction',
  room_transfer: 'Room Transfer',
};

/** Get human-readable label for a change type */
export function getChangeTypeLabel(changeType: string): string {
  return CHANGE_TYPE_LABELS[changeType] || changeType.replaceAll('_', ' ');
}

/** Get the status config, with graceful fallback */
export function getStatusConfig(status: string): StatusConfig {
  return STATUS_CONFIG[status as ChangeStatus] || STATUS_CONFIG.DRAFT;
}
