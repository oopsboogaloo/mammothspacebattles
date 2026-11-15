"use strict";

const $ = (id) => document.getElementById(id);
const svgNS = "http://www.w3.org/2000/svg";
const player = new URLSearchParams(location.search).get("view") === "player";
const progressKey = "mammoth-space-battles.tech-tree.progress.v1";
const labels = { locked: "Locked", available: "Available", completed: "Completed", pending: "Recipe pending" };
const glyphs = {
  pick: "M5 20L15 9M9 4c5-2 9 1 11 6M12 5l7 7",
  blocks: "M3 10h8v9H3zM13 10h8v9h-8zM8 3h8v7H8z",
  tool: "M14 3a5 5 0 0 0-5 7l-5 6a2 2 0 0 0 3 3l6-5a5 5 0 0 0 7-5l-3 2-3-3 2-3z",
  flask: "M9 3h6M10 3v7l-5 8a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-8V3M8 15h8",
  grid: "M4 4h16v16H4zM4 10h16M10 4v16M13 15h4",
  plan: "M5 3h14v18H5zM8 15l7-7M8 15h7M15 15V8",
  rocket: "M9 15l-2-2c2-6 6-9 13-9 0 7-3 11-9 13zM7 13H4l3-4h3M11 17v3l4-3v-3M7 17l-3 3M15 9h.1",
  orbit: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM4 18c-2-2 1-5 5-8s9-5 11-3-1 5-5 8-9 5-11 3z",
  moon: "M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11z",
  star: "M12 3l2 7 7 2-7 2-2 7-2-7-7-2 7-2z",
};

