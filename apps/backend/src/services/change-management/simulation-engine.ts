export interface SimulationResult {
  projectedOutstanding: number;
  depositDelta: number;
  warnings: string[];
  impacts: Array<{
    type: string;
    description: string;
    amount: number;
  }>;
}

export class SimulationEngine {
  async simulate(before: Record<string, any>, diff: Record<string, any>): Promise<SimulationResult> {
    const warnings: string[] = [];
    const impacts: any[] = [];
    let projectedOutstanding = 0;
    let depositDelta = 0;

    // 1. Rent change simulation
    if (diff.monthly_rent !== undefined && diff.monthly_rent !== null) {
      const oldRent = Number(before.monthly_rent || 0);
      const newRent = Number(diff.monthly_rent);
      const rentDiff = newRent - oldRent;
      if (rentDiff !== 0) {
        impacts.push({
          type: "monthly_rent",
          description: `Monthly rent change: ${oldRent} -> ${newRent}`,
          amount: rentDiff,
        });
        warnings.push(`Rent will change by ${rentDiff} per month.`);
      }
    }

    // 2. Deposit change simulation
    if (diff.security_deposit !== undefined && diff.security_deposit !== null) {
      const oldDeposit = Number(before.security_deposit || 0);
      const newDeposit = Number(diff.security_deposit);
      depositDelta = newDeposit - oldDeposit;
      if (depositDelta !== 0) {
        impacts.push({
          type: "security_deposit",
          description: `Security deposit change: ${oldDeposit} -> ${newDeposit}`,
          amount: depositDelta,
        });
        warnings.push(`Security deposit adjustment of ${depositDelta} is required.`);
      }
    }

    return {
      projectedOutstanding,
      depositDelta,
      warnings,
      impacts,
    };
  }
}

export const simulationEngine = new SimulationEngine();
