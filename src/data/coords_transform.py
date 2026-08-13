import pickle
from bisect import bisect_left
from math import inf
from pathlib import Path

import constants_forest_follies as const
from helper import filter_points, extract_singular_points, remove_reconnecting_jumps, remove_single_point_spikes


ENEMY_JUMP_THRESHOLD = 400
# extra distance allowed, per unit of time since a track was last detected, on top of
# jump_threshold when deciding whether a gapped detection continues that track. A flat threshold
# treats a candidate 1 time unit later and one 28 time units later identically, even though more
# time passing means more plausible real movement; this lets longer (but still capped, see
# max_reacquire_gap above) gaps cover proportionally more distance without loosening matching
# for short, consecutive-ish gaps where a jump this large would still be implausible.
ENEMY_REACQUIRE_SPEED = 5
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
PLAYER_KEYS = {
    const.cuphead,
    const.cuphead_ghost,
    const.cuphead_hit,
    const.mugman,
    const.mugman_ghost,
    const.mugman_hit,
}
ENEMY_KEYS = {
    const.acorn,
    const.acorn_machine,
    const.spiky_bulb,
    const.toothy,
    const.daisy,
    const.blueberry,
    const.shroom,
    const.tulip,
}
# same threshold build_enemy_full_paths.py's X_MATCH_THRESHOLD uses to tell separate instances
# of these two enemy types apart -- reused here to assign a raw detection to the known instance
# it belongs to.
FIXED_VERTICAL_X_MATCH_THRESHOLD = 170
# how far outside a known instance's patrol range (y_min..y_max, from enemy_full_paths.pkl) a
# detection may still fall and be treated as that enemy. The range is derived from many
# playthroughs, so a real sighting barely exceeds it; this only absorbs minor per-run variation.
FIXED_VERTICAL_Y_MARGIN = 120
ENEMY_FULL_PATHS_PATH = Path(__file__).parent / "resources/enemy_full_paths.pkl"
_known_enemy_instances = None


def load_known_enemy_instances():
    global _known_enemy_instances
    if _known_enemy_instances is None:
        with open(ENEMY_FULL_PATHS_PATH, "rb") as f:
            _known_enemy_instances = pickle.load(f).get("enemies", {})
    return _known_enemy_instances


def point_distance(point_a, point_b):
    if point_a[0] is None or point_b[0] is None:
        return inf
    dx = point_a[0] - point_b[0]
    dy = point_a[1] - point_b[1]
    return (dx * dx + dy * dy) ** 0.5


def find_player_x(cup_times, cup_path, t):
    if not cup_path:
        return None
    idx = bisect_left(cup_times, t)
    candidates = []
    if idx < len(cup_path):
        candidates.append(cup_path[idx])
    if idx > 0:
        candidates.append(cup_path[idx - 1])
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
    cup_path=(),
    jump_threshold=ENEMY_JUMP_THRESHOLD,
    reacquire_speed=ENEMY_REACQUIRE_SPEED,
    max_reacquire_gap=MAX_ENEMY_REACQUIRE_GAP,
    max_reacquire_gap_near_edge=MAX_ENEMY_REACQUIRE_GAP_NEAR_EDGE,
    min_track_points=MIN_ENEMY_TRACK_POINTS
):
    if not values:
        return []

    cup_path = list(cup_path)
    cup_times = [point[2] for point in cup_path]

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
            player_x = find_player_x(cup_times, cup_path, track[-1][2])
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


def clean_player_path(run, main_type, ghost_type, hit_type):
    # ghost_type is passed to filter_points raw (unsorted, un-deduped): it's only used there
    # to check whether *any* ghost detection falls inside a time gap, so dedup doesn't matter.
    raw_ghosts = run[ghost_type]
    hits = extract_singular_points(run.get(hit_type) or [], min_cluster_size=8)
    ghosts = extract_singular_points(sorted(raw_ghosts, key=lambda point: point[2]), min_cluster_size=8)

    path = sorted(run.get(main_type) or [], key=lambda point: point[2])
    path = clean_path_points(path, raw_ghosts, hits)

    # fold the ghost/hit points back into the trail so revivals and hits show up as points
    # along the path, then re-sort since they're appended out of chronological order
    path = [(x, y, t) for x, y, t in path] + list(ghosts) + list(hits)
    path.sort(key=lambda point: point[2])

    return path, ghosts, hits


def stable_start_time(cup_path, mug_path):
    # earliest of the two players' own validated start (see clean_player_path/find_stable_start):
    # once either player's real position is being tracked, the recording is in real gameplay, so
    # detections of anything -- not just players -- before that point aren't trustworthy either.
    starts = [path[0][2] for path in (cup_path, mug_path) if path]
    return min(starts) if starts else 0


def transform_run(run):
    if not run.get(const.cuphead) or not run.get(const.mugman):
        return None

    cup_path, cup_ghosts, cup_hits = clean_player_path(run, const.cuphead, const.cuphead_ghost, const.cuphead_hit)
    mug_path, mug_ghosts, mug_hits = clean_player_path(run, const.mugman, const.mugman_ghost, const.mugman_hit)
    start_time = stable_start_time(cup_path, mug_path)

    # cuphead/mugman and their ghost/hit streams are cleaned above; enemy tracks are rebuilt
    # from raw run data below, so neither needs the generic sort-and-passthrough treatment here
    my_dict = {
        char: [(x, y, t) for x, y, t in sorted(values, key=lambda point: point[2]) if t >= start_time]
        for char, values in run.items()
        if char not in PLAYER_KEYS | ENEMY_KEYS
    }

    my_dict[const.cuphead] = cup_path
    my_dict[const.mugman] = mug_path
    my_dict[const.cuphead_ghost] = [(x, y, t) for x, y, t in cup_ghosts]
    my_dict[const.mugman_ghost] = [(x, y, t) for x, y, t in mug_ghosts]
    my_dict[const.cuphead_hit] = [(x, y, t) for x, y, t in cup_hits]
    my_dict[const.mugman_hit] = [(x, y, t) for x, y, t in mug_hits]

    known_instances = load_known_enemy_instances()
    for enemy_type in ENEMY_KEYS:
        enemy_values = [point for point in (run.get(enemy_type) or []) if point[2] >= start_time]
        if enemy_type in const.FIXED_VERTICAL_ENEMIES:
            my_dict[enemy_type] = build_fixed_vertical_paths(enemy_values, known_instances.get(enemy_type, []))
        else:
            my_dict[enemy_type] = build_enemy_paths(enemy_values, cup_path=cup_path)

    return my_dict
