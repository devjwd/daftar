import { describe, it, expect } from 'vitest';
import { parseCoinType, getTokenDecimals, formatTokenAmount, formatAddress, isValidAddress } from '../utils/tokenUtils';

describe('tokenUtils', () => {
  describe('isValidAddress', () => {
    it('validates 0x prefixed hex strings', () => {
      expect(isValidAddress('0x1')).toBe(true);
      expect(isValidAddress('0xabcdef')).toBe(true);
      expect(isValidAddress('0x' + 'a'.repeat(64))).toBe(true);
    });

    it('invalidates missing 0x unless 64 chars', () => {
      expect(isValidAddress('abcdef')).toBe(false);
    });

    it('validates 64 char hex string without 0x', () => {
      expect(isValidAddress('a'.repeat(64))).toBe(true);
    });
  });

  describe('formatAddress', () => {
    it('formats long addresses', () => {
      expect(formatAddress('0x1234567890abcdef1234567890abcdef')).toBe('0x1234...cdef');
    });
    
    it('returns short addresses as is', () => {
      expect(formatAddress('0x12')).toBe('0x12');
    });
  });

  describe('formatTokenAmount', () => {
    it('formats amount correctly based on decimals', () => {
      expect(formatTokenAmount('100000000', 8)).toBe('1.00');
      expect(formatTokenAmount('500000000', 8, 4)).toBe('5.0000');
    });
    it('formats very small amounts', () => {
      expect(formatTokenAmount('1000', 8)).toBe('0.0000');
    });
  });
});
