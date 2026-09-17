---
title: Forest Follies
---

# Two Player Gameplay
```js
import { createMapViewer } from "./components/visualize.js";
import { createLevelConfig } from "./components/level-config.js";
import { FOREST_FOLLIES_LEVEL_CONFIG } from "./components/level-config-forest-follies.js";

// load data (FileAttachment) and provide a file-input fallback in the browser if needed
let aggr_players;

aggr_players = await FileAttachment("./data/agg_coords_forest_follies.json").json();

const mapUrl = await FileAttachment("./data/resources/forest_follies_stitched.png").url();
const enemySizesText = await FileAttachment("./data/resources/sprites/forest_follies/sprite_sizes.txt").text();
const spriteUrls = {
	cup: await FileAttachment("./data/resources/sprites/forest_follies/cuphead.png").url(),
	mug: await FileAttachment("./data/resources/sprites/forest_follies/mugman.png").url(),
	cupDeath: await FileAttachment("./data/resources/sprites/forest_follies/cuphead_ghost.png").url(),
	mugDeath: await FileAttachment("./data/resources/sprites/forest_follies/mugman_ghost.png").url(),
	cupHit: await FileAttachment("./data/resources/sprites/forest_follies/cuphead_hit.png").url(),
	mugHit: await FileAttachment("./data/resources/sprites/forest_follies/mugman_hit.png").url(),
	shroom: await FileAttachment("./data/resources/sprites/forest_follies/shroom.png").url(),
	spikyBulb: await FileAttachment("./data/resources/sprites/forest_follies/spiky_bulb.png").url(),
	toothy: await FileAttachment("./data/resources/sprites/forest_follies/toothy.png").url(),
	tulip: await FileAttachment("./data/resources/sprites/forest_follies/tulip.png").url(),
	daisy: await FileAttachment("./data/resources/sprites/forest_follies/daisy.png").url(),
	blueberry: await FileAttachment("./data/resources/sprites/forest_follies/blueberry.png").url(),
	acorn: await FileAttachment("./data/resources/sprites/forest_follies/acorn.png").url(),
	acornMachine: await FileAttachment("./data/resources/sprites/forest_follies/acorn_machine.png").url()
};
```

```js
// All playthroughs from data/resources/play_data/*.pkl, keyed by filename stem
// (see data/run_coords_[level].json.py). Loaded once on page load.
const playthroughsByFile = await FileAttachment("./data/run_coords_forest_follies.json").json();
const playthroughNames = Object.keys(playthroughsByFile);

const playthroughSelect = Inputs.select(playthroughNames, {label: "Select Playthrough", value: playthroughNames[0]});
display(playthroughSelect);

const selectedPlaythrough = Generators.input(playthroughSelect);
```

```js
// Runs within the selected playthrough. Recreated (and reset to "Run 1") whenever
// selectedPlaythrough changes, since different playthroughs have different run counts.
const runOptions = playthroughsByFile[selectedPlaythrough].map((_, i) => `Run ${i + 1}`);
const runSelect = Inputs.select(runOptions, {label: "Select Run", value: runOptions[0]});
display(runSelect);

const selectedRun = Generators.input(runSelect);
```

```js
// Create and display the viewer for the selected playthrough/run. Legend and input UI
// are owned by the viewer itself. Reruns whenever selectedPlaythrough or selectedRun changes.
const runIndex = Number(selectedRun.replace('Run ', '')) - 1;
const currentViewer = await createMapViewer({
	curr_playthrough: [playthroughsByFile[selectedPlaythrough][runIndex]],
	mapUrl,
	spriteUrls,
	enemySizesText,
	aggr_players,
	levelConfig: createLevelConfig(FOREST_FOLLIES_LEVEL_CONFIG)
});

display(currentViewer);
```