import { prisma } from "../../lib/db";
import { Prisma } from "@prisma/client";

export class ChangeRequestRepository {
  async findUnique(args: Prisma.change_requestsFindUniqueArgs) {
    return await prisma.change_requests.findUnique(args);
  }

  async findFirst(args: Prisma.change_requestsFindFirstArgs) {
    return await prisma.change_requests.findFirst(args);
  }

  async findMany(args: Prisma.change_requestsFindManyArgs) {
    return await prisma.change_requests.findMany(args);
  }

  async count(args: Prisma.change_requestsCountArgs) {
    return await prisma.change_requests.count(args);
  }

  async create(args: Prisma.change_requestsCreateArgs) {
    return await prisma.change_requests.create(args);
  }

  async update(args: Prisma.change_requestsUpdateArgs) {
    return await prisma.change_requests.update(args);
  }

  async updateMany(args: Prisma.change_requestsUpdateManyArgs) {
    return await prisma.change_requests.updateMany(args);
  }

  async createEvent(args: Prisma.change_request_eventsCreateArgs) {
    return await prisma.change_request_events.create(args);
  }
}

export const changeRequestRepository = new ChangeRequestRepository();
