import { prisma } from "@/lib/db";
import { billingScheduleService, type PaymentFrequency } from "@/lib/services/billing-schedule-service";
import { settlementPreviewService } from "@/lib/services/settlement-preview-service";
import { hostelPolicyService } from "@/lib/services/hostel-policy-service";
import { fromLegacyStatus } from "@/src/services/payments/financial-obligation.types";
import { consumeIdentityTokenInTx } from "@/src/services/payments/identity-confirmation-guard";
import { liveTenancyWhere } from "@/lib/tenancy/active-tenancy";

function dayBefore(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - 1));
}

function money(value: unknown) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function firstOfUtcMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

/** Whole calendar months from `from` to `to`, at least 1. */
function monthsBetween(from: Date, to: Date): number {
  const months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  return Math.max(1, months);
}

export interface CustomInstallmentInput {
  due_date: string;
  amount: number;
  label?: string;
}

export class BillingTransitionService {
  private async getPolicy(hostelId: string) {
    const response = await hostelPolicyService.getHostelPolicy(hostelId).catch(() => null);
    return billingScheduleService.normalizePolicy(response?.policy);
  }

  async createRequest(profileId: string, data: { requested_frequency: string; reason?: string }) {
    if (!billingScheduleService.isSupportedFrequency(data.requested_frequency)) {
      throw new Error("UNSUPPORTED_PAYMENT_FREQUENCY");
    }
    const requestedFrequency = data.requested_frequency as PaymentFrequency;
    if (!billingScheduleService.exposedFrequencies().includes(requestedFrequency)) {
      throw new Error("CUSTOM_INSTALLMENTS_NOT_AVAILABLE_IN_V1");
    }

    const tenant = await prisma.tenants.findFirst({
      where: liveTenancyWhere(profileId),
      include: {
        payment_frequency_change_requests: { where: { status: "PENDING" }, take: 1 },
        rent_obligations: { include: { payments: true } },
        tenant_billing_plans: { where: { status: "ACTIVE" }, orderBy: { effective_from: "desc" }, take: 1 },
      },
    });
    if (!tenant) throw new Error("TENANT_NOT_FOUND");
    if (!tenant.owner_id) throw new Error("TENANT_OWNER_CONTEXT_MISSING");
    if (tenant.status !== "ACTIVE") throw new Error("ONLY_ACTIVE_TENANTS_CAN_CHANGE_FREQUENCY");
    if (tenant.payment_frequency_change_requests?.length) throw new Error("PENDING_FREQUENCY_CHANGE_EXISTS");

    const currentFrequency = (tenant.payment_frequency || "MONTHLY") as PaymentFrequency;
    if (currentFrequency === requestedFrequency) throw new Error("REQUESTED_FREQUENCY_ALREADY_ACTIVE");

    const policy = await this.getPolicy(tenant.hostel_id);
    if (!policy.allowed_frequencies.includes(requestedFrequency)) throw new Error("FREQUENCY_NOT_ALLOWED_BY_HOSTEL");

    await this.validateCooldown(tenant.id, policy.frequency_change_cooldown_days);

    const effectiveFrom = billingScheduleService.getNextCleanBillingPeriodDate(new Date(), requestedFrequency, policy);
    await this.validateCleanPeriod(tenant.id, effectiveFrom, requestedFrequency, policy);
    await this.validateCommitment(tenant, currentFrequency, policy);

    const preview = await settlementPreviewService.buildFrequencyChangePreview({
      tenantId: tenant.id,
      requestedFrequency,
      effectiveFrom,
      policy,
    });

    return prisma.payment_frequency_change_requests.create({
      data: {
        tenant_id: tenant.id,
        owner_id: tenant.owner_id,
        hostel_id: tenant.hostel_id,
        current_frequency: currentFrequency,
        requested_frequency: requestedFrequency,
        effective_from: effectiveFrom,
        transition_strategy: "NEXT_BILLING_PERIOD",
        reason: data.reason?.trim() || null,
        settlement_snapshot: preview.settlement_snapshot,
        projection_snapshot: preview.projection_snapshot,
        risk_snapshot: preview.risk_snapshot,
      },
    });
  }

