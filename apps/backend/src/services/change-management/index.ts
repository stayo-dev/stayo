/**
 * Change Management System — Public API
 */
export { changeRequestService } from "./change-request-service";
export { approvalEngine } from "./approval-engine";
export { changeManagementFacade } from "./change-management-facade";
export { domainEventsBus } from "./domain-events";
export { validationEngine } from "./validation-engine";
export { policyEngine } from "./change-policies";
export { simulationEngine } from "./simulation-engine";
export {
  classifyField,
  classifyTenantField,
  partitionFieldsByCategory,
  isInCorrectionWindow,
  getEffectiveCategory,
  getFieldsByCategory,
  CATEGORY_LABELS,
  EXPIRATION_DAYS,
  FIELD_REGISTRY,
  type FieldClassification,
} from "./field-classification";
export {
  createTenantSnapshot,
  computeDiff,
  summarizeDiff,
  type FieldDiff,
  type ChangeSnapshot,
} from "./diff-engine";

