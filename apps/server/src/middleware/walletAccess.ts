import { Request, Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { normalizeAddress } from '../utils/address.ts';
import { verifyWalletSignature } from '../utils/crypto.ts';
import { getEffectiveTier } from '../services/subscriptionService.ts';
import { isPremiumTier, type SubscriptionTier } from '@daftar/shared-types';

export interface WalletAccessContext {
  wallet: string;
  tier: SubscriptionTier;
  viaSignature: boolean;
}

function readSignatureFromRequest(req: Request): { signature?: string; message?: string } {
  const signature =
    (req.query.signature as string) ||
    (req.body?.signature as string) ||
    undefined;
  const message =
    (req.query.message as string) ||
    (req.body?.signedMessage as string) ||
    (req.body?.message as string) ||
    undefined;
  return { signature, message };
}

export function hasAdvancedTransactionFilters(req: Request): boolean {
  const protocolsRaw = req.query.protocols as string;
  const exactTypesRaw = req.query.exactTypes as string;
  return Boolean(
    protocolsRaw ||
      exactTypesRaw ||
      req.query.minAmount ||
      req.query.maxAmount ||
      req.query.startDate ||
      req.query.endDate
  );
}

/**
 * Enriched DB data: premium wallet (public pro profile) OR wallet owner signature.
 */
export async function assertEnrichedWalletAccess(
  supabase: SupabaseClient,
  req: Request,
  walletAddress: string
): Promise<WalletAccessContext> {
  const wallet = normalizeAddress(walletAddress);
  if (!wallet) {
    throw new WalletAccessError('wallet is required', 400);
  }

  const tier = await getEffectiveTier(supabase, wallet);
  const { signature, message } = readSignatureFromRequest(req);

  if (isPremiumTier(tier)) {
    return { wallet, tier, viaSignature: false };
  }

  if (signature && message && verifyWalletSignature(wallet, message, signature)) {
    return { wallet, tier, viaSignature: true };
  }

  throw new WalletAccessError(
    'Enriched wallet data requires an active Pro subscription or a valid wallet signature',
    403
  );
}

/**
 * Analytics / advanced filters: premium wallet OR owner signature.
 */
export async function assertPremiumWalletAccess(
  supabase: SupabaseClient,
  req: Request,
  walletAddress: string,
  options?: { requirePremiumForAdvancedFilters?: boolean }
): Promise<WalletAccessContext> {
  const ctx = await assertEnrichedWalletAccess(supabase, req, walletAddress);

  if (
    options?.requirePremiumForAdvancedFilters &&
    hasAdvancedTransactionFilters(req) &&
    !isPremiumTier(ctx.tier)
  ) {
    throw new WalletAccessError('Advanced transaction filters require Pro', 403);
  }

  return ctx;
}

export class WalletAccessError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'WalletAccessError';
    this.statusCode = statusCode;
  }
}

export function walletAccessErrorHandler(err: unknown, res: Response): boolean {
  if (err instanceof WalletAccessError) {
    res.status(err.statusCode).json({ error: err.message, code: 'WALLET_ACCESS_DENIED' });
    return true;
  }
  return false;
}

export function requireMaintenanceKey(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.ANALYTICS_MAINTENANCE_KEY || process.env.ADMIN_MAINTENANCE_KEY;
  if (!expected) {
    res.status(503).json({ error: 'Maintenance endpoint is not configured' });
    return;
  }

  const provided = req.headers['x-maintenance-key'];
  if (provided !== expected) {
    res.status(403).json({ error: 'Invalid maintenance key' });
    return;
  }

  next();
}
