import type { OwnerAction, OwnerActionContext, OwnerActionSummary } from "./types";

class OwnerActionRegistry {
  private actions = new Map<string, OwnerAction>();

  register(action: OwnerAction): void {
    if (this.actions.has(action.actionId)) {
      throw new Error(`duplicate actionId registration: ${action.actionId}`);
    }
    this.actions.set(action.actionId, action);
  }

  has(actionId: string): boolean {
    return this.actions.has(actionId);
  }

  listForEntity(entity: string, ctx: OwnerActionContext): OwnerActionSummary[] {
    const result: OwnerActionSummary[] = [];
    for (const action of this.actions.values()) {
      if (action.entity !== entity) continue;
      if (!action.allowedRoles.includes(ctx.actorRole)) continue;
      result.push({
        actionId: action.actionId,
        entity: action.entity,
        category: action.category,
        label: action.label,
        available: action.isAvailable(ctx),
      });
    }
    return result;
  }
}

export const ownerActionRegistry = new OwnerActionRegistry();
