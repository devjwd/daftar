/**
 * Criteria Registry (v2)
 * 
 * Manages the high-speed evaluation of badge criteria using pre-fetched stats.
 */

const registry = new Map();

/**
 * Register a criteria plugin
 * @param {object} plugin - { type, evaluate(stats, params) }
 */
export function registerCriterion(plugin) {
  if (plugin.type) {
    registry.set(plugin.type, plugin);
  }
}

/**
 * Evaluate a specific criterion
 * @param {string} type - Criteria type
 * @param {object} stats - Pre-fetched wallet stats
 * @param {object} params - Criteria-specific parameters
 */
export function evaluateCriterion(type, stats, params) {
  const plugin = registry.get(type);
  if (!plugin) {
    // Return a stable fallback for unimplemented criteria
    return {
      eligible: false,
      reason: 'Automatic eligibility for this rule is coming soon.',
      label: '🕒 Automated Check Pending',
      progress: 0
    };
  }
  return plugin.evaluate(stats, params);
}

/**
 * Transaction Count Plugin (Lightweight)
 */
registerCriterion({
  type: 'transaction_count',
  evaluate: (stats, params) => {
    const required = Number(params?.minCount || params?.min || 1);
    const current = Number(stats?.txCount || 0);
    return {
      eligible: current >= required,
      current,
      required,
      progress: required > 0 ? Math.min(100, Math.round((current / required) * 100)) : 100,
      label: `${current} / ${required} transactions`
    };
  }
});

/**
 * Minimum Balance Plugin (Lightweight)
 */
registerCriterion({
  type: 'min_balance',
  evaluate: (stats, params) => {
    const required = Number(params?.minAmount || params?.min || 0);
    const coinType = params?.coinType || '';

    const balanceObj = stats?.balances?.find(b => b.asset_type === coinType);
    const rawAmount = Number(balanceObj?.amount || 0);
    const decimals = Number(balanceObj?.metadata?.decimals || 8);
    const current = rawAmount / Math.pow(10, decimals);

    return {
      eligible: current >= required,
      current,
      required,
      progress: required > 0 ? Math.min(100, Math.round((current / required) * 100)) : 100,
      label: `${current.toFixed(2)} / ${required} tokens`
    };
  }
});

/**
 * Days On-chain Plugin (Lightweight)
 */
registerCriterion({
  type: 'days_onchain',
  evaluate: (stats, params) => {
    const required = Number(params?.minDays || params?.min || 1);
    const current = Number(stats?.daysOnchain || 0); // Need to ensure stats has this

    // Fallback: If stats doesn't have daysOnchain but has firstTxVersion,
    // we should ideally have calculated this in engineService.
    return {
      eligible: current >= required,
      current,
      required,
      progress: required > 0 ? Math.min(100, Math.round((current / required) * 100)) : 100,
      label: `${current} / ${required} days`
    };
  }
});

/**
 * Daftar Profile Complete Plugin
 */
registerCriterion({
  type: 'daftar_profile_complete',
  evaluate: (stats, params) => {
    const profile = stats?.profile;
    if (!profile) {
      return { eligible: false, current: 0, required: 1, progress: 0, label: 'No profile found' };
    }
 
    const requirePfp = params?.requirePfp !== false;
    const requireBio = params?.requireBio !== false;
 
    let criteriaMet = true;
    const missing = [];
 
    if (!profile.username) {
      criteriaMet = false;
      missing.push('username');
    }
    // Corrected property name: profileService use avatar_url
    if (requirePfp && !profile.avatar_url) {
      criteriaMet = false;
      missing.push('profile picture');
    }
    if (requireBio && !profile.bio) {
      criteriaMet = false;
      missing.push('bio');
    }
 
    const current = criteriaMet ? 1 : 0;
    return {
      eligible: criteriaMet,
      current,
      required: 1,
      progress: criteriaMet ? 100 : 0,
      label: criteriaMet ? 'Profile Complete' : `Missing: ${missing.join(', ')}`
    };
  }
});

/**
 * Daftar Swap Count Plugin
 */
registerCriterion({
  type: 'daftar_swap_count',
  evaluate: (stats, params) => {
    const required = Number(params?.min || params?.count || 1);
    const current = Number(stats?.swapCount || 0);

    return {
      eligible: current >= required,
      current,
      required,
      progress: required > 0 ? Math.min(100, Math.round((current / required) * 100)) : 100,
      label: `${current} / ${required} swaps on Daftar`
    };
  }
});

/**
 * Daftar Volume USD Plugin
 */
registerCriterion({
  type: 'daftar_volume_usd',
  evaluate: (stats, params) => {
    const required = Number(params?.min || params?.amount || 10);
    const current = Number(stats?.swapVolume || 0);

    return {
      eligible: current >= required,
      current,
      required,
      progress: required > 0 ? Math.min(100, Math.round((current / required) * 100)) : 100,
      label: `$${current.toFixed(2)} / $${required} total volume`
    };
  }
});
