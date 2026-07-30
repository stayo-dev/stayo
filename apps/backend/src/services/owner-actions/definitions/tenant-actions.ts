import { ownerActionRegistry } from "../owner-action-registry";

ownerActionRegistry.register({
  actionId: "TENANT_EDIT_PERSONAL_INFO",
  entity: "tenant",
  category: "EDIT",
  label: "Request Change",
  allowedRoles: ["OWNER"],
  isAvailable: (ctx) => ctx.tenantStatus === "ACTIVE",
});
