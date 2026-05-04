import express, { Request, Response } from 'express';
import fetch from 'node-fetch';

const router = express.Router();

/**
 * POST /api/storage/pin
 * Handles IPFS pinning of JSON metadata via Pinata
 */
router.post('/pin', async (req: Request, res: Response) => {
  const PINATA_JWT = process.env.PINATA_JWT;
  
  if (!PINATA_JWT) {
    return res.status(503).json({ error: 'Storage service unconfigured' });
  }

  try {
    const metadata = req.body;
    if (!metadata || typeof metadata !== 'object') {
      return res.status(400).json({ error: 'Valid JSON metadata required' });
    }

    const response = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PINATA_JWT}`
      },
      body: JSON.stringify({
        pinataContent: metadata,
        pinataMetadata: {
          name: `daftar_badge_${Date.now()}`
        }
      })
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to pin to IPFS' });
    }

    const result: any = await response.json();
    return res.status(200).json({ 
      success: true, 
      ipfsHash: result.IpfsHash,
      uri: `ipfs://${result.IpfsHash}`
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal storage error' });
  }
});

export default router;

