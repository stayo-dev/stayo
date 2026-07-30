import { prisma } from "@/lib/db";
import { eventLog } from "@/lib/services/event-log-service";
import { AgreementGenerationService, DEFAULT_RULE_CONTENT } from "./agreement-generation-service";
import { AGREEMENT_ACTIVITY_EVENTS } from "./agreement-status";
import { getActiveTemplateAndSyncRuleVersion, DEFAULT_AGREEMENT_TEMPLATE, DEFAULT_TERMS_AND_CONDITIONS, interpolateRulesContent } from "../../utils/default-rules";
import { financialLifecycleService } from "../payments/financial-lifecycle-service";
import {
  activateRenewal,
  RenewalActivationBlockedError,
  RenewalChainRaceError,
} from "./renewal-activation-engine";

type AgreementRenewalSigningErrorCode =
  | "RENEWAL_AGREEMENT_NOT_FOUND"
  | "RENEWAL_DRAFT_REQUIRED"
  | "PREDECESSOR_AGREEMENT_NOT_FOUND"
  | "PREDECESSOR_NOT_RENEWABLE"
  | "INVALID_RENEWAL_CHAIN"
  | "MOVE_OUT_IN_PROGRESS"
  | "SECURITY_DEPOSIT_UNPAID"
  | "SIGNATURE_REQUIRED"
  | "AGREEMENT_LIFECYCLE_INCOMPLETE";

type SignatureInput = {
  signature_url?: string | null;
  signature_name?: string | null;
};

type RenewalSigningInput = {
  renewalAgreementId: string;
  tenantSignature: SignatureInput;
  guardianSignature?: (SignatureInput & { relation?: string | null }) | null;
  signedBy?: string | null;
  metadata?: {
    ip?: string | null;
    userAgent?: string | null;
  };
};

type RenewalSigningResult = {
  predecessorAgreement: any;
  renewalAgreement: any;
  pdfUrl: string | null;
  pdfGenerated: boolean;
  pdfError?: string;
};

function cleanString(value: unknown) {
  const str = String(value || "").trim();
  return str || null;
}

export class AgreementRenewalSigningError extends Error {
  code: AgreementRenewalSigningErrorCode;
  status = 409;
  details?: Record<string, unknown>;

  constructor(code: AgreementRenewalSigningErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AgreementRenewalSigningError";
    this.code = code;
    this.details = details;
  }
}

export class AgreementRenewalSigningService {
  constructor(
    private readonly db = prisma,
    private readonly pdfGenerator = AgreementGenerationService,
    private readonly activityLog = eventLog
  ) {}

