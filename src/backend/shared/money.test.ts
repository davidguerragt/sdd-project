import { decimalToCents, formatCents, parseAmountToCents } from './money';

describe('exact money handling', () => {
  it('parses and formats GTQ amounts without floating point', () => {
    expect(parseAmountToCents('123.45')).toBe(12345n);
    expect(formatCents(12345n)).toBe('123.45');
    expect(decimalToCents('0.10')).toBe(10n);
  });

  it.each(['0', '-1', '1.001', '1e2', 1.25, '01.00', '10000000000000000.00'])('rejects invalid amount %p', (amount) => {
    expect(() => parseAmountToCents(amount)).toThrow('invalid_amount');
  });
});