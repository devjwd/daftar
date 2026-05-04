export const LIQUIDITY_SOURCES = [
  { id: "mosaic_amm", label: "Mosaic" },
];

export const DEFAULT_ENABLED_LIQUIDITY_SOURCE_IDS = LIQUIDITY_SOURCES.map((source) => source.id);

const KNOWN_SOURCE_ID_SET = new Set(DEFAULT_ENABLED_LIQUIDITY_SOURCE_IDS);

export const normalizeLiquiditySourceIds = (value) => {
  if (!Array.isArray(value)) {
    return [...DEFAULT_ENABLED_LIQUIDITY_SOURCE_IDS];
  }

  const normalized = value
    .map((item) => String(item || "").trim().toLowerCase())
    .filter((id) => KNOWN_SOURCE_ID_SET.has(id));

  if (normalized.length === 0) {
    return [...DEFAULT_ENABLED_LIQUIDITY_SOURCE_IDS];
  }

  return Array.from(new Set(normalized));
};
