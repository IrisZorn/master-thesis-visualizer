import pickle
from bisect import bisect_left, bisect_right
from math import inf
from pathlib import Path

import numpy as np

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
# filter_points' big_dist cutoff (see its docstring) for player paths specifically, tighter than
# the 700 default used for enemy tracks. Found via a Wally Warbles Cuphead run where a 2-frame
# misdetection (explosion debris mistaken for Cuphead) sat 689px and 685px from his last real
# position -- both just under the 700 default, so filter_points waved them through as plausible
# medium jumps instead of rejecting them as glitches. Checked against every player path in both
# levels' recorded playthroughs: 650 removes that glitch and changes nothing else for either
# player in either level, so it's tight enough to catch this case without costing accuracy
# elsewhere. Left as a player-only override (not a new default) since the same drop to 650
# does measurably change several enemy tracks (e.g. Wally Warbles' willy_egg) that rely on the
# looser cutoff.
PLAYER_BIG_DIST = 650
# tracks shorter than this after cleaning are almost always single-frame false
# detections rather than a real sighting; kept low relative to
# build_enemy_full_paths.py's MIN_TRACK_POINTS=20 because these enemies roam
# freely and can legitimately pass through view in a handful of frames.
MIN_ENEMY_TRACK_POINTS = 5
# minimum simultaneous gap (time units) with zero real-position detections from *either* player
# before a run is considered over and everything from the gap onward is discarded -- a recording
# that goes dark for both players this long is dead air (detector failure, or the footage just
# ending), not two live players waiting to reappear. Matches extract_singular_points' default
# time_thresh, the same "same event" window already used to cluster ghost/hit detections.
BOTH_PLAYERS_UNDETECTED_GAP = 200
# margin (px) by which the raw-labeled player's last known position must be farther from a
# ghost cluster than the other player's, before that cluster's identity gets swapped away from
# the detector's own class label (see resolve_ghost_swaps). Cuphead_ghost and mugman_ghost
# differ only in halo stripe color and a tiny nose shape -- cues that wash out under this
# level's obscured-vision effects, so the detector occasionally swaps which player's ghost
# class a death gets labeled with. Comparing against each player's last known position usually
# tells them apart, but only clearly when one player is a lot closer than the other -- when both
# are near-tied (e.g. a simultaneous co-op wipe, exactly when the swap is most likely) the raw
# label is trusted rather than guessed. 200 is a starting point (~1.4x an enemy's own glyph
# size) pending a look at real swapped-ghost cases.
GHOST_SWAP_MARGIN = 200
# same threshold build_enemy_full_paths.py's X_MATCH_THRESHOLD uses to tell separate instances
# of these enemy types apart -- reused here to assign a raw detection to the known instance it
# belongs to, along whichever axis is fixed for that enemy (x for fixed-vertical, y for
# fixed-horizontal).
FIXED_AXIS_MATCH_THRESHOLD = 170
# how far outside a known instance's patrol range (free_min..free_max along its non-fixed axis,
# from enemy_full_paths.pkl) a detection may still fall and be treated as that enemy. The range
# is derived from many playthroughs, so a real sighting barely exceeds it; this only absorbs
# minor per-run variation.
FIXED_AXIS_RANGE_MARGIN = 120
# defaults for build_bullet_shots (see a level's LINEAR_BULLET_SPEEDS for the actual load-bearing
# parameter, that bullet type's real px/frame speed range). The rest matched what separated real
# single shots from chance noise fits in forest_follies_2's raw cuphead_bullet data: real shots
# run ~15-25 detections over ~15-25 frames, so a candidate line spanning much longer than that, or
# supported by only a handful of points, is far more likely to be an accidental near-fit through
# unrelated detections than an actual shot.
BULLET_SHOT_RESIDUAL_THRESHOLD = 20
BULLET_SHOT_MIN_INLIERS = 6
BULLET_SHOT_MIN_DT = 5
BULLET_SHOT_MAX_SPAN = 30
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


def clean_path_points(points, ghost_points=(), hit_points=(), big_dist=700):
    # shared by both player and enemy path cleaning: strip glitches/big jumps, single-frame
    # spikes, and jump-out-and-back branches. ghost_points/hit_points are only meaningful for
    # players (see filter_points's break-marker insertion) -- enemies have no death event to
    # justify a gap, so they're left empty. big_dist is filter_points' "definitely fake" cutoff;
    # see PLAYER_BIG_DIST for why players use a tighter one than the enemy-path default.
    cleaned = filter_points(points, ghost_points, hit_points, big_dist=big_dist)
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


