import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabase } from '../config/supabase.ts';
import { generalLimiter } from '../middleware/rateLimit.ts';

const router = express.Router();
router.use(generalLimiter);

// For ES Modules compatibility in Node
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '../../data');
const FEEDBACK_FILE = path.join(DATA_DIR, 'feedback.json');

/**
 * POST /api/feedback
 * Submit user feedback
 */
router.post('/', async (req: Request, res: Response) => {
  const { feature, feedbackText, screenshot, walletAddress } = req.body;

  if (!feedbackText || typeof feedbackText !== 'string' || !feedbackText.trim()) {
    return res.status(400).json({ error: 'Feedback text is required' });
  }

  const feedbackId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  const timestamp = new Date().toISOString();

  const feedbackItem = {
    id: feedbackId,
    feature: feature || 'General / Other',
    feedbackText: feedbackText.trim(),
    screenshot, // base64 representation of uploaded image
    walletAddress: walletAddress || null,
    timestamp
  };

  // 1. Log to console for quick developer visibility
  console.log(`[Feedback Received] Feature: ${feedbackItem.feature}, Wallet: ${feedbackItem.walletAddress || 'None'}`);

  // 2. Save to local JSON file
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    let existingFeedback: any[] = [];
    if (fs.existsSync(FEEDBACK_FILE)) {
      try {
        const fileContent = fs.readFileSync(FEEDBACK_FILE, 'utf-8');
        existingFeedback = JSON.parse(fileContent);
        if (!Array.isArray(existingFeedback)) {
          existingFeedback = [];
        }
      } catch (parseErr) {
        console.error('[Feedback] Failed to parse existing feedback JSON. Resetting file.');
        existingFeedback = [];
      }
    }

    // Add new feedback to the list
    existingFeedback.push(feedbackItem);

    // Save with pretty printing
    fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(existingFeedback, null, 2), 'utf-8');
    console.log(`[Feedback] Successfully saved feedback ${feedbackId} to ${FEEDBACK_FILE}`);
  } catch (fileErr: any) {
    console.error('[Feedback] Error saving feedback locally:', fileErr.message);
  }

  // 3. Try saving to Supabase if database table exists
  try {
    const supabaseAdmin = getSupabase();
    if (supabaseAdmin) {
      const { error } = await (supabaseAdmin as any)
        .from('feedbacks')
        .insert({
          id: feedbackId,
          feature: feedbackItem.feature,
          feedback_text: feedbackItem.feedbackText,
          screenshot: feedbackItem.screenshot || null,
          wallet_address: feedbackItem.walletAddress,
          created_at: timestamp
        });
      
      if (error) {
        // Log database issue, but don't fail the response since we saved it locally
        console.warn('[Feedback] Supabase insert warning (table "feedbacks" may not exist):', error.message);
      } else {
        console.log(`[Feedback] Successfully inserted feedback ${feedbackId} into Supabase "feedbacks" table`);
      }
    }
  } catch (dbErr: any) {
    // Suppress db errors if Supabase config is not active/available
    console.log('[Feedback] Supabase not available or configured for logging:', dbErr.message);
  }

  // Return success
  return res.status(200).json({ ok: true, message: 'Feedback submitted successfully' });
});

export default router;
