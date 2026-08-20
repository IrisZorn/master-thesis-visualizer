import pickle
from bisect import bisect_left
from math import inf
from pathlib import Path

from helper import filter_points, extract_singular_points, remove_reconnecting_jumps, remove_single_point_spikes

# This module knows nothing about any particular level. Every function that needs one takes a
# `level` argument -- a constants_<level> module (see constants_forest_follies.py) -- and looks
# type numbers up through its role sets rather than naming them.


# base distance a track's last point and a new detection may be apart, at zero gap, for the
# detection to continue that track (see ENEMY_REACQUIRE_SPEED below for how this grows with gap
# length). Originally 400 with a much steeper per-gap growth (5px/unit): together those let an
# 80-unit gap alone justify an 800px reconnect. Checked against real playthrough data: jumps using
# most of that old allowance were consistently two unrelated sightings stitched together (Daisy
# jumping ~750px, mostly vertical -- ~43% of the level's full screen height -- in one reconnect).
# But a flat cap (no gap growth at all) doesn't work either -- it can't distinguish that bad case
# from a genuine 408px Blueberry reconnect at a similar gap (73 units), since some legitimate
# enemies cover more ground than others while briefly undetected. 250 (~1.8x an enemy's own glyph
# size), paired with the smaller growth rate below, was the smallest combination found that still
# accepts that Blueberry reconnect while rejecting every jump identified as spurious.
ENEMY_JUMP_THRESHOLD = 250
# extra distance allowed, per unit of time since a track was last detected, on top of
# jump_threshold when deciding whether a gapped detection continues that track. Down from an
# original 5px/unit -- see ENEMY_JUMP_THRESHOLD above for why that combination was too generous.
ENEMY_REACQUIRE_SPEED = 3
# a track that hasn't been detected in this many time units is no longer eligible to be
# extended by a later detection, regardless of how close it lands. Without this, a detection
# that happens to land near an old track's last point after a long silent gap -- e.g. the enemy
# reappears in roughly the same spot much later -- gets silently merged into that track, making
# the whole gap look like one continuous, still-active sighting. Legitimate gaps in this data
# top out around 40-50 time units; real re-emergences after a longer absence are rare enough
# that treating them as a new instance is safer than merging.
MAX_ENEMY_REACQUIRE_GAP = 80
# same width as visualize.js's levelConfig.viewportWidth -- used as a rough stand-in for the
# camera's current view, centered on the player, since the raw data has no camera position of
# its own.
VIEWPORT_WIDTH = 2000
# how close to the edge of that assumed viewport an enemy's last point has to be for a gap
# above MAX_ENEMY_REACQUIRE_GAP to still be allowed.
VIEWPORT_EDGE_MARGIN = 150
# tracks whose last point was near the edge of the viewport get this much longer to reappear
# before being treated as a new instance -- they've plausibly walked out of frame and back,
# rather than just gone undetected for no reason.
MAX_ENEMY_REACQUIRE_GAP_NEAR_EDGE = 150
# tracks shorter than this after cleaning are almost always single-frame false
# detections rather than a real sighting; kept low relative to
# build_enemy_full_paths.py's MIN_TRACK_POINTS=20 because these enemies roam
# freely and can legitimately pass through view in a handful of frames.
MIN_ENEMY_TRACK_POINTS = 5
# max time gap between a path's last known position and an existing ghost detection for that
# ghost to count as already covering the end of the run -- reuses extract_singular_points'
# default time_thresh, the same "same event" window already used to cluster ghost/hit detections.
END_OF_RUN_GHOST_WINDOW = 200
# min cleaned path length for the end-of-run marker below to fire. A real player's path spans
# hundreds/thousands of points; a handful of false-positive detections on the *other* player in
# solo footage (e.g. stray "mugman" noise in a Cuphead-only run) cleans down to a tiny path
# instead, which would otherwise get a bogus synthetic ghost stapled onto wherever that noise
# happened to land.
MIN_PATH_POINTS_FOR_END_MARKER = 20
# how close a path's last known x has to be to the level's MAP_WIDTH to count as having reached
# the end of the level. The camera stops scrolling once it's clamped to the map's right edge (see
# visualize.js's cameraX clamp), so a player who actually finished can still be recorded up to
# about this far short of the true edge while still reading as "at the end" on screen.
MAP_END_MARGIN = VIEWPORT_WIDTH * 2 / 3
# same threshold build_enemy_full_paths.py's X_MATCH_THRESHOLD uses to tell separate instances
# of these two enemy types apart -- reused here to assign a raw detection to the known instance
# it belongs to.
FIXED_VERTICAL_X_MATCH_THRESHOLD = 170
# how far outside a known instance's patrol range (y_min..y_max, from enemy_full_paths.pkl) a
# detection may still fall and be treated as that enemy. The range is derived from many
# playthroughs, so a real sighting barely exceeds it; this only absorbs minor per-run variation.
FIXED_VERTICAL_Y_MARGIN = 120
# one cache file per level, since its keys are bare type numbers and those mean different enemies
# in different levels. Written by build_enemy_full_paths.py.
ENEMY_FULL_PATHS_DIR = Path(__file__).parent / "resources/enemy_full_paths"
_known_enemy_instances = {}


