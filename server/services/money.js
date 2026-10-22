export function sumAmounts(amounts) {
  const cents = amounts.reduce((total, amount) => {
    const value = String(amount);
    const negative = value.startsWith('-');
    const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
    const amountCents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    return total + (negative ? -amountCents : amountCents);
  }, 0n);
  const sign = cents < 0n ? '-' : '';
  const absolute = cents < 0n ? -cents : cents;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}