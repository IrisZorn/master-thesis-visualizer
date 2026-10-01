import argparse
import json
import pickle
import sys
from pathlib import Path

import constants_forest_follies
import constants_wally_warbles
from coords_transform import is_coop_footage, precalc_bullet_paths_path, transform_run

# Forest Follies and Wally Warbles' per-run coordinates. Framework calls this once per level
# (e.g. requesting data/run_coords_wally_warbles.json runs it with --level=wally_warbles) -- the
# loader itself is level-agnostic and only ever looks a level up by name here.
#
# Bullet paths come precalculated from build_bullet_paths.py (resources/precalc_bullet_paths/),
# since reconstructing them is by far the slowest part of transform_run. Rerun that script after
# new recordings or pipeline changes, then `npm run clean`: Framework only invalidates its cache
# when this file itself changes, not the pkl it reads.
LEVELS = {
    "forest_follies": constants_forest_follies,
    "wally_warbles": constants_wally_warbles,
}

def merge_into_primary_player(runs, level):
    # single-player footage still produces detections for the other characters (the detector
    # occasionally reads the one player as the other), so fold every stream into the primary
    # player's and leave the rest empty rather than drawing a second, phantom player.
    primary, others = level.PLAYERS[0], level.PLAYERS[1:]
    merged_runs = []

    for run in runs:
        merged_run = dict(run)

        for stream in ("main", "ghost", "hit"):
            # a level without e.g. a hit-reaction sprite (constants_wally_warbles.py) has no type
            # number for that stream at all -- skip it rather than writing a bogus merged_run[None]
            # entry, which json.dumps would silently turn into a "null" key in the output.
            primary_type = primary.get(stream)
            if primary_type is None:
                continue
            points = list(merged_run.get(primary_type, []))
            for other in others:
                other_type = other.get(stream)
                if other_type is None:
                    continue
                points += list(merged_run.get(other_type, []))
                merged_run[other_type] = []
            merged_run[primary_type] = sorted(points, key=lambda point: point[2])

        merged_runs.append(merged_run)

    return merged_runs


def load_precalc_bullet_paths(level):
    path = precalc_bullet_paths_path(level)
    if not path.exists():
        return {}
    with open(path, "rb") as f:
        return pickle.load(f)


def load_runs(pkl_path, level, precalc_bullet_paths):
    with open(pkl_path, "rb") as f:
        point_dict = pickle.load(f)

    is_coop = is_coop_footage(point_dict, level)

    # one entry per run, by index into point_dict. A recording build_bullet_paths.py hasn't seen
    # yet (or one whose run count no longer matches) falls back to computing its bullets here --
    # correct, just slow -- with a note on stderr, which Framework shows in the preview terminal.
    run_bullet_paths = precalc_bullet_paths.get(pkl_path.stem)
    if run_bullet_paths is None or len(run_bullet_paths) != len(point_dict):
        print(f"{pkl_path.name}: no precalculated bullet paths, computing them (run build_bullet_paths.py)", file=sys.stderr)
        run_bullet_paths = [None] * len(point_dict)

    last_index = len(point_dict) - 1
    runs = [
        transform_run(run, level, is_coop=is_coop, has_next_run=index < last_index, bullet_paths=run_bullet_paths[index])
        for index, run in enumerate(point_dict)
    ]
    runs = [run for run in runs if run is not None]

    if not is_coop:
        runs = merge_into_primary_player(runs, level)

    return runs


def dump_playthroughs(level, play_data_dir):
    # every playthrough recording for one level, keyed by filename stem
    precalc_bullet_paths = load_precalc_bullet_paths(level)
    playthroughs = {
        pkl_path.stem: load_runs(pkl_path, level, precalc_bullet_paths)
        for pkl_path in sorted(play_data_dir.glob("*.pkl"))
    }
    print(json.dumps(playthroughs))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--level", required=True, choices=sorted(LEVELS))
    level_name = parser.parse_args().level

    dump_playthroughs(LEVELS[level_name], Path(__file__).parent / "resources/play_data" / level_name)
