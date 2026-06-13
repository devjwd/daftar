import { DEFAULT_NETWORK } from '../config/network';
import { getSwapAssetTypeBySymbol } from '../config/tokens';
import { fetchMosaicQuote, buildMosaicSwapPayload } from './mosaicSwapService';

export const fetchYuzuQuote = async ({
  fromToken,
  toToken,
  amount,
  sender,
  slippageBps,
  settings,
  signal
}: any) => {
  // Route the quote request through Mosaic but force it to only use the Yuzu source.
  const yuzuSettings = {
    ...settings,
    enabledLiquiditySources: ['yuzu']
  };

  const result = await fetchMosaicQuote({
    fromToken,
    toToken,
    amount,
    sender,
    slippageBps,
    settings: yuzuSettings,
    signal
  });

  if (result.best) {
    result.best.sourceLabel = "Yuzu DEX";
  }
  
  // Ensure the top-level selected source identifies as yuzu
  if (result.selectedSource !== "none") {
    result.selectedSource = 'yuzu';
  }

  return result;
};

export const buildYuzuSwapPayload = (quoteData: any) => {
  if (!quoteData || !quoteData.tx) throw new Error("Invalid quote data");
  return buildMosaicSwapPayload(quoteData);
};
