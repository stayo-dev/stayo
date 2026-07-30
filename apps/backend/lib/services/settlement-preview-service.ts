import { prisma } from "@/lib/db";
import { financialService } from "@/src/services/payments/financial-service";
import { billingScheduleService, type PaymentFrequency } from "@/lib/services/billing-schedule-service";

function money(value: unknown) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function serializeSchedule(items: any[]) {
  return items.map((item) => ({
    frequency: item.frequency,
    period_start: item.period_start,
    period_end: item.period_end,
    due_date: item.due_date,
    installment_label: item.installment_label,
    installment_sequence: item.installment_sequence,
    period_months: item.period_months,
    amount: item.amount,
    maintenance_amount: item.maintenance_amount,
    total_amount: money(item.amount + item.maintenance_amount),
  }));
}

export class SettlementPreviewService {
  async buildFrequencyChangePreview(params: {
    tenantId: string;
    requestedFrequency: PaymentFrequency;
    effectiveFrom: Date;
    policy?: any;
  }) {
    const tenant = await prisma.tenants.findUnique({
      where: { id: params.tenantId },
      include: {
        payments: true,
        tenant_financial_ledger: { orderBy: { created_at: "desc" }, take: 1 },
        rent_obligations: {
          include: { payments: true },
          orderBy: { due_date: "desc" },
          take: 120,
        },
      },
    });
    if (!tenant) throw new Error("TENANT_NOT_FOUND");

    const dues = await financialService.getTenantDues(tenant.id, tenant.owner_id || undefined, tenant.hostel_id);
    const paidAmount = money((tenant.payments || []).reduce((sum: number, p: any) => sum + Number(p.amount_paid || 0), 0));
    const advanceBalance = money((tenant.tenant_financial_ledger || [])[0]?.balance_after || 0);
    const monthlyRent = money(tenant.monthly_rent);
    const maintenance = String(tenant.maintenance_type || "MONTHLY") === "MONTHLY" ? money(tenant.maintenance_charge) : 0;
    const currentFrequency = (tenant.payment_frequency || "MONTHLY") as PaymentFrequency;

    const before = billingScheduleService.previewSchedule({
      frequency: currentFrequency,
      startDate: params.effectiveFrom,
      monthlyRent,
      maintenanceAmount: maintenance,
      periods: 4,
      policy: params.policy,
    });
    const after = billingScheduleService.previewSchedule({
      frequency: params.requestedFrequency,
      startDate: params.effectiveFrom,
      monthlyRent,
      maintenanceAmount: maintenance,
      periods: 4,
      policy: params.policy,
    });

    const overdueCount = (dues.items || []).filter((item: any) => new Date(item.due_date) < new Date()).length;
    const partialCount = (tenant.rent_obligations || []).filter((ob: any) => {
      const paid = (ob.payments || []).reduce((sum: number, p: any) => sum + Number(p.amount_paid || 0), 0);
      return paid > 0 && paid < Number(ob.amount || 0);
    }).length;
    const riskLevel = overdueCount > 2 || partialCount > 2 ? "HIGH" : overdueCount || partialCount ? "MEDIUM" : "LOW";

    return {
      settlement_snapshot: {
        already_paid: paidAmount,
        pending_dues: money(dues.total_due),
        pending_rent: money(dues.rent_due),
        late_fees: money(dues.late_fees_due),
        advance_balance: advanceBalance,
        future_rent_credit: advanceBalance,
        existing_obligation_count: tenant.rent_obligations?.length || 0,
      },
      projection_snapshot: {
        effective_from: params.effectiveFrom,
        current_frequency: currentFrequency,
        requested_frequency: params.requestedFrequency,
        before_projection: serializeSchedule(before),
        after_projection: serializeSchedule(after),
        expected_next_payment_date: after[0]?.due_date || params.effectiveFrom,
        cash_flow_delta_first_period: money((after[0]?.amount || 0) + (after[0]?.maintenance_amount || 0)
          - ((before[0]?.amount || 0) + (before[0]?.maintenance_amount || 0))),
      },
      risk_snapshot: {
        risk_level: riskLevel,
        overdue_count: overdueCount,
        partial_obligation_count: partialCount,
        reason: riskLevel === "LOW"
          ? "Tenant has no active overdue or partially paid obligations."
          : "Tenant has overdue or partially paid obligations that may affect collection confidence.",
      },
    };
  }
}

export const settlementPreviewService = new SettlementPreviewService();
