import { createTenantSnapshot } from "./diff-engine";
import { recomputeDocumentVerified } from "../tenants/kyc-status";

export interface EntityAdapter<T = any> {
  entityType: string;
  load(id: string, tx: any): Promise<T>;
  snapshot(entity: T): Record<string, any>;
  apply(entityId: string, diff: Record<string, any>, expectedVersion: number, tx: any): Promise<T>;
  validate(before: Record<string, any>, diff: Record<string, any>): Promise<void>;
}

export class TenantProfileAdapter implements EntityAdapter {
  entityType = "tenant_profile";

  async load(id: string, tx: any): Promise<any> {
    const tenant = await tx.tenants.findUnique({
      where: { id },
      include: {
        profiles: true,
        payments: { select: { id: true }, take: 1 },
      },
    });
    if (!tenant) {
      throw new Error(`NOT_FOUND: Tenant ${id} not found`);
    }
    return tenant;
  }

  snapshot(entity: any): Record<string, any> {
    return createTenantSnapshot(entity, entity.profiles);
  }

  async apply(entityId: string, diff: Record<string, any>, expectedVersion: number, tx: any): Promise<any> {
    const tenant = await tx.tenants.findUnique({
      where: { id: entityId },
      select: { version: true, profile_id: true },
    });

    if (!tenant) {
      throw new Error(`NOT_FOUND: Tenant ${entityId} not found`);
    }

    if (tenant.version !== expectedVersion) {
      throw new Error(
        `CONCURRENCY_ERROR: Tenant version mismatch. Expected version ${expectedVersion} but found version ${tenant.version}.`
      );
    }

    // Split profile vs tenant fields
    const profileFields = ["name", "email", "phone", "emergency_contact"];
    const profileUpdate: Record<string, any> = {};
    const tenantUpdate: Record<string, any> = {};

    for (const [field, value] of Object.entries(diff)) {
      if (profileFields.includes(field)) {
        profileUpdate[field] = value;
      } else {
        tenantUpdate[field] = value;
      }
    }

    if (Object.keys(profileUpdate).length > 0 && tenant.profile_id) {
      await tx.profile.update({
        where: { id: tenant.profile_id },
        data: {
          ...profileUpdate,
          version: { increment: 1 },
        },
      });
    }

    const updatedTenant = await tx.tenants.update({
      where: { id: entityId },
      data: {
        ...tenantUpdate,
        version: expectedVersion + 1,
      },
      include: {
        profiles: true,
      },
    });

    // A profile_type change alters which documents KYC requires — re-derive
    // document_verified so the tenant is not left verified on a document their
    // new type no longer asks for (e.g. College ID after switching to
    // Working Professional).
    if (Object.prototype.hasOwnProperty.call(tenantUpdate, "profile_type")) {
      await recomputeDocumentVerified(tx, entityId);
    }

    return updatedTenant;
  }

  async validate(before: Record<string, any>, diff: Record<string, any>): Promise<void> {
    // Basic validations are handled by the ValidationEngine.
    // If there are adapter-specific validations, they can be implemented here.
  }
}

class EntityAdapterRegistry {
  private adapters = new Map<string, EntityAdapter>();

  register(adapter: EntityAdapter) {
    this.adapters.set(adapter.entityType, adapter);
  }

  get(entityType: string): EntityAdapter {
    const adapter = this.adapters.get(entityType);
    if (!adapter) {
      throw new Error(`VALIDATION: No entity adapter registered for type '${entityType}'`);
    }
    return adapter;
  }
}

export const entityAdapterRegistry = new EntityAdapterRegistry();

// Register the default tenant profile adapter
entityAdapterRegistry.register(new TenantProfileAdapter());