def _fit_constant_velocity_np(t, x, y):
    # least-squares fit of x = x0 + vx*t, y = y0 + vy*t over numpy arrays t/x/y
    n = len(t)
    sum_t, sum_tt = t.sum(), (t * t).sum()
    sum_x, sum_tx = x.sum(), (t * x).sum()
    sum_y, sum_ty = y.sum(), (t * y).sum()
    denom = n * sum_tt - sum_t * sum_t
    vx = (n * sum_tx - sum_t * sum_x) / denom
    x0 = (sum_x - vx * sum_t) / n
    vy = (n * sum_ty - sum_t * sum_y) / denom
    y0 = (sum_y - vy * sum_t) / n
    return x0, vx, y0, vy


def _bullet_shot_plausible(model, t_lo, t_hi, min_speed, max_speed, max_span):
    # a real single shot moves at roughly this bullet type's own known speed (min_speed/max_speed,
    # from LINEAR_BULLET_SPEEDS) and doesn't linger on screen longer than max_span -- a fitted line
    # outside either bound is a coincidental near-fit through unrelated points, not a real shot.
    _, vx, _, vy = model
    speed = (vx * vx + vy * vy) ** 0.5
    return min_speed <= speed <= max_speed and (t_hi - t_lo) <= max_span


def build_bullet_shots(
    values,
    min_speed,
    max_speed,
    max_span=BULLET_SHOT_MAX_SPAN,
    threshold=BULLET_SHOT_RESIDUAL_THRESHOLD,
    min_inliers=BULLET_SHOT_MIN_INLIERS,
    min_dt=BULLET_SHOT_MIN_DT,
):
    # Reconstructs individual shots of a straight-line, constant-velocity bullet type directly
    # from raw per-frame detections, instead of build_enemy_paths' proximity-based reconnection.
    # That heuristic only looks at how far a new detection sits from a track's *last* point -- it
    # has no notion of a consistent heading, so when several shots of the same type are in flight
    # at once (e.g. rapid fire), it happily stitches pieces of different physical bullets together
    # whenever they happen to pass near each other, producing one track that doesn't correspond to
    # any real bullet's actual path. Fitting a constant-velocity line (x = x0 + vx*t, y = y0 +
    # vy*t) to the raw points instead, and pulling out whichever subset best satisfies one shot's
    # actual physics -- a straight line, at a speed matching how fast this bullet type actually
    # moves -- separates concurrent shots correctly even when their positions overlap, since two
    # different physical bullets essentially never sit on the same line at the same time.
    #
    # Validated against forest_follies_2's raw cuphead_bullet data: cleanly recovered ~45px/frame
    # shots (including genuine left-facing ones, at matching speed) that build_enemy_paths had
    # scrambled into a single track spanning hundreds of frames. Only use this for a bullet type
    # whose real motion is actually a constant-velocity straight line -- see LINEAR_BULLET_SPEEDS
    # for why e.g. tulip_bullet (a lobbed, arcing shot) isn't a candidate.
    #
    # The seed-pair search below stays plain Python (bisect + nested loops) since it's inherently
    # a lot of small, irregularly-shaped windows -- but each candidate's actual inlier check (the
    # per-point residual against a fitted line) is done as one batched numpy operation instead of
    # a Python-level loop per point, which is where nearly all of this function's time goes when a
    # 30-frame window holds many points at once (rapid fire). Measured ~1.8x faster on
    # forest_follies_2's own cuphead_bullet data (211s -> 115s), with byte-identical output to the
    # pure-Python version it replaced.
    if not values:
        return []

    pts = sorted((t, x, y) for x, y, t in values if x is not None)
    t_arr = np.array([p[0] for p in pts], dtype=float)
    x_arr = np.array([p[1] for p in pts], dtype=float)
    y_arr = np.array([p[2] for p in pts], dtype=float)

    shots = []

    while len(t_arr) >= min_inliers:
        t_list = t_arr.tolist()  # bisect needs a plain sequence
        candidates = []
        n = len(t_list)

        for i in range(n):
            t_i = t_list[i]
            # only pair each point with others within max_span frames ahead of it -- a real
            # shot's own detections never spread further apart than that
            j_lo = bisect_left(t_list, t_i + min_dt, i + 1)
            j_hi = bisect_right(t_list, t_i + max_span, i + 1)
            if j_lo >= j_hi:
                continue
            for j in range(j_lo, j_hi):
                a_t, a_x, a_y = t_arr[i], x_arr[i], y_arr[i]
                b_t, b_x, b_y = t_arr[j], x_arr[j], y_arr[j]
                dt = b_t - a_t
                vx, vy = (b_x - a_x) / dt, (b_y - a_y) / dt
                x0, y0 = a_x - vx * a_t, a_y - vy * a_t
                model = (x0, vx, y0, vy)
                if not _bullet_shot_plausible(model, a_t, b_t, min_speed, max_speed, max_span):
                    continue

                w_lo = bisect_left(t_list, a_t - max_span)
                w_hi = bisect_right(t_list, b_t + max_span)
                wt, wx, wy = t_arr[w_lo:w_hi], x_arr[w_lo:w_hi], y_arr[w_lo:w_hi]
                px, py = x0 + vx * wt, y0 + vy * wt
                resid = np.hypot(px - wx, py - wy)
                mask = (resid < threshold) & (np.abs(wt - a_t) <= max_span) & (np.abs(wt - b_t) <= max_span)
                count = int(mask.sum())
                if count >= min_inliers:
                    candidates.append((w_lo, mask, count))

        if not candidates:
            break

        # best-supported (most inliers) candidate first, but one that looked good from its seed
        # pair alone can still fail once refit against its own full inlier set -- try the next
        # best instead of abandoning the whole pool the moment that happens
        candidates.sort(key=lambda c: c[2], reverse=True)
        accepted = None
        for w_lo, mask, _ in candidates:
            idx = w_lo + np.flatnonzero(mask)
            it, ix, iy = t_arr[idx], x_arr[idx], y_arr[idx]
            refit = _fit_constant_velocity_np(it, ix, iy)

            t_lo2 = bisect_left(t_list, float(it[0]) - max_span)
            t_hi2 = bisect_right(t_list, float(it[-1]) + max_span)
            wt2, wx2, wy2 = t_arr[t_lo2:t_hi2], x_arr[t_lo2:t_hi2], y_arr[t_lo2:t_hi2]
            x0, vx, y0, vy = refit
            resid2 = np.hypot((x0 + vx * wt2) - wx2, (y0 + vy * wt2) - wy2)
            final_mask = resid2 < threshold
            if int(final_mask.sum()) < min_inliers:
                continue

            fidx = t_lo2 + np.flatnonzero(final_mask)
            ft, fx, fy = t_arr[fidx], x_arr[fidx], y_arr[fidx]
            if not _bullet_shot_plausible(refit, float(ft[0]), float(ft[-1]), min_speed, max_speed, max_span):
                continue
            final_model = _fit_constant_velocity_np(ft, fx, fy)
            if not _bullet_shot_plausible(final_model, float(ft[0]), float(ft[-1]), min_speed, max_speed, max_span):
                continue

            accepted = fidx
            break

        if accepted is None:
            break

        # cast t back to int -- it's int everywhere else in the pipeline (the raw source data's
        # own type); only float here because it rode along in a float64 numpy array
        shots.append(list(zip(
            x_arr[accepted].tolist(), y_arr[accepted].tolist(), t_arr[accepted].astype(int).tolist()
        )))
        keep = np.ones(len(t_arr), dtype=bool)
        keep[accepted] = False
        t_arr, x_arr, y_arr = t_arr[keep], x_arr[keep], y_arr[keep]

    return shots


