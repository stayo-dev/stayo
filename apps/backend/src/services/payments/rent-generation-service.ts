import { prisma } from "@/lib/db";
import { eventSystem } from "@/lib/events";
import { invalidateOwnerDashboardCache, invalidateHostelDashboardCache } from "@/lib/cache/dashboard-cache";
import { eventLog } from "@/lib/services/event-log-service";
import { resolvePreferences } from "@/lib/preferences";
import { getCurrentDateInTimezone, getDayInTimezone } from "@/lib/timezone";
import { rentGenerationLedgerService } from "@/lib/services/rent-generation-ledger-service";
import {
  validateBillingPreferences,
  type BillingValidationError,
} from "@/lib/services/billing-validation";
import { billingScheduleService, type PaymentFrequency } from "@/lib/services/billing-schedule-service";
import crypto from "crypto";
import { agreementRentScheduleService } from "./agreement-rent-schedule-service";
import { financialLifecycleService } from "./financial-lifecycle-service";

/**
 * 🏦 Rent Generation Service — Phases 1-7
 *
 * Idempotent monthly rent obligation generator.
 * Safe to run multiple times — the DB unique constraint
 * on (allocation_id, rent_month, obligation_type) prevents duplicate rows.
 *
 * Safety features:
 * Phase 1: Catch-up generation, ledger idempotency
 * Phase 2: Hostel-scoped preferences, multi-hostel independence
 * Phase 3: Atomic transaction (rent + maintenance in one TX)
 * Phase 4: Billing preference validation before any rows are queued
 * Phase 5: Unified owner-scoped DB lock prevents cron/manual overlap
 * Phase 7: Anomaly events for zero generation, timeouts, lock contention
 */

export class RentGenerationService {

