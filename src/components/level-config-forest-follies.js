// Forest Follies' level config: type codes and enemy behaviour sets, matching
// constants_forest_follies.py. Passed as the base config to createLevelConfig().
export const FOREST_FOLLIES_LEVEL_CONFIG = {
  playerTypes: {
    cup: "3",
    mug: "8",
    cupDeath: "5",
    mugDeath: "9",
    cupHit: "6",
    mugHit: "10",
  },
  enemyGlyphSources: {
    "11": "shroom",
    "14": "spikyBulb",
    "16": "toothy",
    "17": "tulip",
    "7": "daisy",
    "2": "blueberry",
    "0": "acorn",
    "1": "acornMachine",
  },
  enemyNameToType: {
    shroom: "11",
    spiky_bulb: "14",
    toothy: "16",
    tulip: "17",
    daisy: "7",
    blueberry: "2",
    acorn: "0",
    acorn_machine: "1",
  },
  stationaryEnemyTypes: ["11", "17", "1"],
  // no fixed-horizontal enemies here (spiky_bulb/toothy both patrol a fixed vertical column,
  // the default) -- see level-config-wally-warbles.js's injured_wally for one that does.
  fixedHorizontalEnemyTypes: [],
  centeredGlyphEnemyTypes: ["14", "16"],
  // enemies that can "minimize" (go undetected mid-encounter) and later resume the same
  // encounter, rather than actually leaving -- their consecutive tracks get chained into one
  // visual identity instead of showing as separate numbered instances (see
  // buildMinimizingChains in viewer-enemies.js). Matches constants_forest_follies.py's
  // MOVING_MINIMIZING_ENEMIES.
  minimizingEnemyTypes: ["2"],
  // how close two consecutive tracks of a minimizing enemy have to be to count as the same
  // encounter resuming. Gap length deliberately doesn't matter (a minimize can last arbitrarily
  // long); only proximity does. 700 comes from a survey of likely-same-blueberry track pairs in
  // real playthrough data.
  minimizingChainDistance: 700,
  // toothy can never actually leave the level (it just patrols a fixed vertical path), so a
  // detection gap means it's temporarily undetected, not gone -- unlike other enemies it should
  // stay fully colored instead of greying/fading out while "inactive".
  neverFadeEnemyTypes: ["16"],
  // fixed-path enemies that stay put where they were last seen instead of returning to the
  // bottom of their path once they've been undetected for a while (see FIXED_PATH_MAX_HOLD in
  // viewer-enemies.js) -- spiky_bulb holds its position rather than resting at the bottom.
  holdLastPositionEnemyTypes: ["14"],
  // enemy types with per-run live tracks under data[0][type] (an array of
  // point-arrays, one per enemy instance) rather than an aggregate/cache;
  // matches coords_transform.py's ENEMY_KEYS
  trackedEnemyTypes: ["0", "14", "16", "2", "7", "11", "17", "1"],
  enemyInstanceXThreshold: 170,
  // matches build_enemy_full_paths.py's STATIONARY_DISTANCE_THRESHOLD: the distance within
  // which a live shroom/tulip track is considered the same physical instance as an anchor
  stationaryInstanceThreshold: 200,
  startHp: 3,
  viewportWidth: 2000,
  minimapScale: 0.2,
  windowDelta: 50,
  defaultGlyphSize: { w: 68, h: 68 },
  enemySpritesFallbackKey: "cupHit",
  enemyLegendSpriteKey: null,
};
