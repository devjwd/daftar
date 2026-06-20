import { Router, Request, Response } from 'express';
import { Webhook } from 'standardwebhooks';
import { queueSync } from '../services/analyticsSyncQueue.ts';
import { createClient } from '@supabase/supabase-js';
import CONFIG from '../config/index.ts';

const router = Router();
const supabase = createClient(CONFIG.SUPABASE.URL, CONFIG.SUPABASE.SERVICE_KEY);

router.post('/onchain-event', async (req: Request, res: Response) => {
  try {
    const webhookSecret = process.env.WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.warn('[Webhook] WEBHOOK_SECRET not configured.');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    const wh = new Webhook(webhookSecret);
    // Express parses the body, we need to convert it back to string or use raw body middleware
    // For simplicity, JSON.stringify(req.body) is often used if the payload doesn't have strict spacing requirements, 
    // but ideally we'd use express.raw for webhooks. Assuming standard JSON.
    const payload = JSON.stringify(req.body);
    const headers = {
      'webhook-id': req.headers['webhook-id'] as string,
      'webhook-timestamp': req.headers['webhook-timestamp'] as string,
      'webhook-signature': req.headers['webhook-signature'] as string,
    };

    const event = wh.verify(payload, headers) as any;

    // Suppose the event contains the user's wallet address who had a transaction
    const walletAddress = event?.data?.account_address || event?.data?.address || event?.data?.wallet_address;
    
    if (walletAddress) {
      console.log(`[Webhook] Received on-chain event for ${walletAddress}. Queuing high priority sync.`);
      // Queue with high priority (10) so it gets processed immediately by drainSyncQueue
      await queueSync(supabase, walletAddress, 10);
    } else {
      console.log(`[Webhook] Unrecognized event payload structure:`, event);
    }

    res.status(200).json({ received: true });
  } catch (err: any) {
    console.error(`[Webhook] Validation failed:`, err.message);
    res.status(400).json({ error: 'Webhook verification failed' });
  }
});

export default router;
