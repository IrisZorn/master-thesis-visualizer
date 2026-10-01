import pickle

from coords_transform import precalc_bullet_paths_path, transform_recording
from levels import LEVELS, play_data_dir

# Precalculates every play_data recording's bullet paths for run_coords_[level].json.py, since
# reconstructing them (coords_transform.build_bullet_shots' line search) takes minutes per level
# and would otherwise rerun on every Framework load. Needs build_aggregate_data.py's
# enemy_full_paths.pkl to be current, since transform_run (and with it the run window the bullets
# are cut to) reads it. One run refreshes the cache of every level in levels.LEVELS.


def build_recording_bullet_paths(pkl_path, level):
    # one entry per run, by index into the recording -- None for a run transform_run discards.
    # Goes through the same transform_recording run_coords_[level].json.py's load_runs uses, since
    # its run window decides which bullet detections are used.
    with open(pkl_path, "rb") as f:
        point_dict = pickle.load(f)

    bullet_keys = getattr(level, "BULLET_KEYS", set())
    return [
        None if transformed is None else {
            bullet_type: transformed[bullet_type] for bullet_type in bullet_keys if bullet_type in transformed
        }
        for transformed in transform_recording(point_dict, level)
    ]


if __name__ == "__main__":
    for level in LEVELS.values():
        # keyed by filename stem, same as run_coords_[level].json.py's playthroughs
        bullet_paths = {
            pkl_path.stem: build_recording_bullet_paths(pkl_path, level)
            for pkl_path in sorted(play_data_dir(level).glob("*.pkl"))
        }

        output_path = precalc_bullet_paths_path(level)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "wb") as f:
            pickle.dump(bullet_paths, f)

        print(f"{level.LEVEL} -> {output_path}")
