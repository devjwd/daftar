import express, { Request, Response } from 'express';
import fetch from 'node-fetch';
import { generalLimiter } from '../middleware/rateLimit.ts';

const router = express.Router();

router.use(generalLimiter);

/**
 * GET /api/swap/tokens
 */
router.get('/tokens', async (req: Request, res: Response) => {
  const MOSAIC_API_KEY = process.env.MOSAIC_API_KEY;
  if (!MOSAIC_API_KEY) {
    return res.status(503).json({ error: 'Mosaic API not configured' });
  }

  try {
    const response = await fetch('https://api.mosaic.ag/v1/tokens', {
      headers: { 'X-API-KEY': MOSAIC_API_KEY, 'Accept': 'application/json' }
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: 'Mosaic API error', status: response.status, details: errText });
    }
    
    const data: any = await response.json();
    const tokens = data.tokenById ? Object.values(data.tokenById) : (data.data || data);
    
    return res.json(Array.isArray(tokens) ? tokens : []);
  } catch (err: any) {
    return res.status(502).json({ error: 'Failed to fetch tokens from Mosaic', message: err.message });
  }
});

/**
 * GET /api/swap/quote
 */
router.get('/quote', async (req: Request, res: Response) => {
  const MOSAIC_API_KEY = process.env.MOSAIC_API_KEY;
  if (!MOSAIC_API_KEY) {
    return res.status(503).json({ error: 'Mosaic API not configured' });
  }

  const params = new URLSearchParams(req.query as any);
  try {
    const response = await fetch(`https://api.mosaic.ag/v1/quote?${params.toString()}`, {
      headers: { 'X-API-KEY': MOSAIC_API_KEY, 'Accept': 'application/json' }
    });

    if (!response.ok) {
      const errText = await response.text();
      let errJson;
      try { errJson = JSON.parse(errText); } catch { errJson = { error: errText }; }
      return res.status(response.status).json(errJson);
    }

    const data: any = await response.json();
    return res.json(data);
  } catch (err: any) {
    return res.status(502).json({ error: 'Gateway failure when calling Mosaic', message: err.message });
  }
});

export default router;

