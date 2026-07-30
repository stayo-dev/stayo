import { generateToken } from "../lib/auth-edge";
import { prisma } from "../lib/db";
import axios from "axios";

async function main() {
  try {
    const ownerId = "0b301633-272e-4856-b9a5-773faf3a58da";
    const token = await generateToken({
      sub: ownerId,
      email: "sriadithyahostels@gmail.com",
      role: "OWNER",
      owner_id: ownerId,
      sid: "test-session-id-1234567890",
    });
    
    console.log("Generated token:", token);
    
    const url = "http://localhost:3000/api/tenants?limit=25&offset=0&hostelId=ea89eed3-56b0-41bb-93ca-2f66a4e805d9";
    console.log(`Sending GET request to: ${url}`);
    
    const res = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      validateStatus: () => true, // Don't throw on 500
    });
    
    console.log("Response status:", res.status);
    console.log("Response headers:", res.headers);
    console.log("Response body:", JSON.stringify(res.data, null, 2));
  } catch (err: any) {
    console.error("HTTP request error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