  async listForTenant(profileId: string) {
    const tenant = await prisma.tenants.findFirst({ where: liveTenancyWhere(profileId), select: { id: true } });
    if (!tenant) throw new Error("TENANT_NOT_FOUND");
    return prisma.payment_frequency_change_requests.findMany({
      where: { tenant_id: tenant.id },
      orderBy: { created_at: "desc" },
      take: 20,
    });
  }

  async listForOwner(ownerId: string, filters: { hostelId: string | undefined; tenantId?: string; status?: string }) {
    return prisma.payment_frequency_change_requests.findMany({
      where: {
        owner_id: ownerId,
        ...(filters.hostelId ? { hostel_id: filters.hostelId } : {}),
        ...(filters.tenantId ? { tenant_id: filters.tenantId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      include: {
        tenants: {
          select: {
            id: true,
            profiles: { select: { name: true, email: true, phone: true } },
          },
        },
      },
      orderBy: { created_at: "desc" },
    });
  }

  /**
   * Shared write path for both `approve()` (a tenant's own pending request)
   * and `ownerInitiateChange()` (owner acts directly, no tenant request) —
   * supersede the active plan, create the new one, and stamp the tenant's
   * frequency fields. Must run inside an existing transaction.
   */
  private async writeBillingPlanTransition(tx: any, params: {
    tenantId: string;
    ownerId: string;
    hostelId: string;
    requestedFrequency: PaymentFrequency;
    effectiveFrom: Date;
    schedule: ReturnType<typeof billingScheduleService.previewSchedule>;
    totalContractAmount: number;
    transitionStrategy: string;
    approvedBy: string;
  }) {
    await tx.tenant_billing_plans.updateMany({
      where: { tenant_id: params.tenantId, status: "ACTIVE" },
      data: { status: "SUPERSEDED", effective_to: dayBefore(params.effectiveFrom), updated_at: new Date() },
    });
    const plan = await tx.tenant_billing_plans.create({
      data: {
        tenant_id: params.tenantId,
        owner_id: params.ownerId,
        hostel_id: params.hostelId,
        frequency: params.requestedFrequency,
        effective_from: params.effectiveFrom,
        installment_count: params.schedule.length,
        total_contract_amount: money(params.totalContractAmount),
        transition_strategy: params.transitionStrategy,
        schedule_snapshot: params.schedule,
        status: "ACTIVE",
        approved_by: params.approvedBy,
        approved_at: new Date(),
      },
    });
    await tx.tenants.update({
      where: { id: params.tenantId },
      data: {
        payment_frequency: params.requestedFrequency,
        payment_frequency_effective_from: params.effectiveFrom,
        payment_frequency_updated_at: new Date(),
      },
    });
    return plan;
  }

  async approve(requestId: string, ownerId: string) {
    const request = await prisma.payment_frequency_change_requests.findFirst({
      where: { id: requestId, owner_id: ownerId },
      include: { tenants: true },
    });
    if (!request) throw new Error("REQUEST_NOT_FOUND");
    if (request.status !== "PENDING") throw new Error("REQUEST_ALREADY_DECIDED");

    const policy = await this.getPolicy(request.hostel_id);
    await this.validateCleanPeriod(request.tenant_id, request.effective_from, request.requested_frequency, policy);

    const schedule = billingScheduleService.previewSchedule({
      frequency: request.requested_frequency,
      startDate: request.effective_from,
      monthlyRent: money(request.tenants.monthly_rent),
      maintenanceAmount: String(request.tenants.maintenance_type || "MONTHLY") === "MONTHLY" ? money(request.tenants.maintenance_charge) : 0,
      periods: 4,
      policy,
    });
    const totalContractAmount = schedule.reduce((sum, item) => sum + item.amount + item.maintenance_amount, 0);

    return prisma.$transaction(async (tx: any) => {
      const plan = await this.writeBillingPlanTransition(tx, {
        tenantId: request.tenant_id,
        ownerId: request.owner_id,
        hostelId: request.hostel_id,
        requestedFrequency: request.requested_frequency,
        effectiveFrom: request.effective_from,
        schedule,
        totalContractAmount,
        transitionStrategy: request.transition_strategy,
        approvedBy: ownerId,
      });
      const updatedRequest = await tx.payment_frequency_change_requests.update({
        where: { id: request.id },
        data: { status: "APPROVED", approved_by: ownerId, approved_at: new Date(), updated_at: new Date() },
      });
      return { request: updatedRequest, billing_plan: plan };
    });
  }

  /**
   * Owner acts directly — no pre-existing tenant request needed. Runs the
   * exact same cooldown/clean-period/commitment guards as the tenant-request
   * path (see Business-Rules.md); the only difference is who initiates it and
   * that approval is immediate. A `payment_frequency_change_requests` row is
   * still created (status APPROVED from birth) purely for audit history —
   * this is not a lighter-weight or less-validated path.
   *
   * KNOWN LIMITATION: for tenants with a signed agreement, rent generation is
   * driven by `agreement-rent-schedule-service.ts`, which does not yet
   * consult `tenant_billing_plans`/`payment_frequency` — it always generates
   * one obligation per calendar month regardless of this setting. This call
   * still records the change and will apply correctly once that generator is
   * updated (tracked separately — see Bugs.md), but for agreement-based
   * tenants it does not yet change actual future obligation cadence.
   */
  async ownerInitiateChange(ownerId: string, tenantId: string, data: { requested_frequency: string; reason?: string; identityJti?: string }) {
    if (!billingScheduleService.isSupportedFrequency(data.requested_frequency)) {
      throw new Error("UNSUPPORTED_PAYMENT_FREQUENCY");
    }
    const requestedFrequency = data.requested_frequency as PaymentFrequency;
    if (!billingScheduleService.exposedFrequencies().includes(requestedFrequency)) {
      throw new Error("CUSTOM_INSTALLMENTS_NOT_AVAILABLE_IN_V1");
    }

    const tenant = await prisma.tenants.findFirst({
      where: { id: tenantId, owner_id: ownerId },
      include: {
        tenant_billing_plans: { where: { status: "ACTIVE" }, orderBy: { effective_from: "desc" }, take: 1 },
      },
    });
    if (!tenant) throw new Error("TENANT_NOT_FOUND");
    if (tenant.status !== "ACTIVE") throw new Error("ONLY_ACTIVE_TENANTS_CAN_CHANGE_FREQUENCY");

    const currentFrequency = (tenant.payment_frequency || "MONTHLY") as PaymentFrequency;
    if (currentFrequency === requestedFrequency) throw new Error("REQUESTED_FREQUENCY_ALREADY_ACTIVE");

    const policy = await this.getPolicy(tenant.hostel_id);
    if (!policy.allowed_frequencies.includes(requestedFrequency)) throw new Error("FREQUENCY_NOT_ALLOWED_BY_HOSTEL");

    // Cooldown check disabled for the owner-direct path per explicit request
    // (2026-07-22) — it was blocking repeated testing/iteration on the same
    // tenant. Still enforced for the tenant-request path (createRequest).
    // Re-enable here if repeated owner-direct changes need throttling again:
    // await this.validateCooldown(tenant.id, policy.frequency_change_cooldown_days);
    //
    // Owner-direct changes don't block just because the tenant has older,
    // non-overlapping unpaid rent (e.g. last month's overdue charge) — that
    // debt is untouched and stays collectible exactly as before, alongside
    // the new frequency, rather than blocking the change outright. Only a
    // REAL overlap with the new schedule's window blocks (double-billing the
    // same period) — see ADR-023. Rather than testing a single naive "next
    // calendar month" candidate and giving up if it happens to collide (e.g.
    // switching a tenant back from Quarterly to Monthly when this month's
    // rent is already activated), this searches forward for the first period
    // start that's actually clean — see ADR-026. This intentionally does not
    // reuse the stricter `validateCleanPeriod` used by the tenant-request→
    // approve path, which still blocks on any unresolved debt regardless of
    // overlap.
    const effectiveFrom = await this.findCleanEffectiveFrom(tenant.id, requestedFrequency, policy);
    // Minimum-commitment check also disabled for the owner-direct path per
    // the same 2026-07-22 request as the cooldown above — see ADR-025.
    // await this.validateCommitment(tenant, currentFrequency, policy);

    // Tenants with a signed agreement had their FULL rent schedule generated
    // up front, one row per month, by agreement-rent-schedule-service.ts (a
    // one-shot call at signing — it never re-runs). Updating the frequency
    // setting alone (as below) is correct and sufficient for a non-agreement
    // tenant, whose obligations are generated on a rolling basis by
    // rent-generation-service.ts, which already reads payment_frequency for
    // any month not yet generated. But for an agreement tenant, the already-
    // generated future monthly rows would otherwise sit there unchanged
    // forever, so this regroups them into the new cadence directly — see
    // ADR-024.
    const agreement = await prisma.agreement.findFirst({
      where: { tenant_id: tenant.id, status: { in: ["SIGNED", "EXPIRING_SOON", "AGREEMENT_EXPIRED"] } },
      orderBy: { generated_at: "desc" },
    });

    const periodMonths = billingScheduleService.periodMonths(requestedFrequency);
    let periodsNeeded = 4;
    if (agreement?.agreement_end_date) {
      const monthsRemaining = monthsBetween(effectiveFrom, new Date(agreement.agreement_end_date));
      periodsNeeded = Math.min(40, Math.max(1, Math.ceil(monthsRemaining / periodMonths)));
    }

    const maintenanceAmount = String(tenant.maintenance_type || "MONTHLY") === "MONTHLY" ? money(tenant.maintenance_charge) : 0;
    const schedule = billingScheduleService.previewSchedule({
      frequency: requestedFrequency,
      startDate: effectiveFrom,
      monthlyRent: money(tenant.monthly_rent),
      maintenanceAmount,
      periods: agreement ? periodsNeeded : 4,
      policy,
    });
    const totalContractAmount = schedule.reduce((sum, item) => sum + item.amount + item.maintenance_amount, 0);

    const preview = await settlementPreviewService.buildFrequencyChangePreview({
      tenantId: tenant.id,
      requestedFrequency,
      effectiveFrom,
      policy,
    });

    return prisma.$transaction(async (tx: any) => {
      // Consumed in the SAME transaction as the actual mutation, not a
      // separate outer one — a rollback of one rolls back the other.
      if (data.identityJti) await consumeIdentityTokenInTx(tx, data.identityJti);
      const request = await tx.payment_frequency_change_requests.create({
        data: {
          tenant_id: tenant.id,
          owner_id: ownerId,
          hostel_id: tenant.hostel_id,
          current_frequency: currentFrequency,
          requested_frequency: requestedFrequency,
          effective_from: effectiveFrom,
          transition_strategy: "NEXT_BILLING_PERIOD",
          reason: data.reason?.trim() || "Owner-initiated frequency change",
          settlement_snapshot: preview.settlement_snapshot,
          projection_snapshot: preview.projection_snapshot,
          risk_snapshot: preview.risk_snapshot,
          status: "APPROVED",
          approved_by: ownerId,
          approved_at: new Date(),
        },
      });
      const plan = await this.writeBillingPlanTransition(tx, {
        tenantId: tenant.id,
        ownerId,
        hostelId: tenant.hostel_id,
        requestedFrequency,
        effectiveFrom,
        schedule,
        totalContractAmount,
        transitionStrategy: "NEXT_BILLING_PERIOD",
        approvedBy: ownerId,
      });

      let obligationsCreated = 0;
      let obligationsSuperseded = 0;
      if (agreement) {
        // Supersede every currently-live UPCOMING RENT row, not just ones
        // due on/after this call's effectiveFrom. A prior regeneration (e.g.
        // an earlier switch to a shorter cadence) can have used an EARLIER
        // effectiveFrom, leaving obligations dated before *this* call's
        // effectiveFrom — scoping only to due_date >= effectiveFrom left
        // those orphaned: still live, still on the old cadence's amount,
        // alongside the newly-created ones. UPCOMING rows are never
        // activated for collection (no payments possible), so wiping and
        // fully regenerating them on every switch is safe and keeps the
        // schedule always internally consistent. See ADR-027.
        const toSupersede = await tx.rent_obligations.findMany({
          where: {
            tenant_id: tenant.id,
            obligation_type: "RENT",
            is_superseded: false,
            status: "UPCOMING",
          },
          select: { id: true },
        });
        if (toSupersede.length > 0) {
          await tx.rent_obligations.updateMany({
            where: { id: { in: toSupersede.map((o: any) => o.id) } },
            data: {
              is_superseded: true,
              superseded_at: new Date(),
              superseded_by_request_id: request.id,
              updated_at: new Date(),
            },
          });
          obligationsSuperseded = toSupersede.length;
        }

        for (const item of schedule) {
          const { lifecycle_status, settlement_status } = fromLegacyStatus("UPCOMING");
          const rentMonth = firstOfUtcMonth(item.period_start);
          const rowData = {
            tenant_id: tenant.id,
            owner_id: ownerId,
            hostel_id: tenant.hostel_id,
            agreement_id: agreement.id,
            billing_plan_id: plan.id,
            obligation_type: "RENT",
            amount: item.amount,
            total_amount: item.amount,
            rent_month: rentMonth,
            due_date: item.due_date,
            status: "UPCOMING",
            lifecycle_status,
            settlement_status,
            installment_label: item.installment_label,
            installment_sequence: item.installment_sequence,
            billing_period_start: item.period_start,
            billing_period_end: item.period_end,
            is_superseded: false,
            superseded_at: null,
            superseded_by_request_id: null,
            updated_at: new Date(),
          };
          // (agreement_id, rent_month, obligation_type) is a hard, unfiltered
          // unique constraint — it doesn't exempt is_superseded rows. Repeated
          // frequency switches on the same tenant can land on a rent_month a
          // now-dead, still-superseded row already occupies (a stale row from
          // an earlier switch, e.g. Monthly -> Quarterly -> Monthly ->
          // Quarterly landing back on the same quarter). Revive that row in
          // place instead of inserting a fresh one — same pattern
          // agreement-rent-schedule-service.ts uses for its own duplicate
          // guard, just not filtered to is_superseded:false since that's
          // exactly the row we'd otherwise collide with. See ADR-027.
          const existing = await tx.rent_obligations.findFirst({
            where: { agreement_id: agreement.id, rent_month: rentMonth, obligation_type: "RENT" },
            select: { id: true },
          });
          if (existing) {
            await tx.rent_obligations.update({ where: { id: existing.id }, data: rowData });
          } else {
            await tx.rent_obligations.create({ data: rowData });
          }
          obligationsCreated++;
        }
      }

      return { request, billing_plan: plan, obligations_created: obligationsCreated, obligations_superseded: obligationsSuperseded };
    });
  }

  async reject(requestId: string, ownerId: string, rejectionReason?: string) {
    const request = await prisma.payment_frequency_change_requests.findFirst({
      where: { id: requestId, owner_id: ownerId },
    });
    if (!request) throw new Error("REQUEST_NOT_FOUND");
    if (request.status !== "PENDING") throw new Error("REQUEST_ALREADY_DECIDED");
    return prisma.payment_frequency_change_requests.update({
      where: { id: request.id },
      data: {
        status: "REJECTED",
        rejection_reason: rejectionReason?.trim() || null,
        updated_at: new Date(),
      },
    });
  }

  /**
   * Owner-defined custom installment schedule — a fixed, explicit list of
   * {due_date, amount} charges, not a recurring cadence. Unlike
   * `ownerInitiateChange` (periodic MONTHLY/QUARTERLY/HALF_YEARLY), this
   * bypasses `agreement-rent-schedule-service.ts` entirely rather than
   * relying on it to understand a new cadence — it directly supersedes the
   * tenant's future not-yet-activated (UPCOMING) RENT obligations from the
   * first installment date onward and creates the owner-specified rows in
   * their place. This is safe for agreement-based tenants specifically
   * because `generateForAgreementInTx` is a one-shot call (at signing / at
   * renewal activation) that never re-runs for an already-signed agreement —
   * so nothing will later recreate the monthly obligations this replaces.
   *
   * Guards: every date must be today or later, amounts must be positive, no
   * duplicate dates, max 24 installments (sanity cap, not a business rule).
   * Like `ownerInitiateChange`, refuses to touch a tenant with any
   * already-activated (PENDING/PARTIAL/OVERDUE) obligation with a real
   * outstanding balance due on or after the first installment date — that's
   * real, already-communicated debt, not something to silently sweep away.
   */
  async ownerSetCustomSchedule(ownerId: string, tenantId: string, data: { installments: CustomInstallmentInput[]; reason?: string; identityJti?: string }) {
    if (!Array.isArray(data.installments) || data.installments.length === 0) {
      throw new Error("VALIDATION_ERROR: at least one installment is required");
    }
    if (data.installments.length > 24) {
      throw new Error("VALIDATION_ERROR: too many installments (maximum 24)");
    }

    const today = startOfUtcDay(new Date());
    const seenDates = new Set<string>();
    const normalized = data.installments
      .map((inst) => {
        const amount = money(inst.amount);
        if (!(amount > 0)) throw new Error("VALIDATION_ERROR: each installment amount must be greater than 0");
        const dueDate = startOfUtcDay(new Date(inst.due_date));
        if (Number.isNaN(dueDate.getTime())) throw new Error("VALIDATION_ERROR: invalid installment due date");
        if (dueDate.getTime() < today.getTime()) throw new Error("VALIDATION_ERROR: installment due dates must be today or later");
        const key = dueDate.toISOString().slice(0, 10);
        if (seenDates.has(key)) throw new Error("VALIDATION_ERROR: duplicate installment due date");
        seenDates.add(key);
        return { amount, dueDate, label: inst.label?.trim() || null };
      })
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

    const tenant = await prisma.tenants.findFirst({ where: { id: tenantId, owner_id: ownerId } });
    if (!tenant) throw new Error("TENANT_NOT_FOUND");
    if (tenant.status !== "ACTIVE") throw new Error("ONLY_ACTIVE_TENANTS_CAN_CHANGE_FREQUENCY");

    const effectiveFrom = normalized[0].dueDate;
    const currentFrequency = (tenant.payment_frequency || "MONTHLY") as PaymentFrequency;

    const policy = await this.getPolicy(tenant.hostel_id);
    // Cooldown check disabled for the owner-direct path per explicit request
    // (2026-07-22) — see the matching note in ownerInitiateChange.
    // await this.validateCooldown(tenant.id, policy.frequency_change_cooldown_days);

    const inFlight = await prisma.rent_obligations.findMany({
      where: {
        tenant_id: tenant.id,
        obligation_type: "RENT",
        is_superseded: false,
        status: { in: ["PENDING", "PARTIAL", "OVERDUE"] },
        due_date: { gte: effectiveFrom },
      },
      include: { payments: { select: { amount_paid: true } } },
    });
    const blockers = inFlight.filter((ob: any) => {
      const paid = (ob.payments || []).reduce((sum: number, p: any) => sum + Number(p.amount_paid || 0), 0);
      return Number(ob.amount || 0) - paid > 0;
    });
    if (blockers.length > 0) throw new Error("UNCLEAN_BILLING_PERIOD");

    const agreement = await prisma.agreement.findFirst({
      where: { tenant_id: tenant.id, status: { in: ["SIGNED", "EXPIRING_SOON", "AGREEMENT_EXPIRED"] } },
      orderBy: { generated_at: "desc" },
    });

    const totalContractAmount = normalized.reduce((sum, inst) => sum + inst.amount, 0);
    const scheduleSnapshot = normalized.map((inst, i) => ({
      sequence: i + 1,
      due_date: inst.dueDate,
      amount: inst.amount,
      label: inst.label,
    }));

    return prisma.$transaction(async (tx: any) => {
      // Consumed in the SAME transaction as the actual mutation, not a
      // separate outer one — a rollback of one rolls back the other.
      if (data.identityJti) await consumeIdentityTokenInTx(tx, data.identityJti);
      const toSupersede = await tx.rent_obligations.findMany({
        where: {
          tenant_id: tenant.id,
          obligation_type: "RENT",
          is_superseded: false,
          status: "UPCOMING",
          due_date: { gte: effectiveFrom },
        },
        select: { id: true },
      });

      const request = await tx.payment_frequency_change_requests.create({
        data: {
          tenant_id: tenant.id,
          owner_id: ownerId,
          hostel_id: tenant.hostel_id,
          current_frequency: currentFrequency,
          requested_frequency: "CUSTOM_INSTALLMENTS",
          effective_from: effectiveFrom,
          transition_strategy: "NEXT_BILLING_PERIOD",
          reason: data.reason?.trim() || "Owner-defined custom installment schedule",
          settlement_snapshot: { type: "CUSTOM_INSTALLMENTS", installments: scheduleSnapshot },
          projection_snapshot: { installments: scheduleSnapshot },
          risk_snapshot: { obligations_superseded: toSupersede.length },
          status: "APPROVED",
          approved_by: ownerId,
          approved_at: new Date(),
        },
      });

      if (toSupersede.length > 0) {
        await tx.rent_obligations.updateMany({
          where: { id: { in: toSupersede.map((o: any) => o.id) } },
          data: {
            is_superseded: true,
            superseded_at: new Date(),
            superseded_by_request_id: request.id,
            updated_at: new Date(),
          },
        });
      }

      await tx.tenant_billing_plans.updateMany({
        where: { tenant_id: tenant.id, status: "ACTIVE" },
        data: { status: "SUPERSEDED", effective_to: dayBefore(effectiveFrom), updated_at: new Date() },
      });
      const plan = await tx.tenant_billing_plans.create({
        data: {
          tenant_id: tenant.id,
          owner_id: ownerId,
          hostel_id: tenant.hostel_id,
          frequency: "CUSTOM_INSTALLMENTS",
          effective_from: effectiveFrom,
          installment_count: normalized.length,
          total_contract_amount: money(totalContractAmount),
          transition_strategy: "NEXT_BILLING_PERIOD",
          schedule_snapshot: scheduleSnapshot,
          status: "ACTIVE",
          approved_by: ownerId,
          approved_at: new Date(),
        },
      });

      const createdObligations: any[] = [];
      for (const inst of normalized) {
        const { lifecycle_status, settlement_status } = fromLegacyStatus("UPCOMING");
        const row = await tx.rent_obligations.create({
          data: {
            tenant_id: tenant.id,
            owner_id: ownerId,
            hostel_id: tenant.hostel_id,
            agreement_id: agreement?.id || null,
            billing_plan_id: plan.id,
            obligation_type: "RENT",
            amount: inst.amount,
            total_amount: inst.amount,
            rent_month: firstOfUtcMonth(inst.dueDate),
            due_date: inst.dueDate,
            status: "UPCOMING",
            lifecycle_status,
            settlement_status,
            installment_label: inst.label || `Custom installment (${createdObligations.length + 1})`,
            installment_sequence: createdObligations.length + 1,
            billing_period_start: inst.dueDate,
            billing_period_end: inst.dueDate,
          },
        });
        createdObligations.push(row);
      }

      await tx.tenants.update({
        where: { id: tenant.id },
        data: {
          payment_frequency: "CUSTOM_INSTALLMENTS",
          payment_frequency_effective_from: effectiveFrom,
          payment_frequency_updated_at: new Date(),
        },
      });

      return {
        request,
        billing_plan: plan,
        obligations_created: createdObligations.length,
        obligations_superseded: toSupersede.length,
      };
    });
  }

  /**
   * Lighter-weight than `validateCleanPeriod` — only flags an obligation
   * whose billing period genuinely overlaps the new schedule's window (the
   * real double-billing risk). Deliberately does NOT block on older,
   * non-overlapping unpaid rent the way `validateCleanPeriod` does; used by
   * `ownerInitiateChange` so an owner can change frequency for a tenant who
   * simply has existing overdue rent — that debt is left untouched and
   * stays collectible exactly as before. See ADR-023.
   */
  private async findOverlappingObligations(tenantId: string, effectiveFrom: Date, requestedFrequency: PaymentFrequency, policy: any) {
    const requestedPeriod = billingScheduleService.getPeriodForAnchor(effectiveFrom, requestedFrequency, policy);
    const obligations = await prisma.rent_obligations.findMany({
      where: {
        tenant_id: tenantId,
        is_superseded: false,
        status: { in: ["PENDING", "PARTIAL"] },
      },
      include: { payments: true },
    });
    return obligations.filter((ob: any) => {
      const paid = (ob.payments || []).reduce((sum: number, p: any) => sum + Number(p.amount_paid || 0), 0);
      const remaining = Math.max(Number(ob.amount || 0) - paid, 0);
      if (remaining <= 0) return false;
      const periodStart = new Date(ob.billing_period_start || ob.rent_month);
      const periodEnd = new Date(ob.billing_period_end || ob.rent_month);
      return periodStart <= requestedPeriod.end && periodEnd >= requestedPeriod.start;
    });
  }

  /**
   * Finds the first upcoming period-start date for `requestedFrequency` that
   * doesn't collide with any of the tenant's current in-flight obligations —
   * unlike `getNextCleanBillingPeriodDate` (a pure calendar computation that
   * ignores the tenant's actual state entirely), this actually checks each
   * candidate against `findOverlappingObligations` and keeps searching
   * forward instead of giving up after the first naive candidate. Needed for
   * e.g. switching a tenant back from Quarterly to Monthly when this
   * month's rent is already activated — the immediate next month collides,
   * but a later one usually won't. See ADR-026. Throws UNCLEAN_BILLING_PERIOD
   * only if nothing clean is found in the next 36 months.
   */
  private async findCleanEffectiveFrom(tenantId: string, requestedFrequency: PaymentFrequency, policy: any): Promise<Date> {
    let cursor = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1));
    for (let i = 0; i < 36; i++) {
      if (billingScheduleService.isPeriodStart(cursor, requestedFrequency, policy)) {
        const overlapping = await this.findOverlappingObligations(tenantId, cursor, requestedFrequency, policy);
        if (overlapping.length === 0) return cursor;
      }
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    }
    throw new Error("UNCLEAN_BILLING_PERIOD");
  }

  async validateCleanPeriod(tenantId: string, effectiveFrom: Date, requestedFrequency: PaymentFrequency, policy: any) {
    const requestedPeriod = billingScheduleService.getPeriodForAnchor(effectiveFrom, requestedFrequency, policy);
    const obligations = await prisma.rent_obligations.findMany({
      where: {
        tenant_id: tenantId,
        is_superseded: false,
        status: { in: ["PENDING", "PARTIAL"] },
      },
      include: { payments: true },
    });
    const blockers = obligations.filter((ob: any) => {
      const paid = (ob.payments || []).reduce((sum: number, p: any) => sum + Number(p.amount_paid || 0), 0);
      const remaining = Math.max(Number(ob.amount || 0) - paid, 0);
      if (remaining <= 0) return false;
      const periodStart = new Date(ob.billing_period_start || ob.rent_month);
      const periodEnd = new Date(ob.billing_period_end || ob.rent_month);
      const beforeEffective = periodEnd < effectiveFrom;
      const overlapsNewWindow = periodStart <= requestedPeriod.end && periodEnd >= requestedPeriod.start;
      return beforeEffective || overlapsNewWindow;
    });
    if (blockers.length) throw new Error("UNCLEAN_BILLING_PERIOD");
  }

  private async validateCooldown(tenantId: string, cooldownDays: number) {
    const latest = await prisma.payment_frequency_change_requests.findFirst({
      where: { tenant_id: tenantId, status: "APPROVED" },
      orderBy: { approved_at: "desc" },
    });
    if (!latest?.approved_at) return;
    const nextAllowed = new Date(latest.approved_at.getTime() + cooldownDays * 86_400_000);
    if (nextAllowed > new Date()) throw new Error("FREQUENCY_CHANGE_COOLDOWN_ACTIVE");
  }

  private async validateCommitment(tenant: any, currentFrequency: PaymentFrequency, policy: any) {
    const activePlan = tenant.tenant_billing_plans?.[0];
    if (!activePlan) return;
    const commitmentMonths = Number(policy.minimum_commitment_months?.[currentFrequency] || 1);
    const effectiveFrom = activePlan.effective_from;
    const minUntil = new Date(Date.UTC(
      effectiveFrom.getUTCFullYear(),
      effectiveFrom.getUTCMonth() + commitmentMonths,
      effectiveFrom.getUTCDate()
    ));
    if (minUntil > new Date()) throw new Error("MINIMUM_COMMITMENT_NOT_MET");
  }
}

export const billingTransitionService = new BillingTransitionService();
