const DEFAULT_PFP = '/pfp/default.png';

const LEVEL_PFP_FILES = [
  'level1 (1).png',
  'level1 (2).png',
  'level1 (4).png',
  'level1 (5).png',
  'level1 (6).png',
  'level1 (7).png',
  'level1 (8).png',
  'level3.png',
  'level3 (1).png',
  'level3 (2).png',
  'level3 (3).png',
  'level3 (4).png',
  'level3 (5).png',
  'level3 (6).png',
  'level6 (1).png',
  'level6 (2).png',
  'level6 (3).png',
  'level6 (4).png',
  'level6 (5).png',
  'level6 (6).png',
  'level6 (7).png',
  'level9 (1).png',
  'level9 (2).png',
  'level9 (3).png',
  'level9 (4).png',
  'level9 (5).png',
  'level9 (6).png',
  'level9 (7).png',
  'level9 (8).png',
  'level9 (9).png',
  'level9 (10).png',
  'level9 (11).png',
];

const parseRequiredLevel = (fileName) => {
  const match = String(fileName || '').match(/level(\d+)/i);
  return match ? Number(match[1]) : 1;
};

const toPublicPath = (fileName) => `/pfp/${encodeURIComponent(fileName)}`;

const normalizeLevel = (level) => {
  const value = Number(level);
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
};

const buildAllOptions = () => {
  const options = [
    {
      fileName: 'default.png',
      src: DEFAULT_PFP,
      requiredLevel: 0,
    },
  ];

  LEVEL_PFP_FILES.forEach((fileName) => {
    options.push({
      fileName,
      src: toPublicPath(fileName),
      requiredLevel: parseRequiredLevel(fileName),
    });
  });

  return options;
};

const buildUnlockedOptions = (level) => {
  const normalizedLevel = normalizeLevel(level);

  return buildAllOptions()
    .filter((item) => item.requiredLevel <= normalizedLevel);
};

export const getAllLevelPfps = () => buildAllOptions();

export const getUnlockedLevelPfps = (level) => buildUnlockedOptions(level);

export const isPfpUnlockedForLevel = (pfpSrc, level) => {
  const unlocked = buildUnlockedOptions(level);
  return unlocked.some((item) => item.src === pfpSrc);
};

export const isPfpAllowedForLevel = (pfpSrc, level) => {
  if (!pfpSrc || typeof pfpSrc !== 'string') return false;
  return isPfpUnlockedForLevel(pfpSrc, level);
};

export const getLevelBasedPfp = ({ level, address, preferredPfp } = {}) => {
  void address;

  if (isPfpAllowedForLevel(preferredPfp, level)) {
    return preferredPfp;
  }

  return DEFAULT_PFP;
};

export const DEFAULT_LEVEL_PFP = DEFAULT_PFP;