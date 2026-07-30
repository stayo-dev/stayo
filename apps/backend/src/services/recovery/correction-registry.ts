import type { CorrectionHandler } from "./types";

class CorrectionRegistry {
  private handlers = new Map<string, CorrectionHandler<any>>();

  register(handler: CorrectionHandler<any>): void {
    if (this.handlers.has(handler.caseType)) {
      throw new Error(`duplicate case_type registration: ${handler.caseType}`);
    }
    this.handlers.set(handler.caseType, handler);
  }

  resolve(caseType: string): CorrectionHandler<any> {
    const handler = this.handlers.get(caseType);
    if (!handler) {
      throw new Error(`no handler registered for case_type: ${caseType}`);
    }
    return handler;
  }

  has(caseType: string): boolean {
    return this.handlers.has(caseType);
  }
}

export const correctionRegistry = new CorrectionRegistry();
