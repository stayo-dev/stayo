import { portfolioPerformanceService } from "../lib/services/portfolio-performance-service";

async function main() {
  try {
    const ownerId = "c39676a0-c867-4435-9660-a060b8bceab6";
    console.log("Fetching portfolio performance...");
    const performance = await portfolioPerformanceService.getPortfolioPerformance(ownerId);
    console.log("Portfolio performance results:\n", JSON.stringify(performance, null, 2));
  } catch (err: any) {
    console.error("Error fetching performance:", err);
  }
}

main();
