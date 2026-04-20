#!/usr/bin/env node
// Simple runner to evaluate badge eligibility rules for one or more addresses.
// Usage: node scripts/badgeEligibilityRunner.js 0xabc123 [0xdef456 ...]

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

(async () => {
  try {
    const addresses = process.argv.slice(2);
    if (addresses.length === 0) {
      console.log('Usage: node scripts/badgeEligibilityRunner.js <address1> [address2 ...]');
      process.exit(1);
    }

    const { pathToFileURL } = await import('url');
    const adaptersPath = path.resolve(__dirname, '../frontend/src/services/badgeAdapters/index.js');
    const apiPath = path.resolve(__dirname, '../frontend/src/services/badgeApi.js');
    const { runAdaptersForAddress } = await import(pathToFileURL(adaptersPath).href);
    const badgeApi = await import(pathToFileURL(apiPath).href);

    // simple flag parser --award
    const shouldAward = process.argv.includes('--award');

    for (const addr of addresses) {
      console.log(`\nChecking badges for ${addr}`);
      // load badgeConfigs from local json if provided or from db
      let badgeConfigs = [];
      const { pathToFileURL } = await import('url');
      const configArg = process.argv.find((arg) => arg.startsWith('--config='));
      if (configArg) {
        try {
          // resolve relative to current working directory rather than __dirname
          const cfgPath = path.resolve(process.cwd(), configArg.split('=')[1]);
          const fs = await import('fs');
          const raw = await fs.promises.readFile(cfgPath, { encoding: 'utf8' });
          badgeConfigs = JSON.parse(raw);
        } catch (e) {
          console.warn('failed to read config file', e);
        }
      }
      if (badgeConfigs.length === 0) {
        // fallback example
        badgeConfigs.push({ badgeId: 'first-step', rule: 1, params: {} });
      }

      const awards = await runAdaptersForAddress(addr, badgeConfigs, { /* ctx if needed */ });
      for (const award of awards) {
        console.log('Award candidate', award);
        if (shouldAward) {
          console.log('-> sending award request to backend');
          try {
            const resp = await badgeApi.awardBadgeToUser(addr, award.badgeId, award.extra || {});
            console.log('backend response', resp);
          } catch (e) {
            console.warn('failed to award badge', e);
          }
        }
      }
    }
  } catch (e) {
    console.error('Error in runner:', e);
    process.exit(1);
  }
})();