import { ownerActionRegistry } from "../owner-action-registry";

ownerActionRegistry.register({
  actionId: "ROOM_MOVE",
  entity: "room",
  category: "WORKFLOW",
  label: "Move Room",
  allowedRoles: ["OWNER"],
  isAvailable: (ctx) => ctx.tenantStatus === "ACTIVE",
});
