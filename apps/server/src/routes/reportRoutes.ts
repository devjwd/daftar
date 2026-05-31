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
const REPORTS_FILE = path.join(DATA_DIR, 'reports.json');

/**
 * POST /api/reports
 * Submit a bug or incorrect token data report
 */
router.post('/', async (req: Request, res: Response) => {
  const { type, description, screenshot, walletAddress, tokenSymbol, tokenAddress } = req.body;

  if (!description || typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({ error: 'Description is required' });
  }

  const reportId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  const timestamp = new Date().toISOString();

  const reportItem = {
    id: reportId,
    type: type || 'general',
    description: description.trim(),
    screenshot: screenshot || null, // base64 representation of uploaded image
    walletAddress: walletAddress || null,
    tokenSymbol: tokenSymbol || null,
    tokenAddress: tokenAddress || null,
    timestamp
  };

  // 1. Log to console for quick developer visibility
  console.log(`[Report Received] Type: ${reportItem.type}, Wallet: ${reportItem.walletAddress || 'None'}`);

  // 2. Save to local JSON file
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    let existingReports: any[] = [];
    if (fs.existsSync(REPORTS_FILE)) {
      try {
        const fileContent = fs.readFileSync(REPORTS_FILE, 'utf-8');
        existingReports = JSON.parse(fileContent);
        if (!Array.isArray(existingReports)) {
          existingReports = [];
        }
      } catch (parseErr) {
        console.error('[Reports] Failed to parse existing reports JSON. Resetting file.');
        existingReports = [];
      }
    }

    // Add new report to the list
    existingReports.push(reportItem);

    // Save with pretty printing
    fs.writeFileSync(REPORTS_FILE, JSON.stringify(existingReports, null, 2), 'utf-8');
    console.log(`[Reports] Successfully saved report ${reportId} to ${REPORTS_FILE}`);
  } catch (fileErr: any) {
    console.error('[Reports] Error saving report locally:', fileErr.message);
  }

  // 3. Try saving to Supabase if database table exists
  try {
    const supabaseAdmin = getSupabase();
    if (supabaseAdmin) {
      const { error } = await (supabaseAdmin as any)
        .from('reports')
        .insert({
          id: reportId,
          type: reportItem.type,
          description: reportItem.description,
          screenshot: reportItem.screenshot || null,
          wallet_address: reportItem.walletAddress,
          token_symbol: reportItem.tokenSymbol,
          token_address: reportItem.tokenAddress,
          created_at: timestamp
        });
      
      if (error) {
        // Log database issue, but don't fail the response since we saved it locally
        console.warn('[Reports] Supabase insert warning (table "reports" may not exist):', error.message);
      } else {
        console.log(`[Reports] Successfully inserted report ${reportId} into Supabase "reports" table`);
      }
    }
  } catch (dbErr: any) {
    // Suppress db errors if Supabase config is not active/available
    console.log('[Reports] Supabase not available or configured for logging:', dbErr.message);
  }

  // Return success
  return res.status(200).json({ ok: true, message: 'Report submitted successfully' });
});

export default router;
