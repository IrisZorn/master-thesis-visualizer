# Cuphead Gameplay Visualizations

An [Observable Framework](https://observablehq.com/framework/) app that visualizes recorded Cuphead
playthroughs of two levels, **Forest Follies** and **Aviary Action** (Wally Warbles). Each run can be
scrubbed through on the level map: player trails, deaths and hits, enemy paths, bullet directions,
an aggregated route across all playthroughs and an enemy-density heatmap.

The positions come from YOLO detections on gameplay videos. Python data loaders turn those detections
into the JSON the pages load; all of that happens at build time, so the result is a static site.

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer
- [Python](https://www.python.org/) 3.9 or newer, with numpy

## Setup

```sh
npm install
python -m venv .venv
```

Activate the virtual environment and install the Python dependencies:

```sh
# Windows (PowerShell)
.venv\Scripts\Activate.ps1
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
```

## Running locally

With the virtual environment **activated**, start the preview server:

```sh
npm run dev
```

Then open <http://localhost:3000>.

The data loaders are run by Framework as `python3`. Activating the venv makes sure that resolves to the
Python with numpy installed. On Windows, without it, `python3` may instead be the Microsoft Store
placeholder, and the pages fail to load their data.

## Updating the data

The recordings are pickled detection data (`.pkl`), one file per gameplay video:

| Folder | Contents |
|---|---|
| `src/data/resources/play_data/<level>/` | every recording; each one can be selected on its level's page |
| `src/data/resources/agg_play_data/<level>/` | the recordings pooled into the aggregated route and enemy heatmap |

Expensive steps are precomputed into caches next to them (`enemy_full_paths/`, `aggregate_data/`,
`precalc_bullet_paths/`). After adding or changing recordings, or changing the pipeline, rebuild them
**in this order**, since the second script reads what the first one writes:

```sh
cd src/data
python build_aggregate_data.py   # known enemy instances, aggregated route, enemy heatmap
python build_bullet_paths.py     # bullet paths per run (the slow one, ~10 minutes)
cd ../..
npm run clean
```

`npm run clean` is needed because Framework only reruns a data loader when the loader file itself
changes, not when the `.pkl` files it reads do.

To add a level, add its `constants_<level>.py` to `src/data/levels.py`, plus a
`src/components/level-config-<level>.js` and a page in `src/` (see the existing two).

## Building

```sh
npm run build
```

writes the static site to `dist/`, which can be hosted on any static web host.

## Project structure

```ini
.
├─ src
│  ├─ index.md                  # home page, links to the levels
│  ├─ forest_follies.md         # level pages
│  ├─ wally_warbles.md
│  ├─ components                # the viewer (JavaScript)
│  │  ├─ visualize.js           # map viewer: rendering, camera, timeline, legend, stats
│  │  ├─ viewer-*.js            # enemies, bullets, heatmap, controls, helpers
│  │  └─ level-config-*.js      # per-level type codes and enemy behaviour
│  └─ data
│     ├─ run_coords_[level].json.py   # loader: per-run coordinates
│     ├─ agg_coords_[level].json.py   # loader: aggregate across playthroughs
│     ├─ build_*.py                   # cache builders (see "Updating the data")
│     ├─ coords_transform.py          # detection cleaning and track reconstruction
│     ├─ constants_<level>.py         # per-level type codes and enemy categories
│     ├─ levels.py                    # registry of all levels
│     └─ resources                    # recordings, caches, maps and sprites
├─ observablehq.config.js
├─ package.json
└─ requirements.txt
```
