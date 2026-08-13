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
STATIONARY_ENEMIES = {
    shroom,
    tulip,
    acorn_machine,
}