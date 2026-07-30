export type Actor = { actorId: string; actorRole: string };

export type EntityRef = { type: string; id: string };

export interface OperationContext {
  hostelId: string;
  actor: Actor;
  reason: string;
  input: Record<string, unknown>;
}

export interface ImpactReport {
  balanceChanges: { entityType: string; entityId: string; before: unknown; after: unknown }[];
  obligationChanges: { obligationId: string; before: unknown; after: unknown }[];
  ledgerEntries: { direction: "DEBIT" | "CREDIT"; reason: string; amount: number; tenantId: string }[];
  affectedReports: string[];
  notifications: { channel: string; template: string; recipient: string }[];
  warnings: string[];
}

export interface PolicyResult {
  allowed: boolean;
  reason?: string;
}

export interface CaseDraft<TDetail = Record<string, unknown>> {
  domain: string;
  tier: string;
  entityRefs: EntityRef[];
  beforeSnapshot: unknown;
  caseDetail: TDetail;
  idempotencyKey: string;
  dependsOn?: string[];
  undoExpiresAt?: Date | null;
  correlationId?: string | null;
}

export interface CorrectionCaseRecord<TDetail = Record<string, unknown>> {
  id: string;
  hostelId: string;
  domain: string;
  caseType: string;
  tier: string;
  status: string;
  entityRefs: EntityRef[];
  reason: string;
  actorId: string;
  actorRole: string;
  beforeSnapshot: unknown;
  previewImpact: ImpactReport | null;
  executionResult: Record<string, unknown> | null;
  caseDetail: TDetail;
  idempotencyKey: string;
  dependsOn: string[];
  undoExpiresAt: Date | null;
  correlationId: string | null;
  createdAt: Date;
  updatedAt: Date | null;
}

export interface ExecutionResult {
  [key: string]: unknown;
}

export interface CorrectionPolicy<TDetail = Record<string, unknown>> {
  canPreview(ctx: OperationContext): Promise<boolean>;
  canExecute(kase: CorrectionCaseRecord<TDetail>): Promise<PolicyResult>;
  windowFor?(kase: CorrectionCaseRecord<TDetail>): Date;
}

export interface CorrectionHandler<TDetail = Record<string, unknown>> {
  caseType: string;
  domain: string;
  tier: string;
  policy: CorrectionPolicy<TDetail>;
  createCase(ctx: OperationContext): Promise<CaseDraft<TDetail>>;
  computeImpact(kase: CorrectionCaseRecord<TDetail>): Promise<ImpactReport>;
  execute(tx: any, kase: CorrectionCaseRecord<TDetail>, actor: Actor): Promise<ExecutionResult>;
  affectedEntities(kase: CorrectionCaseRecord<TDetail>): EntityRef[];
}
