import pickle
from pathlib import Path
import json
from statistics import median

import constants_forest_follies as const
from coords_transform import transform_run
from helper import distance


base = Path(__file__).parent
pkl_path = base / "resources/forest_follies_agg"

RESAMPLE_STEPS = 10000
SMOOTHING_WINDOW = 1
OUTLIER_CLUSTER_SIZE = 3

AGGREGATED_LINEAR_ENEMIES = {
    const.spiky_bulb,
    const.toothy,
}
STATIONARY_ENEMIES = {
    const.shroom,
    const.tulip,
}
FULL_PATH_ENEMIES = {
    const.acorn,
}


def valid_points(points):
    return [point for point in points if point and point[0] is not None and point[1] is not None]


def cumulative_distances(points):
    distances = [0.0]
    total = 0.0

    for index in range(1, len(points)):
        total += distance(points[index - 1], points[index])
        distances.append(total)

    return distances


def interpolate_point(start, end, fraction):
    x = start[0] + (end[0] - start[0]) * fraction
    y = start[1] + (end[1] - start[1]) * fraction
    return (x, y)


def resample_path(points, steps=RESAMPLE_STEPS):
    clean_points = valid_points(points)
    if not clean_points:
        return []
    if len(clean_points) == 1:
        return [(clean_points[0][0], clean_points[0][1]) for _ in range(steps)]

    distances = cumulative_distances(clean_points)
    total_length = distances[-1]
    if total_length == 0:
        return [(clean_points[0][0], clean_points[0][1]) for _ in range(steps)]

    targets = [total_length * step / (steps - 1) for step in range(steps)]
    resampled = []
    segment_index = 0

    for target in targets:
        while segment_index < len(distances) - 2 and distances[segment_index + 1] < target:
            segment_index += 1

        start_distance = distances[segment_index]
        end_distance = distances[segment_index + 1]
        start_point = clean_points[segment_index]
        end_point = clean_points[segment_index + 1]

        if end_distance == start_distance:
            resampled.append((start_point[0], start_point[1]))
            continue

        fraction = (target - start_distance) / (end_distance - start_distance)
        resampled.append(interpolate_point(start_point, end_point, fraction))

    return resampled


def smooth_path(points, window=SMOOTHING_WINDOW):
    if len(points) < 3 or window <= 1:
        return points

    radius = window // 2
    smoothed = []

    for index in range(len(points)):
        start_index = max(0, index - radius)
        end_index = min(len(points), index + radius + 1)
        window_points = points[start_index:end_index]
        avg_x = sum(point[0] for point in window_points) / len(window_points)
        avg_y = sum(point[1] for point in window_points) / len(window_points)
        smoothed.append((avg_x, avg_y))

    return smoothed


def aggregate_paths(paths, steps=RESAMPLE_STEPS):
    resampled_paths = [resample_path(path, steps=steps) for path in paths if valid_points(path)]
    if not resampled_paths:
        return []

    aggregated = []
    for step_index in range(steps):
        xs = [path[step_index][0] for path in resampled_paths]
        ys = [path[step_index][1] for path in resampled_paths]
        aggregated.append((median(xs), median(ys), step_index))

    return smooth_path(aggregated)


def aggregate_spatial_path(paths, distance_threshold=120):
    all_points = [point for path in paths for point in valid_points(path)]
    if not all_points:
        return []

    clusters = cluster_points_by_distance(all_points, distance_threshold=distance_threshold)
    aggregated = []

    for cluster in clusters:
        if not cluster:
            continue
        aggregated.append((
            median(point[0] for point in cluster),
            median(point[1] for point in cluster),
            len(cluster),
        ))

    aggregated.sort(key=lambda point: point[0])
    return [(point[0], point[1], index) for index, point in enumerate(aggregated)]


def simplify_vertical_path(points):
    clean_points = valid_points(points)
    if not clean_points:
        return []

    xs = [point[0] for point in clean_points]
    ys = [point[1] for point in clean_points]
    center_x = median(xs)
    return [
        (center_x, min(ys), 0),
        (center_x, max(ys), 1),
    ]


def aggregate_stationary_points(points):
    clean_points = valid_points(points)
    if not clean_points:
        return None
    return (median(point[0] for point in clean_points), median(point[1] for point in clean_points), 0)


def cluster_points_by_distance(points, distance_threshold=120):
    clusters = []

    for point in valid_points(points):
        assigned = None
        for cluster in clusters:
            anchor = cluster[0]
            if distance(anchor, point) <= distance_threshold:
                assigned = cluster
                break

        if assigned is None:
            clusters.append([point])
        else:
            assigned.append(point)

    return clusters


def aggregate_enemy_data(runs):
    enemy_data = {}

    for enemy_type in AGGREGATED_LINEAR_ENEMIES | STATIONARY_ENEMIES | FULL_PATH_ENEMIES:
        all_tracks = []

        for run in runs:
            enemy_tracks = run.get("enemy_paths", {}).get(enemy_type, [])
            all_tracks.extend(track.get("points", []) for track in enemy_tracks if valid_points(track.get("points", [])))

            if enemy_type in STATIONARY_ENEMIES and not enemy_tracks:
                direct_points = run.get(enemy_type, [])
                if valid_points(direct_points):
                    all_tracks.append(valid_points(direct_points))

        if enemy_type in AGGREGATED_LINEAR_ENEMIES:
            aggregated_path = aggregate_paths(all_tracks)
            enemy_data[enemy_type] = {
                "mode": "aggregated-linear",
                "path": simplify_vertical_path(aggregated_path),
            }
            continue

        if enemy_type in STATIONARY_ENEMIES:
            clusters = cluster_points_by_distance([point for track in all_tracks for point in track])
            anchors = [aggregate_stationary_points(cluster) for cluster in clusters if len(cluster) >= OUTLIER_CLUSTER_SIZE]
            enemy_data[enemy_type] = {
                "mode": "stationary",
                "anchors": [anchor for anchor in anchors if anchor is not None],
            }
            continue

        if enemy_type in FULL_PATH_ENEMIES:
            enemy_data[enemy_type] = {
                "mode": "full-path",
                "path": aggregate_paths(all_tracks),
            }

    return enemy_data


all_runs = []

for file in pkl_path.glob("*.pkl"):
    with open(file, "rb") as f:
        point_dict = pickle.load(f)

    runs = []

    for run in point_dict:
        runs.append(transform_run(run))

    all_runs.extend(runs)

cup_paths = [run.get(const.cuphead, []) for run in all_runs if run.get(const.cuphead)]
mug_paths = [run.get(const.mugman, []) for run in all_runs if run.get(const.mugman)]
combined_cup_paths = cup_paths + mug_paths

aggregated_paths = {
    const.cuphead: aggregate_spatial_path(combined_cup_paths),
    const.mugman: [],
    "enemies": aggregate_enemy_data(all_runs),
}

print(json.dumps(aggregated_paths))

