import { BADGE_MODULE_ADDRESS } from "./network";

export const BADGE_MODULE_NAME = "badges";

// Fallback: use module address from network config
export const getModuleAddress = () => BADGE_MODULE_ADDRESS;

export const BADGE_RULES = {
  ALLOWLIST: 1,
  MIN_BALANCE: 2,
  OFFCHAIN_ALLOWLIST: 3,
};

export const getBadgeModuleAddress = () => getModuleAddress();

export const getBadgeFunction = (functionName) => {
  const address = getBadgeModuleAddress();
  if (!address) return null;
  return `${address}::${BADGE_MODULE_NAME}::${functionName}`;
};
