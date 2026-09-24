---
title: Aviary Action
---

# Two Player Gameplay
```js
import { createMapViewer } from "./components/visualize.js";
import { createLevelConfig } from "./components/level-config.js";
import { WALLY_WARBLES_LEVEL_CONFIG } from "./components/level-config-wally-warbles.js";

// load data (FileAttachment) and provide a file-input fallback in the browser if needed
let aggr_players;

aggr_players = await FileAttachment("./data/agg_coords_wally_warbles.json").json();

const mapUrl = await FileAttachment("./data/resources/wally_warbles_map.jpg").url();
const enemySizesText = await FileAttachment("./data/resources/sprites/wally_warbles/sprite_sizes.txt").text();
const spriteUrls = {
	cup: await FileAttachment("./data/resources/sprites/wally_warbles/cuphead.png").url(),
	mug: await FileAttachment("./data/resources/sprites/wally_warbles/mugman.png").url(),
	cupDeath: await FileAttachment("./data/resources/sprites/wally_warbles/cuphead_ghost.png").url(),
	mugDeath: await FileAttachment("./data/resources/sprites/wally_warbles/mugman_ghost.png").url(),
	wally: await FileAttachment("./data/resources/sprites/wally_warbles/wally.png").url(),
	willy: await FileAttachment("./data/resources/sprites/wally_warbles/willy.png").url(),
	injuredWally: await FileAttachment("./data/resources/sprites/wally_warbles/injured_wally.png").url(),
	nailbird: await FileAttachment("./data/resources/sprites/wally_warbles/nailbird.png").url(),
	junk: await FileAttachment("./data/resources/sprites/wally_warbles/junk.png").url()
};
```

```js
// All playthroughs from data/resources/play_data/wally_warbles/*.pkl, keyed by filename stem
// (see data/run_coords_[level].json.py). Loaded once on page load.
const playthroughsByFile = await FileAttachment("./data/run_coords_wally_warbles.json").json();
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
// No minimap: this level is a single static-camera arena, so there's no wider map to orient
// against.
const runIndex = Number(selectedRun.replace('Run ', '')) - 1;
const currentViewer = await createMapViewer({
	curr_playthrough: [playthroughsByFile[selectedPlaythrough][runIndex]],
	totalRuns: playthroughsByFile[selectedPlaythrough].length,
	mapUrl,
	spriteUrls,
	enemySizesText,
	aggr_players,
	levelConfig: createLevelConfig(WALLY_WARBLES_LEVEL_CONFIG),
	showMinimap: false
});

display(currentViewer);
```