def build_fixed_axis_paths(
    values,
    instances,
    fixed_axis="x",
    match_threshold=FIXED_AXIS_MATCH_THRESHOLD,
    range_margin=FIXED_AXIS_RANGE_MARGIN,
    min_track_points=MIN_ENEMY_TRACK_POINTS,
):
    # unlike build_enemy_paths, these enemies' possible positions along their fixed axis are
    # already known ahead of time (instances, from enemy_full_paths.pkl) since they only ever
    # patrol a fixed line -- vertical (fixed_axis="x", e.g. toothy/wally) or horizontal
    # (fixed_axis="y", e.g. injured_wally). So rather than splitting a run's detections into
    # tracks via jump-distance/reacquire-gap heuristics meant for enemies that could be
    # anywhere, just assign each detection to the known instance it's closest to along that
    # axis and sort by time -- a detection gap no longer needs to be bridged by a heuristic,
    # since there's no ambiguity about which instance it belongs to.
    if not values or not instances:
        return []

    fixed_idx = 0 if fixed_axis == "x" else 1
    free_idx = 1 - fixed_idx
    free_axis = "y" if fixed_axis == "x" else "x"
    free_min_key, free_max_key = f"{free_axis}_min", f"{free_axis}_max"

    buckets = [[] for _ in instances]
    for point in values:
        if point[fixed_idx] is None:
            continue
        nearest_index, nearest_dist = None, inf
        for index, instance in enumerate(instances):
            d = abs(instance[fixed_axis] - point[fixed_idx])
            if d < nearest_dist:
                nearest_dist, nearest_index = d, index
        if nearest_index is not None and nearest_dist <= match_threshold:
            buckets[nearest_index].append(point)

    tracks = []
    for instance, bucket in zip(instances, buckets):
        if len(bucket) < min_track_points:
            continue
        # clean_path_points is deliberately NOT used here. Its cleaners all assume roaming
        # motion and actively destroy this enemy's real movement: remove_reconnecting_jumps
        # treats "moves away and returns near where it started" as a detector glitch, which is
        # exactly what patrolling a fixed line looks like (it was deleting ~13% of all points
        # overall and up to ~49% for a single instance, punching holes in otherwise perfectly
        # smooth tracks); remove_single_point_spikes assumes they can't move far enough in a
        # few frames for a round trip to be real; and filter_points reads a legitimate
        # full-range traversal across a detection gap as one big glitch jump. Since points are
        # already assigned to a known instance by its fixed axis, the only cleaning that makes
        # sense is rejecting detections outside that instance's known patrol band.
        low = instance[free_min_key] - range_margin
        high = instance[free_max_key] + range_margin
        points = [
            point for point in sorted(bucket, key=lambda point: point[2])
            if point[free_idx] is not None and low <= point[free_idx] <= high
        ]
        if len(points) >= min_track_points:
            tracks.append(points)
    return tracks


