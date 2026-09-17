// Wally Warbles' level config: type codes and enemy behaviour sets, matching
// constants_wally_warbles.py. Passed as the base config to createLevelConfig().
//
// Unlike Forest Follies, this level has no hit-reaction detection stream (cuphead/mugman "hit"
// types don't exist), so playerTypes has no cupHit/mugHit -- visualize.js treats a level with
// neither as having no HP-halo/hit tracking to show. Wally patrols a fixed vertical line and
// injured_wally (his stage-3 form) a fixed horizontal one; willy/nailbird and the junk pickups
// just move freely. None are stationary or "minimizing". wally/injured_wally are marked
// centered-glyph so they're excluded from the generic live-track draw loop in
// viewer-enemies.js -- they're already drawn via the full-path-instances branch, and without
// this exclusion they get drawn a second time (the "duplicate Wally" bug).
export const WALLY_WARBLES_LEVEL_CONFIG = {
  playerTypes: {
    cup: "1",
    mug: "9",
    cupDeath: "2",
    mugDeath: "10",
  },
  enemyGlyphSources: {
    "17": "wally",
    "20": "willy",
    "8": "injuredWally",
    "11": "nailbird",
    // every JUNK type (constants_wally_warbles.py) shares the one junk sprite
    "0": "junk",
    "3": "junk",
    "4": "junk",
    "5": "junk",
    "6": "junk",
    "12": "junk",
    "13": "junk",
    "15": "junk",
    "19": "junk",
    "22": "junk",
  },
  enemyNameToType: {
    wally: "17",
    willy: "20",
    injured_wally: "8",
    nailbird: "11",
    apple: "0",
    egg: "3",
    eggshell: "4",
    fish: "5",
    heart: "6",
    pill: "12",
    pill_half: "13",
    shoe: "15",
    wally_feather: "19",
    willy_egg: "22",
  },
  stationaryEnemyTypes: [],
  // injured_wally patrols a fixed horizontal line rather than the default fixed vertical column
  // (see level-config.js's fixedHorizontalEnemyTypes / constants_wally_warbles.py's
  // FIXED_HORIZONTAL_ENEMIES) -- wally itself stays on the default vertical axis.
  fixedHorizontalEnemyTypes: ["8"],
  centeredGlyphEnemyTypes: ["17", "8"],
  minimizingEnemyTypes: [],
  neverFadeEnemyTypes: [],
  holdLastPositionEnemyTypes: [],
  // ENEMIES + JUNK from constants_wally_warbles.py; bullets/start marker excluded like
  // Forest Follies excludes its own bullets/start marker
  trackedEnemyTypes: ["17", "20", "8", "11", "0", "3", "4", "5", "6", "12", "13", "15", "19", "22"],
  enemyInstanceXThreshold: 170,
  stationaryInstanceThreshold: 200,
  startHp: 3,
  // this level's arena is one static 1920x1080 screen (see constants_wally_warbles.py /
  // coords_transform.py's MAP_END_MARGIN note), so the viewport is set to the full map width --
  // the camera never needs to pan.
  viewportWidth: 1920,
  minimapScale: 0.2,
  windowDelta: 50,
  defaultGlyphSize: { w: 68, h: 68 },
  enemySpritesFallbackKey: "junk",
  enemyLegendSpriteKey: "wally",
  // matches constants_wally_warbles.py's STAGES order -- a run's data[0].stage_starts is
  // positional against this same list. Forest Follies has no stages, so its level config simply
  // has no stageNames, and visualize.js treats that as "nothing to mark".
  stageNames: ["Stage 1", "Stage 2", "Stage 3"],
  // matches constants_wally_warbles.py's ENEMY_STAGE_INDEX -- wally only exists during stage 1,
  // injured_wally only during stage 3. viewer-enemies.js hides a full-path-instance enemy outside
  // its own stage instead of leaving both patrol lines on screen for the whole run. A type absent
  // here renders regardless of stage.
  enemyStageIndex: { "17": 0, "8": 2 },
};
