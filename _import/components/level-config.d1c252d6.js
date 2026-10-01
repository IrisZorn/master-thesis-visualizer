// Generic level-config plumbing shared by every level. The actual per-level data (type codes,
// enemy behaviour sets) lives in level-config-<level>.js modules -- this file only turns their
// array fields into the Sets the viewer expects.

// fixedHorizontalEnemyTypes: full-path-instance enemies whose fixed axis is y instead of the
// default x (e.g. Wally Warbles' injured_wally, which patrols side to side along a fixed height
// rather than up and down a fixed column) -- matches constants_<level>.py's FIXED_HORIZONTAL_ENEMIES.
const SET_FIELDS = [
  "stationaryEnemyTypes",
  "fixedHorizontalEnemyTypes",
  "centeredGlyphEnemyTypes",
  "minimizingEnemyTypes",
  "neverFadeEnemyTypes",
  "holdLastPositionEnemyTypes",
  "countableEnemyTypes",
];

export function createLevelConfig(baseConfig) {
  const config = { ...baseConfig };
  for (const field of SET_FIELDS) config[field] = new Set(baseConfig[field]);
  return config;
}

export function parseEnemySizes(text, enemyNameToType) {
  const sizes = {};
  for (const rawLine of (text || "").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const [name, rest] = line.split("=").map((value) => value.trim());
    const type = enemyNameToType[name];
    if (!type || !rest) continue;
    const [wStr, hStr] = rest.split(",").map((value) => value.trim());
    const w = Number(wStr);
    const h = Number(hStr ?? wStr);
    if (Number.isFinite(w) && Number.isFinite(h)) sizes[type] = { w, h };
  }
  return sizes;
}
