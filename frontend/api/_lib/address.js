const normalizeHex = (value) => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  return raw.startsWith('0x') ? raw : `0x${raw}`;
};

export const normalizeAddress64 = (value) => {
  const normalized = normalizeHex(value);
  if (!normalized) return '';
  const withoutPrefix = normalized.slice(2);
  if (!/^[0-9a-f]+$/i.test(withoutPrefix)) return '';
  return `0x${withoutPrefix.padStart(64, '0')}`;
};

