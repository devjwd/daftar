import { Response } from 'express';

export class AppError extends Error {
  public statusCode: number;
  public status: string;
  public isOperational: boolean;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

export const handleError = (err: any, res: Response) => {
  const { statusCode = 500, message, status = 'error' } = err;
  
  // Log internal errors
  if (statusCode === 500) {
    console.error('[Internal Error]', err);
  }

  res.status(statusCode).json({
    status,
    message: statusCode === 500 ? 'Internal server error' : message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

