import pickle
from pathlib import Path

import constants_forest_follies
import constants_wally_warbles
from coords_transform import build_enemy_paths, enemy_full_paths_path
from helper import distance, cluster_points_by_distance

# same threshold visualize.js's aggregateVerticalEnemyTracks already uses to
# tell separate instances of these enemy types apart on-screen -- shared by both fixed-vertical
# and fixed-horizontal enemies, since it's just a distance-along-the-fixed-axis cutoff
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
    (constants_forest_follies, Path(__file__).parent / "resources/play_data/forest_follies"),
    (constants_wally_warbles, Path(__file__).parent / "resources/play_data/wally_warbles"),
]


def find_nearest_instance(instances, distance_to, threshold):
    best, best_dist = None, float("inf")
    for instance in instances:
        d = distance_to(instance)
        if d < best_dist:
            best_dist, best = d, instance
    return best if best is not None and best_dist <= threshold else None


def merge_track_into_instances(instances, points, fixed_axis="x", x_match_threshold=X_MATCH_THRESHOLD, min_track_points=MIN_TRACK_POINTS):
    # fixed_axis picks which coordinate identifies the instance (x for a fixed-vertical enemy
    # like toothy/wally, y for a fixed-horizontal one like injured_wally) -- the other coordinate
    # is the one the enemy actually patrols along, so its range gets tracked as free_min/free_max.
    # Field names are derived from fixed_axis so a vertical instance keeps exactly the
    # {"x", "y_min", "y_max"} shape this already had before horizontal support existed.
    fixed_idx = 0 if fixed_axis == "x" else 1
    free_idx = 1 - fixed_idx
    free_axis = "y" if fixed_axis == "x" else "x"
    free_min_key, free_max_key = f"{free_axis}_min", f"{free_axis}_max"

    fixed_values = [p[fixed_idx] for p in points if p[fixed_idx] is not None]
    free_values = [p[free_idx] for p in points if p[free_idx] is not None]
    if len(fixed_values) < min_track_points or not free_values:
        return

    track_fixed = sum(fixed_values) / len(fixed_values)
    track_free_min, track_free_max = min(free_values), max(free_values)
    track_count = len(fixed_values)

    match = find_nearest_instance(instances, lambda i: abs(i[fixed_axis] - track_fixed), x_match_threshold)
    if match is None:
        instances.append({fixed_axis: track_fixed, free_min_key: track_free_min, free_max_key: track_free_max, "num_points": track_count})
        return

    total = match["num_points"] + track_count
    match[fixed_axis] = (match[fixed_axis] * match["num_points"] + track_fixed * track_count) / total
    match[free_min_key] = min(match[free_min_key], track_free_min)
    match[free_max_key] = max(match[free_max_key], track_free_max)
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
                merge_track_into_instances(known_paths[enemy_type], points, fixed_axis="x")

        for enemy_type in level.FIXED_HORIZONTAL_ENEMIES:
            for points in build_enemy_paths(run.get(enemy_type) or []):
                merge_track_into_instances(known_paths[enemy_type], points, fixed_axis="y")

        for enemy_type in level.STATIONARY_ENEMIES:
            merge_stationary_points_into_instances(known_paths[enemy_type], run.get(enemy_type) or [])


def print_instances(known_paths):
    for enemy_type, instances in known_paths.items():
        print(f"{enemy_type}: {len(instances)} instance(s)")
        for instance in sorted(instances, key=lambda i: i.get("x", i.get("y"))):
            if "y_min" in instance:
                print(f"  x={instance['x']:.1f} y=[{instance['y_min']:.1f}, {instance['y_max']:.1f}] n={instance['num_points']}")
            elif "x_min" in instance:
                print(f"  y={instance['y']:.1f} x=[{instance['x_min']:.1f}, {instance['x_max']:.1f}] n={instance['num_points']}")
            else:
                print(f"  x={instance['x']:.1f} y={instance['y']:.1f} n={instance['num_points']}")


def build_known_paths(level, source_dir):
    known_paths = {
        enemy_type: []
        for enemy_type in level.FIXED_VERTICAL_ENEMIES | level.FIXED_HORIZONTAL_ENEMIES | level.STATIONARY_ENEMIES
    }

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