def last_known_position(sorted_path, path_times, t):
    # sorted_path/path_times are a player's own main-path points/timestamps, both already
    # time-sorted. Returns the last point strictly before t (not the nearest by time either
    # side, since a dead player's main stream has nothing after their death to be "nearest" to)
    # -- or None if there's no such point.
    idx = bisect_left(path_times, t)
    if idx == 0:
        return None
    point = sorted_path[idx - 1]
    return point if point[0] is not None else None


def resolve_ghost_swaps(run, players):
    # Pools both players' raw ghost-class detections and re-clusters them into death events
    # together (same time/distance rule extract_singular_points uses per-player), instead of
    # trusting each player's own raw class stream in isolation -- so a cluster gets assigned to
    # whichever player it actually belongs to, not just whichever class the detector happened to
    # label it with. See GHOST_SWAP_MARGIN for why the raw label is only overridden when that's
    # a clear enough call. Assumes exactly two players (both this project's levels are 2-player
    # co-op), since "the other player" is unambiguous only in that case.
    ghost_types = [player["ghost"] for player in players]
    main_paths = []
    main_times = []
    for player in players:
        path = sorted(run.get(player["main"]) or [], key=lambda point: point[2])
        main_paths.append(path)
        main_times.append([point[2] for point in path])

    pooled = [
        (point, index)
        for index, player in enumerate(players)
        for point in (run.get(player["ghost"]) or [])
    ]
    pooled.sort(key=lambda entry: entry[0][2])

    # same clustering rule as extract_singular_points (time_thresh=200, dist_thresh=700),
    # reimplemented here rather than reused because each pooled point also carries which
    # player's raw class it came from, which extract_singular_points has no way to track.
    clusters = []
    for point, raw_index in pooled:
        assigned = None
        for cluster in clusters:
            anchor, _ = cluster[0]
            if abs(anchor[2] - point[2]) <= 200 and point_distance(anchor, point) <= 700:
                assigned = cluster
                break
        if assigned is None:
            clusters.append([(point, raw_index)])
        else:
            assigned.append((point, raw_index))

    resolved = {ghost_type: [] for ghost_type in ghost_types}
    for cluster in clusters:
        if len(cluster) < 8:
            continue
        first_point, raw_index = cluster[0]
        other_index = 1 - raw_index

        raw_last = last_known_position(main_paths[raw_index], main_times[raw_index], first_point[2])
        other_last = last_known_position(main_paths[other_index], main_times[other_index], first_point[2])

        chosen_index = raw_index
        if raw_last is not None and other_last is not None:
            dist_raw = point_distance(raw_last, first_point)
            dist_other = point_distance(other_last, first_point)
            if dist_raw - dist_other > GHOST_SWAP_MARGIN:
                chosen_index = other_index

        resolved[ghost_types[chosen_index]].append(first_point)

    return resolved


