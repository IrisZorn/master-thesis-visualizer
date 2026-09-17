# Everything level-specific lives in this module: the type numbering the detector assigns, which
# of those numbers are players, and which behaviour category each enemy falls into. The rest of
# the pipeline (coords_transform.py, run_coords_[level].json.py, agg_coords_[level].json.py,
# build_enemy_full_paths.py) is level-agnostic and only ever looks a type up by its role here --
# so a new level is a copy of this file with its own numbers and sets.

# names this level's cached enemy data: resources/enemy_full_paths/<LEVEL>.pkl
LEVEL = 'forest_follies'
# pixel width of resources/forest_follies_stitched.png, the background this level's positions are
# recorded against -- only used to tell a path that ends because the player reached the right
# edge of the level (a finish) apart from one that ends for any other reason (a death/recording
# cutoff). Needs updating if that image is ever re-stitched at a different size.
MAP_WIDTH = 29114

#constants
acorn = '0'
acorn_machine = '1'
blueberry = '2'
cuphead = '3'
cuphead_bullet = '4'
cuphead_ghost = '5'
cuphead_hit = '6'
daisy = '7'
mugman = '8'
mugman_ghost = '9'
mugman_hit = '10'
shroom = '11'
shroom_cloud_pink = '12'
shroom_cloud_purple = '13'
spiky_bulb = '14'
start = '15'
toothy = '16'
tulip = '17'
tulip_bullet = '18'

# spiky_bulb/toothy only ever move up and down on a fixed path; their true
# range is only known by combining many playthroughs, so it's maintained
# separately (see build_enemy_full_paths.py) instead of being recomputed here.
FIXED_VERTICAL_ENEMIES = {
    spiky_bulb,
    toothy,
}

# no fixed-horizontal enemies in this level (see constants_wally_warbles.py's injured_wally for
# one) -- kept as an empty set rather than omitted so level-agnostic code can always look it up.
FIXED_HORIZONTAL_ENEMIES = set()

STATIONARY_ENEMIES = {
    shroom,
    tulip,
    acorn_machine,
}

MOVING_ENEMIES = {
    daisy,
    blueberry,
    acorn
}

MOVING_MINIMIZING_ENEMIES = {
    blueberry
}

# every player character this level has, in priority order. PLAYERS[0] is the primary one: the
# player a single-player recording's detections all get merged into (see
# run_coords_[level].json.py's merge_into_primary_player), and the one whose position stands in
# for the camera when reconstructing enemy tracks. Each player produces three detection streams --
# their normal sprite, their death/ghost sprite, and their taking-a-hit sprite.
PLAYERS = (
    {"main": cuphead, "ghost": cuphead_ghost, "hit": cuphead_hit},
    {"main": mugman, "ghost": mugman_ghost, "hit": mugman_hit},
)
PLAYER_KEYS = {type_id for player in PLAYERS for type_id in player.values()}
# every enemy type whose paths get reconstructed per run in coords_transform.transform_run.
# Types absent from all the sets above (bullets, effects, start markers) are passed through
# untouched, so a type only needs listing here if it has a behaviour worth tracking.
ENEMY_KEYS = FIXED_VERTICAL_ENEMIES | FIXED_HORIZONTAL_ENEMIES | STATIONARY_ENEMIES | MOVING_ENEMIES