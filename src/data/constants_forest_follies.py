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
    acorn,
    # a lobbed, arcing shot rather than a straight-line one (see LINEAR_BULLET_SPEEDS), so it
    # gets a full reconstructed path like acorn instead of a current-direction arrow
    tulip_bullet,
}

MOVING_MINIMIZING_ENEMIES = {
    blueberry
}

# bullet types tracked separately from ENEMY_KEYS: they get their own per-shot tracks (see
# coords_transform.transform_run) via the same build_enemy_paths reconnection logic as
# MOVING_ENEMIES, for the bullet-direction-arrow feature -- but they're kept out of ENEMY_KEYS
# itself so they never end up in the enemy density heatmap or the Enemies Hit stat, neither of
# which makes sense for a bullet.
BULLET_KEYS = {
    cuphead_bullet,
    shroom_cloud_pink,
    shroom_cloud_purple,
}

# tracked like an enemy (in ENEMY_KEYS, so the viewer draws its full path) but still a bullet, so
# kept out of the enemy density heatmap -- see agg_coords_[level].json.py's aggregate_enemy_density.
HEATMAP_EXCLUDED_ENEMIES = {
    tulip_bullet,
}

# bullet types whose real motion is a straight line at roughly constant speed, so
# coords_transform.build_bullet_shots' per-shot line fit can reconstruct individual shots
# directly from raw detections instead of build_enemy_paths' proximity-based reconnection (see
# build_bullet_shots for why that matters for e.g. rapid fire). Keyed by (min_speed, max_speed)
# in px/frame, the plausible range for a real shot of that type -- derived from forest_follies_2's
# own clean, unambiguous single-shot cuphead_bullet tracks (~40-48px/frame observed, widened
# slightly for margin). shroom_cloud_pink/purple and tulip_bullet (the latter now tracked as a
# MOVING_ENEMIES path rather than a bullet) are deliberately excluded: their
# real shots arc/drift rather than moving in a constant-velocity straight line (confirmed against
# a real tulip_bullet track -- distance from its stationary anchor rises then falls over the
# course of one continuous, genuine shot), so this model doesn't apply to them and they keep using
# build_enemy_paths instead.
LINEAR_BULLET_SPEEDS = {
    cuphead_bullet: (30, 60),
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