def enemy_full_paths_path(level):
    return ENEMY_FULL_PATHS_DIR / f"{level.LEVEL}.pkl"


def load_known_enemy_instances(level):
    if level.LEVEL not in _known_enemy_instances:
        with open(enemy_full_paths_path(level), "rb") as f:
            _known_enemy_instances[level.LEVEL] = pickle.load(f).get("enemies", {})
    return _known_enemy_instances[level.LEVEL]


def point_distance(point_a, point_b):
    if point_a[0] is None or point_b[0] is None:
        return inf
    dx = point_a[0] - point_b[0]
    dy = point_a[1] - point_b[1]
    return (dx * dx + dy * dy) ** 0.5


def find_player_x(player_times, player_path, t):
    if not player_path:
        return None
    idx = bisect_left(player_times, t)
    candidates = []
    if idx < len(player_path):
        candidates.append(player_path[idx])
    if idx > 0:
        candidates.append(player_path[idx - 1])
    nearest = min(candidates, key=lambda point: abs(point[2] - t))
    return nearest[0]


def is_near_viewport_edge(enemy_x, player_x):
    if player_x is None:
        return False
    return abs(abs(enemy_x - player_x) - VIEWPORT_WIDTH / 2) <= VIEWPORT_EDGE_MARGIN


def clean_path_points(points, ghost_points=(), hit_points=()):
    # shared by both player and enemy path cleaning: strip glitches/big jumps, single-frame
    # spikes, and jump-out-and-back branches. ghost_points/hit_points are only meaningful for
    # players (see filter_points's break-marker insertion) -- enemies have no death event to
    # justify a gap, so they're left empty.
    cleaned = filter_points(points, ghost_points, hit_points)
    cleaned = remove_reconnecting_jumps(cleaned)
    cleaned = remove_single_point_spikes(cleaned)
    return cleaned


def build_enemy_paths(
    values,
    player_path=(),
    jump_threshold=ENEMY_JUMP_THRESHOLD,
    reacquire_speed=ENEMY_REACQUIRE_SPEED,
    max_reacquire_gap=MAX_ENEMY_REACQUIRE_GAP,
    max_reacquire_gap_near_edge=MAX_ENEMY_REACQUIRE_GAP_NEAR_EDGE,
    min_track_points=MIN_ENEMY_TRACK_POINTS
):
    if not values:
        return []

    player_path = list(player_path)
    player_times = [point[2] for point in player_path]

    tracks = []

    for detection in values:
        frame_time = detection[2]

        available_tracks = []
        for track in tracks:
            if track[-1][2] > frame_time:
                continue
            gap = frame_time - track[-1][2]
            if gap <= max_reacquire_gap:
                available_tracks.append(track)
                continue
            player_x = find_player_x(player_times, player_path, track[-1][2])
            if gap <= max_reacquire_gap_near_edge and is_near_viewport_edge(track[-1][0], player_x):
                available_tracks.append(track)

        best_track = None
        best_distance = inf
        best_score = inf

        for track in available_tracks:
            gap = frame_time - track[-1][2]
            allowed_distance = jump_threshold + reacquire_speed * gap
            jump_distance = point_distance(track[-1], detection)
            score = jump_distance / allowed_distance
            if score < best_score:
                best_score = score
                best_distance = jump_distance
                best_track = track

        if best_track is not None and best_track[-1][2] == frame_time:
            # another detection already claimed this track at this exact instant -- a raw
            # detector can report the same physical object twice in one frame. Keep whichever of
            # the two candidates better continues the track's established trajectory (closer to
            # the point before the tie), and drop the other, instead of treating the tie as a
            # brand-new instance.
            if best_distance <= jump_threshold:
                if len(best_track) >= 2 and point_distance(best_track[-2], detection) < point_distance(best_track[-2], best_track[-1]):
                    best_track[-1] = detection
                continue
            best_track = None
            best_score = inf

        if best_track is None or best_score > 1:
            best_track = []
            tracks.append(best_track)

        best_track.append(detection)

    cleaned_tracks = [clean_path_points(track) for track in tracks]
    return [points for points in cleaned_tracks if len(points) >= min_track_points]


