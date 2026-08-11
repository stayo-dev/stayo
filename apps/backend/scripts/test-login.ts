import * as dotenv from "dotenv";
import path from "path";
const envPath = path.resolve(__dirname, "../../../.env");
dotenv.config({ path: envPath });

async function main() {
  const { authService } = await import("../lib/services/auth-service");
  try {
    const result = await authService.login("owner-00098f02-2699-4b5d-8047-4fd000c71c7b@test.com", "password123");
    console.log("SUCCESS:", result);
  } catch (e) {
    console.error("FAILED:", e.message);
  }
}
main().finally(() => process.exit(0));
