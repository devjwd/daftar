import { describe, it, expect } from 'vitest';
import { parseSignaturePayload } from './crypto.ts';

describe('crypto utils', () => {
  describe('parseSignaturePayload', () => {
    it('should parse an object payload', () => {
      const payload = { publicKey: '0x123', signature: '0xabc' };
      const result = parseSignaturePayload(payload);
      expect(result).toEqual(payload);
    });

    it('should parse a stringified JSON payload', () => {
      const payload = { publicKey: '0x123', signature: '0xabc' };
      const result = parseSignaturePayload(JSON.stringify(payload));
      expect(result).toEqual(payload);
    });

    it('should return null for invalid JSON string', () => {
      const result = parseSignaturePayload('invalid-json');
      expect(result).toBeNull();
    });

    it('should return null for undefined or null', () => {
      expect(parseSignaturePayload(null)).toBeNull();
      expect(parseSignaturePayload(undefined)).toBeNull();
    });
  });
});
