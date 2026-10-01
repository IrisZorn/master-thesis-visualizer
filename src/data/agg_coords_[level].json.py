import argparse
import json
import pickle

from coords_transform import aggregate_data_path, load_known_enemy_instances
from levels import LEVELS

# Forest Follies and Wally Warbles' aggregate across playthroughs. Framework calls this once per
# level (e.g. requesting data/agg_coords_wally_warbles.json runs it with --level=wally_warbles) --
# the loader itself is level-agnostic and only ever looks a level up by name here.
#
# Everything expensive (re-detecting every aggregated run, clustering the pooled player route,
# binning the enemy heatmap) is precomputed by build_aggregate_data.py into
# resources/aggregate_data/<level>.pkl -- this only reshapes that cache for the viewer. Rerun
# build_aggregate_data.py after new recordings or pipeline changes, then `npm run clean`:
# Framework only invalidates its cache when this file itself changes, not the pkl it reads.


def load_precomputed_enemy_data(level, allowed_types=None):
    # enemies whose real extent can only be known by combining many playthroughs are not
    # aggregated here at all -- build_aggregate_data.py already did that across every recording,
    # so this just reshapes its cache for the viewer. allowed_types restricts this to one stage's
    # own fixed enemy (see build_viewer_aggregate) -- None (the level-wide call) means no restriction.
    known_instances = load_known_enemy_instances(level)

    def allowed(enemy_type):
        return allowed_types is None or enemy_type in allowed_types

    def sorted_instances(enemy_type, axis):
        return sorted(known_instances.get(enemy_type, []), key=lambda instance: instance[axis])

    def path_instances(enemy_type, axis, endpoints):
        return {
            "mode": "full-path-instances",
            "instances": [
                {"id": f"{enemy_type}-{index}", "path": endpoints(instance)}
                for index, instance in enumerate(sorted_instances(enemy_type, axis))
            ],
        }

    data = {}
    for enemy_type in filter(allowed, sorted(level.FIXED_VERTICAL_ENEMIES)):
        data[enemy_type] = path_instances(
            enemy_type, "x", lambda instance: [(instance["x"], instance["y_min"], 0), (instance["x"], instance["y_max"], 1)]
        )

    for enemy_type in filter(allowed, sorted(level.FIXED_HORIZONTAL_ENEMIES)):
        data[enemy_type] = path_instances(
            enemy_type, "y", lambda instance: [(instance["x_min"], instance["y"], 0), (instance["x_max"], instance["y"], 1)]
        )

    for enemy_type in filter(allowed, sorted(level.STATIONARY_ENEMIES)):
        data[enemy_type] = {
            "mode": "stationary",
            "anchors": [
                (instance["x"], instance["y"], index)
                for index, instance in enumerate(sorted_instances(enemy_type, "x"))
            ],
        }

    return data


def build_viewer_aggregate(precomputed, level, stage_index=None):
    # stage_index=None (the level-wide call) leaves "enemies" unfiltered, showing every fixed
    # enemy the level has; a per-stage call restricts it to only the enemy actually active in that
    # stage (see constants_wally_warbles.ENEMY_STAGE_INDEX), instead of repeating e.g. wally's
    # patrol line in every stage's aggregate even though he's only around for stage 1.
    allowed_types = None
    if stage_index is not None:
        enemy_stage_index = getattr(level, "ENEMY_STAGE_INDEX", None)
        if enemy_stage_index:
            allowed_types = {
                enemy_type for enemy_type, index in enemy_stage_index.items() if index == stage_index
            }

    # the pooled route of every player lives under the primary player's type (see
    # build_aggregate_data.build_run_aggregate); the other players' keys stay empty
    aggregated_paths = {player["main"]: [] for player in level.PLAYERS}
    aggregated_paths[level.PLAYERS[0]["main"]] = precomputed["player_path"]
    aggregated_paths["enemies"] = load_precomputed_enemy_data(level, allowed_types)
    aggregated_paths["enemy_density"] = precomputed["enemy_density"]
    return aggregated_paths


def dump_aggregate(level):
    with open(aggregate_data_path(level), "rb") as f:
        precomputed = pickle.load(f)

    aggregated_paths = build_viewer_aggregate(precomputed, level)

    # levels with no STAGES (e.g. Forest Follies) get no "stages" key at all, rather than one
    # holding a single stage -- absence means "this level has nothing to stage-split".
    if "stages" in precomputed:
        aggregated_paths["stages"] = [
            build_viewer_aggregate(stage, level, stage_index=stage_index)
            for stage_index, stage in enumerate(precomputed["stages"])
        ]

    print(json.dumps(aggregated_paths))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--level", required=True, choices=sorted(LEVELS))
    dump_aggregate(LEVELS[parser.parse_args().level])