def build_player_path(run, player):
    # player is one entry of a level's PLAYERS tuple: {"main", "ghost", "hit"} -> type numbers,
    # though "hit" may be absent for a level with no hit-reaction sprite (see
    # constants_wally_warbles.py). Cleans one player's raw main-path detections only -- ghost/hit
    # points aren't folded in yet, since find_untracked_cutoff still needs every player's cleaned
    # *real-position* path before anything gets truncated to a shared cutoff (see transform_run).
    main_type, ghost_type, hit_type = player["main"], player["ghost"], player.get("hit")

    # ghost_type is passed to filter_points raw (unsorted, un-deduped): it's only used there
    # to check whether *any* ghost detection falls inside a time gap, so dedup doesn't matter.
    # This stays keyed off the detector's raw per-player class (not resolve_ghost_swaps' output)
    # since a gap marker only needs "some death-like event happened here for this player", not
    # a correctly-identified one.
    raw_ghosts = run[ghost_type]
    hits = extract_singular_points(run.get(hit_type) or [], min_cluster_size=8)

    path = sorted(run.get(main_type) or [], key=lambda point: point[2])
    path = clean_path_points(path, raw_ghosts, hits, big_dist=PLAYER_BIG_DIST)
    return path, hits


def find_untracked_cutoff(paths, gap_threshold):
    # paths: one or more players' detection streams (main path, ghosts, hits -- anything that
    # counts as "this player was detected somehow"). Pools every stream's real-position
    # timestamps (None-marker break points excluded) together and returns the time of the last
    # detection before the first stretch of gap_threshold or longer with no detection from any of
    # them -- or None if the pooled detections never go dark that long, meaning nothing needs to
    # be cut.
    times = sorted(point[2] for path in paths for point in path if point[0] is not None)
    for previous, current in zip(times, times[1:]):
        if current - previous > gap_threshold:
            return previous
    return None


def finalize_player_path(path, ghosts, hits, cutoff):
    # truncates every stream to the simultaneous-undetected cutoff (cutoff=None means the run
    # never went dark, so nothing is cut), then folds ghost/hit points back into the main trail
    # so revivals and hits show up as points along the path, and re-sorts since they're appended
    # out of chronological order. Ghosts are used as-is (whatever resolve_ghost_swaps actually
    # detected) -- a player whose track simply ends with no detected ghost reads as having
    # finished the level rather than died, so no marker is added for them.
    if cutoff is not None:
        path = [point for point in path if point[2] <= cutoff]
        ghosts = [point for point in ghosts if point[2] <= cutoff]
        hits = [point for point in hits if point[2] <= cutoff]
    else:
        ghosts = list(ghosts)
        hits = list(hits)

    full_path = [(x, y, t) for x, y, t in path] + ghosts + hits
    full_path.sort(key=lambda point: point[2])

    return {"main": full_path, "ghost": ghosts, "hit": hits}


def stable_start_time(player_paths):
    # earliest of the players' own validated starts (see build_player_path/find_stable_start):
    # once any player's real position is being tracked, the recording is in real gameplay, so
    # detections of anything -- not just players -- before that point aren't trustworthy either.
    starts = [path[0][2] for path in player_paths if path]
    return min(starts) if starts else 0