  async generateMonthlyRent(
    targetDate: Date | undefined,
    ownerId: string,
    triggerType: "cron" | "manual" = "manual",
    hostelId: string
  ) {
    if (!ownerId || !hostelId) {
      throw new Error("HOSTEL_CONTEXT_REQUIRED: Rent generation requires ownerId and hostelId");
    }

    const startTime = Date.now();
    const now = targetDate || new Date();
    // Deterministic month key — always UTC midnight on 1st
    const rentMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));

    const monthKey = `${rentMonth.getUTCFullYear()}-${String(rentMonth.getUTCMonth() + 1).padStart(2, "0")}`;
    const lockKey = `rent_gen_${hostelId}_${monthKey}`;

    try {
      // Atomic Lock Acquisition: INSERT with ON CONFLICT DO UPDATE WHERE expires_at < NOW()
      // Zero rows affected means the lock is held by another process and not yet expired.
      const lockAcquired = await prisma.$executeRaw`
        INSERT INTO system_locks (key, locked_at, expires_at)
        VALUES (${lockKey}, NOW(), NOW() + interval '60 seconds')
        ON CONFLICT (key) DO UPDATE
        SET locked_at = NOW(), expires_at = NOW() + interval '60 seconds'
        WHERE system_locks.expires_at < NOW()
      `;

      if (lockAcquired === 0) {
        // Phase 7: Structured lock contention event
        console.warn("[RENT] Lock contention — generation already in progress", {
          lock_key: lockKey, trigger_type: triggerType, owner_id: ownerId,
        });
        await eventLog.log("LOCK_CONTENTION", ownerId || null, {
          lock_key: lockKey,
          rent_month: rentMonth.toISOString(),
          trigger_type: triggerType,
        }).catch(() => {});
        return {
          rent_month: rentMonth.toISOString(),
          error: "Rent generation already in progress. Please wait.",
          locked: true,
        };
      }

      console.log("[RENT] Lock acquired", { lock_key: lockKey, trigger_type: triggerType });
    } catch (e: any) {
      console.error("[RENT] Critical DB lock failure:", e);
      await eventLog.log("LOCK_CONTENTION", ownerId || null, {
        lock_key: lockKey,
        rent_month: rentMonth.toISOString(),
        trigger_type: triggerType,
        error: e?.message,
        cause: "LOCK_ACQUIRE_FAILED",
      }).catch(() => {});
      return {
        rent_month: rentMonth.toISOString(),
        error: "Failed to acquire generation lock.",
        locked: true,
      };
    }

    try {
      // Verify hostel is ACTIVE
      const hostel = await prisma.hostels.findUnique({
        where: { id: hostelId },
        select: { status: true, owner_id: true }
      });
      if (!hostel || hostel.owner_id !== ownerId) {
        throw new Error(`HOSTEL_NOT_FOUND: Hostel ${hostelId} does not exist or access denied.`);
      }
      if (hostel.status !== "ACTIVE") {
        throw new Error(`HOSTEL_NOT_ACTIVE: Rent generation is only allowed for ACTIVE hostels.`);
      }

      await agreementRentScheduleService.syncDueStatuses({ hostelId, now }).catch((error: any) => {
        console.warn("[RENT] Agreement schedule status sync failed", {
          hostel_id: hostelId,
          error: error?.message || String(error),
        });
      });

      const lastDay = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)).getUTCDate();
      const monthEndDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), lastDay, 23, 59, 59, 999));

      // Find allocations that are active AND haven't ended before this month
      const whereClause: any = {
        is_active: true,
        hostel_id: hostelId,
        start_date: { lte: monthEndDate },
        tenant: { status: "ACTIVE", owner_id: ownerId },
        OR: [
          { end_date: null },
          { end_date: { gte: rentMonth } }
        ]
      };

      const allocations = await prisma.roomAllocation.findMany({
        where: whereClause,
        include: {
          tenant: {
            select: {
              id: true,
              monthly_rent: true,
              owner_id: true,
              maintenance_charge: true,
              maintenance_type: true,
              payment_frequency: true,
              payment_frequency_effective_from: true,
            }
          },
          room: {
            select: { base_rent: true, hostel_id: true }
          }
        }
      });

      // Phase 2: preferences are scoped to the allocation's actual hostel.
      // This keeps multi-hostel owners from leaking one hostel's billing config into another.
      const hostelIds = Array.from(new Set(allocations.map(a => (a.room as any).hostel_id).filter(Boolean))) as string[];
      const hostelPrefs: any[] = await prisma.hostels.findMany({
        where: { id: { in: hostelIds }, status: "ACTIVE" },
      });
      const prefsMap = new Map(hostelPrefs.map((p: any) => [p.id, p]));

      let created = 0;
      let skipped = 0;
      let failed = 0;
      const errors: string[] = [];

      // ── BATCH obligation generation (replaces N×2 per-allocation queries) ──
      // 1. One round-trip to fetch all existing obligations this rentMonth
      const allocationIds = allocations.map(a => a.id);
      const existingObligations = await prisma.rent_obligations.findMany({
        where: { allocation_id: { in: allocationIds }, rent_month: rentMonth },
        select: { allocation_id: true, obligation_type: true },
      });
      // O(1) lookup set: "allocId:obligationType"
      const existingSet = new Set(
        existingObligations.map(o => `${o.allocation_id}:${o.obligation_type ?? 'RENT'}`)
      );

      const tenantIds = Array.from(new Set(allocations.map((a: any) => a.tenant?.id).filter(Boolean))) as string[];
      const agreementRows = tenantIds.length > 0
        ? await prisma.agreement.findMany({
            where: {
              tenant_id: { in: tenantIds },
              status: { in: ["SIGNED", "EXPIRING_SOON", "AGREEMENT_EXPIRED"] },
            },
            select: { tenant_id: true },
          })
        : [];
      const tenantsWithAgreementSchedules = new Set(agreementRows.map((agreement: any) => agreement.tenant_id));
      const activePlans = await prisma.tenant_billing_plans.findMany({
        where: {
          tenant_id: { in: tenantIds },
          status: "ACTIVE",
          effective_from: { lte: rentMonth },
          OR: [{ effective_to: null }, { effective_to: { gte: rentMonth } }],
        },
        orderBy: { effective_from: "desc" },
      });
      const activePlanMap = new Map<string, any>();
      for (const plan of activePlans) {
        if (!activePlanMap.has(plan.tenant_id)) activePlanMap.set(plan.tenant_id, plan);
      }

      const rentRows:  any[] = [];
      const maintRows: any[] = [];
      const ledgerStats = new Map<string, {
        ownerId: string;
        hostelId: string;
        obligationType: string;
        created: number;
        skipped: number;
      }>();

      const ledgerKey = (ownerId: string, hostelId: string, obligationType: string) =>
        `${ownerId}:${hostelId}:${obligationType}`;

      const ensureLedgerStat = (ownerId: string, hostelId: string, obligationType: string) => {
        const key = ledgerKey(ownerId, hostelId, obligationType);
        const current = ledgerStats.get(key);
        if (current) return current;
        const next = { ownerId, hostelId, obligationType, created: 0, skipped: 0 };
        ledgerStats.set(key, next);
        return next;
      };

      const logGenerationDecision = (payload: Record<string, any>) => {
        console.log("[RENT] generation-decision", payload);
      };

      for (const alloc of allocations) {
        // Runaway generation timeout guard
        if (Date.now() - startTime > 30_000) {
          console.warn("[RENT] Runaway generation detected — safety aborting at 30,000ms");
          errors.push("TIMEOUT: Generation exceeded Vercel 30s limit");
          break;
        }

        const ownerId = alloc.tenant.owner_id;
        if (!ownerId) {
          console.warn(`[RENT] Skipping allocation ${alloc.id} — missing owner_id`);
          skipped++;
          continue;
        }

        const hostelId = (alloc.room as any).hostel_id;
        if (!hostelId) {
          console.warn(`[RENT] Skipping allocation ${alloc.id} — missing hostel_id`);
          skipped++;
          continue;
        }

        const prefs: any = prefsMap.get(hostelId);
        if (!prefs) {
          console.warn(`[RENT] Skipping allocation ${alloc.id} — missing active hostel preferences for ${hostelId}`);
          skipped++;
          await rentGenerationLedgerService.skip({
            ownerId, hostelId, rentMonth, obligationType: "RENT",
            skippedCount: 1, reason: "ACTIVE_HOSTEL_NOT_FOUND"
          }).catch((ledgerErr: any) => console.error("[RENT] Failed to write ledger skip:", ledgerErr));
          logGenerationDecision({
            owner_id: ownerId, hostel_id: hostelId, rent_month: rentMonth.toISOString(),
            obligation_type: "RENT", created: 0, skipped: 1,
            reason: "ACTIVE_HOSTEL_NOT_FOUND", trigger_type: triggerType
          });
          continue;
        }

        const config = resolvePreferences(prefs);

        // Phase 4: Validate billing preferences before queuing any rows.
        // Invalid configs produce a structured error and skip this hostel's generation.
        const prefValidation = validateBillingPreferences({
          hostel_id: hostelId,
          owner_id: ownerId,
          auto_rent_day: Number(config.auto_rent_day ?? 1),
          due_day: Number(config.due_day ?? 5),
          timezone: config.timezone || "Asia/Kolkata",
          rent_cycle: config.rent_cycle || "MONTHLY",
        });
        if (!prefValidation.valid) {
          const errorCodes = prefValidation.errors.map((e) => e.code).join(",");
          console.warn(`[RENT] Skipping hostel ${hostelId} — invalid billing config: ${errorCodes}`, prefValidation.errors);
          skipped++;
          await rentGenerationLedgerService.skip({
            ownerId, hostelId, rentMonth, obligationType: "RENT",
            skippedCount: 1, reason: `INVALID_BILLING_CONFIG:${errorCodes}`,
          }).catch((ledgerErr: any) => console.error("[RENT] Failed to write ledger skip:", ledgerErr));
          logGenerationDecision({
            owner_id: ownerId, hostel_id: hostelId, rent_month: rentMonth.toISOString(),
            obligation_type: "RENT", created: 0, skipped: 1,
            reason: "INVALID_BILLING_CONFIG", validation_errors: prefValidation.errors,
            trigger_type: triggerType,
          });
          continue;
        }
        // Log any warnings (e.g. DUE_DAY_BEFORE_RENT_DAY_SHIFTED) without aborting
        const prefWarnings = prefValidation.errors.filter((e: BillingValidationError) => e.severity === "WARNING");
        if (prefWarnings.length > 0) {
          console.warn(`[RENT] Billing config warnings for hostel ${hostelId}`, prefWarnings);
        }

        // Automation Guard: Skip if owner disabled auto-generation (unless manual trigger)
        if (triggerType === "cron") {
          const autoGen = config.auto_generate_rent ?? true;
          if (!autoGen) {
            console.info(`[RENT] Skipping owner ${ownerId} — auto_generate_rent disabled`);
            await rentGenerationLedgerService.skip({
              ownerId, hostelId, rentMonth, obligationType: "RENT",
              skippedCount: 1, reason: "AUTO_GENERATE_DISABLED"
            }).catch((ledgerErr: any) => console.error("[RENT] Failed to write ledger skip:", ledgerErr));
            logGenerationDecision({
              owner_id: ownerId, hostel_id: hostelId, rent_month: rentMonth.toISOString(),
              obligation_type: "RENT", created: 0, skipped: 1,
              reason: "AUTO_GENERATE_DISABLED", trigger_type: triggerType
            });
            skipped++;
            continue;
          }

          // Per-owner generation-day guard
          const tz = config.timezone || "Asia/Kolkata";
          const expectedDay = Number(config.auto_rent_day ?? 1);
          const localDay = getDayInTimezone(now, tz);

          console.log("[RENT] day-check", {
            ownerId, hostelId, utcNow: now.toISOString(), timezone: tz,
            localDay, expectedDay, willProcess: localDay >= expectedDay,
          });

          if (localDay < expectedDay) {
            await rentGenerationLedgerService.skip({
              ownerId, hostelId, rentMonth, obligationType: "RENT",
              skippedCount: 1, reason: "BEFORE_GENERATION_DAY"
            }).catch((ledgerErr: any) => console.error("[RENT] Failed to write ledger skip:", ledgerErr));
            logGenerationDecision({
              owner_id: ownerId, hostel_id: hostelId, rent_month: rentMonth.toISOString(),
              obligation_type: "RENT", created: 0, skipped: 1,
              reason: "BEFORE_GENERATION_DAY", trigger_type: triggerType,
              local_day: localDay, expected_day: expectedDay
            });
            skipped++;
            continue;
          }
        }

        const autoRentDayVal = Number(config.auto_rent_day ?? 1);
        const dueDayVal = Number(config.due_day ?? 5);

        const rentAmount = Number(alloc.tenant.monthly_rent) || Number(alloc.room.base_rent) || 0;
        if (rentAmount <= 0) {
          console.info(`[RENT] Skipping allocation ${alloc.id} — zero rent`);
          skipped++;
          continue;
        }

        const policy = billingScheduleService.normalizePolicy((prefs as any)?.preferences_config);
        const effectiveFrom = (alloc.tenant as any).payment_frequency_effective_from
          ? new Date((alloc.tenant as any).payment_frequency_effective_from)
          : null;
        const tenantFrequency = String((alloc.tenant as any).payment_frequency || "MONTHLY") as PaymentFrequency;
        const frequency = effectiveFrom && effectiveFrom <= rentMonth ? tenantFrequency : "MONTHLY";
        if (!billingScheduleService.isPeriodStart(rentMonth, frequency, policy)) {
          skipped++;
          logGenerationDecision({
            owner_id: ownerId,
            hostel_id: hostelId,
            rent_month: rentMonth.toISOString(),
            obligation_type: "RENT",
            created: 0,
            skipped: 1,
            reason: "NOT_BILLING_PERIOD_START",
            payment_frequency: frequency,
            trigger_type: triggerType,
          });
          continue;
        }
        const installment = billingScheduleService.buildInstallment({
          frequency,
          anchorDate: rentMonth,
          monthlyRent: rentAmount,
          maintenanceAmount: Number((alloc.tenant as any).maintenance_charge) || 0,
          dueDay: dueDayVal,
          autoRentDay: autoRentDayVal,
          policy,
        });
        const tenantDueDate = installment.due_date;
        const activePlan = activePlanMap.get(alloc.tenant.id);

        // Collect RENT row if not already present. Tenants with signed
        // agreements get their closed rent schedule from AgreementRentScheduleService.
        const rentCompleted = await rentGenerationLedgerService.hasCompleted(ownerId, hostelId, rentMonth, "RENT");
        if (tenantsWithAgreementSchedules.has(alloc.tenant.id)) {
          skipped++;
          logGenerationDecision({
            owner_id: ownerId, hostel_id: hostelId, rent_month: rentMonth.toISOString(),
            obligation_type: "RENT", created: 0, skipped: 1,
            reason: "AGREEMENT_SCHEDULE_SOURCE", trigger_type: triggerType
          });
        } else if (rentCompleted) {
          skipped++;
          await rentGenerationLedgerService.skip({
            ownerId, hostelId, rentMonth, obligationType: "RENT",
            skippedCount: 1, reason: "ALREADY_COMPLETED"
          }).catch((ledgerErr: any) => console.error("[RENT] Failed to write ledger skip:", ledgerErr));
          logGenerationDecision({
            owner_id: ownerId, hostel_id: hostelId, rent_month: rentMonth.toISOString(),
            obligation_type: "RENT", created: 0, skipped: 1,
            reason: "ALREADY_COMPLETED", trigger_type: triggerType
          });
        } else {
          await rentGenerationLedgerService.startOrReuse({
            ownerId, hostelId, rentMonth, obligationType: "RENT",
            triggerType, generatedBy: triggerType === "manual" ? ownerId : null
          });
          const stat = ensureLedgerStat(ownerId, hostelId, "RENT");
          if (!existingSet.has(`${alloc.id}:RENT`)) {
            rentRows.push({
              tenant_id: alloc.tenant.id, allocation_id: alloc.id,
              owner_id: alloc.tenant.owner_id, rent_month: rentMonth,
              amount: installment.amount, total_amount: installment.amount,
              due_date: tenantDueDate, status: "PENDING", obligation_type: "RENT",
              hostel_id: hostelId, // Phase 2: immutable hostel context at generation time
              billing_period_start: installment.period_start,
              billing_period_end: installment.period_end,
              installment_label: installment.installment_label,
              installment_sequence: installment.installment_sequence,
              billing_plan_id: activePlan?.id || null,
            });
            stat.created++;
          } else {
            stat.skipped++;
            skipped++;
          }
        }

        // Collect MAINTENANCE row if applicable and not already present
        const maintAmount = Number((alloc.tenant as any).maintenance_charge) || 0;
        const maintType   = (alloc.tenant as any).maintenance_type || "MONTHLY";
        if (maintAmount > 0 && maintType === "MONTHLY") {
          const maintCompleted = await rentGenerationLedgerService.hasCompleted(ownerId, hostelId, rentMonth, "MAINTENANCE");
          if (maintCompleted) {
            skipped++;
            await rentGenerationLedgerService.skip({
              ownerId, hostelId, rentMonth, obligationType: "MAINTENANCE",
              skippedCount: 1, reason: "ALREADY_COMPLETED"
            }).catch((ledgerErr: any) => console.error("[RENT] Failed to write ledger skip:", ledgerErr));
            logGenerationDecision({
              owner_id: ownerId, hostel_id: hostelId, rent_month: rentMonth.toISOString(),
              obligation_type: "MAINTENANCE", created: 0, skipped: 1,
              reason: "ALREADY_COMPLETED", trigger_type: triggerType
            });
          } else {
            await rentGenerationLedgerService.startOrReuse({
              ownerId, hostelId, rentMonth, obligationType: "MAINTENANCE",
              triggerType, generatedBy: triggerType === "manual" ? ownerId : null
            });
            const stat = ensureLedgerStat(ownerId, hostelId, "MAINTENANCE");
            if (!existingSet.has(`${alloc.id}:MAINTENANCE`)) {
              maintRows.push({
                tenant_id: alloc.tenant.id, allocation_id: alloc.id,
                owner_id: alloc.tenant.owner_id, rent_month: rentMonth,
                amount: installment.maintenance_amount, total_amount: installment.maintenance_amount,
                due_date: tenantDueDate, status: "PENDING", obligation_type: "MAINTENANCE",
                hostel_id: hostelId, // Phase 2: immutable hostel context at generation time
                billing_period_start: installment.period_start,
                billing_period_end: installment.period_end,
                installment_label: installment.installment_label,
                installment_sequence: installment.installment_sequence,
                billing_plan_id: activePlan?.id || null,
              });
              stat.created++;
            } else {
              stat.skipped++;
              skipped++;
            }
          }

        }
      }

      // 2. Atomic bulk insert — both rent and maintenance rows go in a single transaction.
      //    If either insert fails the entire transaction rolls back, preventing partial generation.
      //    skipDuplicates is still set so concurrent cron/manual triggers that race past the
      //    ledger check are handled gracefully inside the transaction window.
      let txRolledBack = false;
      try {
        const txResults = await prisma.$transaction(async (tx) => {
          let rentCount = 0;
          let maintCount = 0;
          if (rentRows.length > 0) {
            const result = await tx.rent_obligations.createMany({ data: rentRows, skipDuplicates: true });
            rentCount = result.count;
          }
          if (maintRows.length > 0) {
            const result = await tx.rent_obligations.createMany({ data: maintRows, skipDuplicates: true });
            maintCount = result.count;
          }

          // Synchronous activation, inside this same transaction, per tenant.
          // createMany doesn't return row IDs, so re-fetch each tenant's
          // just-created PENDING rows for this rent_month before activating.
          if (rentCount + maintCount > 0) {
            const allCreatedRows = [...rentRows, ...maintRows];
            const tenantOwnerMap = new Map<string, { owner_id: string; hostel_id: string }>();
            for (const row of allCreatedRows) {
              if (!tenantOwnerMap.has(row.tenant_id)) {
                tenantOwnerMap.set(row.tenant_id, {
                  owner_id: row.owner_id,
                  hostel_id: row.hostel_id,
                });
              }
            }
            for (const [tid, ctx] of Array.from(tenantOwnerMap)) {
              const created_ = await tx.rent_obligations.findMany({
                where: {
                  tenant_id: tid,
                  rent_month: rentMonth,
                  obligation_type: { in: ["RENT", "MAINTENANCE"] },
                  status: "PENDING",
                },
                select: { id: true },
              });
              if (created_.length > 0) {
                await financialLifecycleService.activatePayableObligations(tx, {
                  tenantId: tid, ownerId: ctx.owner_id, hostelId: ctx.hostel_id,
                  obligationIds: created_.map((c: any) => c.id),
                });
              }
            }
          }

          return { rentCount, maintCount };
        });
        created += txResults.rentCount + txResults.maintCount;

        // Post-commit: notify (cache invalidation + SSE) per unique tenant.
        // Activation itself already happened synchronously above.
        if (txResults.rentCount + txResults.maintCount > 0) {
          const allCreatedRows = [...rentRows, ...maintRows];
          const tenantOwnerMap = new Map<string, { owner_id: string; hostel_id: string }>();
          for (const row of allCreatedRows) {
            if (!tenantOwnerMap.has(row.tenant_id)) {
              tenantOwnerMap.set(row.tenant_id, {
                owner_id: row.owner_id,
                hostel_id: row.hostel_id,
              });
            }
          }
          for (const [tid, ctx] of Array.from(tenantOwnerMap)) {
            financialLifecycleService.notifyActivated({
              tenantId: tid,
              ownerId: ctx.owner_id,
              hostelId: ctx.hostel_id,
              source: "rent_generation",
            });
          }
        }
      } catch (insertErr: any) {
        txRolledBack = true;
        failed += ledgerStats.size || 1;

        // Classify the failure reason for structured audit trails
        const failureReason = insertErr?.code === "P2002"
          ? "DUPLICATE_KEY_CONFLICT"
          : insertErr?.message?.includes("timeout")
            ? "TRANSACTION_TIMEOUT"
            : "TRANSACTION_ROLLED_BACK";

        console.error("[RENT] Transaction rolled back — no obligations written", {
          rent_month: rentMonth.toISOString(),
          reason: failureReason,
          error: insertErr?.message,
          rent_rows_pending: rentRows.length,
          maint_rows_pending: maintRows.length,
        });

        errors.push(`${failureReason}: ${insertErr?.message || "unknown"}`);

        // Mark every affected ledger entry as FAILED.
        // These writes happen OUTSIDE the rolled-back transaction so the control-plane
        // accurately records the failure and unblocks safe retries.
        for (const stat of Array.from(ledgerStats.values())) {
          await rentGenerationLedgerService.fail({
            ownerId: stat.ownerId,
            hostelId: stat.hostelId,
            rentMonth,
            obligationType: stat.obligationType,
            createdCount: 0,
            skippedCount: stat.skipped,
            reason: failureReason,
          }).catch((ledgerErr: any) => console.error("[RENT] Failed to mark ledger failed:", ledgerErr));
        }
        throw insertErr;
      }

      for (const stat of Array.from(ledgerStats.values())) {
        await rentGenerationLedgerService.complete({
          ownerId: stat.ownerId,
          hostelId: stat.hostelId,
          rentMonth,
          obligationType: stat.obligationType,
          createdCount: stat.created,
          skippedCount: stat.skipped,
        }).catch((ledgerErr: any) => {
          console.error("[RENT] Failed to complete ledger:", ledgerErr);
          errors.push(`LEDGER_COMPLETE_FAILED: ${ledgerErr?.message || ledgerErr}`);
        });
        logGenerationDecision({
          owner_id: stat.ownerId,
          hostel_id: stat.hostelId,
          rent_month: rentMonth.toISOString(),
          obligation_type: stat.obligationType,
          created: stat.created,
          skipped: stat.skipped,
          reason: "COMPLETED",
          trigger_type: triggerType,
        });
      }

      const durationMs = Date.now() - startTime;

      const summary = {
        rent_month: rentMonth.toISOString(),
        total_allocations: allocations.length,
        created,
        skipped,
        failed,
        duration_ms: durationMs,
        errors: errors.length > 0 ? errors : undefined
      };

      // Phase 7: Anomaly detection — emit ZERO_RENT_GENERATED when we had eligible
      // allocations but created nothing. This is a financial signal, not an error per se,
      // but it must be surfaced for operational visibility.
      if (created === 0 && allocations.length > 0 && failed === 0) {
        await eventLog.log("ZERO_RENT_GENERATED", ownerId || null, {
          rent_month: rentMonth.toISOString(),
          trigger_type: triggerType,
          total_allocations: allocations.length,
          skipped,
          hint: "All eligible allocations were skipped. Verify ledger state and hostel config.",
        }).catch(() => {});
      }

      // Phase 7: Emit GENERATION_TIMEOUT anomaly if we hit the safety abort
      if (errors.some((e) => e.startsWith("TIMEOUT:"))) {
        await eventLog.log("GENERATION_TIMEOUT", ownerId || null, {
          rent_month: rentMonth.toISOString(),
          trigger_type: triggerType,
          duration_ms: durationMs,
          created,
          skipped,
          failed,
        }).catch(() => {});
      }

      // Write audit log
      await prisma.rent_generation_logs.create({
        data: {
          id: crypto.randomUUID(),
          rent_month: rentMonth,
          trigger_type: triggerType,
          triggered_by: ownerId || null,
          total_allocations: allocations.length,
          obligations_created: created,
          obligations_skipped: skipped,
          obligations_failed: failed,
          duration_ms: durationMs,
          errors: errors.length > 0 ? JSON.stringify(errors) : null
        }
      }).catch(logErr => {
        console.error("[RENT] Failed to write generation log:", logErr);
      });

      const totalAmountGenerated = rentRows.reduce((sum, r) => sum + Number(r.amount), 0) +
                                   maintRows.reduce((sum, r) => sum + Number(r.amount), 0);
      const tenantCount = Array.from(
        new Set([
          ...rentRows.map((r: any) => r.tenant_id),
          ...maintRows.map((r: any) => r.tenant_id),
        ])
      ).length;

      // Broadcast structured SSE events
      if (created > 0) {
        await eventSystem.trigger("rent_generated", {
          month: rentMonth.toISOString(),
          count: created,
          owner_id: ownerId || "all",
          hostel_id: hostelId || null,
          tenant_count: tenantCount,
          total_amount: totalAmountGenerated,
        });
        await eventSystem.trigger("dashboard_updated", {
          reason: "rent_generated",
          owner_id: ownerId || "all",
          hostel_id: hostelId || null,
        });

        if (hostelId) {
          invalidateHostelDashboardCache(hostelId);
        } else {
          const hostelIds = Array.from(new Set(allocations.map((a: any) => a.hostel_id).filter(Boolean)));
          hostelIds.forEach(id => {
            if (id) invalidateHostelDashboardCache(id);
          });
        }
      }

      // Write structured audit event
      await eventLog.log("RENT_GENERATED", ownerId || null, {
        rent_month: rentMonth.toISOString(),
        trigger_type: triggerType,
        created, skipped, failed, duration_ms: durationMs
      });

      console.log(`[RENT] Generation complete: ${created} created, ${skipped} skipped, ${failed} failed (${durationMs}ms)`);
      return summary;

    } finally {
      // 🔧 FIX M4: Use raw SQL for cleanup to match raw SQL lock acquisition
      // Prevents connection/transaction mismatch between raw SQL INSERT and Prisma ORM DELETE
      await prisma.$executeRaw`DELETE FROM system_locks WHERE key = ${lockKey}`
        .catch((e: any) => console.error("[RENT] Failed to release DB lock:", e));
    }
  }

  /**
   * Generate upcoming rent installments for ONE tenant, on demand (ADR-036).
   *
   * Exists because a tenant may pay more than is currently due, and StayO no
   * longer parks the excess as a future-rent-credit balance — every rupee must
   * land on a real installment. Called from the payment path *before* the
   * settlement planner runs.
   *
   * Deliberately NOT `generateMonthlyRent()`: that method is hostel-wide and
   * month-locked, so calling it here would create next month's rent for every
   * tenant in the hostel as a side effect of one person paying ahead.
   *
   * Idempotency comes from the database, not the generation ledger:
   * `@@unique([agreement_id, rent_month, obligation_type])` makes a duplicate
   * impossible, and the monthly cron already tolerates pre-existing rows
   * (`existingSet` pre-check + `createMany({ skipDuplicates: true })`). The
   * `rent_generation_ledgers` key is deliberately left untouched — it is scoped
   * to (owner, hostel, month), so marking it here would make the cron skip the
   * whole hostel.
   *
   * Period maths reuses `billingScheduleService.buildInstallment`, the same
   * computation the cron uses, so labels/sequences/due dates stay identical.
   */
  async ensureInstallmentsForTenant(input: {
    tenantId: string;
    ownerId: string;
    hostelId: string;
    /** Rupees still unallocated after every existing obligation is covered. */
    amountNeeded: number;
    tx?: any;
  }): Promise<{ created: string[]; coveredAmount: number; exhausted: boolean }> {
    const db = input.tx ?? prisma;
    const created: string[] = [];
    let coveredAmount = 0;

    if (!input.amountNeeded || input.amountNeeded <= 0) {
      return { created, coveredAmount: 0, exhausted: false };
    }

    const agreement = await (db as any).agreement.findFirst({
      where: { tenant_id: input.tenantId, status: "ACTIVE" },
      orderBy: { agreement_start_date: "desc" },
    });

    const monthlyRent = Number(agreement?.contract_rent) || 0;
    if (!agreement || monthlyRent <= 0) {
      // Nothing to bill against — the caller must refuse the excess rather
      // than inventing an amount.
      return { created, coveredAmount: 0, exhausted: true };
    }

    const frequency = (agreement.contract_payment_frequency || "MONTHLY") as PaymentFrequency;
    const periodMonths = billingScheduleService.periodMonths(frequency);

    const latest = await (db as any).rent_obligations.findFirst({
      where: { tenant_id: input.tenantId, obligation_type: "RENT" },
      orderBy: { rent_month: "desc" },
      select: { rent_month: true },
    });

    const startFrom = latest?.rent_month ? new Date(latest.rent_month) : new Date();
    let cursor = new Date(
      Date.UTC(startFrom.getUTCFullYear(), startFrom.getUTCMonth() + periodMonths, 1),
    );

    const endDate = agreement.agreement_end_date ? new Date(agreement.agreement_end_date) : null;
    let exhausted = false;

    while (coveredAmount < input.amountNeeded) {
      if (endDate && cursor > endDate) {
        exhausted = true;
        break;
      }

      const installment = billingScheduleService.buildInstallment({
        frequency,
        anchorDate: cursor,
        monthlyRent,
      });

      try {
        const row = await (db as any).rent_obligations.create({
          data: {
            tenant_id: input.tenantId,
            owner_id: input.ownerId,
            hostel_id: input.hostelId,
            agreement_id: agreement.id,
            rent_month: cursor,
            amount: installment.amount,
            total_amount: installment.amount,
            due_date: installment.due_date,
            status: "PENDING",
            obligation_type: "RENT",
            billing_period_start: installment.period_start,
            billing_period_end: installment.period_end,
            installment_label: installment.installment_label,
            installment_sequence: installment.installment_sequence,
          },
        });
        if (row?.id) created.push(row.id);
      } catch (err: any) {
        // P2002: the cron (or a concurrent payment) already created this
        // period. The month is covered either way — keep going.
        if (err?.code !== "P2002") throw err;
      }

      coveredAmount += installment.amount;
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + periodMonths, 1));
    }

    return { created, coveredAmount, exhausted };
  }

  /**
   * Preview what would be generated without writing anything.
   * Pure read-only operation.
   */
  async previewMonthlyRent(targetDate: Date | undefined, ownerId: string, hostelId: string) {
    if (!ownerId || !hostelId) {
      throw new Error("HOSTEL_CONTEXT_REQUIRED: Rent preview requires ownerId and hostelId");
    }

    const hostel = await prisma.hostels.findUnique({
      where: { id: hostelId },
      select: { status: true, owner_id: true }
    });
    if (!hostel || hostel.owner_id !== ownerId) {
      throw new Error(`HOSTEL_NOT_FOUND: Hostel ${hostelId} does not exist or access denied.`);
    }
    if (hostel.status !== "ACTIVE") {
      throw new Error(`HOSTEL_NOT_ACTIVE: Rent preview is only allowed for ACTIVE hostels.`);
    }

    const now = targetDate || new Date();
    const rentMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));

    const lastDay = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)).getUTCDate();
    const monthEndDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), lastDay, 23, 59, 59, 999));

    const whereClause: any = {
      is_active: true,
      hostel_id: hostelId,
      start_date: { lte: monthEndDate },
      tenant: { status: "ACTIVE", owner_id: ownerId },
      OR: [
        { end_date: null },
        { end_date: { gte: rentMonth } }
      ]
    };

    const allocations = await prisma.roomAllocation.findMany({
      where: whereClause,
      include: {
        tenant: {
          select: { id: true, monthly_rent: true, owner_id: true, profiles: { select: { name: true } } }
        },
        room: {
          select: { room_no: true, base_rent: true }
        }
      }
    });

    // Check which already have obligations for this month
    const existingObligations = await prisma.rent_obligations.findMany({
      where: {
        allocation_id: { in: allocations.map(a => a.id) },
        rent_month: rentMonth
      },
      select: { allocation_id: true }
    });

    const existingSet = new Set(existingObligations.map(o => o.allocation_id));

    const preview = allocations.map(alloc => {
      const rentAmount = Number(alloc.tenant.monthly_rent) || Number(alloc.room.base_rent) || 0;
      return {
        allocation_id: alloc.id,
        tenant_name: alloc.tenant.profiles?.name || "Unknown",
        room_no: alloc.room.room_no,
        rent_amount: rentAmount,
        already_generated: existingSet.has(alloc.id),
        will_skip: rentAmount <= 0 || existingSet.has(alloc.id)
      };
    });

    return {
      rent_month: rentMonth.toISOString(),
      total: preview.length,
      will_create: preview.filter(p => !p.will_skip).length,
      will_skip: preview.filter(p => p.will_skip).length,
      items: preview
    };
  }
}

export const rentGenerationService = new RentGenerationService();
