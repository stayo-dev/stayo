import { NextRequest } from "next/server";
import { GET } from "../app/api/tenants/route";
import { prisma } from "../lib/db";

async function main() {
  try {
    const url = "http://localhost:3000/api/tenants?limit=25&offset=0&hostelId=ea89eed3-56b0-41bb-93ca-2f66a4e805d9";
    const headers = new Headers();
    headers.set("x-user-id", "0b301633-272e-4856-b9a5-773faf3a58da");
    headers.set("x-user-role", "OWNER");
    headers.set("x-user-email", "sriadithyahostels@gmail.com");
    headers.set("x-owner-id", "0b301633-272e-4856-b9a5-773faf3a58da");
    
    const req = new NextRequest(url, { headers });
    
    console.log("Calling GET endpoint directly...");
    const res = await GET(req);
    console.log("Response status:", res.status);
    const body = await res.json();
    console.log("Response body:", JSON.stringify(body, null, 2));
  } catch (err: any) {
    console.error("Endpoint crash error:", err);
    if (err.stack) {
      console.error(err.stack);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main();
