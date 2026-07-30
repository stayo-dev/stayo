import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(__dirname, "../.env") });

const token = process.env.WHATSAPP_TOKEN;
const businessId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

console.log("Token present:", !!token);
console.log("Business ID:", businessId);

async function run() {
  if (!token || !businessId) {
    console.error("Missing WHATSAPP_TOKEN or WHATSAPP_BUSINESS_ACCOUNT_ID in .env");
    return;
  }
  const url = `https://graph.facebook.com/v19.0/${businessId}/message_templates?name=tenant_onboarding_completed_v1&access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  console.log("Response:", JSON.stringify(data, null, 2));
}

run().catch(console.error);
