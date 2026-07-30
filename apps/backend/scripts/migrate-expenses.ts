import { prisma } from "../lib/db";

async function main() {
  console.log("Starting expense scope migration...");
  
  // Update all expenses with non-null hostel_id to HOSTEL scope
  const hostelUpdated = await prisma.expenses.updateMany({
    where: {
      hostel_id: { not: null }
    },
    data: {
      expense_scope: "HOSTEL"
    }
  });
  console.log(`Updated ${hostelUpdated.count} expenses with hostel context to HOSTEL scope.`);

  // Update all expenses with null hostel_id to BUSINESS scope
  const businessUpdated = await prisma.expenses.updateMany({
    where: {
      hostel_id: null
    },
    data: {
      expense_scope: "BUSINESS"
    }
  });
  console.log(`Updated ${businessUpdated.count} expenses without hostel context to BUSINESS scope.`);
  
  console.log("Expense scope migration completed successfully.");
}

main()
  .catch((e) => {
    console.error("Migration failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