function el(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

function svg(tag, attributes = {}) {
  const element = document.createElementNS(svgNS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

function glyph(name) {
  const element = svg("svg", { class: "glyph", viewBox: "0 0 24 24", "aria-hidden": "true" });
  element.append(svg("path", { d: glyphs[name] ?? glyphs.star }));
  return element;
}

function createModel(data) {
  if (!Array.isArray(data?.phases) || !data.phases.every((phase) => typeof phase === "string" && phase.trim()) ||
      !Array.isArray(data.nodes) || !data.nodes.length || !Array.isArray(data.edges) ||
      !Array.isArray(data.firstAcquisition) || !Array.isArray(data.conversions) ||
      !Array.isArray(data.loop) || !data.loop.every((step) => typeof step === "string" && step.trim()) ||
      !Array.isArray(data.opening) || !data.opening.every((note) => typeof note === "string" && note.trim())) {
    throw new Error("Expected phases, nodes, edges, firstAcquisition, conversions, opening and loop arrays in tech-tree.js, with at least one node.");
  }
  const operations = data.operations ?? [];
  if (!Array.isArray(operations)) throw new Error("Expected an operations array in tech-tree.js.");
  const byId = new Map();
  const columns = [];
  const phases = data.phases;
  for (const node of data.nodes) {
    if (!node || !/^[a-z][a-z0-9-]*$/.test(node.id ?? "") || typeof node.title !== "string" || !node.title.trim() ||
        typeof node.description !== "string" || !Number.isInteger(node.phase) || !phases[node.phase] ||
        (node.minColumn !== undefined && (!Number.isSafeInteger(node.minColumn) || node.minColumn < 0))) {
      throw new Error("Invalid node: " + (node?.id ?? "(missing ID)"));
    }
    if (byId.has(node.id)) throw new Error("Duplicate node: " + node.id);
    byId.set(node.id, { ...node, requires: [], unlocks: [], acquisition: [], conversions: [], operations: [] });
  }
  const acquisitionEdges = new Map();
  for (const edge of [...data.edges, ...data.firstAcquisition]) {
    if (!Array.isArray(edge) || edge.length !== 2 || !edge.every((id) => byId.has(id))) {
      throw new Error("Invalid prerequisite edge: " + JSON.stringify(edge));
    }
    const [from, to] = edge.map((id) => byId.get(id));
    if (from.unlocks.includes(to)) throw new Error("Duplicate prerequisite edge: " + from.id + " → " + to.id);
    if (data.firstAcquisition.includes(edge)) {
      to.acquisition.push(from);
      if (!acquisitionEdges.has(from)) acquisitionEdges.set(from, new Set());
      acquisitionEdges.get(from).add(to);
    }
    from.unlocks.push(to);
    to.requires.push(from);
  }
  for (const node of byId.values()) {
    if (node.starting && node.requires.length) throw new Error("Starting unlock has prerequisites: " + node.id);
  }
  for (const [field, relationships] of [["conversions", data.conversions], ["operations", operations]]) {
    for (const relation of relationships) {
      if (!Array.isArray(relation) || relation.length !== 3 || !byId.has(relation[0]) || !byId.has(relation[1]) ||
          relation[0] === relation[1] || typeof relation[2] !== "string" || !relation[2].trim()) {
        throw new Error("Invalid entry in " + field + ": " + JSON.stringify(relation));
      }
      const [from, to, label] = relation;
      byId.get(from)[field].push(label);
      byId.get(to)[field].push(label);
    }
  }
  const pending = new Map([...byId.values()].map((node) => [node, node.requires.length]));
  const ordered = [...pending.keys()].filter((node) => pending.get(node) === 0);
  for (const node of ordered) {
    node.depth = Math.max(node.minColumn ?? 0, ...node.requires.map((item) => item.depth + 1));
    while (columns.length <= node.depth) columns.push([]);
    columns[node.depth].push(node);
    for (const next of node.unlocks) {
      const remaining = pending.get(next) - 1;
      pending.set(next, remaining);
      if (!remaining) ordered.push(next);
    }
  }
  if (ordered.length !== byId.size) throw new Error("The prerequisite graph contains a cycle.");
  return { byId, columns, ordered, phases, acquisitionEdges, loop: data.loop, opening: data.opening };
}

function normalizeProgress(ordered, saved) {
  const valid = new Set();
  for (const node of ordered) {
    if (!node.pending && (node.starting || (saved.has(node.id) && node.requires.every((item) => valid.has(item.id))))) valid.add(node.id);
  }
  return valid;
}

function readProgress(ordered) {
  try {
    const saved = JSON.parse(localStorage.getItem(progressKey));
    return normalizeProgress(ordered, new Set(Array.isArray(saved) ? saved : []));
  } catch {
    return normalizeProgress(ordered, new Set());
  }
}

function mount(model) {
  let selected = model.ordered[0];
  let completed = player ? readProgress(model.ordered) : new Set();
  let fitted = false;
  const graph = $("graph");
  const viewport = $("viewport");
  const extent = $("extent");
  const cardWidth = 150, cardHeight = 80, columnGap = 37, rowGap = 28, padding = 24;
  const width = padding * 2 + model.columns.length * (cardWidth + columnGap) - columnGap;
  const rows = Math.max(...model.columns.map((column) => column.length));
  const height = Math.max(306, 114 + rows * (cardHeight + rowGap));
  const edgeLayer = svg("svg", { class: "edges", width, height, "aria-hidden": "true" });
  const cards = new Map();
  const position = new Map();
  const lines = [];

  $("design-mode").toggleAttribute("aria-current", !player);
  $("player-mode").toggleAttribute("aria-current", player);
  $(player ? "player-mode" : "design-mode").setAttribute("aria-current", "page");
  $("subtitle").textContent = player ? "Explore unlocks and track your progress." : "Inspect the progression from your starting moon to off-moon expeditions.";
  $("draft").hidden = player;
  $("repeat").hidden = player || !model.loop.length;
  $("foot-detail").textContent = player ? "Player preview" : "Progression prototype";
  $("opening").hidden = player || !model.opening.length;
  for (const note of model.opening) $("opening-notes").append(el("p", "", note));
  for (const [index, step] of model.loop.entries()) {
    const item = el("li");
    const arrow = el("i", "", index === model.loop.length - 1 ? "↻" : "→");
    arrow.setAttribute("aria-hidden", "true");
    item.append(el("span", "", step), arrow);
    $("loop").append(item);
  }

  for (const [className, label] of [["", "Prerequisite path"], ["incoming", "Requires"], ["outgoing", "Unlocks"], ["acquisition", "First acquisition"]]) {
    const item = el("span");
    item.append(el("i", className), document.createTextNode(label));
    $("legend").append(item);
  }

  graph.style.width = width + "px";
  graph.style.height = height + "px";
  graph.append(edgeLayer);

  let stageStart = 0;
  const commonPhase = (column) => {
    if (!column.length) return "";
    return column.every((node) => node.phase === column[0].phase) ? model.phases[column[0].phase] : "Multiple phases";
  };
  while (stageStart < model.columns.length) {
    const label = commonPhase(model.columns[stageStart]);
    let end = stageStart + 1;
    while (end < model.columns.length && commonPhase(model.columns[end]) === label) end++;
    const heading = el("div", "stage", label);
    heading.style.left = (padding + stageStart * (cardWidth + columnGap)) + "px";
    heading.style.width = ((end - stageStart) * (cardWidth + columnGap) - columnGap) + "px";
    if (label) graph.append(heading);
    stageStart = end;
  }

  function status(node) {
    if (node.pending) return "pending";
    if (completed.has(node.id)) return "completed";
    return node.requires.every((item) => completed.has(item.id)) ? "available" : "locked";
  }

  for (const column of model.columns) {
    column.forEach((node, row) => {
      const x = padding + node.depth * (cardWidth + columnGap);
      const y = (height + 42 - cardHeight) / 2 + (row - (column.length - 1) / 2) * (cardHeight + rowGap);
      position.set(node, { x, y });
      const card = el("button", "node");
      card.type = "button";
      card.dataset.node = node.id;
      card.title = node.title;
      Object.assign(card.style, { left: x + "px", top: y + "px", width: cardWidth + "px", height: cardHeight + "px" });
      const caption = el("small");
      card.append(glyph(node.icon), el("strong", "", node.title), caption);
      card.addEventListener("click", () => select(node));
      graph.append(card);
      cards.set(node, { card, caption });
    });
  }

  for (const from of model.ordered) {
    const start = position.get(from);
    for (const to of from.unlocks) {
      const end = position.get(to);
      const x = start.x + cardWidth, y = start.y + cardHeight / 2;
      const tx = end.x - 2, ty = end.y + cardHeight / 2;
      const inset = 13;
      const d = to.depth === from.depth + 1
        ? "M " + x + " " + y + " C " + (x + inset) + " " + y + " " + (tx - inset) + " " + ty + " " + (tx - 5) + " " + ty
        : "M " + x + " " + y + " H " + (x + inset) + " V " + (height - 12) + " H " + (tx - inset) + " V " + ty + " H " + (tx - 5);
      const line = svg("path", { d, class: model.acquisitionEdges.get(from)?.has(to) ? "edge acquisition" : "edge" });
      const tip = svg("path", { d: "M " + tx + " " + ty + " l -6 -3 v 6 z", class: "edge-tip" });
      edgeLayer.append(line, tip);
      lines.push({ from, to, line, tip });
    }
  }

  function showCard(node) {
    const { card } = cards.get(node);
    const { x, y } = position.get(node);
    const scale = fitted ? Math.min(1, viewport.clientWidth / width) : 1;
    if (x * scale < viewport.scrollLeft || (x + cardWidth) * scale > viewport.scrollLeft + viewport.clientWidth) {
      viewport.scrollLeft = (x + cardWidth / 2) * scale - viewport.clientWidth / 2;
    }
    if (y * scale < viewport.scrollTop || (y + cardHeight) * scale > viewport.scrollTop + viewport.clientHeight) {
      viewport.scrollTop = (y + cardHeight / 2) * scale - viewport.clientHeight / 2;
    }
    card.focus({ preventScroll: true });
  }

  function detailGroup(label, nodes, empty) {
    const group = el("section", "detail-group");
    group.append(el("h3", "", label));
    const links = el("div", "detail-links");
    if (!nodes.length) links.append(el("p", "", empty));
    for (const node of nodes) {
      const button = el("button", "", node.title);
      button.type = "button";
      button.addEventListener("click", () => select(node, true));
      links.append(button);
    }
    group.append(links);
    return group;
  }

  function renderSelection() {
    for (const [node, { card, caption }] of cards) {
      const state = player || node.pending ? status(node) : "";
      card.className = ["node", state, selected.requires.includes(node) ? "related" : ""].filter(Boolean).join(" ");
      card.setAttribute("aria-pressed", String(node === selected));
      caption.textContent = node.pending ? labels.pending : player ? (node.starting ? "From start" : labels[state]) : model.phases[node.phase];
    }
    for (const { from, to, line, tip } of lines) {
      for (const mark of [line, tip]) {
        mark.classList.toggle("active", to === selected);
        mark.classList.toggle("related", from === selected);
        if (to === selected || from === selected) edgeLayer.append(mark);
      }
    }
    const node = selected;
    const icon = el("div", "detail-icon");
    icon.append(glyph(node.icon));
    const details = $("details");
    details.replaceChildren(icon, el("h2", "", node.title));
    const state = status(node);
    if (player) details.append(el("span", "status " + state, node.starting ? "Available from start" : labels[state]));
    details.append(el("p", "", node.description));
    if (node.pending) details.append(el("p", "pending-note", node.pending));
    if (node.acquisition.length) details.append(detailGroup("First acquisition", node.acquisition));
    const prerequisites = node.requires.filter((item) => !node.acquisition.includes(item));
    if (!node.acquisition.length || prerequisites.length) {
      details.append(detailGroup("Requires", prerequisites, "No prerequisites"));
    }
    details.append(detailGroup("Unlocks", node.unlocks, "No further unlocks"));
    for (const [heading, lines] of [["Conversions", node.conversions], ["Operating relationships", node.operations]]) {
      if (!lines.length) continue;
      const section = el("section", "detail-group");
      section.append(el("h3", "", heading));
      for (const line of lines) section.append(el("p", "", line));
      details.append(section);
    }
    if (!player && node.notes) {
      const notes = el("section", "detail-group");
      notes.append(el("h3", "", "Design notes"), el("p", "", node.notes));
      details.append(notes);
    }
    if (player && !node.starting && (state === "available" || state === "completed")) {
      const action = el("button", "progress-action", state === "completed" ? "Undo completion" : "Mark complete");
      action.type = "button";
      const nextCount = completed.size;
      if (state === "completed") {
        const remaining = new Set(completed);
        remaining.delete(node.id);
        const removed = nextCount - normalizeProgress(model.ordered, remaining).size - 1;
        if (removed) details.append(el("p", "", "Undo also clears " + removed + " dependent " + (removed === 1 ? "unlock." : "unlocks.")));
      }
      action.addEventListener("click", () => {
        if (completed.has(node.id)) completed.delete(node.id);
        else completed.add(node.id);
        completed = normalizeProgress(model.ordered, completed);
        try {
          localStorage.setItem(progressKey, JSON.stringify([...completed]));
        } catch {
          $("foot-detail").textContent = "Progress saved for this visit only";
        }
        renderSelection();
        details.querySelector(".progress-action")?.focus();
      });
      details.append(action);
    }
  }

  function select(node, reveal = false) {
    selected = node;
    renderSelection();
    if (reveal) showCard(node);
  }

  function resize() {
    const scale = fitted ? Math.min(1, viewport.clientWidth / width) : 1;
    graph.style.transform = "scale(" + scale + ")";
    extent.style.width = Math.min(width, fitted ? viewport.clientWidth : width) + "px";
    extent.style.height = Math.ceil(height * scale) + "px";
    $("fit").hidden = width <= viewport.clientWidth;
    $("fit").setAttribute("aria-pressed", String(fitted));
    $("fit").textContent = fitted ? "Actual size" : "Fit map";
    $("map-hint").textContent = !fitted && width > viewport.clientWidth
      ? "Select an unlock for details. Scroll sideways to explore."
      : "Select an unlock to inspect its prerequisites.";
  }

  $("fit").addEventListener("click", () => {
    fitted = !fitted;
    resize();
    if (!fitted) {
      const { x } = position.get(selected);
      viewport.scrollLeft = Math.max(0, x - padding);
    }
  });
  new ResizeObserver(resize).observe(viewport);
  renderSelection();
  resize();
}

try {
  mount(createModel(window.TECH_TREE));
} catch (error) {
  const message = $("error");
  message.textContent = "Unable to load the tech tree. " + error.message;
  message.hidden = false;
  $("workspace").hidden = true;
  $("repeat").hidden = true;
  $("opening").hidden = true;
}
