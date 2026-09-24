# See constants_forest_follies.py for what this module's job is and how the rest of the pipeline
# (coords_transform.py, run_coords_[level].json.py, agg_coords_[level].json.py,
# build_enemy_full_paths.py) uses it.
LEVEL = 'wally_warbles'

# this level's arena is one static 1920x1080 screen (no side-scrolling), so MAP_WIDTH is just the
# screen width.
MAP_WIDTH = 1920

#constants
apple = '0'
cuphead = '1'
cuphead_ghost = '2'
egg = '3'
eggshell = '4'
fish = '5'
heart = '6'
heart_bullet = '7'
injured_wally = '8'
mugman = '9'
mugman_ghost = '10'
nailbird = '11'
pill = '12'
pill_half = '13'
player_bullet = '14'
shoe = '15'
start = '16'
wally = '17'
wally_bullet = '18'
wally_feather = '19'
willy = '20'
willy_bullet = '21'
willy_egg = '22'

JUNK = {
    apple,
    fish,
    heart,
    pill,
    pill_half,
    shoe,
    wally_feather,
    egg,
    eggshell,
    willy_egg
}

ENEMIES = {
    wally,
    willy,
    injured_wally,
    nailbird,
}

# stage_start_times only needs one type whose first sighting reliably marks a stage's start --
# each boss is exactly that for their own stage, so bullets/pickups (which can lag or misfire)
# aren't needed alongside them. Stage 1's marker set is never read (see STAGES below) since stage
# 1 always starts at the run's own stable start, not a detection.
STAGE_1 = set()
STAGE_2 = {willy}
STAGE_3 = {injured_wally}

# ordered so index i's set is the types whose first detection marks the start of stage i+1 --
# coords_transform.stage_start_times walks this to find where each stage begins in a run. Absent
# on levels with no stages (e.g. Forest Follies), which the pipeline treats as "nothing to mark".
STAGES = (
    ("Stage 1", STAGE_1),
    ("Stage 2", STAGE_2),
    ("Stage 3", STAGE_3),
)

# wally only ever moves up and down a fixed vertical line, and injured_wally (his stage-3 form)
# only ever moves side to side along a fixed horizontal line; both patrol ranges are only known
# by combining many playthroughs, so like Forest Follies' spiky_bulb/toothy they're maintained
# separately (see build_enemy_full_paths.py) instead of being recomputed here. willy/nailbird and
# every JUNK pickup roam freely, so they're reconstructed into tracks the generic way (see
# coords_transform.transform_run's build_enemy_paths branch).
FIXED_VERTICAL_ENEMIES = {
    wally,
}
FIXED_HORIZONTAL_ENEMIES = {
    injured_wally,
}
STATIONARY_ENEMIES = set()
MOVING_ENEMIES = (ENEMIES - FIXED_VERTICAL_ENEMIES - FIXED_HORIZONTAL_ENEMIES) | JUNK
ENEMY_KEYS = FIXED_VERTICAL_ENEMIES | FIXED_HORIZONTAL_ENEMIES | STATIONARY_ENEMIES | MOVING_ENEMIES

# which stage (0-based, matching STAGES) each full-path-instance enemy belongs to -- wally is only
# around for Stage 1, injured_wally only for Stage 3. Used to keep a stage's aggregated "enemies"
# data (agg_coords_[level].json.py's build_aggregate) and the live viewer's rendering
# (level-config-wally-warbles.js's enemyStageIndex) limited to the fixed enemy actually active in
# that stage, instead of showing both patrol lines throughout the whole run. A type absent here
# (or on a level with no STAGES at all) is never stage-restricted.
ENEMY_STAGE_INDEX = {
    wally: 0,
    injured_wally: 2,
}

# no hit-reaction detection stream in this level (player damage isn't detectable) -- "hit" is
# omitted entirely rather than set to None, so PLAYER_KEYS/transform_run's per-stream loop skip it
# via player.get("hit") instead of writing a bogus type-less entry.
PLAYERS = (
    {"main": cuphead, "ghost": cuphead_ghost},
    {"main": mugman, "ghost": mugman_ghost},
)
PLAYER_KEYS = {type_id for player in PLAYERS for type_id in player.values()}