def build_fixed_vertical_paths(
    values,
    instances,
    x_match_threshold=FIXED_VERTICAL_X_MATCH_THRESHOLD,
    y_margin=FIXED_VERTICAL_Y_MARGIN,
    min_track_points=MIN_ENEMY_TRACK_POINTS,
):
    # unlike build_enemy_paths, these enemies' possible x positions are already known ahead of
    # time (instances, from enemy_full_paths.pkl) since they only ever patrol a fixed vertical
    # line. So rather than splitting a run's detections into tracks via jump-distance/reacquire-gap
    # heuristics meant for enemies that could be anywhere, just assign each detection to the
    # known instance it's closest to and sort by time -- a detection gap no longer needs to be
    # bridged by a heuristic, since there's no ambiguity about which instance it belongs to.
    if not values or not instances:
        return []

    buckets = [[] for _ in instances]
    for point in values:
        if point[0] is None:
            continue
        nearest_index, nearest_dist = None, inf
        for index, instance in enumerate(instances):
            d = abs(instance["x"] - point[0])
            if d < nearest_dist:
                nearest_dist, nearest_index = d, index
        if nearest_index is not None and nearest_dist <= x_match_threshold:
            buckets[nearest_index].append(point)

    tracks = []
    for instance, bucket in zip(instances, buckets):
        if len(bucket) < min_track_points:
            continue
        # clean_path_points is deliberately NOT used here. Its cleaners all assume roaming
        # motion and actively destroy this enemy's real movement: remove_reconnecting_jumps
        # treats "moves away and returns near where it started" as a detector glitch, which is
        # exactly what patrolling up and down a fixed line looks like (it was deleting ~13% of
        # all points overall and up to ~49% for a single instance, punching holes in otherwise
        # perfectly smooth tracks); remove_single_point_spikes assumes they can't move far
        # enough in a few frames for a round trip to be real; and filter_points reads a
        # legitimate full-range traversal across a detection gap as one big glitch jump.
        # Since points are already assigned to a known instance by x, the only cleaning that
        # makes sense is rejecting detections outside that instance's known patrol band.
        low = instance["y_min"] - y_margin
        high = instance["y_max"] + y_margin
        points = [
            point for point in sorted(bucket, key=lambda point: point[2])
            if point[1] is not None and low <= point[1] <= high
        ]
        if len(points) >= min_track_points:
            tracks.append(points)
    return tracks


