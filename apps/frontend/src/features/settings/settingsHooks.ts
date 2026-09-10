import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ownerService } from '@features/owners/api';
import { queryKeys } from '@lib/queryKeys';

export const policyKey = (hostelId: string) => ['hostel', hostelId, 'settings-policy'];

export function useHostelPolicy(hostelId: string | null) {
  return useQuery({
    queryKey: hostelId ? policyKey(hostelId) : ['noop'],
    queryFn: () => ownerService.getHostelPreferences(hostelId!),
    enabled: !!hostelId,
    staleTime: 5 * 60 * 1000,
    select: (raw: any) => {
      const d = raw?.data ?? raw;
      return d as { hostel: HostelInfo; policy: HostelPolicy };
    },
  });
}

export function useUpdateHostelPolicy(hostelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Record<string, any>) => ownerService.updateHostelPolicy(hostelId, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: policyKey(hostelId) }),
  });
}

export function useUpdateOwnerProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => ownerService.updateOwner(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['owner', 'profile'] }),
  });
}

export function useUpdateHostelIdentity(hostelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => ownerService.updateHostel(data, hostelId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: policyKey(hostelId) });
      qc.invalidateQueries({ queryKey: ['owner', 'hostels'] });
    },
  });
}

export function useUploadHostelLogo(hostelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => ownerService.uploadLogo(file, hostelId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: policyKey(hostelId) });
      qc.invalidateQueries({ queryKey: ['owner', 'hostels'] });
    },
  });
}

export function useRemoveHostelLogo(hostelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => ownerService.removeLogo(hostelId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: policyKey(hostelId) });
      qc.invalidateQueries({ queryKey: ['owner', 'hostels'] });
    },
  });
}

/** Archives a hostel (`DELETE /hostels/:id`) — blocked server-side while it has active room allocations. */
export function useArchiveHostel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ hostelId, reason }: { hostelId: string; reason?: string }) =>
      ownerService.archiveHostel(hostelId, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.portfolio.summary() });
      qc.invalidateQueries({ queryKey: ['owner', 'hostels'] });
    },
  });
}

/**
 * Deletes an archived hostel for good (`DELETE /hostels/:id/permanent`).
 *
 * Distinct from `useArchiveHostel` — that one archives and is reversible.
 * This accepts only an already-archived hostel with no operational history,
 * and there is no undo.
 */
export function useDeleteHostelPermanently() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (hostelId: string) => ownerService.deleteHostelPermanently(hostelId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.portfolio.summary() });
      qc.invalidateQueries({ queryKey: ['owner', 'hostels'] });
    },
  });
}

/** Reactivates an archived hostel (`PATCH /hostels/:id` with `status: ACTIVE`). */
export function useReactivateHostel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (hostelId: string) => ownerService.reactivateHostel(hostelId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.portfolio.summary() });
      qc.invalidateQueries({ queryKey: ['owner', 'hostels'] });
    },
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HostelInfo {
  id: string; name: string; phone: string | null; address: string | null;
  city: string | null; state: string | null; pincode: string | null;
  upi_id: string | null; gst_number: string | null; logo_url: string | null;
  /** `hostels.hostel_type` — BOYS/GIRLS/CO_LIVING/WORKING_PROS, null until asked. */
  hostel_type: string | null;
}

export interface LateFeeRule {
  type: 'FLAT' | 'PERCENTAGE' | 'PER_DAY';
  amount: number;
  starts_after_days: number;
}

export interface HostelPolicy {
  billing: {
    rent_cycle: string; auto_rent_day: number; due_day: number; grace_days: number;
    late_fee: { enabled: boolean; rules: LateFeeRule[]; max_amount: number };
    deposit: {
      enabled: boolean;
      default_amount: number;
      refundable: boolean;
      calculation_mode?: 'FLAT' | 'MONTHS_OF_RENT';
      deposit_months?: number;
    };
    maintenance: { type: string; amount: number };
    invite_defaults: { auto_fill_room_rent: boolean; allow_override: boolean; agreement_duration_months?: number };
    /** `minimum_percentage` (0-100 of total outstanding) added 2026-08-05, ADR-043. */
    partial_payments: { enabled: boolean; minimum_amount: number; minimum_percentage: number };
    payment_frequency: {
      allowed_frequencies: string[];
      academic_year_start_month: number;
      academic_year_start_day: number;
      academic_year_name_format: string;
      frequency_change_cooldown_days: number;
      minimum_commitment_months: Record<string, number>;
    };
  };
  payments: { upi_id: string | null; phonepe_merchant_id: string | null; payment_instructions: string | null };
  reminders: {
    enabled: boolean;
    channels: { email: boolean; in_app: boolean; whatsapp: boolean; sms: boolean };
    schedule: { before_due_days: number[]; after_due_days: number[] };
    auto_stop_after_payment: boolean; late_fee_notifications: boolean; owner_daily_summary: boolean;
  };
  receipts: { prefix: string; format: string; auto_email: boolean; footer: string };
  branding: { logo_url: string | null; gst_number: string | null; legal_name: string | null };
  tenant_rules: {
    allow_profile_edits: boolean; profile_photo_required: boolean; invite_expiry_hours: number;
    /** Whether tenants must accept rules and sign before activation (ADR-059). */
    agreement_required?: boolean;
  };
  automation: {
    auto_generate_rent: boolean; auto_apply_late_fees: boolean;
    auto_send_reminders: boolean; auto_email_receipts: boolean;
    /** 0 = escalation off. Backend validates 0–365. Surfaced by the Automation screen. */
    auto_deactivate_days?: number;
    nightly_reconciliation?: boolean;
    snapshot_generation?: boolean;
  };
  operations: { currency: string; timezone: string; date_format: string; time_format: string; language: string };
}
