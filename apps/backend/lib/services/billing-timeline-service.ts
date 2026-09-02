import { prisma } from "@/lib/db";
import { billingScheduleService, type PaymentFrequency } from "@/lib/services/billing-schedule-service";
import { hostelPolicyService } from "@/lib/services/hostel-policy-service";

function money(value: unknown) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function daysUntil(date: Date) {
  const today = new Date();
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const target = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((target - start) / 86_400_000);
}

export class BillingTimelineService {
  async getTenantTimeline(tenantId: string, ownerId?: string) {
    const tenant = await prisma.tenants.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        owner_id: true,
        hostel_id: true,
        payment_frequency: true,
        payment_frequency_effective_from: true,
        payment_frequency_updated_at: true,
        monthly_rent: true,
        maintenance_charge: true,
        maintenance_type: true,
        tenant_billing_plans: {
          orderBy: { effective_from: "desc" },
          take: 8,
        },
        payment_frequency_change_requests: {
          orderBy: { created_at: "desc" },
          take: 10,
        },
      },
    });
    if (!tenant) throw new Error("TENANT_NOT_FOUND");
    if (ownerId && tenant.owner_id !== ownerId) throw new Error("TENANT_NOT_FOUND");

    const [policyResponse] = await Promise.all([
      hostelPolicyService.getHostelPolicy(tenant.hostel_id).catch(() => null),
    ]);
    // Extract billing schedule settings from the full policy (NOT just payment_frequency)
    const billingPrefs = (policyResponse?.policy?.billing ?? {}) as {
      due_day?: number; auto_rent_day?: number; grace_days?: number;
    };
    const dueDay = Math.max(1, Math.min(28, Number(billingPrefs.due_day ?? 5)));
    const autoRentDay = Math.max(1, Math.min(28, Number(billingPrefs.auto_rent_day ?? 1)));

    const obligations = await prisma.rent_obligations.findMany({
      where: {
        tenant_id: tenantId,
        status: { in: ["UPCOMING", "PENDING", "PARTIAL", "PAID", "OVERDUE", "WAIVED"] },
        is_superseded: false,
      },
      include: { payments: true },
      orderBy: [{ billing_period_start: "asc" }, { rent_month: "asc" }, { obligation_type: "asc" }],
      take: 120,
    });

    const rentAdvanceCredits = await prisma.tenant_financial_ledger.findMany({
      where: {
        tenant_id: tenantId,
        type: "CREDIT",
        reason: "FUTURE_RENT_CREDIT_TOPUP",
      },
      orderBy: { created_at: "desc" },
      take: 20,
    });

    const timelineEvents: any[] = [];

    obligations.forEach((ob: any) => {
      const amount = money(ob.amount);
      const recordedPaid = money((ob.payments || []).reduce((s: number, p: any) => s + Number(p.amount_paid || 0), 0));
      const paid = ob.status === "PAID" && recordedPaid <= 0 ? amount : recordedPaid;
      const remaining = money(Math.max(amount - paid, 0));
      const dueDate = new Date(ob.due_date);
      const delta = daysUntil(dueDate);
      
      let state = "pending";
      if (ob.status === "WAIVED") state = "waived";
      else if (remaining <= 0 || ob.status === "PAID") state = "paid";
      else if (paid > 0 || ob.status === "PARTIAL") state = "partial";
      else if (delta < 0) state = "overdue";
      else if (delta <= 5) state = "due_soon";
      else if (delta > 30) state = "upcoming";

      const latestPayment = ob.payments && ob.payments.length > 0
        ? ob.payments.reduce((latest: any, current: any) => {
            return new Date(current.payment_date) > new Date(latest.payment_date) ? current : latest;
          }, ob.payments[0])
        : null;

      const paidDate = latestPayment ? latestPayment.payment_date : null;

      if (state === "paid") {
        let eventType = ob.obligation_type + "_PAID";
        if (ob.obligation_type === "RENT") eventType = "RENT_PAID";
        else if (ob.obligation_type === "SECURITY_DEPOSIT") eventType = "SECURITY_DEPOSIT_PAID";
        else if (ob.obligation_type === "MAINTENANCE") eventType = "MAINTENANCE_PAID";

        let label = "";
        if (ob.obligation_type === "RENT") {
          label = `Rent Paid - ${new Date(ob.rent_month).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}`;
        } else if (ob.obligation_type === "SECURITY_DEPOSIT") {
          label = "Security Deposit Paid";
        } else if (ob.obligation_type === "MAINTENANCE") {
          label = "Onboarding Maintenance Paid";
        } else {
          label = `${ob.obligation_type.replace("_", " ")} Paid`;
        }

        timelineEvents.push({
          id: `event:paid:${ob.id}`,
          timeline_id: `event:paid:${ob.id}`,
          obligation_id: ob.id,
          obligation_type: ob.obligation_type,
          type: eventType,
          billing_plan_id: ob.billing_plan_id,
          period_start: ob.billing_period_start || ob.rent_month,
          period_end: ob.billing_period_end || ob.rent_month,
          rent_month: ob.rent_month,
          label: ob.installment_label || label,
          installment_sequence: ob.installment_sequence,
          amount,
          paid,
          remaining: 0,
          original_amount: amount,
          paid_amount: paid,
          remaining_amount: 0,
          due_date: ob.due_date,
          paid_date: paidDate || ob.due_date,
          event_date: paidDate || ob.due_date,
          status: "PAID",
          state: "paid",
          payment_method: latestPayment?.payment_method || null,
          reference_number: latestPayment?.reference_number || null,
        });
      } else {
        let eventType = ob.obligation_type + "_GENERATED";
        if (ob.obligation_type === "RENT") eventType = "RENT_GENERATED";
        else if (ob.obligation_type === "SECURITY_DEPOSIT") eventType = "SECURITY_DEPOSIT_GENERATED";
        else if (ob.obligation_type === "MAINTENANCE") eventType = "MAINTENANCE_GENERATED";
        else if (ob.obligation_type === "EXTRA_CHARGE") eventType = "EXTRA_CHARGE_CREATED";

        let label = "";
        if (ob.obligation_type === "RENT") {
          label = `Rent Due - ${new Date(ob.rent_month).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}`;
        } else if (ob.obligation_type === "SECURITY_DEPOSIT") {
          label = "Security Deposit Due";
        } else if (ob.obligation_type === "MAINTENANCE") {
          label = "Onboarding Maintenance Due";
        } else {
          label = `${ob.obligation_type.replace("_", " ")} Due`;
        }

        timelineEvents.push({
          id: `event:unpaid:${ob.id}`,
          timeline_id: `event:unpaid:${ob.id}`,
          obligation_id: ob.id,
          obligation_type: ob.obligation_type,
          type: eventType,
          billing_plan_id: ob.billing_plan_id,
          period_start: ob.billing_period_start || ob.rent_month,
          period_end: ob.billing_period_end || ob.rent_month,
          rent_month: ob.rent_month,
          label: ob.installment_label || label,
          installment_sequence: ob.installment_sequence,
          amount,
          paid,
          remaining,
          original_amount: amount,
          paid_amount: paid,
          remaining_amount: remaining,
          due_date: ob.due_date,
          paid_date: null,
          event_date: ob.due_date,
          status: ob.status,
          state,
          payment_method: null,
          reference_number: null,
        });

        if (state === "partial" && ob.payments && ob.payments.length > 0) {
          ob.payments.forEach((p: any) => {
            timelineEvents.push({
              id: `event:payment:${p.id}`,
              timeline_id: `event:payment:${p.id}`,
              obligation_id: ob.id,
              obligation_type: "PAYMENT",
              type: "PAYMENT_SETTLED",
              billing_plan_id: ob.billing_plan_id,
              period_start: p.payment_date,
              period_end: p.payment_date,
              rent_month: p.payment_date,
              label: `Partial Payment Received`,
              installment_sequence: null,
              amount: money(p.amount_paid),
              paid: money(p.amount_paid),
              remaining: 0,
              original_amount: money(p.amount_paid),
              paid_amount: money(p.amount_paid),
              remaining_amount: 0,
              due_date: ob.due_date,
              paid_date: p.payment_date,
              event_date: p.payment_date,
              status: "PAID",
              state: "paid",
              payment_method: p.payment_method,
              reference_number: p.reference_number,
            });
          });
        }
      }
    });

    const activeFrequency = (tenant.payment_frequency || "MONTHLY") as PaymentFrequency;

    const rentAdvanceItems = rentAdvanceCredits.map((entry: any) => ({
      id: `event:credit:${entry.id}`,
      timeline_id: `event:credit:${entry.id}`,
      obligation_id: null,
      obligation_type: "RENT_CREDIT",
      type: "CREDIT_APPLIED",
      billing_plan_id: null,
      period_start: entry.created_at,
      period_end: entry.created_at,
      rent_month: entry.created_at,
      label: "Future rent credit",
      installment_sequence: null,
      amount: money(entry.amount),
      paid: money(entry.amount),
      remaining: 0,
      original_amount: money(entry.amount),
      paid_amount: money(entry.amount),
      remaining_amount: 0,
      due_date: entry.created_at,
      paid_date: entry.created_at,
      event_date: entry.created_at,
      status: "PAID",
      state: "paid",
      payment_method: entry.reference_type === "PAYMENT_ATTEMPT" ? "RAZORPAY" : "OFFLINE",
      reference_number: entry.reference_id,
      notes: entry.notes,
    }));

    const timeline = [...timelineEvents, ...rentAdvanceItems].sort((a: any, b: any) => {
      const aDate = new Date(a.event_date || a.due_date || a.period_start || 0).getTime();
      const bDate = new Date(b.event_date || b.due_date || b.period_start || 0).getTime();
      if (aDate !== bDate) return aDate - bDate;
      return String(a.timeline_id).localeCompare(String(b.timeline_id));
    });

    // Find the latest rent obligation
    const rentObligations = obligations.filter((ob) => ob.obligation_type === "RENT");
    let latestRentMonth: Date | null = tenant.payment_frequency_effective_from
      ? new Date(tenant.payment_frequency_effective_from)
      : null;

    if (rentObligations.length > 0) {
      const maxMonth = rentObligations.reduce((max, ob) => {
        const d = new Date(ob.rent_month);
        return d > max ? d : max;
      }, new Date(0));
      if (maxMonth.getTime() > 0) {
        latestRentMonth = maxMonth;
      }
    }

    if (!latestRentMonth) {
      const activeAllocation = await prisma.roomAllocation.findFirst({
        where: { tenant_id: tenantId, is_active: true },
        select: { start_date: true },
      });
      latestRentMonth = activeAllocation?.start_date ? new Date(activeAllocation.start_date) : new Date();
    }

    const months = billingScheduleService.periodMonths(activeFrequency);
    // `billingScheduleService.normalizePolicy` reads `raw.billing.payment_frequency`
    // (or a flat blob) — so the normalized HostelPolicy is a valid input and
    // carries the hostel's real academic-year config, unlike the previous
    // `policy.preferences_config` access which was always undefined.
    const policyForSchedule = (policyResponse?.policy ?? {}) as any;

    // Default: one billing period after the latest already-billed month.
    let nextRentMonth = new Date(Date.UTC(latestRentMonth.getUTCFullYear(), latestRentMonth.getUTCMonth() + months, 1));

    // But if the CURRENT billing period has started and has no RENT obligation
    // yet (the monthly generator hasn't run, or a mid-month join predates it),
    // the real "next payment" is this period, not the one after the last row.
    // Without this the projection tells an owner October when September is what
    // is actually owed. Guarded on an active tenancy with billing started.
    const nowMonthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const currentPeriod = billingScheduleService.getPeriodForAnchor(nowMonthStart, activeFrequency, policyForSchedule);
    const hasRentForCurrentPeriod = rentObligations.some((ob: any) => {
      const m = new Date(ob.rent_month);
      return m.getTime() >= currentPeriod.start.getTime() && m.getTime() <= currentPeriod.end.getTime();
    });
    if (!hasRentForCurrentPeriod && currentPeriod.start.getTime() <= nowMonthStart.getTime()
        && currentPeriod.start.getTime() < nextRentMonth.getTime()) {
      const activeAllocation = await prisma.roomAllocation.findFirst({
        where: { tenant_id: tenantId, is_active: true, end_date: null },
        select: { start_date: true },
      });
      const billingStarted = activeAllocation?.start_date
        ? new Date(activeAllocation.start_date).getTime() <= currentPeriod.end.getTime()
        : true;
      if (billingStarted && Number(tenant.monthly_rent) > 0) {
        nextRentMonth = new Date(Date.UTC(currentPeriod.start.getUTCFullYear(), currentPeriod.start.getUTCMonth(), 1));
      }
    }

    const nextGenDate = new Date(Date.UTC(nextRentMonth.getUTCFullYear(), nextRentMonth.getUTCMonth(), autoRentDay));

    const nextInstallment = billingScheduleService.buildInstallment({
      frequency: activeFrequency,
      anchorDate: nextRentMonth,
      monthlyRent: tenant.monthly_rent ? Number(tenant.monthly_rent) : 0,
      maintenanceAmount: String(tenant.maintenance_type || "MONTHLY") === "MONTHLY" && tenant.maintenance_charge ? Number(tenant.maintenance_charge) : 0,
      dueDay,
      autoRentDay,
      policy: policyForSchedule,
    });

    const nextRentGeneration = {
      next_rent_month: nextRentMonth.toISOString(),
      next_rent_generation_date: nextGenDate.toISOString(),
      next_installment_due_date: nextInstallment.due_date.toISOString(),
      next_installment_amount: nextInstallment.amount,
      next_maintenance_amount: nextInstallment.maintenance_amount,
      period_start: nextInstallment.period_start.toISOString(),
      period_end: nextInstallment.period_end.toISOString(),
      installment_label: nextInstallment.installment_label,
    };

    // Response trimmed to its two confirmed-live consumers — TenantFinancialsPage.tsx
    // reads `items` (schedule/timeline UI grouping; overdue classification for
    // financial-status purposes is now sourced from FinancialReadModelService,
    // not this service), and TenantProfilePage.tsx (owner side) reads
    // `next_rent_generation`. Every other field (billing_settings, plans,
    // requests, tenant_id, active_frequency, effective_from, updated_at,
    // obligation_items, payment_items, rent_advance_items, projected_items)
    // had zero frontend consumers — confirmed via repo-wide grep — and is
    // "financial state" this service should no longer be computing per
    // docs/business-logic/financial-consistency-investigation-report.md.
    return {
      items: timeline,
      next_rent_generation: nextRentGeneration,
    };
  }
}

export const billingTimelineService = new BillingTimelineService();
