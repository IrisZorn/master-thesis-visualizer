import pickle
from pathlib import Path

import constants_forest_follies
import constants_wally_warbles
from coords_transform import is_coop_footage, precalc_bullet_paths_path, transform_run

# Precalculates every play_data recording's bullet paths for run_coords_[level].json.py, since
# reconstructing them (coords_transform.build_bullet_shots' line search) takes minutes per level
# and would otherwise rerun on every Framework load. Needs build_aggregate_data.py's
# enemy_full_paths.pkl to be current, since transform_run (and with it the run window the bullets
# are cut to) reads it.
#
# every level this script rebuilds a cache for, paired with the play data it's built from. Add a
# level's constants module here once its recordings exist; one run refreshes all of them.
RESOURCES_DIR = Path(__file__).parent / "resources"
LEVELS = [
    (constants_forest_follies, RESOURCES_DIR / "play_data/forest_follies"),
    (constants_wally_warbles, RESOURCES_DIR / "play_data/wally_warbles"),
]


def build_recording_bullet_paths(pkl_path, level):
    # one entry per run, by index into the recording -- None for a run transform_run discards.
    # transform_run gets the same is_coop/has_next_run run_coords_[level].json.py's load_runs
    # passes, since both change the run window and with it which bullet detections are used.
    with open(pkl_path, "rb") as f:
        point_dict = pickle.load(f)

    is_coop = is_coop_footage(point_dict, level)
    bullet_keys = getattr(level, "BULLET_KEYS", set())

    last_index = len(point_dict) - 1
    run_bullet_paths = []
    for index, run in enumerate(point_dict):
        transformed = transform_run(run, level, is_coop=is_coop, has_next_run=index < last_index)
        if transformed is None:
            run_bullet_paths.append(None)
            continue
        run_bullet_paths.append({
            bullet_type: transformed[bullet_type] for bullet_type in bullet_keys if bullet_type in transformed
        })

    return run_bullet_paths


if __name__ == "__main__":
    for level, source_dir in LEVELS:
        # keyed by filename stem, same as run_coords_[level].json.py's playthroughs
        bullet_paths = {
            pkl_path.stem: build_recording_bullet_paths(pkl_path, level)
            for pkl_path in sorted(source_dir.glob("*.pkl"))
        }

        output_path = precalc_bullet_paths_path(level)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "wb") as f:
            pickle.dump(bullet_paths, f)

        print(f"{level.LEVEL} -> {output_path}")