def stage_start_times(my_dict, level, start_time):
    # None for a level with no STAGES (e.g. Forest Follies) -- absence means "nothing to mark".
    # Stage 0 always starts at the run's own stable start; every later stage starts at the first
    # cleaned sighting (after that start) of any type in its set -- STAGE_2/STAGE_3 etc. only ever
    # contain types belonging to that stage's boss, so their first real sighting is that stage's
    # start. Reads my_dict (already-cleaned per-type tracks), not the raw run dict: raw detections
    # include a handful of stray misdetections of e.g. willy/injured_wally in runs that never
    # actually left stage 1, which build_enemy_paths/build_fixed_axis_paths already discard as
    # noise (tracks under MIN_ENEMY_TRACK_POINTS) -- reading raw data here would let that same
    # noise fabricate a stage the run never reached.
    # None for a stage the run never reached (e.g. the recording ended mid-Stage-1).
    #
    # Stages can only increase, so a stage's marker only counts once the *previous* stage's own
    # marker has actually been seen -- e.g. wally's stage-1 sprite is sometimes misdetected as his
    # injured stage-3 form before willy (stage 2) ever shows up. Those early detections aren't a
    # real sighting of anything, so this mutates my_dict to drop them outright rather than merely
    # excluding them from the time calculation -- they must not be visualized either. If a stage's
    # marker is never seen at all, every later stage's markers are dropped the same way, since none
    # of them could be real either.
    stages = getattr(level, "STAGES", None)
    if not stages:
        return None

    def type_points(enemy_type):
        value = my_dict.get(enemy_type) or []
        if enemy_type in level.ENEMY_KEYS:
            return [point for track in value for point in track]
        return value

    def drop_before(enemy_type, cutoff):
        value = my_dict.get(enemy_type)
        if not value:
            return
        if enemy_type in level.ENEMY_KEYS:
            my_dict[enemy_type] = [
                kept_track for kept_track in
                ([point for point in track if point[2] >= cutoff] for track in value)
                if kept_track
            ]
        else:
            my_dict[enemy_type] = [point for point in value if point[2] >= cutoff]

    starts = [start_time]
    cutoff = start_time
    previous_reached = True
    for _, types in stages[1:]:
        if not previous_reached:
            for enemy_type in types:
                drop_before(enemy_type, float("inf"))
            starts.append(None)
            continue

        for enemy_type in types:
            drop_before(enemy_type, cutoff)

        detection_times = [point[2] for enemy_type in types for point in type_points(enemy_type)]
        if detection_times:
            cutoff = min(detection_times)
            starts.append(cutoff)
        else:
            starts.append(None)
            previous_reached = False

    return starts


