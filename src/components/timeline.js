import * as Plot from "npm:@observablehq/plot";

export function timeline(events, {width, height} = {}) {
  const normalizedEvents = (events ?? []).map((event, index) => ({
    y: 0,
    glyph: "dot",
    ...event,
    id: event?.id ?? `${event?.type ?? "event"}-${index}`
  }));

  const defaultedHeight = height ?? 140;
  const typedEvents = normalizedEvents.filter(event => event.type === "hit" || event.type === "death");
  const genericEvents = normalizedEvents.filter(event => !typedEvents.includes(event));

  const markerText = event => {
    if (event.glyph && event.glyph !== "dot") return event.glyph;
    if (event.type === "death") return "✝";
    if (event.type === "hit") return "✦";
    return "●";
  };

  const markerFill = event => {
    if (event.color) return event.color;
    if (event.type === "death") return "#d62828";
    if (event.type === "hit") return "#f59e0b";
    return "currentColor";
  };

  return Plot.plot({
    width,
    height: defaultedHeight,
    marginTop: 30,
    marginBottom: 28,
    x: {nice: true, label: null, tickFormat: ""},
    y: {axis: null},
    marks: [
      Plot.ruleX(genericEvents, {x: "year", y: "y", markerEnd: "dot", strokeWidth: 2.5}),
      Plot.ruleX(typedEvents, {x: "year", y: "y", strokeWidth: 2.5, stroke: markerFill}),
      Plot.text(typedEvents, {
        x: "year",
        y: "y",
        text: markerText,
        fill: markerFill,
        stroke: "white",
        strokeWidth: 2,
        paintOrder: "stroke",
        fontSize: 16,
        dy: 0,
        lineAnchor: "middle"
      }),
      Plot.ruleY([0]),
      Plot.text(normalizedEvents, {x: "year", y: "y", text: "name", lineAnchor: "bottom", dy: -10, lineWidth: 10, fontSize: 12})
    ]
  });
}
