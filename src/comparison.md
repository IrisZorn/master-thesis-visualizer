---
title: Gameplay Comparison
---

# Two Player Gameplay
```js
import { createMapViewer } from "./components/visualize.js";

// load data (FileAttachment) and provide a file-input fallback in the browser if needed
let data;

data = await FileAttachment("./data/player_coords.json").json();

const mapUrl = await FileAttachment("./data/resources/forest_follies_stitched.png").url();

// Create and display the viewer. Legend and input UI are owned by the viewer itself.
const currentViewer = await createMapViewer({ data, mapUrl });

// show the viewer
display(currentViewer);

```