def transform_run(run, level, is_coop=True, has_next_run=True):
    if not all(run.get(player["main"]) for player in level.PLAYERS):
        return None

    resolved_ghosts = resolve_ghost_swaps(run, level.PLAYERS)
    built_players = [build_player_path(run, player) for player in level.PLAYERS]

    # only the primary player (PLAYERS[0]) is always really being tracked. In single-player
    # footage the others' detections are noise misread off the primary, so they're excluded here
    # -- their "path" going dark isn't a real player going undetected. A ghost/hit sighting counts
    # as a detection here too, not just a live position -- the ghost sprite takes a few frames to
    # register after a death, so a gap measured on live positions alone would (and did) cross the
    # threshold and cut the run just before that real ghost detection arrived.
    tracked_streams = [
        path + list(resolved_ghosts[player["ghost"]]) + list(hits)
        for index, (player, (path, hits)) in enumerate(zip(level.PLAYERS, built_players))
        if is_coop or index == 0
    ]
    cutoff = find_untracked_cutoff(tracked_streams, BOTH_PLAYERS_UNDETECTED_GAP)

    cleaned_players = [
        finalize_player_path(path, resolved_ghosts[player["ghost"]], hits, cutoff)
        for player, (path, hits) in zip(level.PLAYERS, built_players)
    ]

    # a player who goes undetected for an extended stretch before the run's own end almost always
    # died without the detector ever catching it (off-screen, or the death sprite itself went
    # unrecognized) -- so if nothing else already marks their last known position as a death, add
    # one there. Only considered for players who are really being tracked (see is_coop above);
    # skipped when a real ghost already covers their last point. An extended gap isn't the only
    # tell, though: if both players stay detected together right up to a shared simultaneous-
    # silence cutoff (see find_untracked_cutoff above), neither one's own gap looks "extended"
    # relative to the other -- but has_next_run (a later attempt exists in this same recording)
    # independently proves this run still ended in death for whoever isn't already confirmed, so
    # that's checked too rather than relying on gap size alone.
    def last_real_point(cleaned):
        return next((point for point in reversed(cleaned["main"]) if point[0] is not None), None)

    tracked_indices = [index for index in range(len(level.PLAYERS)) if is_coop or index == 0]
    run_end_times = [
        point[2] for point in (last_real_point(cleaned_players[index]) for index in tracked_indices)
        if point is not None
    ]
    run_end = max(run_end_times) if run_end_times else None

    if run_end is not None:
        for index in tracked_indices:
            cleaned = cleaned_players[index]
            last_point = last_real_point(cleaned)
            if last_point is None:
                continue
            has_nearby_ghost = any(
                abs(g[2] - last_point[2]) <= BOTH_PLAYERS_UNDETECTED_GAP for g in cleaned["ghost"]
            )
            extended_absence = run_end - last_point[2] >= BOTH_PLAYERS_UNDETECTED_GAP
            if not has_nearby_ghost and (extended_absence or has_next_run):
                cleaned["ghost"] = list(cleaned["ghost"]) + [last_point]

    player_paths = [cleaned["main"] for cleaned in cleaned_players]
    start_time = stable_start_time(player_paths)

    def in_window(t):
        return t >= start_time and (cutoff is None or t <= cutoff)

    # players and their ghost/hit streams are cleaned above; enemy and bullet tracks are rebuilt
    # from raw run data below, so none of them need the generic sort-and-passthrough treatment here
    bullet_keys = getattr(level, "BULLET_KEYS", set())
    my_dict = {
        char: [(x, y, t) for x, y, t in sorted(values, key=lambda point: point[2]) if in_window(t)]
        for char, values in run.items()
        if char not in level.PLAYER_KEYS | level.ENEMY_KEYS | bullet_keys
    }

    for stream in ("main", "ghost", "hit"):
        for player, cleaned in zip(level.PLAYERS, cleaned_players):
            # a level without e.g. a hit-reaction sprite (constants_wally_warbles.py) has no type
            # number for that stream at all -- skip it rather than writing a bogus my_dict[None]
            # entry, which json.dumps would silently turn into a "null" key in the output.
            stream_type = player.get(stream)
            if stream_type is None:
                continue
            my_dict[stream_type] = [(x, y, t) for x, y, t in cleaned[stream]]

    # sorted() because these sets iterate in an arbitrary (per-process) order otherwise, which
    # would shuffle the output's key order from one run of the pipeline to the next
    known_instances = load_known_enemy_instances(level)
    for enemy_type in sorted(level.ENEMY_KEYS):
        enemy_values = [point for point in (run.get(enemy_type) or []) if in_window(point[2])]
        if enemy_type in level.FIXED_VERTICAL_ENEMIES:
            my_dict[enemy_type] = build_fixed_axis_paths(enemy_values, known_instances.get(enemy_type, []), fixed_axis="x")
        elif enemy_type in level.FIXED_HORIZONTAL_ENEMIES:
            my_dict[enemy_type] = build_fixed_axis_paths(enemy_values, known_instances.get(enemy_type, []), fixed_axis="y")
        else:
            my_dict[enemy_type] = build_enemy_paths(enemy_values, player_path=player_paths[0])

    # a bullet type listed in the level's LINEAR_BULLET_SPEEDS moves in a straight line at roughly
    # constant speed, so build_bullet_shots' per-shot line fit reconstructs its individual shots
    # far more reliably than proximity-based reconnection does when several are in flight at once
    # (see build_bullet_shots). Every other bullet type keeps the same free-roaming track
    # reconstruction as MOVING_ENEMIES (build_enemy_paths' jump-distance/reacquire-gap heuristic
    # already handles multiple simultaneous instances, which is exactly what concurrent bullets on
    # screen are) -- kept in their own loop since BULLET_KEYS is deliberately separate from
    # ENEMY_KEYS -- see its definition.
    linear_bullet_speeds = getattr(level, "LINEAR_BULLET_SPEEDS", {})
    for bullet_type in sorted(bullet_keys):
        bullet_values = [point for point in (run.get(bullet_type) or []) if in_window(point[2])]
        if bullet_type in linear_bullet_speeds:
            min_speed, max_speed = linear_bullet_speeds[bullet_type]
            my_dict[bullet_type] = build_bullet_shots(bullet_values, min_speed, max_speed)
        else:
            my_dict[bullet_type] = build_enemy_paths(bullet_values, player_path=player_paths[0])

    stage_starts = stage_start_times(my_dict, level, start_time)
    if stage_starts is not None:
        my_dict["stage_starts"] = stage_starts

    return my_dict
