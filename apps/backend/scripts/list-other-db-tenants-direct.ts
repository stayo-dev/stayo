import { PrismaClient } from "@prisma/client";

async function main() {
  const url = "postgresql://postgres:Supa%4021200605@db.nqnsqiowmfmdglhvpjbx.supabase.co:5432/postgres";
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: url
      }
    }
  });

  try {
    const tenants = await prisma.tenants.findMany({
      include: {
        profiles: true,
        agreements: true,
        identification_documents: true
      }
    });

    console.log(`Found ${tenants.length} tenants in nqnsqiowmfmdglhvpjbx direct:`);
    for (const t of tenants) {
      console.log(`- TenantID: ${t.id}, Name: ${t.profiles?.name || 'N/A'}, Agreements: ${t.agreements.length}`);
      for (const a of t.agreements) {
        console.log(`  * Agreement ID: ${a.id}, Status: ${a.status}, PDF: ${a.pdf_url}`);
      }
    }
  } catch (err) {
    console.error("Connection failed:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
