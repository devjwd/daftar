import { describe, it, expect } from 'vitest';
import {
  formatAmount,
  hasPositiveDisplayNumber,
  shortenTokenLabel,
  truncateHash
} from '../utils/formatters';

describe('formatters', () => {
  describe('formatAmount', () => {
    it('formats normal numbers correctly', () => {
      expect(formatAmount(1234)).toBe('1,234');
      expect(formatAmount(0)).toBe('0');
    });

    it('formats small fractions correctly', () => {
      expect(formatAmount(0.523)).toBe('0.523');
      expect(formatAmount(0.0012)).toBe('0.0012');
    });

    it('returns — for invalid inputs', () => {
      expect(formatAmount(NaN)).toBe('—');
      expect(formatAmount(Infinity)).toBe('—');
      expect(formatAmount('abc')).toBe('—');
    });
  });

  describe('hasPositiveDisplayNumber', () => {
    it('returns true for positive numbers', () => {
      expect(hasPositiveDisplayNumber(1)).toBe(true);
      expect(hasPositiveDisplayNumber(0.1)).toBe(true);
      expect(hasPositiveDisplayNumber('5')).toBe(true);
    });

    it('returns false for zero or negative numbers', () => {
      expect(hasPositiveDisplayNumber(0)).toBe(false);
      expect(hasPositiveDisplayNumber(-1)).toBe(false);
    });
  });

  describe('shortenTokenLabel', () => {
    it('shortens long labels', () => {
      expect(shortenTokenLabel('1234567890123456789')).toBe('12345678...6789');
    });

    it('handles short labels', () => {
      expect(shortenTokenLabel('BTC')).toBe('BTC');
    });

    it('handles hex addresses', () => {
      expect(shortenTokenLabel('0x1234567890abcdef1234567890abcdef')).toBe('0X1234...CDEF');
    });
  });

  describe('truncateHash', () => {
    it('truncates long hashes', () => {
      expect(truncateHash('123456789012345')).toBe('123456...2345');
    });

    it('returns as is for short hashes', () => {
      expect(truncateHash('short')).toBe('short');
    });
  });
});
