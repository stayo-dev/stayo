import * as dotenv from "dotenv";
import * as path from "path";
import * as crypto from "crypto";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { prisma } from "../lib/db";

const HOSTEL_ID = "6fa62eca-cbb1-4b12-8567-81756608ed38";

const ALLOCATIONS = [
  { tenantId: "bdbccc3a-260f-47e5-accc-5b042ffa1fab", roomNo: "402", startDate: "2026-06-01", name: "K.Ashish" },
  { tenantId: "a21506a0-62d3-4194-9403-2070a07958b0", roomNo: "402", startDate: "2026-05-01", name: "Md.Faizaan" },
  { tenantId: "2ad5f929-a4d4-4b6e-9596-e3594ff09d95", roomNo: "601", startDate: "2026-06-01", name: "Mohammed Zaraar Javed" },
  { tenantId: "c212dd13-c4d9-4f7a-90ad-c0ea56e09f06", roomNo: "602", startDate: "2026-06-23", name: "Jashwanth rao" },
];

async function main() {
  console.log("=== ALLOCATING MISSING ROOMS ===");

  const rooms = await prisma.rooms.findMany({
    where: { hostel_id: HOSTEL_ID },
  });
  const roomMap = new Map(rooms.map(r => [r.room_no, r.id]));

  await prisma.$transaction(async (tx) => {
    for (const alloc of ALLOCATIONS) {
      const roomId = roomMap.get(alloc.roomNo);
      if (!roomId) {
        throw new Error(`Room ${alloc.roomNo} not found in hostel`);
      }

      // Check if active allocation already exists
      const existing = await tx.roomAllocation.findFirst({
        where: { tenant_id: alloc.tenantId, is_active: true }
      });

      if (existing) {
        console.log(`Active allocation already exists for ${alloc.name}: room ID ${existing.room_id}`);
        continue;
      }

      await tx.roomAllocation.create({
        data: {
          id: crypto.randomUUID(),
          tenant_id: alloc.tenantId,
          room_id: roomId,
          hostel_id: HOSTEL_ID,
          start_date: new Date(alloc.startDate + "T00:00:00.000Z"),
          is_active: true,
        }
      });
      console.log(`Created active room allocation for ${alloc.name} -> Room ${alloc.roomNo} starting ${alloc.startDate}`);
    }
  });

  console.log("Done.");
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exitCode = 1;
});
