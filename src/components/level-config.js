// Generic level-config plumbing shared by every level. The actual per-level data (type codes,
// enemy behaviour sets) lives in level-config-<level>.js modules -- this file only knows how to
// merge a base config with overrides and turn array fields into the Sets the viewer expects.

export function createLevelConfig(baseConfig, overrides = {}) {
  return {
    ...baseConfig,
    ...overrides,
    playerTypes: {
      ...baseConfig.playerTypes,
      ...(overrides.playerTypes || {}),
    },
    enemyGlyphSources: {
      ...baseConfig.enemyGlyphSources,
      ...(overrides.enemyGlyphSources || {}),
    },
    enemyNameToType: {
      ...baseConfig.enemyNameToType,
      ...(overrides.enemyNameToType || {}),
    },
    stationaryEnemyTypes: new Set(overrides.stationaryEnemyTypes || baseConfig.stationaryEnemyTypes),
    // full-path-instance enemies whose fixed axis is y instead of the default x (e.g. Wally
    // Warbles' injured_wally, which patrols side to side along a fixed height rather than up
    // and down a fixed column) -- matches constants_<level>.py's FIXED_HORIZONTAL_ENEMIES.
    fixedHorizontalEnemyTypes: new Set(overrides.fixedHorizontalEnemyTypes || baseConfig.fixedHorizontalEnemyTypes),
    centeredGlyphEnemyTypes: new Set(overrides.centeredGlyphEnemyTypes || baseConfig.centeredGlyphEnemyTypes),
    minimizingEnemyTypes: new Set(overrides.minimizingEnemyTypes || baseConfig.minimizingEnemyTypes),
    neverFadeEnemyTypes: new Set(overrides.neverFadeEnemyTypes || baseConfig.neverFadeEnemyTypes),
    holdLastPositionEnemyTypes: new Set(overrides.holdLastPositionEnemyTypes || baseConfig.holdLastPositionEnemyTypes),
    enemyLegendSpriteKey: overrides.enemyLegendSpriteKey ?? baseConfig.enemyLegendSpriteKey,
  };
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