  async signRenewalAgreement(input: RenewalSigningInput): Promise<RenewalSigningResult> {
    const renewalAgreementId = cleanString(input.renewalAgreementId);
    if (!renewalAgreementId) {
      throw new AgreementRenewalSigningError("RENEWAL_AGREEMENT_NOT_FOUND", "Renewal agreement not found");
    }

    const tenantSignatureUrl = cleanString(input.tenantSignature?.signature_url);
    const tenantSignatureName = cleanString(input.tenantSignature?.signature_name);
    const guardianSignatureUrl = cleanString(input.guardianSignature?.signature_url);
    const guardianSignatureName = cleanString(input.guardianSignature?.signature_name);
    const guardianRelation = cleanString(input.guardianSignature?.relation);
    const hasGuardianSignature = Boolean(guardianSignatureUrl || guardianSignatureName || guardianRelation);

    if (!tenantSignatureUrl || !tenantSignatureName) {
      throw new AgreementRenewalSigningError("SIGNATURE_REQUIRED", "Tenant signature is required", {
        renewalAgreementId,
      });
    }
    if (hasGuardianSignature && (!guardianSignatureUrl || !guardianSignatureName || !guardianRelation)) {
      throw new AgreementRenewalSigningError("SIGNATURE_REQUIRED", "Complete guardian signature is required", {
        renewalAgreementId,
      });
    }

    const now = new Date();
    const signed = await this.db.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT id FROM "Agreement" WHERE id = ${renewalAgreementId}::uuid FOR UPDATE`;

      const renewalAgreement = await tx.agreement.findUnique({
        where: { id: renewalAgreementId },
        include: {
          template: true,
          tenant: {
            select: {
              id: true,
              owner_id: true,
              hostel_id: true,
              profiles: {
                select: {
                  name: true,
                },
              },
              hostels: {
                select: {
                  name: true,
                },
              },
            },
          },
          renewed_from_agreement: true,
        },
      });

      if (!renewalAgreement) {
        throw new AgreementRenewalSigningError("RENEWAL_AGREEMENT_NOT_FOUND", "Renewal agreement not found", {
          renewalAgreementId,
        });
      }
      if (renewalAgreement.status !== "DRAFT") {
        throw new AgreementRenewalSigningError("RENEWAL_DRAFT_REQUIRED", "Renewal agreement must be in DRAFT status", {
          renewalAgreementId,
          status: renewalAgreement.status,
        });
      }
      if (!renewalAgreement.renewed_from_agreement_id || !renewalAgreement.renewed_from_agreement) {
        throw new AgreementRenewalSigningError(
          "PREDECESSOR_AGREEMENT_NOT_FOUND",
          "Predecessor agreement not found",
          { renewalAgreementId }
        );
      }

      const predecessor = renewalAgreement.renewed_from_agreement;

      // Fetch active template and sync rule version — read-only and
      // independent of the predecessor's row state, so it's safe to
      // resolve before activation (unlike cron activation, manual signing
      // always captures a fresh signature and re-resolves the current
      // active template rather than carrying the predecessor's forward).
      const template = await getActiveTemplateAndSyncRuleVersion(tx, renewalAgreement.tenant.hostel_id, "RESIDENCY");
      const ruleVersion = await tx.ruleVersion.findUnique({
        where: { id: template.id },
      });

      const roomNo = (renewalAgreement.content_snapshot as any)?.room_number || "N/A";
      const tenantName = renewalAgreement.tenant.profiles?.name || "Tenant";

      const variables = {
        TENANT_NAME: tenantName,
        ROOM_NUMBER: roomNo,
        MONTHLY_RENT: Number(renewalAgreement.contract_rent ?? 0),
        SECURITY_DEPOSIT_AMOUNT: Number(renewalAgreement.contract_security_deposit ?? 0),
        MAINTENANCE_CHARGE_AMOUNT: Number(renewalAgreement.contract_maintenance ?? 0),
        HOSTEL_NAME: renewalAgreement.tenant.hostels?.name || "Hostel",
        OWNER_NAME: template.owner_name,
        JOINING_DATE: (renewalAgreement.content_snapshot as any)?.joining_date || "",
      };

      const rawRules = template.rules_content || DEFAULT_AGREEMENT_TEMPLATE;
      const interpolatedRules = interpolateRulesContent(rawRules, variables, true);

      const rulesSnapshot = ruleVersion
        ? interpolateRulesContent(ruleVersion.content || ruleVersion.content_snapshot || rawRules, variables, true)
        : interpolatedRules;

      const ruleVersionId = ruleVersion?.id || template.id;
      const ruleVersionNumber = ruleVersion?.version || `v${template.version_number}`;

      try {
        await activateRenewal({
          tx,
          predecessor,
          successor: renewalAgreement,
          now,
          buildSuccessorUpdateData: () => ({
            status: "SIGNED",
            signed_at: now,
            tenant_signature_url: tenantSignatureUrl,
            tenant_signature_name: tenantSignatureName,
            tenant_signed_at: now,
            tenant_ip: input.metadata?.ip || null,
            tenant_user_agent: input.metadata?.userAgent || null,
            guardian_signature_url: hasGuardianSignature ? guardianSignatureUrl : null,
            guardian_signature_name: hasGuardianSignature ? guardianSignatureName : null,
            guardian_relation: hasGuardianSignature ? guardianRelation : null,
            guardian_signed_at: hasGuardianSignature ? now : null,
            guardian_ip: hasGuardianSignature ? input.metadata?.ip || null : null,
            guardian_user_agent: hasGuardianSignature ? input.metadata?.userAgent || null : null,
            owner_signature_url: template.owner_signature_url || renewalAgreement.template?.owner_signature_url || null,
            owner_signature_name: template.owner_name || renewalAgreement.template?.owner_name || null,
            owner_signed_at: now,
            rules_snapshot: rulesSnapshot,
            rule_version_id: ruleVersionId,
            rule_version_number: ruleVersionNumber,
            content_snapshot: {
              ...(renewalAgreement.content_snapshot as any || {}),
              template_id: template.id,
              template_version_number: template.version_number,
              template_published_at: template.published_at,
              template_name: template.title,
              template_type: template.type,
              raw_rules: rawRules,
              interpolated_rules: interpolatedRules,
              hostel_rules: interpolatedRules,
              terms_and_conditions: (template.rules_content as any)?.terms_and_conditions || DEFAULT_TERMS_AND_CONDITIONS,
            },
          }),
          tenantContractSync: {
            monthly_rent: renewalAgreement.contract_rent,
            security_deposit: renewalAgreement.contract_security_deposit,
            maintenance_charge: renewalAgreement.contract_maintenance,
            maintenance_type: renewalAgreement.contract_maintenance_type || "MONTHLY",
          },
          timelineActor: {
            type: (input.signedBy || "TENANT") === "TENANT" ? "TENANT" : "OWNER",
          },
        });
      } catch (err: any) {
        if (err instanceof RenewalActivationBlockedError) {
          const failure = err.failures[0];
          throw new AgreementRenewalSigningError(failure.code as AgreementRenewalSigningErrorCode, failure.reason, failure.details);
        }
        if (err instanceof RenewalChainRaceError) {
          if (err.target === "predecessor") {
            throw new AgreementRenewalSigningError("INVALID_RENEWAL_CHAIN", "Renewal chain changed during signing", {
              predecessorAgreementId: predecessor.id,
              renewalAgreementId: renewalAgreement.id,
            });
          }
          throw new AgreementRenewalSigningError("RENEWAL_DRAFT_REQUIRED", "Renewal agreement changed during signing", {
            renewalAgreementId: renewalAgreement.id,
          });
        }
        throw err;
      }

      const signedRenewal = await tx.agreement.findUnique({
        where: { id: renewalAgreement.id },
        include: { template: true },
      });
      const renewedPredecessor = await tx.agreement.findUnique({
        where: { id: predecessor.id },
      });

      return {
        predecessorAgreement: renewedPredecessor,
        renewalAgreement: signedRenewal,
        tenantOwnerId: renewalAgreement.tenant?.owner_id || null,
        tenantId: renewalAgreement.tenant_id,
      };
    });

    // Post-commit: notify (cache invalidation + SSE). Activation itself
    // (credit sweep for the newly created rent schedule obligations)
    // already happened synchronously inside generateForAgreementInTx above.
    if (signed.tenantId && signed.tenantOwnerId) {
      financialLifecycleService.notifyActivated({
        tenantId: signed.tenantId,
        ownerId: signed.tenantOwnerId,
        hostelId: signed.renewalAgreement?.hostel_id || "",
        source: "renewal_agreement_signing",
      });
    }

    let pdfUrl: string | null = null;
    let pdfGenerated = false;
    let pdfError: string | undefined;
    try {
      pdfUrl = await this.pdfGenerator.generateAndUploadPdf(renewalAgreementId);
      pdfGenerated = true;
      if (signed.renewalAgreement) {
        signed.renewalAgreement.pdf_url = pdfUrl;
      }
    } catch (error: any) {
      pdfError = String(error?.message || error);
    }

    await this.activityLog.log(
      AGREEMENT_ACTIVITY_EVENTS.RENEWED,
      signed.tenantOwnerId,
      {
        tenant_id: signed.tenantId,
        old_agreement_id: signed.predecessorAgreement?.id,
        new_agreement_id: signed.renewalAgreement?.id,
        signed_by: input.signedBy || "TENANT",
        renewed_at: now.toISOString(),
        pdf_generated: pdfGenerated,
        ...(pdfError ? { pdf_error: pdfError } : {}),
      },
      signed.tenantId
    );

    return {
      predecessorAgreement: signed.predecessorAgreement,
      renewalAgreement: signed.renewalAgreement,
      pdfUrl,
      pdfGenerated,
      ...(pdfError ? { pdfError } : {}),
    };
  }
}

export const agreementRenewalSigningService = new AgreementRenewalSigningService();

export async function signRenewalAgreement(input: RenewalSigningInput) {
  return agreementRenewalSigningService.signRenewalAgreement(input);
}
