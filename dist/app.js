(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const els = {
    grid: $("#grid"),
    stage: $("#gridStage"),
    viewport: $("#gridViewport"),
    overlay: $("#pathOverlay"),
    halo: $("#pathHalo"),
    line: $("#pathLine"),
    rows: $("#rowInput"),
    cols: $("#colInput"),
    letter: $("#letterSelect"),
    keyTool: $("#keyToolGlyph"),
    lockTool: $("#lockToolGlyph"),
    run: $("#runButton"),
    runIcon: $("#runIcon"),
    status: $("#statusMessage"),
    toast: $("#toast"),
  };

  const sample = [
    "............",
    ".@...#....f.",
    ".###.#.####.",
    ".a...#...F..",
    ".###.###.#..",
    ".b.B.....#..",
    ".#####.###..",
    "............",
  ];
  const directions = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  const baseCellSize = 44;

  let rows = sample.length;
  let cols = sample[0].length;
  let cells = sample.map((line) => [...line]);
  let selectedTool = "pan";
  let isPainting = false;
  let isPanning = false;
  let spaceHeld = false;
  let panOrigin = null;
  let solveToken = 0;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let lastPath = null;
  let lastResult = null;
  let toastTimer;

  const keyIcon = () => `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="7.5" cy="15.5" r="4.5"></circle>
      <path d="M10.7 12.3 21 2"></path>
      <path d="m15.5 7.5 2.8 2.8"></path>
      <path d="m18.2 4.8 2.8 2.8"></path>
    </svg>`;
  const lockIcon = () => `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="10" width="16" height="11" rx="2.4"></rect>
      <path d="M8 10V7a4 4 0 0 1 8 0v3"></path>
      <circle cx="12" cy="15.5" r="1.1"></circle>
      <path d="M12 16.6V19"></path>
    </svg>`;

  for (let code = 65; code <= 90; code += 1) {
    const option = document.createElement("option");
    option.value = String.fromCharCode(code).toLowerCase();
    option.textContent = String.fromCharCode(code);
    els.letter.append(option);
  }

  function colorForLetter(letter) {
    const index = letter.toLowerCase().charCodeAt(0) - 97;
    const hue = (24 + index * 47) % 360;
    return `hsl(${hue} 70% 48%)`;
  }

  function updateLetterTools() {
    const color = colorForLetter(els.letter.value);
    els.keyTool.innerHTML = keyIcon();
    els.lockTool.innerHTML = lockIcon();
    els.keyTool.style.color = color;
    els.lockTool.style.color = color;
  }

  function blankGrid(nextRows, nextCols) {
    return Array.from({ length: nextRows }, () => Array(nextCols).fill("."));
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("show");
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2200);
  }

  function classFor(value) {
    if (value === "#") return "wall";
    if (value === "@") return "start";
    if (/[a-z]/.test(value)) return "key";
    if (/[A-Z]/.test(value)) return "lock";
    return "floor";
  }

  function labelFor(value, r, c) {
    const location = `row ${r + 1}, column ${c + 1}`;
    if (value === "#") return `Wall at ${location}`;
    if (value === "@") return `Start at ${location}`;
    if (/[a-z]/.test(value)) return `Key ${value.toUpperCase()} at ${location}`;
    if (/[A-Z]/.test(value)) return `Lock ${value} at ${location}`;
    return `Empty cell at ${location}`;
  }

  function tileMarkup(value) {
    if (value === "#" || value === "@") return value;
    if (!/[a-zA-Z]/.test(value)) return "";
    const icon = /[a-z]/.test(value) ? keyIcon() : lockIcon();
    return `${icon}<span class="tile-letter">${value}</span>`;
  }

  function renderGrid() {
    els.grid.replaceChildren();
    els.grid.style.setProperty("--rows", rows);
    els.grid.style.setProperty("--cols", cols);
    const fragment = document.createDocumentFragment();
    cells.forEach((line, r) => line.forEach((value, c) => {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = `cell ${classFor(value)}`;
      cell.dataset.row = r;
      cell.dataset.col = c;
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-label", labelFor(value, r, c));
      const glyph = document.createElement("span");
      glyph.className = "tile-glyph";
      glyph.innerHTML = tileMarkup(value);
      if (/[a-zA-Z]/.test(value)) glyph.style.setProperty("--tile-color", colorForLetter(value));
      cell.append(glyph);
      fragment.append(cell);
    }));
    els.grid.append(fragment);
    clearPath();
  }

  function updateTransform() {
    els.stage.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  }

  function centerGrid() {
    panX = (els.viewport.clientWidth - cols * baseCellSize * zoom) / 2;
    panY = (els.viewport.clientHeight - rows * baseCellSize * zoom) / 2;
    updateTransform();
  }

  function resetResult(status = "Ready") {
    solveToken += 1;
    lastResult = null;
    els.run.classList.remove("running");
    els.runIcon.textContent = "▶";
    els.run.setAttribute("aria-label", "Run breadth-first search");
    els.status.textContent = status;
  }

  function clearPath() {
    lastPath = null;
    [els.halo, els.line].forEach((line) => {
      line.classList.remove("animate");
      line.setAttribute("points", "");
    });
  }

  function setTool(tool) {
    selectedTool = tool;
    $$(".tool").forEach((button) => {
      const active = button.dataset.tool === tool;
      button.classList.toggle("active", active);
      button.setAttribute("aria-checked", String(active));
    });
  }

  function valueForTool() {
    if (selectedTool === "wall") return "#";
    if (selectedTool === "start") return "@";
    if (selectedTool === "key") return els.letter.value;
    if (selectedTool === "lock") return els.letter.value.toUpperCase();
    return ".";
  }

  function paintCell(r, c) {
    if (selectedTool === "pan" || spaceHeld || isPanning) return;
    const value = valueForTool();
    if (value === "@") {
      cells.forEach((line, row) => line.forEach((cell, col) => {
        if (cell === "@") cells[row][col] = ".";
      }));
    }
    cells[r][c] = value;
    renderGrid();
    resetResult("Grid updated");
  }

  function applyGridSize() {
    const nextRows = Math.max(3, Math.min(30, Number(els.rows.value) || rows));
    const nextCols = Math.max(3, Math.min(30, Number(els.cols.value) || cols));
    const next = blankGrid(nextRows, nextCols);
    for (let r = 0; r < Math.min(rows, nextRows); r += 1) {
      for (let c = 0; c < Math.min(cols, nextCols); c += 1) next[r][c] = cells[r][c];
    }
    rows = nextRows;
    cols = nextCols;
    cells = next;
    els.rows.value = rows;
    els.cols.value = cols;
    renderGrid();
    resetResult("Grid resized");
    centerGrid();
  }

  function keyBit(letter) {
    return 1n << BigInt(letter.toLowerCase().charCodeAt(0) - 97);
  }

  function stateId(r, c, mask) {
    return `${r},${c},${mask.toString(36)}`;
  }

  function parseState(id) {
    const [r, c] = id.split(",");
    return [Number(r), Number(c)];
  }

  function validateGrid() {
    let start = null;
    let starts = 0;
    const keys = new Set();
    cells.forEach((line, r) => line.forEach((value, c) => {
      if (value === "@") { start = [r, c]; starts += 1; }
      if (/[a-z]/.test(value)) keys.add(value);
    }));
    if (starts !== 1) return { error: "Place one start point." };
    if (!keys.size) return { error: "Place at least one key." };
    return { start, keys };
  }

  function frame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
  }

  async function solve() {
    if (els.run.classList.contains("running")) {
      solveToken += 1;
      resetResult("Stopped");
      return;
    }
    const validation = validateGrid();
    if (validation.error) { showToast(validation.error); return; }

    clearPath();
    const token = ++solveToken;
    let allKeys = 0n;
    validation.keys.forEach((key) => { allKeys |= keyBit(key); });
    const [startR, startC] = validation.start;
    const start = stateId(startR, startC, 0n);
    const queue = [{ r: startR, c: startC, mask: 0n, steps: 0, id: start }];
    const visited = new Set([start]);
    const previous = new Map();
    let head = 0;
    let goal = null;

    els.run.classList.add("running");
    els.runIcon.textContent = "■";
    els.run.setAttribute("aria-label", "Stop search");
    els.status.textContent = "Searching";

    while (head < queue.length && token === solveToken) {
      const current = queue[head++];
      if (current.mask === allKeys) { goal = current; break; }
      for (const [dr, dc] of directions) {
        const nr = current.r + dr;
        const nc = current.c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const cell = cells[nr][nc];
        if (cell === "#") continue;
        if (/[A-Z]/.test(cell) && (current.mask & keyBit(cell)) === 0n) continue;
        let mask = current.mask;
        if (/[a-z]/.test(cell)) mask |= keyBit(cell);
        const id = stateId(nr, nc, mask);
        if (visited.has(id)) continue;
        visited.add(id);
        previous.set(id, current.id);
        queue.push({ r: nr, c: nc, mask, steps: current.steps + 1, id });
      }
      if (visited.size >= 1_000_000) break;
      if (head % 4000 === 0) await frame();
    }

    if (token !== solveToken) return;
    els.run.classList.remove("running");
    els.runIcon.textContent = "↻";
    els.run.setAttribute("aria-label", "Run again");

    if (!goal) {
      lastResult = { minimumSteps: -1, statesSeen: visited.size };
      els.status.textContent = visited.size >= 1_000_000 ? "State limit reached" : "No route";
      return;
    }

    const ids = [];
    let cursor = goal.id;
    while (cursor) {
      ids.push(cursor);
      cursor = previous.get(cursor);
    }
    ids.reverse();
    lastResult = { minimumSteps: goal.steps, statesSeen: visited.size };
    els.status.textContent = `${goal.steps} steps, ${visited.size} states`;
    animatePath(ids.map(parseState));
  }

  function drawPath(path, animate) {
    els.overlay.setAttribute("width", cols * baseCellSize);
    els.overlay.setAttribute("height", rows * baseCellSize);
    els.overlay.setAttribute("viewBox", `0 0 ${cols * baseCellSize} ${rows * baseCellSize}`);
    const points = path.map(([r, c]) => `${c * baseCellSize + baseCellSize / 2},${r * baseCellSize + baseCellSize / 2}`).join(" ");
    [els.halo, els.line].forEach((line) => {
      line.classList.remove("animate");
      line.setAttribute("points", points);
    });
    const length = els.line.getTotalLength();
    const duration = `${Math.min(4, Math.max(.9, path.length * .052))}s`;
    [els.halo, els.line].forEach((line) => {
      line.style.setProperty("--path-length", length);
      line.style.setProperty("--path-duration", duration);
      line.style.strokeDasharray = length;
      line.style.strokeDashoffset = animate ? length : 0;
    });
    if (animate) {
      void els.line.getBoundingClientRect();
      els.halo.classList.add("animate");
      els.line.classList.add("animate");
    }
  }

  function animatePath(path) {
    lastPath = path;
    drawPath(path, true);
  }

  function setZoom(nextZoom, event) {
    const oldZoom = zoom;
    zoom = Math.max(.2, Math.min(4, nextZoom));
    if (oldZoom === zoom) return;
    const rect = els.viewport.getBoundingClientRect();
    const pointerX = event ? event.clientX - rect.left : rect.width / 2;
    const pointerY = event ? event.clientY - rect.top : rect.height / 2;
    const worldX = (pointerX - panX) / oldZoom;
    const worldY = (pointerY - panY) / oldZoom;
    panX = pointerX - worldX * zoom;
    panY = pointerY - worldY * zoom;
    updateTransform();
    if (lastPath) drawPath(lastPath, false);
  }

  function startPan(event) {
    event.preventDefault();
    isPanning = true;
    panOrigin = { x: event.clientX, y: event.clientY, panX, panY };
    els.viewport.classList.add("is-panning");
    els.viewport.setPointerCapture(event.pointerId);
  }

  $$(".tool").forEach((button) => button.addEventListener("click", () => setTool(button.dataset.tool)));
  $("#applySize").addEventListener("click", applyGridSize);
  els.letter.addEventListener("change", updateLetterTools);
  els.run.addEventListener("click", solve);

  els.grid.addEventListener("pointerdown", (event) => {
    const cell = event.target.closest(".cell");
    if (!cell || selectedTool === "pan" || spaceHeld || event.button !== 0) return;
    isPainting = true;
    paintCell(Number(cell.dataset.row), Number(cell.dataset.col));
  });
  els.grid.addEventListener("pointerover", (event) => {
    const cell = event.target.closest(".cell");
    if (!cell || !isPainting || !["wall", "erase"].includes(selectedTool)) return;
    paintCell(Number(cell.dataset.row), Number(cell.dataset.col));
  });
  els.viewport.addEventListener("pointerdown", (event) => {
    if (selectedTool === "pan" || spaceHeld || event.button === 1) startPan(event);
  });
  els.viewport.addEventListener("pointermove", (event) => {
    if (!isPanning || !panOrigin) return;
    panX = panOrigin.panX + event.clientX - panOrigin.x;
    panY = panOrigin.panY + event.clientY - panOrigin.y;
    updateTransform();
  });
  els.viewport.addEventListener("wheel", (event) => {
    event.preventDefault();
    setZoom(zoom * Math.exp(-event.deltaY * .0015), event);
  }, { passive: false });
  window.addEventListener("pointerup", () => {
    isPainting = false;
    isPanning = false;
    panOrigin = null;
    els.viewport.classList.remove("is-panning");
  });
  window.addEventListener("keydown", (event) => {
    if (["INPUT", "SELECT"].includes(document.activeElement.tagName)) return;
    if (event.code === "Space") {
      event.preventDefault();
      spaceHeld = true;
      return;
    }
    const tools = { p: "pan", w: "wall", e: "erase", s: "start", k: "key", l: "lock" };
    if (tools[event.key.toLowerCase()]) setTool(tools[event.key.toLowerCase()]);
  });
  window.addEventListener("keyup", (event) => {
    if (event.code === "Space") spaceHeld = false;
  });

  function registerWebMCP() {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const tools = [
      {
        name: "configure_key_maze",
        title: "Configure key maze",
        description: "Replace the visible maze with equal-length rows using . # @ a-z and A-Z.",
        inputSchema: { type: "object", properties: { grid: { type: "array", minItems: 3, maxItems: 30, items: { type: "string", minLength: 3, maxLength: 30 } } }, required: ["grid"], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          if (!input || !Array.isArray(input.grid) || input.grid.length < 3 || input.grid.length > 30) throw new Error("Grid must contain 3–30 rows.");
          const width = input.grid[0]?.length;
          if (width < 3 || width > 30 || input.grid.some((line) => line.length !== width || /[^.#@a-zA-Z]/.test(line))) throw new Error("Rows must be 3–30 equal-length valid grid strings.");
          if (input.grid.join("").split("@").length - 1 !== 1) throw new Error("Grid must contain exactly one @ start.");
          rows = input.grid.length;
          cols = width;
          cells = input.grid.map((line) => [...line]);
          els.rows.value = rows;
          els.cols.value = cols;
          renderGrid();
          resetResult("Maze configured");
          centerGrid();
          return { rows, columns: cols };
        },
      },
      {
        name: "run_shortest_key_search",
        title: "Run shortest-key search",
        description: "Run BFS on the visible maze and animate its optimal all-keys route.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        async execute() {
          await solve();
          return { ...lastResult, status: els.status.textContent };
        },
      },
    ];
    tools.forEach((tool) => { try { void Promise.resolve(context.registerTool(tool)).catch(() => {}); } catch (_) {} });
  }

  renderGrid();
  setTool("pan");
  updateLetterTools();
  requestAnimationFrame(centerGrid);
  registerWebMCP();
})();
