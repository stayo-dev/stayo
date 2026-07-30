import { prisma } from "../../lib/db";
import { Prisma } from "@prisma/client";

export class RoomRepository {
    async findUnique(args: Prisma.roomsFindUniqueArgs) {
        return await prisma.rooms.findUnique(args);
    }

    async findFirst(args: Prisma.roomsFindFirstArgs) {
        return await prisma.rooms.findFirst(args);
    }

    async findMany(args: Prisma.roomsFindManyArgs) {
        return await prisma.rooms.findMany(args);
    }

    async count(args: Prisma.roomsCountArgs) {
        return await prisma.rooms.count(args);
    }

    async create(args: Prisma.roomsCreateArgs) {
        return await prisma.rooms.create(args);
    }

    async update(args: Prisma.roomsUpdateArgs) {
        return await prisma.rooms.update(args);
    }

    async delete(args: Prisma.roomsDeleteArgs) {
        return await prisma.rooms.delete(args);
    }

    async transaction<T>(fn: (tx: Omit<Prisma.TransactionClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">) => Promise<T>) {
        return await prisma.$transaction(fn);
    }
}

export const roomRepository = new RoomRepository();
