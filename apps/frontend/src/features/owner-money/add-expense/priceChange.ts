/**
 * Client mirror of the backend's `priceChangeNote` thresholds (ADR-047).
 *
 * Kept as a tiny pure function rather than a round trip: the owner is typing,
 * and a request per keystroke to compare two numbers they already have on
 * screen would be slower and no more correct. It performs no financial
 * derivation — `averageAmount` is computed server-side and simply compared
 * against what is being typed.
 */
export function priceChange(
  amount: number,
  occurrences: number,
  averageAmount: number,
  options: { minOccurrences?: number; thresholdPercent?: number } = {},
): { direction: 'up' | 'down'; percent: number; message: string } | null {
  const minOccurrences = options.minOccurrences ?? 2;
  const threshold = options.thresholdPercent ?? 15;

  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (occurrences < minOccurrences) return null;
  if (!averageAmount || averageAmount <= 0) return null;

  const diff = ((amount - averageAmount) / averageAmount) * 100;
  const percent = Math.round(Math.abs(diff));
  if (percent < threshold) return null;

  const usual = `₹${Math.round(averageAmount).toLocaleString('en-IN')}`;
  return diff > 0
    ? { direction: 'up', percent, message: `${percent}% above your usual ${usual}` }
    : { direction: 'down', percent, message: `${percent}% below your usual ${usual}` };
}
