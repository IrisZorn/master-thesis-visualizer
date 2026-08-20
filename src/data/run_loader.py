import json
import pickle

from coords_transform import transform_run

# a recording counts as single-player once a non-primary player has fewer than 1/COOP_RATIO_THRESHOLD
# as many detections as the primary one: at that point their "path" is stray false detections on
# the primary player rather than a second person playing.
COOP_RATIO_THRESHOLD = 20


def is_coop_footage(point_dict, level):
    totals = {
        player["main"]: sum(len(run.get(player["main"]) or []) for run in point_dict)
        for player in level.PLAYERS
    }
    primary_total = totals[level.PLAYERS[0]["main"]]
    return all(
        totals[player["main"]] * COOP_RATIO_THRESHOLD > primary_total
        for player in level.PLAYERS[1:]
    )


def merge_into_primary_player(runs, level):
    # single-player footage still produces detections for the other characters (the detector
    # occasionally reads the one player as the other), so fold every stream into the primary
    # player's and leave the rest empty rather than drawing a second, phantom player.
    primary, others = level.PLAYERS[0], level.PLAYERS[1:]
    merged_runs = []

    for run in runs:
        merged_run = dict(run)

        for stream in ("main", "ghost", "hit"):
            points = list(merged_run.get(primary[stream], []))
            for other in others:
                points += list(merged_run.get(other[stream], []))
                merged_run[other[stream]] = []
            merged_run[primary[stream]] = sorted(points, key=lambda point: point[2])

        merged_runs.append(merged_run)

    return merged_runs


def load_runs(pkl_path, level):
    with open(pkl_path, "rb") as f:
        point_dict = pickle.load(f)

    is_coop = is_coop_footage(point_dict, level)

    last_index = len(point_dict) - 1
    runs = [
        transform_run(run, level, is_coop=is_coop, has_next_run=index < last_index)
        for index, run in enumerate(point_dict)
    ]
    runs = [run for run in runs if run is not None]

    if not is_coop:
        runs = merge_into_primary_player(runs, level)

    return runs


def dump_playthroughs(level, play_data_dir):
    # every playthrough recording for one level, keyed by filename stem
    playthroughs = {
        pkl_path.stem: load_runs(pkl_path, level)
        for pkl_path in sorted(play_data_dir.glob("*.pkl"))
    }
    print(json.dumps(playthroughs))
