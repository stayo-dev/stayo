import { ownerActionRegistry } from "../owner-action-registry";

ownerActionRegistry.register({
  actionId: "TENANT_CHANGE_RENT",
  entity: "tenant",
  category: "WORKFLOW",
  label: "Change Rent",
  allowedRoles: ["OWNER"],
  isAvailable: (ctx) => ctx.tenantStatus === "ACTIVE",
});
