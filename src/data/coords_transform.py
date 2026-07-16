import pickle
from math import inf

import constants_forest_follies as const
from helper import filter_points, extract_singular_points, remove_reconnecting_jumps


ENEMY_JUMP_THRESHOLD = 200
ENEMY_PATH_KEY = "enemy_paths"
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
    const.spiky_bulb,
    const.toothy,
}


def point_distance(point_a, point_b):
    if point_a[0] is None or point_b[0] is None:
        return inf
    dx = point_a[0] - point_b[0]
    dy = point_a[1] - point_b[1]
    return (dx * dx + dy * dy) ** 0.5


def build_enemy_paths(run, jump_threshold=ENEMY_JUMP_THRESHOLD):
    enemy_paths = {}

    for enemy_type, values in run.items():
        if enemy_type not in ENEMY_KEYS:
            continue

        detections = sorted(
            [(x, y, t) for x, y, t in values if x is not None and y is not None],
            key=lambda point: (point[2], point[0], point[1]),
        )
        if not detections:
            continue

        tracks = []

        for detection in detections:
            frame_time = detection[2]
            available_tracks = [
                track for track in tracks if track["last_time"] < frame_time
            ]

            best_track = None
            best_distance = inf

            for track in available_tracks:
                jump_distance = point_distance(track["last_point"], detection)
                if jump_distance < best_distance:
                    best_distance = jump_distance
                    best_track = track

            if best_track is None or best_distance > jump_threshold:
                best_track = {
                    "id": f"{enemy_type}-{len(tracks)}",
                    "points": [],
                    "last_point": None,
                    "last_time": -inf,
                }
                tracks.append(best_track)

            best_track["points"].append(detection)
            best_track["last_point"] = detection
            best_track["last_time"] = frame_time

        serialized_tracks = []
        for track in tracks:
            if len(track["points"]) < 1:
                continue
            serialized_tracks.append(
                {
                    "id": track["id"],
                    "type": enemy_type,
                    "points": track["points"],
                }
            )

        if serialized_tracks:
            enemy_paths[enemy_type] = serialized_tracks

    return enemy_paths


def transform_run(run):
    my_dict = {}

    cleaned_cup_hits = extract_singular_points(run.get(const.cuphead_hit) or [], min_cluster_size=6)
    cleaned_mug_hits = extract_singular_points(run.get(const.mugman_hit) or [], min_cluster_size=6)

    cup = run.get(const.cuphead) or []
    mug = run.get(const.mugman) or []
    if not cup or not mug:
        return None

    add_points = {
        const.cuphead: [],
        const.mugman: [],
    }

    for char, values in run.items():
        values = sorted(values, key=lambda t: t[2])
        filtered_vals = values
        if char == const.cuphead:
            filtered_vals = filter_points(values, run[const.cuphead_ghost], cleaned_cup_hits)
            filtered_vals = remove_reconnecting_jumps(
                filtered_vals,
                jump_dist=150,
                return_dist=180,
                max_branch_points=70,
                min_branch_points=3,
                min_deviation=70,
            )
        elif char == const.mugman:
            filtered_vals = filter_points(values, run[const.mugman_ghost], cleaned_mug_hits)
            filtered_vals = remove_reconnecting_jumps(
                filtered_vals,
                jump_dist=150,
                return_dist=180,
                max_branch_points=70,
                min_branch_points=3,
                min_deviation=70,
            )
        elif char == const.cuphead_ghost:
            filtered_vals = extract_singular_points(values, min_cluster_size=8)
            add_points[const.cuphead].extend(filtered_vals)
        elif char == const.cuphead_hit:
            filtered_vals = cleaned_cup_hits
            add_points[const.cuphead].extend(filtered_vals)
        elif char == const.mugman_ghost:
            filtered_vals = extract_singular_points(values, min_cluster_size=8)
            add_points[const.mugman].extend(filtered_vals)
        elif char == const.mugman_hit:
            filtered_vals = cleaned_mug_hits
            add_points[const.mugman].extend(filtered_vals)

        my_dict[char] = [(x, y, t) for x, y, t in filtered_vals]

    for player in (const.cuphead, const.mugman):
        my_dict[player].extend(add_points[player])
        my_dict[player].sort(key=lambda t: t[2])

    my_dict[ENEMY_PATH_KEY] = build_enemy_paths(my_dict)

    return my_dict
