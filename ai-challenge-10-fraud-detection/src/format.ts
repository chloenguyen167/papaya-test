/** Number as shown in evidence strings: thousands separators, at most `maxFractionDigits` decimals. */
export function formatNumber(value: number, maxFractionDigits = 2): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: maxFractionDigits });
}
