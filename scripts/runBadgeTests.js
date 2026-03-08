#!/usr/bin/env node
// Simple Node-based tests for badge logic (adapters + utilities)
import assert from 'assert';
import path from 'path';
import { pathToFileURL } from 'url';

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// base path for frontend sources, calculated relative to this script's directory
const base = path.resolve(__dirname, '../frontend/src');
const badgeConfigUrl = pathToFileURL(path.join(base, 'config/badges.js')).href;
const txAdapterUrl = pathToFileURL(path.join(base, 'services/badgeAdapters/transactionCount.js')).href;
const longevityAdapterUrl = pathToFileURL(path.join(base, 'services/badgeAdapters/longevity.js')).href;
const minBalanceAdapterUrl = pathToFileURL(path.join(base, 'services/badgeAdapters/minBalance.js')).href;
const adapterIndexUrl = pathToFileURL(path.join(base, 'services/badgeAdapters/index.js')).href;
const indexerUrl = pathToFileURL(path.join(base, 'services/indexer.js')).href;

(async () => {
  console.log('Running badge logic tests...');
  // instead of modifying the imported module (read-only), we'll create a stub
  const indexer = {
    checkAccountExists: async () => ({ txCount: 42 }),
    getWalletAge: async () => ({ firstTxTimestamp: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString() }),
    getUserTokenBalances: async () => [{ coinType: '0x1::aptos_coin::AptosCoin', amount: '200' }],
  };

  const badgeConfig = await import(badgeConfigUrl);
  const txAdapter = await import(txAdapterUrl);
  const longevityAdapter = await import(longevityAdapterUrl);
  const minBalanceAdapter = await import(minBalanceAdapterUrl);
  const adapterIndex = await import(adapterIndexUrl);
  
  // inject stub indexer into adapters for deterministic behaviour
  if (txAdapter.__setIndexer) txAdapter.__setIndexer(indexer);
  if (longevityAdapter.__setIndexer) longevityAdapter.__setIndexer(indexer);
  if (minBalanceAdapter.__setIndexer) minBalanceAdapter.__setIndexer(indexer);
  // adapterIndex does not need injection since it calls adapters directly

  // utilities tests
  console.log('- testing badge utilities');
  const { getRarityInfo, calculateTotalXP, getLevelFromXP, getNextLevelXP, BADGE_RULES } = badgeConfig;
  assert.strictEqual(getRarityInfo('COMMON').name, 'Common');
  assert.strictEqual(getRarityInfo('UNKNOWN').name, 'Common');
  assert.strictEqual(calculateTotalXP([{ rarity: 'COMMON', xp: 10 }, { rarity: 'RARE', xp: 50 }]), 60);
  assert.strictEqual(getLevelFromXP(0), 1);
  assert.strictEqual(getLevelFromXP(100), 2);
  assert.strictEqual(getNextLevelXP(150), 200);
  console.log('  ✅ utilities ok');

  // adapter tests
  console.log('- testing adapters');
  let awards = await txAdapter.check('0x1');
  assert.ok(Array.isArray(awards) && awards.length > 0);
  awards = await longevityAdapter.check('0x1');
  assert.ok(awards.some((a) => a.badgeId.includes('7-day-pioneer')));
  awards = await minBalanceAdapter.check('0x1', null, { coinType: '0x1::aptos_coin::AptosCoin', minBalance: 100, badgeId: 'aptos-holder' });
  assert.strictEqual(awards[0].badgeId, 'aptos-holder');
  console.log('  ✅ adapters ok');

  // runAdaptersForAddress
  const configs = [
    { badgeId: 'foo', rule: BADGE_RULES.TRANSACTION_COUNT, params: {} },
    { badgeId: 'bar', rule: BADGE_RULES.MIN_BALANCE, params: { coinType: 'x', minBalance: 1 } },
  ];
  awards = await adapterIndex.runAdaptersForAddress('0x1', configs);
  // should at least produce some award from the TRANSACTION_COUNT rule
  assert.ok(awards.length > 0, 'expected awards array to be non-empty');
  // bar config has min balance rule which our stub indexer returns no matching coin type
  assert.ok(!awards.some((a) => a.badgeId === 'bar'));
  console.log('  ✅ runAdaptersForAddress ok');

  console.log('All tests passed!');
})();