def clean_player_path(run, player, map_width, allow_end_marker=True, has_next_run=True):
    # player is one entry of a level's PLAYERS tuple: {"main", "ghost", "hit"} -> type numbers.
    # Returns the same shape, so callers can keep working stream-by-stream without knowing which
    # character it is.
    main_type, ghost_type, hit_type = player["main"], player["ghost"], player["hit"]

    # ghost_type is passed to filter_points raw (unsorted, un-deduped): it's only used there
    # to check whether *any* ghost detection falls inside a time gap, so dedup doesn't matter.
    raw_ghosts = run[ghost_type]
    hits = extract_singular_points(run.get(hit_type) or [], min_cluster_size=8)
    ghosts = extract_singular_points(sorted(raw_ghosts, key=lambda point: point[2]), min_cluster_size=8)

    path = sorted(run.get(main_type) or [], key=lambda point: point[2])
    path = clean_path_points(path, raw_ghosts, hits)

    # a run that just stops (recording cuts off) rather than ending in a captured death looks
    # identical to a live player on the timeline. If the path's last known position isn't
    # already near a real ghost detection, synthesize one there so the end of the run reads the
    # same as an actual death. Skipped for a player who isn't really being tracked at all
    # (allow_end_marker=False, e.g. Mugman in a solo run about to be merged into Cuphead) --
    # their "path" is noise, so it has no real end to mark.
    last_point = None
    if allow_end_marker and len(path) >= MIN_PATH_POINTS_FOR_END_MARKER:
        last_point = next((point for point in reversed(path) if point[0] is not None), None)
    if last_point is not None and not any(abs(ghost[2] - last_point[2]) <= END_OF_RUN_GHOST_WINDOW for ghost in ghosts):
        # a later run in the same playthrough means this one ended in a death (the player
        # retried); with no later run, reaching the far edge of the map means they finished the
        # level instead, which isn't a death and shouldn't get a marker.
        reached_map_end = last_point[0] is not None and last_point[0] >= map_width - MAP_END_MARGIN
        if has_next_run or not reached_map_end:
            ghosts = list(ghosts) + [last_point]

    # fold the ghost/hit points back into the trail so revivals and hits show up as points
    # along the path, then re-sort since they're appended out of chronological order
    path = [(x, y, t) for x, y, t in path] + list(ghosts) + list(hits)
    path.sort(key=lambda point: point[2])

    return {"main": path, "ghost": ghosts, "hit": hits}


def stable_start_time(player_paths):
    # earliest of the players' own validated starts (see clean_player_path/find_stable_start):
    # once any player's real position is being tracked, the recording is in real gameplay, so
    # detections of anything -- not just players -- before that point aren't trustworthy either.
    starts = [path[0][2] for path in player_paths if path]
    return min(starts) if starts else 0


def transform_run(run, level, is_coop=True, has_next_run=True):
    if not all(run.get(player["main"]) for player in level.PLAYERS):
        return None

    # only the primary player (PLAYERS[0]) is always really being tracked. In single-player
    # footage the others' detections are noise misread off the primary, so they get no
    # end-of-run marker -- there's no real run of theirs to mark the end of.
    cleaned_players = [
        clean_player_path(
            run, player, level.MAP_WIDTH,
            allow_end_marker=is_coop or index == 0,
            has_next_run=has_next_run,
        )
        for index, player in enumerate(level.PLAYERS)
    ]
    player_paths = [cleaned["main"] for cleaned in cleaned_players]
    start_time = stable_start_time(player_paths)

    # players and their ghost/hit streams are cleaned above; enemy tracks are rebuilt
    # from raw run data below, so neither needs the generic sort-and-passthrough treatment here
    my_dict = {
        char: [(x, y, t) for x, y, t in sorted(values, key=lambda point: point[2]) if t >= start_time]
        for char, values in run.items()
        if char not in level.PLAYER_KEYS | level.ENEMY_KEYS
    }

    for stream in ("main", "ghost", "hit"):
        for player, cleaned in zip(level.PLAYERS, cleaned_players):
            my_dict[player[stream]] = [(x, y, t) for x, y, t in cleaned[stream]]

    # sorted() because these sets iterate in an arbitrary (per-process) order otherwise, which
    # would shuffle the output's key order from one run of the pipeline to the next
    known_instances = load_known_enemy_instances(level)
    for enemy_type in sorted(level.ENEMY_KEYS):
        enemy_values = [point for point in (run.get(enemy_type) or []) if point[2] >= start_time]
        if enemy_type in level.FIXED_VERTICAL_ENEMIES:
            my_dict[enemy_type] = build_fixed_vertical_paths(enemy_values, known_instances.get(enemy_type, []))
        else:
            my_dict[enemy_type] = build_enemy_paths(enemy_values, player_path=player_paths[0])

    return my_dict
