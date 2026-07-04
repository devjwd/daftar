import { describe, it, expect, vi } from 'vitest';
import { AppError, handleError } from './errors.ts';
import { Response } from 'express';

describe('error utils', () => {
  describe('AppError', () => {
    it('should set status to fail for 4xx status codes', () => {
      const err = new AppError('Not found', 404);
      expect(err.statusCode).toBe(404);
      expect(err.status).toBe('fail');
      expect(err.message).toBe('Not found');
      expect(err.isOperational).toBe(true);
    });

    it('should set status to error for 5xx status codes', () => {
      const err = new AppError('Server fault', 500);
      expect(err.statusCode).toBe(500);
      expect(err.status).toBe('error');
    });
  });

  describe('handleError', () => {
    it('should format response correctly for operational errors', () => {
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      } as unknown as Response;

      const err = new AppError('Bad request', 400);
      handleError(err, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        status: 'fail',
        message: 'Bad request'
      }));
    });
  });
});
