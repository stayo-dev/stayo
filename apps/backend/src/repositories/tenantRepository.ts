import { prisma } from "../../lib/db";
import { Prisma } from "@prisma/client";

export class TenantRepository {
    async findUnique(args: Prisma.tenantsFindUniqueArgs) {
        return await prisma.tenants.findUnique(args);
    }

    async findFirst(args: Prisma.tenantsFindFirstArgs) {
        return await prisma.tenants.findFirst(args);
    }

    async findMany(args: Prisma.tenantsFindManyArgs) {
        return await prisma.tenants.findMany(args);
    }

    async count(args: Prisma.tenantsCountArgs) {
        return await prisma.tenants.count(args);
    }

    async create(args: Prisma.tenantsCreateArgs) {
        return await prisma.tenants.create(args);
    }

    async update(args: Prisma.tenantsUpdateArgs) {
        return await prisma.tenants.update(args);
    }

    async transaction<T>(fn: (tx: Omit<Prisma.TransactionClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">) => Promise<T>) {
        return await prisma.$transaction(fn);
    }

    // Specific repository queries that encapsulate complex logic
    async findReactivationRequests(args: Prisma.reactivation_requestsFindManyArgs) {
        return await prisma.reactivation_requests.findMany(args);
    }

    async createReactivationRequest(args: Prisma.reactivation_requestsCreateArgs) {
        return await prisma.reactivation_requests.create(args);
    }

    async findReactivationRequestFirst(args: Prisma.reactivation_requestsFindFirstArgs) {
        return await prisma.reactivation_requests.findFirst(args);
    }

    async updateReactivationRequest(args: Prisma.reactivation_requestsUpdateArgs) {
        return await prisma.reactivation_requests.update(args);
    }
}

export const tenantRepository = new TenantRepository();
