from pathlib import Path

import constants_forest_follies
import constants_wally_warbles

# Every level the pipeline knows, by name -- the loaders look a level up here by their --level
# argument, and both build scripts rebuild their caches for every entry. Add a level's constants
# module here once its recordings exist.
LEVELS = {
    "forest_follies": constants_forest_follies,
    "wally_warbles": constants_wally_warbles,
}

RESOURCES_DIR = Path(__file__).parent / "resources"


def play_data_dir(level):
    # every recording of a level: what the viewer lets you pick from, and what the fixed enemies'
    # known instances are built from
    return RESOURCES_DIR / "play_data" / level.LEVEL


def agg_play_data_dir(level):
    # the recordings pooled into a level's aggregate (player route + enemy heatmap)
    return RESOURCES_DIR / "agg_play_data" / level.LEVEL
