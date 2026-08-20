import pickle
from pathlib import Path

import constants_forest_follies
from coords_transform import build_enemy_paths, enemy_full_paths_path
from helper import distance, cluster_points_by_distance

# same threshold visualize.js's aggregateVerticalEnemyTracks already uses to
# tell separate instances of these two enemy types apart on-screen
X_MATCH_THRESHOLD = 170
# tracks shorter than this are almost always single-frame false detections,
# not a real enemy sighting (real sightings run into the hundreds of points)
MIN_TRACK_POINTS = 20
# stationary enemies don't form tracks, so sightings are clustered spatially
# instead; 120 was splitting single enemies into duplicate instances
# ~125-150px apart (confirmed per-file in resources/play_data/*.pkl), so
# this has margin above that gap while staying well below the ~500px+ gap
# between genuinely distinct enemies
STATIONARY_DISTANCE_THRESHOLD = 200
# stationary instances with fewer points than this are almost always a
# one-off false detection rather than a real, recurring enemy; real
# instances run into the hundreds/thousands of points, noise tops out
# around a dozen, so this sits comfortably in the gap between them
OUTLIER_CLUSTER_SIZE = 50

# every level this script rebuilds a cache for, paired with the play data it's built from. Add a
# level's constants module here once its recordings exist; one run refreshes all of them.
LEVELS = [
    (constants_forest_follies, Path(__file__).parent / "resources/play_data"),
]


def find_nearest_instance(instances, distance_to, threshold):
    best, best_dist = None, float("inf")
    for instance in instances:
        d = distance_to(instance)
        if d < best_dist:
            best_dist, best = d, instance
    return best if best is not None and best_dist <= threshold else None


def merge_track_into_instances(instances, points, x_match_threshold=X_MATCH_THRESHOLD, min_track_points=MIN_TRACK_POINTS):
    xs = [p[0] for p in points if p[0] is not None]
    ys = [p[1] for p in points if p[1] is not None]
    if len(xs) < min_track_points or not ys:
        return

    track_x = sum(xs) / len(xs)
    track_y_min, track_y_max = min(ys), max(ys)
    track_count = len(xs)

    match = find_nearest_instance(instances, lambda i: abs(i["x"] - track_x), x_match_threshold)
    if match is None:
        instances.append({"x": track_x, "y_min": track_y_min, "y_max": track_y_max, "num_points": track_count})
        return

    total = match["num_points"] + track_count
    match["x"] = (match["x"] * match["num_points"] + track_x * track_count) / total
    match["y_min"] = min(match["y_min"], track_y_min)
    match["y_max"] = max(match["y_max"], track_y_max)
    match["num_points"] = total


def merge_stationary_points_into_instances(instances, points, distance_threshold=STATIONARY_DISTANCE_THRESHOLD):
    for cluster in cluster_points_by_distance(points, distance_threshold=distance_threshold):
        cluster_x = sum(p[0] for p in cluster) / len(cluster)
        cluster_y = sum(p[1] for p in cluster) / len(cluster)
        cluster_count = len(cluster)

        match = find_nearest_instance(instances, lambda i: distance((i["x"], i["y"]), (cluster_x, cluster_y)), distance_threshold)
        if match is None:
            instances.append({"x": cluster_x, "y": cluster_y, "num_points": cluster_count})
            continue

        total = match["num_points"] + cluster_count
        match["x"] = (match["x"] * match["num_points"] + cluster_x * cluster_count) / total
        match["y"] = (match["y"] * match["num_points"] + cluster_y * cluster_count) / total
        match["num_points"] = total


def update_from_pkl(known_paths, pkl_path, level):
    with open(pkl_path, "rb") as f:
        point_dict = pickle.load(f)

    for run in point_dict:
        for enemy_type in level.FIXED_VERTICAL_ENEMIES:
            for points in build_enemy_paths(run.get(enemy_type) or []):
                merge_track_into_instances(known_paths[enemy_type], points)

        for enemy_type in level.STATIONARY_ENEMIES:
            merge_stationary_points_into_instances(known_paths[enemy_type], run.get(enemy_type) or [])


def print_instances(known_paths):
    for enemy_type, instances in known_paths.items():
        print(f"{enemy_type}: {len(instances)} instance(s)")
        for instance in sorted(instances, key=lambda i: i["x"]):
            if "y_min" in instance:
                print(f"  x={instance['x']:.1f} y=[{instance['y_min']:.1f}, {instance['y_max']:.1f}] n={instance['num_points']}")
            else:
                print(f"  x={instance['x']:.1f} y={instance['y']:.1f} n={instance['num_points']}")


def build_known_paths(level, source_dir):
    known_paths = {enemy_type: [] for enemy_type in level.FIXED_VERTICAL_ENEMIES | level.STATIONARY_ENEMIES}

    for pkl_path in sorted(source_dir.glob("*.pkl")):
        update_from_pkl(known_paths, pkl_path, level)

    for enemy_type in level.STATIONARY_ENEMIES:
        known_paths[enemy_type] = [
            instance for instance in known_paths[enemy_type]
            if instance["num_points"] >= OUTLIER_CLUSTER_SIZE
        ]

    return known_paths


if __name__ == "__main__":
    for level, source_dir in LEVELS:
        known_paths = build_known_paths(level, source_dir)

        output_path = enemy_full_paths_path(level)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "wb") as f:
            pickle.dump({"enemies": known_paths}, f)

        print(f"{level.LEVEL} -> {output_path}")
        print_instances(known_paths)
