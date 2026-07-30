import { prisma } from "../../lib/db";
import { Prisma } from "@prisma/client";

export class AllocationRepository {
    async findUnique(args: Prisma.roomAllocationFindUniqueArgs) {
        return await prisma.roomAllocation.findUnique(args);
    }

    async findFirst(args: Prisma.roomAllocationFindFirstArgs) {
        return await prisma.roomAllocation.findFirst(args);
    }

    async findMany(args: Prisma.roomAllocationFindManyArgs) {
        return await prisma.roomAllocation.findMany(args);
    }

    async count(args: Prisma.roomAllocationCountArgs) {
        return await prisma.roomAllocation.count(args);
    }

    async create(args: Prisma.roomAllocationCreateArgs) {
        return await prisma.roomAllocation.create(args);
    }

    async update(args: Prisma.roomAllocationUpdateArgs) {
        return await prisma.roomAllocation.update(args);
    }

    async updateMany(args: Prisma.roomAllocationUpdateManyArgs) {
        return await prisma.roomAllocation.updateMany(args);
    }

    async delete(args: Prisma.roomAllocationDeleteArgs) {
        return await prisma.roomAllocation.delete(args);
    }
}

export const allocationRepository = new AllocationRepository();
