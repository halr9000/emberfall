const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const app = document.querySelector("#app");

let viewport = { width: window.innerWidth, height: window.innerHeight, dpr: Math.min(window.devicePixelRatio || 1, 2) };
let keys = new Set();
let pointer = { x: 0, y: 0, down: false };
let lastFrame = performance.now();
let nextToastId = 1;
let toastTimers = new Map();
let lastToolKey = "";

const TILE = 32;
const WORLD_WIDTH = 224 * TILE;
const GROUND_LEVEL = 520;
const RESOURCE_NODE_SIZE = 24;
const RESOURCE_NODE_RAISE = 40;
const GRAVITY = 1450;
const TAU = Math.PI * 2;

const zones = [
  { name: "Mosslight Meadow", start: 0, end: 62, skyTop: "#4a7e9d", skyBottom: "#a7c5bd", ground: "#69492f", soil: "#3a2a25", accent: "#e7bf6b", fog: "#d4e7d1" },
  { name: "Glowroot Grotto", start: 62, end: 140, skyTop: "#243b4b", skyBottom: "#1a2530", ground: "#40342f", soil: "#211d24", accent: "#70c3bc", fog: "#668b92" },
  { name: "The Emberworks", start: 140, end: 224, skyTop: "#542d2a", skyBottom: "#171b25", ground: "#5b3730", soil: "#2b2026", accent: "#ed7258", fog: "#b85042" }
];

const stations = [
  { type: "bedroll", x: 9 * TILE, y: 520, label: "camp bedroll", color: "#74c5a1" },
  { type: "workshop", x: 58 * TILE, y: 520, label: "copper workshop", color: "#d88958" },
  { type: "forge", x: 151 * TILE, y: 520, label: "ember forge", color: "#ed7258" },
  { type: "gate", x: 210 * TILE, y: 520, label: "Warden gate", color: "#ad8ce8" }
];

const upgradeData = [
  { id: "coil", glyph: "⌁", name: "Verdant Coil", copy: "Recover 2 vitality every 5 seconds. Your beacon also heals a little more.", tag: "for patient explorers" },
  { id: "blast", glyph: "✦", name: "Blast Cap", copy: "Rivet shots pierce one target and deal 30% more damage to the Warden.", tag: "for loud solutions" },
  { id: "stride", glyph: "↗", name: "Deep Stride", copy: "Move 18% faster and gain a second air hop after touching a glowroot.", tag: "for restless feet" }
];

const state = {
  active: false,
  paused: false,
  upgradeOpen: false,
  victory: false,
  t: 0,
  seed: Math.floor(Math.random() * 9000) + 1000,
  camera: { x: 0, y: 0 },
  player: { x: 10 * TILE, y: 470, w: 22, h: 40, vx: 0, vy: 0, facing: 1, hp: 100, maxHp: 100, energy: 100, grounded: false, coyote: 0, jumps: 0, attackCooldown: 0, invuln: 0, swing: 0, tool: 0, kills: 0, shots: 0, falls: 0 },
  resources: { copper: 0, crystal: 0, ember: 0 },
  flags: { workshop: false, bedroll: false, forge: false, upgrade: null, wardenAwake: false },
  nodes: [],
  enemies: [],
  projectiles: [],
  enemyProjectiles: [],
  beacons: [],
  particles: [],
  floatingText: [],
  spentSeconds: 0,
  explored: 0,
  currentZone: 0,
  eventText: "",
  world: { platforms: [], hazards: [] }
};

function resize() {
  viewport = { width: window.innerWidth, height: window.innerHeight, dpr: Math.min(window.devicePixelRatio || 1, 2) };
  canvas.width = Math.floor(viewport.width * viewport.dpr);
  canvas.height = Math.floor(viewport.height * viewport.dpr);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
}

window.addEventListener("resize", resize);
resize();

function seededRandom(seed) {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => (value = value * 16807 % 2147483647) / 2147483647;
}

function zoneAt(worldX) {
  const tileX = worldX / TILE;
  return zones.findIndex((zone) => tileX >= zone.start && tileX < zone.end) || 0;
}

function currentZone() { return zones[state.currentZone]; }

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function rectsOverlap(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function screenX(x) { return x - state.camera.x; }
function screenY(y) { return y - state.camera.y; }
function worldPoint(x, y) { return { x: screenX(x), y: screenY(y) }; }

function resetGame() {
  state.active = false;
  state.paused = false;
  state.upgradeOpen = false;
  state.victory = false;
  state.t = 0;
  state.seed = Math.floor(Math.random() * 9000) + 1000;
  state.camera = { x: 0, y: 0 };
  state.player = { x: 10 * TILE, y: 470, w: 22, h: 40, vx: 0, vy: 0, facing: 1, hp: 100, maxHp: 100, energy: 100, grounded: false, coyote: 0, jumps: 0, attackCooldown: 0, invuln: 0, swing: 0, tool: 0, kills: 0, shots: 0, falls: 0 };
  state.resources = { copper: 0, crystal: 0, ember: 0 };
  state.flags = { workshop: false, bedroll: false, forge: false, upgrade: null, wardenAwake: false };
  state.nodes = [];
  state.enemies = [];
  state.projectiles = [];
  state.enemyProjectiles = [];
  state.beacons = [];
  state.particles = [];
  state.floatingText = [];
  state.spentSeconds = 0;
  state.explored = 0;
  state.currentZone = 0;
  state.eventText = "";
  state.world = { platforms: [], hazards: [] };
  lastToolKey = "";
  generateWorld();
  renderToolSlots();
  updateHud();
}

function generateWorld() {
  const random = seededRandom(state.seed);
  const platforms = [
    { x: 0, y: GROUND_LEVEL, w: WORLD_WIDTH + TILE, h: 340, kind: "ground" },
    { x: 54 * TILE, y: 444, w: 10 * TILE, h: 22, kind: "ledge" },
    { x: 68 * TILE, y: 410, w: 9 * TILE, h: 22, kind: "ledge" },
    { x: 83 * TILE, y: 474, w: 8 * TILE, h: 22, kind: "ledge" },
    { x: 96 * TILE, y: 386, w: 12 * TILE, h: 22, kind: "ledge" },
    { x: 114 * TILE, y: 448, w: 10 * TILE, h: 22, kind: "ledge" },
    { x: 129 * TILE, y: 360, w: 9 * TILE, h: 22, kind: "ledge" },
    { x: 150 * TILE, y: 432, w: 8 * TILE, h: 22, kind: "ledge" },
    { x: 164 * TILE, y: 370, w: 10 * TILE, h: 22, kind: "ledge" },
    { x: 183 * TILE, y: 458, w: 10 * TILE, h: 22, kind: "ledge" },
    { x: 196 * TILE, y: 397, w: 9 * TILE, h: 22, kind: "ledge" },
    { x: 208 * TILE, y: 455, w: 13 * TILE, h: 22, kind: "arena" }
  ];
  state.world.platforms = platforms;

  // Node height is relative to the walkable surface beneath it, not the canvas origin.
  const nodeDefs = [
    ["copper", 15, RESOURCE_NODE_RAISE, 3], ["copper", 20, 0, 3], ["copper", 29, RESOURCE_NODE_RAISE, 3], ["copper", 38, 0, 3], ["copper", 48, RESOURCE_NODE_RAISE, 3],
    ["crystal", 68, 0, 4], ["crystal", 78, RESOURCE_NODE_RAISE, 4], ["crystal", 88, 0, 4], ["crystal", 101, 0, 4], ["crystal", 111, RESOURCE_NODE_RAISE, 4], ["crystal", 123, 0, 4], ["crystal", 132, RESOURCE_NODE_RAISE, 4],
    ["ember", 146, RESOURCE_NODE_RAISE, 4], ["ember", 158, 0, 4], ["ember", 172, RESOURCE_NODE_RAISE, 4], ["ember", 180, 0, 4], ["ember", 190, RESOURCE_NODE_RAISE, 4], ["ember", 201, 0, 4]
  ];
  state.nodes = nodeDefs.map(([type, tileX, rise, hp], index) => {
    const x = tileX * TILE + 4 + Math.floor(random() * 8);
    const support = platforms.find((platform) => platform.kind !== "ground" && x + RESOURCE_NODE_SIZE > platform.x && x < platform.x + platform.w);
    const surfaceY = support?.y ?? GROUND_LEVEL;
    return { id: `node-${index}`, type, x, y: surfaceY - RESOURCE_NODE_SIZE - rise, w: RESOURCE_NODE_SIZE, h: RESOURCE_NODE_SIZE, hp, maxHp: hp, alive: true, bob: random() * TAU };
  });

  const enemyDefs = [
    ["slime", 31, 470], ["moth", 43, 330], ["slime", 51, 470],
    ["moth", 74, 310], ["sentry", 92, 470], ["bat", 106, 300], ["slime", 118, 470], ["moth", 132, 270],
    ["emberling", 148, 470], ["sentry", 166, 470], ["emberling", 180, 470], ["bat", 195, 290]
  ];
  state.enemies = enemyDefs.map(([type, tileX, y], index) => makeEnemy(type, tileX * TILE, y, index));
}

function makeEnemy(type, x, y, id) {
  const data = {
    slime: { w: 28, h: 24, hp: 32, speed: 60, color: "#78aa80", contact: 10, worth: 1 },
    moth: { w: 26, h: 21, hp: 24, speed: 75, color: "#ad8ce8", contact: 8, worth: 2 },
    bat: { w: 30, h: 18, hp: 42, speed: 88, color: "#ce7190", contact: 12, worth: 2 },
    sentry: { w: 27, h: 31, hp: 55, speed: 0, color: "#d88359", contact: 15, worth: 3 },
    emberling: { w: 25, h: 29, hp: 62, speed: 94, color: "#ed7258", contact: 17, worth: 4 },
    warden: { w: 70, h: 86, hp: 260, speed: 90, color: "#e5a557", contact: 25, worth: 50 }
  }[type];
  return { id, type, x, y: y - data.h, baseY: y - data.h, w: data.w, h: data.h, hp: data.hp, maxHp: data.hp, speed: data.speed, color: data.color, contact: data.contact, worth: data.worth, vx: 0, vy: 0, grounded: false, timer: 0.7 + id * .17, phase: id * 1.4, hitFlash: 0, alive: true, bossPhase: 0, pattern: 0 };
}

function startGame() {
  resetGame();
  state.active = true;
  hideLayer("intro-screen");
  toast("Your lamp is warm. The lantern line starts east.", "FIELD NOTE");
  announce("Mine 3 copper chunks near camp.");
}

function hideLayer(id) { document.querySelector(`#${id}`).classList.add("hidden"); document.querySelector(`#${id}`).classList.remove("visible"); }
function showLayer(id) { document.querySelector(`#${id}`).classList.remove("hidden"); document.querySelector(`#${id}`).classList.add("visible"); }

function toast(message, title = "FIELD NOTE", tone = "") {
  const item = document.createElement("div");
  const id = nextToastId++;
  item.className = `toast ${tone}`;
  item.innerHTML = `<strong>${title}</strong>${message}`;
  document.querySelector("#toast-stack").appendChild(item);
  const timer = setTimeout(() => { item.remove(); toastTimers.delete(id); }, 6200);
  toastTimers.set(id, timer);
}

function announce(message) {
  state.eventText = message;
  const existing = document.querySelector("#objective-copy");
  if (existing && state.active) existing.textContent = message;
}

function getObjective() {
  const { copper, crystal, ember } = state.resources;
  if (!state.flags.workshop) return {
    kicker: "01 // WAKE THE WORKSHOP",
    title: copper < 3 ? "Feed the copper press" : "Wake the copper press",
    copy: copper < 3 ? `Mine ${3 - copper} more copper chunk${3 - copper === 1 ? "" : "s"} nearby. Press J or click to mine; jump for raised ore.` : "Press E at the red awning workshop at the meadow's edge.",
    step: 0
  };
  if (crystal < 3) return { kicker: "02 // FIND THE GLOWROOT", title: "Collect the deep signal", copy: `Mine ${3 - crystal} more glow crystal${3 - crystal === 1 ? "" : "s"} in the grotto. Use the Rivet Sling on flying enemies.`, step: 1 };
  if (!state.flags.forge) return { kicker: "03 // CROSS THE DARK", title: "Bring light to the forge", copy: `Mine ${2 - ember} ember shard${2 - ember === 1 ? "" : "s"}, then press E at the forge in the Emberworks.`, step: 2 };
  if (!state.flags.upgrade) return { kicker: "03 // GLOWROOT CORE", title: "Choose what the deep keeps", copy: "The core has three answers. Pick one before the Warden wakes.", step: 2 };
  if (!state.flags.wardenAwake) return { kicker: "04 // THE WARDEN GATE", title: "Wake the furnace guardian", copy: "Reach the violet gate at the far end of the Emberworks and press E.", step: 3 };
  const boss = state.enemies.find((enemy) => enemy.type === "warden" && enemy.alive);
  if (boss) return { kicker: "04 // WARDEN ACTIVE", title: "Break the furnace heart", copy: "Stay moving. The arena pillars block its line shots, but not the ground pulse.", step: 3 };
  return { kicker: "FIELD TEST COMPLETE", title: "The furnace is yours", copy: "You made a way through. The old machines are listening again.", step: 3 };
}

function updateHud() {
  const player = state.player;
  const objective = getObjective();
  document.querySelector("#hp-text").textContent = `${Math.ceil(player.hp)} / ${player.maxHp}`;
  document.querySelector("#hp-fill").style.width = `${clamp(player.hp / player.maxHp * 100, 0, 100)}%`;
  document.querySelector("#energy-text").textContent = `${Math.ceil(player.energy)}`;
  document.querySelector("#energy-fill").style.width = `${clamp(player.energy, 0, 100)}%`;
  document.querySelector("#copper-count").textContent = state.resources.copper;
  document.querySelector("#crystal-count").textContent = state.resources.crystal;
  document.querySelector("#ember-count").textContent = state.resources.ember;
  document.querySelector("#zone-name").textContent = currentZone().name;
  const dayClock = (6 + state.t / 55) % 24;
  const hours = String(Math.floor(dayClock)).padStart(2, "0");
  const minutes = String(Math.floor(dayClock % 1 * 60)).padStart(2, "0");
  document.querySelector("#clock-readout").textContent = `${hours}:${minutes}`;
  document.querySelector("#objective-kicker").textContent = objective.kicker;
  document.querySelector("#objective-title").textContent = objective.title;
  document.querySelector("#objective-copy").textContent = objective.copy;
  document.querySelectorAll(".route-dot").forEach((dot, index) => { dot.classList.toggle("active", index === objective.step); dot.classList.toggle("done", index < objective.step); });
  const checkpoint = document.querySelector("#checkpoint-readout");
  checkpoint.textContent = state.flags.bedroll ? "BEDROLL ACTIVE" : "NO BEDROLL";
  checkpoint.classList.toggle("active", state.flags.bedroll);
  renderToolSlots();
}

function renderToolSlots() {
  const toolKey = `${state.player.tool}|${state.flags.workshop}|${state.flags.forge}`;
  if (toolKey === lastToolKey) return;
  lastToolKey = toolKey;
  const tools = [
    { icon: "⛏", name: "Pickaxe", locked: false },
    { icon: "╱", name: "Rivet sling", locked: !state.flags.workshop },
    { icon: "✦", name: "Ember beacon", locked: !state.flags.forge }
  ];
  document.querySelector("#tool-slots").innerHTML = tools.map((tool, index) => `<button class="tool-slot ${state.player.tool === index ? "selected" : ""} ${tool.locked ? "locked" : ""}" data-tool="${index}" ${tool.locked ? "disabled" : ""}><span class="slot-num">${index + 1}</span><span class="tool-icon">${tool.icon}</span><span class="tool-name">${tool.name}</span></button>`).join("");
  document.querySelectorAll(".tool-slot").forEach((slot) => slot.addEventListener("click", () => selectTool(Number(slot.dataset.tool))));
}

function selectTool(index) {
  if (index === 1 && !state.flags.workshop) return toast("The press needs copper before it can throw anything.", "LOCKED", "warn");
  if (index === 2 && !state.flags.forge) return toast("The ember beacon is still a sketch on a wall.", "LOCKED", "warn");
  state.player.tool = index;
  renderToolSlots();
}

function nearestStation() {
  const player = state.player;
  return stations.find((station) => Math.abs(station.x + 20 - (player.x + player.w / 2)) < 78 && Math.abs(station.y - (player.y + player.h)) < 76);
}

function interact() {
  if (!state.active || state.paused || state.upgradeOpen || state.victory) return;
  const station = nearestStation();
  if (!station) return toast("Nothing answers your lamp here.", "NO SIGNAL");
  if (station.type === "bedroll") {
    state.flags.bedroll = true;
    toast("Bedroll laid. If the deep gets you, you wake here.", "CHECKPOINT", "good");
    announce("The bedroll is safe. Follow the lantern posts east.");
    return;
  }
  if (station.type === "workshop") {
    if (state.flags.workshop) return toast("The copper press is humming. Rivets are ready.", "WORKSHOP");
    if (state.resources.copper < 3) return toast(`The press is hungry. Bring ${3 - state.resources.copper} more copper.`, "WORKSHOP", "warn");
    state.resources.copper -= 3;
    state.flags.workshop = true;
    state.player.tool = 1;
    toast("Rivet sling fabricated. The grotto is full of targets.", "NEW TOOL", "good");
    announce("Collect 3 glow crystals. Your sling can reach what the pickaxe cannot.");
    updateHud();
    return;
  }
  if (station.type === "forge") {
    if (state.flags.forge) return toast("The core is awake. Choose your mutation.", "EMBER FORGE");
    if (state.resources.crystal < 3 || state.resources.ember < 2) return toast("The forge needs 3 glow and 2 ember to hold a mutation.", "EMBER FORGE", "warn");
    state.resources.crystal -= 3;
    state.resources.ember -= 2;
    state.flags.forge = true;
    state.upgradeOpen = true;
    buildUpgradeCards();
    showLayer("upgrade-screen");
    announce("Choose the shape of the rest of the run.");
    updateHud();
    return;
  }
  if (station.type === "gate") {
    if (!state.flags.upgrade) return toast("The violet gate has no reason to open yet.", "WARDEN GATE", "warn");
    if (state.flags.wardenAwake) return toast("The furnace is awake. Finish what you started.", "WARDEN GATE");
    state.flags.wardenAwake = true;
    const warden = makeEnemy("warden", 218 * TILE, 520, 99);
    warden.y = 520 - warden.h;
    state.enemies.push(warden);
    toast("Something enormous just inhaled.", "WARDEN ACTIVE", "warn");
    announce("Break the furnace heart. Use the arena pillars to survive.");
    burst(218 * TILE, 475, "#ed7258", 32);
    updateHud();
  }
}

function buildUpgradeCards() {
  document.querySelector("#upgrade-options").innerHTML = upgradeData.map((upgrade) => `<button class="upgrade-card" data-upgrade="${upgrade.id}"><span class="upgrade-glyph">${upgrade.glyph}</span><strong>${upgrade.name}</strong><p>${upgrade.copy}</p><em>${upgrade.tag}</em></button>`).join("");
  document.querySelectorAll(".upgrade-card").forEach((card) => card.addEventListener("click", () => chooseUpgrade(card.dataset.upgrade)));
}

function chooseUpgrade(id) {
  state.flags.upgrade = id;
  state.upgradeOpen = false;
  hideLayer("upgrade-screen");
  const chosen = upgradeData.find((upgrade) => upgrade.id === id);
  toast(`${chosen.name} is in your blood now.`, "MUTATION ACCEPTED", "good");
  announce("Reach the violet gate at the far end of the Emberworks.");
  updateHud();
}

function handleJump() {
  const player = state.player;
  if (!state.active || state.paused || state.upgradeOpen || state.victory) return;
  if (player.grounded || player.coyote > 0) {
    player.vy = -520;
    player.grounded = false;
    player.coyote = 0;
    player.jumps = 1;
    burst(player.x + player.w / 2, player.y + player.h, "#e9b85b", 5);
    return;
  }
  if (state.flags.upgrade === "stride" && player.jumps < 2) {
    player.vy = -460;
    player.jumps = 2;
    burst(player.x + player.w / 2, player.y + player.h, "#ad8ce8", 8);
  }
}

function handleUse() {
  if (!state.active || state.paused || state.upgradeOpen || state.victory || state.player.attackCooldown > 0) return;
  const player = state.player;
  if (player.tool === 0) usePickaxe();
  if (player.tool === 1) useSling();
  if (player.tool === 2) useBeacon();
}

function usePickaxe() {
  const player = state.player;
  player.attackCooldown = .34;
  player.swing = .22;
  const reach = { x: player.x + (player.facing > 0 ? player.w : -58), y: player.y + 4, w: 58, h: 45 };
  let hit = false;
  const node = state.nodes.find((candidate) => candidate.alive && rectsOverlap(reach, candidate));
  if (node) {
    node.hp -= 1;
    hit = true;
    burst(node.x + node.w / 2, node.y + node.h / 2, node.type === "copper" ? "#d88958" : node.type === "crystal" ? "#72c3bf" : "#ed7258", 8);
    if (node.hp <= 0) collectNode(node);
  }
  state.enemies.filter((enemy) => enemy.alive && rectsOverlap(reach, enemy)).forEach((enemy) => { damageEnemy(enemy, 15); hit = true; });
  if (!hit) burst(player.x + player.facing * 48, player.y + 23, "#e9b85b", 3);
}

function useSling() {
  const player = state.player;
  if (player.energy < 6) return toast("Your focus is empty. Let it refill.", "LOW FOCUS", "warn");
  player.attackCooldown = .24;
  player.energy -= 6;
  player.shots += 1;
  state.projectiles.push({ x: player.x + player.w / 2 + player.facing * 13, y: player.y + 16, vx: player.facing * 650, vy: 0, life: 1.8, damage: state.flags.upgrade === "blast" ? 25 : 16, pierce: state.flags.upgrade === "blast" ? 1 : 0, color: "#f0bf68" });
  burst(player.x + player.facing * 16, player.y + 15, "#f0bf68", 6);
}

function useBeacon() {
  const player = state.player;
  if (state.resources.ember < 1) return toast("The beacon needs an ember shard to flare.", "NO CHARGE", "warn");
  state.resources.ember -= 1;
  player.attackCooldown = .65;
  state.beacons.push({ x: player.x + player.facing * 54, y: 510, life: 13, pulse: 0 });
  toast("Beacon down. Enemies slow inside the light.", "EMBER BEACON", "good");
  burst(player.x + player.facing * 54, 500, "#ed7258", 16);
  updateHud();
}

function collectNode(node) {
  node.alive = false;
  const amount = node.type === "copper" ? 1 : node.type === "crystal" ? 1 : 1;
  state.resources[node.type] += amount;
  const label = node.type === "copper" ? "Copper" : node.type === "crystal" ? "Glow crystal" : "Ember shard";
  floatingText(node.x, node.y - 8, `+1 ${label}`, node.type === "copper" ? "#e7b477" : node.type === "crystal" ? "#9be2d1" : "#ff9671");
  burst(node.x + node.w / 2, node.y + node.h / 2, node.type === "copper" ? "#d88958" : node.type === "crystal" ? "#72c3bf" : "#ed7258", 18);
  if (node.type === "copper" && state.resources.copper === 3) toast("Three chunks is enough. The press is east, under the red awning.", "THREAD ADVANCED", "good");
  if (node.type === "crystal" && state.resources.crystal === 3) toast("The glowroot is answering. Find the forge beyond the hot bridge.", "THREAD ADVANCED", "good");
  if (node.type === "ember" && state.resources.ember === 2) toast("You have enough ember to make a beacon—or bargain with the forge.", "THREAD ADVANCED", "good");
  updateHud();
}

function damageEnemy(enemy, amount) {
  if (!enemy.alive) return;
  enemy.hp -= amount;
  enemy.hitFlash = .12;
  enemy.vx += state.player.facing * 80;
  burst(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2, enemy.color, 6);
  if (enemy.hp <= 0) {
    enemy.alive = false;
    state.player.kills += 1;
    floatingText(enemy.x, enemy.y, `+${enemy.w > 50 ? 50 : enemy.w > 28 ? 3 : 1} scrap`, "#f0bf68");
    burst(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2, enemy.color, enemy.type === "warden" ? 70 : 18);
    if (enemy.type === "warden") finishGame();
  }
}

function damagePlayer(amount, sourceX = state.player.x) {
  const player = state.player;
  if (player.invuln > 0 || state.victory) return;
  player.hp -= amount;
  player.invuln = .78;
  player.vx += player.x < sourceX ? -160 : 160;
  player.vy = -180;
  burst(player.x + player.w / 2, player.y + player.h / 2, "#e06a4f", 12);
  if (player.hp <= 0) respawn();
}

function respawn() {
  state.player.falls += 1;
  state.player.hp = state.player.maxHp;
  state.player.energy = 100;
  state.player.vx = 0;
  state.player.vy = 0;
  state.player.x = state.flags.bedroll ? 9 * TILE : 10 * TILE;
  state.player.y = 470;
  state.camera.x = 0;
  toast(state.flags.bedroll ? "The bedroll did its job. The deep still waits." : "The lantern dragged you back to camp.", "WAKE UP", "warn");
}

function finishGame() {
  state.victory = true;
  state.active = false;
  const minutes = Math.max(1, Math.round(state.t / 60));
  document.querySelector("#victory-copy").textContent = `You reached the furnace in ${minutes} minute${minutes === 1 ? "" : "s"}. The old machines are listening again.`;
  document.querySelector("#victory-stats").innerHTML = `<div><b>${state.player.kills}</b><span>threats cleared</span></div><div><b>${state.player.shots}</b><span>rivet shots</span></div><div><b>${state.player.falls}</b><span>deep wakes</span></div>`;
  showLayer("victory-screen");
}

function update(dt) {
  if (!state.active || state.paused || state.upgradeOpen || state.victory) return;
  dt = Math.min(dt, .035);
  state.t += dt;
  state.spentSeconds += dt;
  const player = state.player;
  player.attackCooldown = Math.max(0, player.attackCooldown - dt);
  player.swing = Math.max(0, player.swing - dt);
  player.invuln = Math.max(0, player.invuln - dt);
  player.energy = clamp(player.energy + dt * 10, 0, 100);

  const moveInput = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
  const strideBonus = state.flags.upgrade === "stride" ? 1.18 : 1;
  const maxSpeed = 225 * strideBonus;
  player.vx = lerp(player.vx, moveInput * maxSpeed, Math.min(1, dt * 11));
  if (moveInput) player.facing = moveInput;
  player.vy += GRAVITY * dt;
  const wasGrounded = player.grounded;
  moveAndCollide(player, dt);
  player.coyote = player.grounded ? .1 : Math.max(0, player.coyote - dt);
  if (player.grounded && !wasGrounded) player.jumps = 0;

  if (player.y > 700) respawn();
  state.explored = Math.max(state.explored, player.x / WORLD_WIDTH);
  const newZone = zoneAt(player.x);
  if (newZone !== state.currentZone) {
    state.currentZone = newZone;
    const zone = currentZone();
    toast(`The air changes. ${zone.name} ahead.`, "NEW BIOME", "good");
    announce(zone.name === "Glowroot Grotto" ? "Collect 3 glow crystals. Ledges are safer than the dark floor." : zone.name === "The Emberworks" ? "Gather ember shards, then find the forge." : "Follow the lantern line.");
    updateHud();
  }

  updateEnemies(dt);
  updateProjectiles(dt);
  updateBeacons(dt);
  updateParticles(dt);
  updateFloatingText(dt);
  updatePrompt();
  updateHud();
}

function moveAndCollide(entity, dt) {
  entity.x += entity.vx * dt;
  entity.x = clamp(entity.x, 8, WORLD_WIDTH - entity.w - 8);
  const previousBottom = entity.y + entity.h;
  entity.y += entity.vy * dt;
  entity.grounded = false;
  if (entity.vy >= 0) {
    let landing = null;
    for (const platform of state.world.platforms) {
      if (entity.x + entity.w > platform.x + 3 && entity.x < platform.x + platform.w - 3 && previousBottom <= platform.y + 4 && entity.y + entity.h >= platform.y) {
        if (!landing || platform.y < landing.y) landing = platform;
      }
    }
    if (landing) {
      entity.y = landing.y - entity.h;
      entity.vy = 0;
      entity.grounded = true;
    }
  }
}

function updateEnemies(dt) {
  const player = state.player;
  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    enemy.timer -= dt;
    enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
    const distance = Math.abs(player.x - enemy.x);
    const beaconSlow = state.beacons.some((beacon) => Math.abs(beacon.x - enemy.x) < 120) ? .48 : 1;
    if (enemy.type === "sentry") {
      enemy.vx = 0;
      if (enemy.timer <= 0 && distance < 780) {
        enemy.timer = 2.4;
        state.enemyProjectiles.push({ x: enemy.x + enemy.w / 2, y: enemy.y + 11, vx: player.x > enemy.x ? 250 : -250, vy: -25, life: 3, color: "#ef8663", damage: 12 });
        burst(enemy.x + enemy.w / 2, enemy.y + 10, "#ef8663", 8);
      }
    } else if (enemy.type === "moth" || enemy.type === "bat") {
      const targetX = player.x > enemy.x ? 1 : -1;
      enemy.vx = targetX * enemy.speed * beaconSlow;
      enemy.y = enemy.baseY + Math.sin(state.t * (enemy.type === "moth" ? 2.8 : 3.7) + enemy.phase) * (enemy.type === "moth" ? 32 : 47);
      if (enemy.timer <= 0 && distance < 280) {
        enemy.timer = enemy.type === "moth" ? 1.3 : 1.8;
        enemy.vy = (player.y - enemy.y) * .5;
      }
      enemy.x += enemy.vx * dt;
      enemy.y += enemy.vy * dt;
    } else if (enemy.type === "warden") {
      const warden = enemy;
      if (warden.timer <= 0) {
        warden.timer = warden.bossPhase % 2 === 0 ? 1.8 : 2.7;
        warden.pattern += 1;
        warden.bossPhase = warden.pattern % 2;
        if (warden.bossPhase === 0) {
          for (let i = -2; i <= 2; i++) state.enemyProjectiles.push({ x: warden.x + warden.w / 2, y: warden.y + 30, vx: i * 95, vy: -245, life: 2.7, color: "#ef8663", damage: 14, arc: true });
          toast("The furnace heart throws sparks in a fan.", "WARDEN PATTERN");
        } else {
          state.enemyProjectiles.push({ x: warden.x + warden.w / 2, y: warden.y + 40, vx: player.x > warden.x ? -180 : 180, vy: -520, life: 2.5, color: "#c46af0", damage: 18, groundPulse: true });
          toast("Hide behind a pillar when the purple charge rises.", "WARDEN PATTERN");
        }
      }
      const targetX = player.x > warden.x ? 1 : -1;
      warden.vx = targetX * warden.speed * .45 * beaconSlow;
      warden.x += warden.vx * dt;
      warden.x = clamp(warden.x, 207 * TILE, 220 * TILE);
      warden.y = 520 - warden.h + Math.sin(state.t * 2) * 3;
    } else {
      const direction = player.x > enemy.x ? 1 : -1;
      enemy.vx = direction * enemy.speed * beaconSlow;
      if (enemy.timer <= 0 && enemy.grounded && distance < 440) {
        enemy.timer = enemy.type === "slime" ? 1.55 : 1.2;
        enemy.vy = enemy.type === "slime" ? -400 : -460;
      }
      moveAndCollide(enemy, dt);
    }
    if (rectsOverlap(player, enemy)) damagePlayer(enemy.contact, enemy.x);
  }

  state.enemies = state.enemies.filter((enemy) => enemy.alive || enemy.type === "warden");
}

function updateProjectiles(dt) {
  for (const projectile of state.projectiles) {
    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;
    projectile.life -= dt;
    for (const enemy of state.enemies) {
      if (!enemy.alive || projectile.life <= 0 || projectile.hit?.includes(enemy.id)) continue;
      if (rectsOverlap({ x: projectile.x - 5, y: projectile.y - 5, w: 10, h: 10 }, enemy)) {
        projectile.hit ??= [];
        projectile.hit.push(enemy.id);
        damageEnemy(enemy, projectile.damage);
        projectile.pierce -= 1;
        if (projectile.pierce < 0) projectile.life = 0;
      }
    }
  }
  for (const projectile of state.enemyProjectiles) {
    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;
    projectile.vy += projectile.arc ? 420 * dt : 620 * dt;
    projectile.life -= dt;
    if (projectile.groundPulse && projectile.y > 515) {
      projectile.life = 0;
      burst(projectile.x, 515, projectile.color, 24);
      if (Math.abs(state.player.x - projectile.x) < 115) damagePlayer(projectile.damage, projectile.x);
    }
    if (rectsOverlap({ x: projectile.x - 7, y: projectile.y - 7, w: 14, h: 14 }, state.player)) { damagePlayer(projectile.damage, projectile.x); projectile.life = 0; burst(projectile.x, projectile.y, projectile.color, 13); }
  }
  state.projectiles = state.projectiles.filter((projectile) => projectile.life > 0 && projectile.x > -100 && projectile.x < WORLD_WIDTH + 100);
  state.enemyProjectiles = state.enemyProjectiles.filter((projectile) => projectile.life > 0 && projectile.y < 760 && projectile.x > -100 && projectile.x < WORLD_WIDTH + 100);
}

function updateBeacons(dt) {
  for (const beacon of state.beacons) {
    beacon.life -= dt;
    beacon.pulse += dt;
    if (state.flags.upgrade === "coil" && Math.abs(state.player.x - beacon.x) < 120 && beacon.pulse > 2) {
      beacon.pulse = 0;
      state.player.hp = clamp(state.player.hp + 3, 0, state.player.maxHp);
      floatingText(state.player.x, state.player.y, "+3", "#8ed7ab");
    }
  }
  state.beacons = state.beacons.filter((beacon) => beacon.life > 0);
}

function updatePrompt() {
  const prompt = document.querySelector("#prompt");
  const station = nearestStation();
  if (!station || !state.active || state.paused || state.upgradeOpen || state.victory) { prompt.classList.remove("visible"); return; }
  let text = `E  ${station.label}`;
  if (station.type === "workshop" && state.flags.workshop) text = "E  inspect copper press";
  if (station.type === "forge" && state.flags.forge) text = "E  inspect ember forge";
  if (station.type === "gate" && state.flags.wardenAwake) text = "E  face the Warden";
  prompt.innerHTML = `<kbd>E</kbd>${text}`;
  prompt.classList.add("visible");
}

function burst(x, y, color, count = 8) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * TAU;
    const speed = 30 + Math.random() * 170;
    state.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, size: 2 + Math.random() * 4, life: .35 + Math.random() * .6, color });
  }
}

function floatingText(x, y, text, color) { state.floatingText.push({ x, y, text, color, life: 1.2 }); }
function updateParticles(dt) { for (const p of state.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 380 * dt; p.life -= dt; } state.particles = state.particles.filter((p) => p.life > 0); }
function updateFloatingText(dt) { for (const p of state.floatingText) { p.y -= 22 * dt; p.life -= dt; } state.floatingText = state.floatingText.filter((p) => p.life > 0); }

function draw() {
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  if (!state.active && !state.victory) drawTitleBackdrop();
  const zone = currentZone();
  const horizon = 430 - state.camera.y * .08;
  const sky = ctx.createLinearGradient(0, 0, 0, viewport.height);
  sky.addColorStop(0, zone.skyTop);
  sky.addColorStop(1, zone.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, viewport.width, viewport.height);
  const cycle = (state.t / 55) % 24;
  const night = clamp((cycle - 17) / 4, 0, 1) + clamp((7 - cycle) / 3, 0, 1);
  if (night > 0) { ctx.fillStyle = `rgba(12, 14, 27, ${Math.min(.64, night * .42)})`; ctx.fillRect(0, 0, viewport.width, viewport.height); }
  drawBackground(zone, horizon);
  drawWorld(zone);
  drawParticles();
  drawLighting();
}

function drawTitleBackdrop() {
  ctx.fillStyle = "#111b22";
  ctx.fillRect(0, 0, viewport.width, viewport.height);
  for (let i = 0; i < 18; i++) { ctx.fillStyle = i % 2 ? "rgba(116,197,161,.06)" : "rgba(233,184,91,.05)"; ctx.fillRect((i * 113) % viewport.width, 80 + (i * 53) % Math.max(180, viewport.height - 120), 2, 2); }
}

function drawBackground(zone, horizon) {
  ctx.save();
  ctx.translate(-state.camera.x * .14, -state.camera.y * .04);
  ctx.fillStyle = "rgba(20,29,38,.26)";
  for (let i = -2; i < 16; i++) {
    const x = i * 220;
    ctx.beginPath(); ctx.moveTo(x, horizon + 64); ctx.lineTo(x + 92, horizon - 75 - (i % 3) * 25); ctx.lineTo(x + 180, horizon + 64); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = zone.fog;
  ctx.globalAlpha = .16;
  for (let i = -1; i < 13; i++) { ctx.fillRect(i * 190 + 28, horizon + 12 + (i % 2) * 18, 118, 22); }
  ctx.globalAlpha = 1;
  ctx.restore();
  if (state.currentZone === 0) drawClouds();
  if (state.currentZone === 1) drawGrottoCeilings();
  if (state.currentZone === 2) drawSmoke();
}

function drawClouds() {
  ctx.save(); ctx.translate(-state.camera.x * .22, -state.camera.y * .02); ctx.globalAlpha = .42;
  for (let i = -1; i < 9; i++) { const x = i * 320 + 80; const y = 92 + (i % 3) * 40; ctx.fillStyle = "#d9e9e1"; ctx.fillRect(x, y, 130, 24); ctx.fillRect(x + 25, y - 15, 62, 30); ctx.fillRect(x + 80, y - 7, 68, 22); }
  ctx.restore();
}

function drawGrottoCeilings() {
  ctx.save(); ctx.translate(-state.camera.x * .28, -state.camera.y * .2); ctx.fillStyle = "rgba(15,21,29,.68)";
  for (let i = -1; i < 12; i++) { const x = i * 240 + 40; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 60, 120 + (i % 4) * 30); ctx.lineTo(x + 124, 54); ctx.lineTo(x + 184, 160 + (i % 3) * 32); ctx.lineTo(x + 235, 0); ctx.closePath(); ctx.fill(); }
  ctx.restore();
}

function drawSmoke() {
  ctx.save(); ctx.globalAlpha = .16; ctx.fillStyle = "#f1a66a";
  for (let i = -1; i < 12; i++) { const x = i * 220 + Math.sin(state.t + i) * 18; ctx.beginPath(); ctx.arc(x, 168 + (i % 3) * 55, 38, 0, TAU); ctx.arc(x + 44, 158 + (i % 2) * 42, 47, 0, TAU); ctx.fill(); }
  ctx.restore();
}

function drawWorld(zone) {
  const left = Math.floor(state.camera.x / TILE) - 2;
  const right = Math.ceil((state.camera.x + viewport.width) / TILE) + 2;
  for (let tx = left; tx <= right; tx++) {
    if (tx < 0 || tx > 223) continue;
    const x = tx * TILE;
    const tileZone = zones.find((candidate) => tx >= candidate.start && tx < candidate.end) || zone;
    drawSurfaceTile(x, 520, tileZone, tx);
    for (let ty = 17; ty < 28; ty++) drawSoilTile(x, ty * TILE, tileZone, tx, ty);
  }
  state.world.platforms.filter((platform) => platform.kind !== "ground").forEach((platform) => drawPlatform(platform, zone));
  drawLandmarks();
  state.nodes.filter((node) => node.alive).forEach(drawNode);
  state.beacons.forEach(drawBeacon);
  state.enemies.filter((enemy) => enemy.alive).forEach(drawEnemy);
  drawProjectiles();
  drawPlayer();
}

function drawSurfaceTile(x, y, zone, tx) {
  const sx = screenX(x), sy = screenY(y);
  if (sx < -TILE * 2 || sx > viewport.width + TILE * 2) return;
  ctx.fillStyle = zone.ground; ctx.fillRect(sx, sy, TILE + 1, TILE);
  ctx.fillStyle = zone.accent; ctx.fillRect(sx, sy, TILE + 1, 5);
  ctx.fillStyle = "rgba(255,255,255,.08)"; ctx.fillRect(sx + 4, sy + 7, 5, 4); ctx.fillRect(sx + 19, sy + 10, 7, 3);
  if (tx % 3 === 0 && zone === zones[0]) { ctx.fillStyle = "#3b6f55"; ctx.fillRect(sx + 10, sy - 11, 3, 11); ctx.fillRect(sx + 6, sy - 14, 12, 4); }
  if (tx % 5 === 0 && zone === zones[2]) { ctx.fillStyle = "#e56b4e"; ctx.fillRect(sx + 13, sy - 8, 4, 8); ctx.fillStyle = "#ffb36d"; ctx.fillRect(sx + 12, sy - 11, 6, 4); }
}

function drawSoilTile(x, y, zone, tx, ty) {
  const sx = screenX(x), sy = screenY(y);
  if (sx < -TILE || sx > viewport.width + TILE) return;
  ctx.fillStyle = zone.soil; ctx.fillRect(sx, sy, TILE + 1, TILE + 1);
  const seed = (tx * 13 + ty * 7 + state.seed) % 17;
  ctx.fillStyle = seed % 4 === 0 ? "rgba(234, 188, 112, .22)" : "rgba(0,0,0,.16)";
  ctx.fillRect(sx + 5 + seed, sy + 7, 5, 4); ctx.fillRect(sx + 19 - seed % 6, sy + 20, 8, 3);
  if (zone === zones[1] && seed % 11 === 0) { ctx.fillStyle = "rgba(112,195,188,.42)"; ctx.fillRect(sx + 12, sy + 4, 4, 16); }
  if (zone === zones[2] && seed % 9 === 0) { ctx.fillStyle = "rgba(237,114,88,.35)"; ctx.fillRect(sx + 3, sy + 15, 23, 3); }
}

function drawPlatform(platform, zone) {
  const sx = screenX(platform.x), sy = screenY(platform.y);
  if (sx > viewport.width + platform.w || sx + platform.w < 0) return;
  ctx.fillStyle = platform.kind === "arena" ? "#644844" : zone.ground; ctx.fillRect(sx, sy, platform.w, platform.h);
  ctx.fillStyle = zone.accent; ctx.fillRect(sx, sy, platform.w, 5);
  for (let x = 0; x < platform.w; x += TILE) { ctx.fillStyle = "rgba(255,255,255,.08)"; ctx.fillRect(sx + x + 6, sy + 10, 6, 4); }
}

function drawLandmarks() {
  stations.forEach((station) => {
    const sx = screenX(station.x), sy = screenY(station.y);
    if (sx < -200 || sx > viewport.width + 200) return;
    ctx.save();
    ctx.globalAlpha = station.type === "gate" && !state.flags.upgrade ? .55 : 1;
    if (station.type === "bedroll") {
      ctx.fillStyle = "#b45f4c"; ctx.fillRect(sx, sy - 18, 45, 16); ctx.fillStyle = "#e3a15f"; ctx.fillRect(sx + 7, sy - 13, 31, 5); ctx.fillStyle = "#7d513d"; ctx.fillRect(sx + 3, sy - 2, 4, 7); ctx.fillRect(sx + 38, sy - 2, 4, 7);
    } else if (station.type === "workshop") {
      ctx.fillStyle = "#35272a"; ctx.fillRect(sx - 29, sy - 75, 78, 75); ctx.fillStyle = "#ca6749"; ctx.fillRect(sx - 34, sy - 82, 88, 12); ctx.fillStyle = "#b86045"; ctx.fillRect(sx - 25, sy - 62, 12, 62); ctx.fillRect(sx + 25, sy - 62, 12, 62); ctx.fillStyle = "#ebbb68"; ctx.fillRect(sx - 5, sy - 38, 25, 20); ctx.fillStyle = "#141a1f"; ctx.fillRect(sx + 2, sy - 32, 12, 14); ctx.fillStyle = "#d98858"; ctx.fillRect(sx + 32, sy - 54, 9, 16);
    } else if (station.type === "forge") {
      ctx.fillStyle = "#3b272a"; ctx.fillRect(sx - 31, sy - 72, 72, 72); ctx.fillStyle = "#6f3834"; ctx.fillRect(sx - 36, sy - 78, 82, 11); ctx.fillStyle = "#ed7258"; ctx.fillRect(sx - 12, sy - 49, 36, 34); ctx.fillStyle = "#ffb36d"; ctx.fillRect(sx - 4, sy - 42, 19, 23); ctx.fillStyle = "rgba(237,114,88,.34)"; ctx.beginPath(); ctx.arc(sx + 4, sy - 55, 28 + Math.sin(state.t * 2) * 4, 0, TAU); ctx.fill();
    } else if (station.type === "gate") {
      ctx.fillStyle = "#2f2545"; ctx.fillRect(sx - 45, sy - 126, 92, 126); ctx.fillStyle = "#644d99"; ctx.fillRect(sx - 50, sy - 131, 102, 10); ctx.fillStyle = state.flags.wardenAwake ? "#ed7258" : "#ad8ce8"; ctx.fillRect(sx - 27, sy - 106, 54, 94); ctx.fillStyle = "rgba(173,140,232,.28)"; ctx.fillRect(sx - 17, sy - 96, 34, 75); for (let i = 0; i < 4; i++) { ctx.fillStyle = "#ad8ce8"; ctx.fillRect(sx - 36 + i * 24, sy - 143 - (i % 2) * 8, 10, 13); }
    }
    ctx.restore();
    if (station.type !== "bedroll") { ctx.fillStyle = station.color; ctx.globalAlpha = .8 + Math.sin(state.t * 3 + station.x) * .15; ctx.fillRect(sx + 5, sy - 91, 4, 4); ctx.globalAlpha = 1; }
  });
  for (let x = 16 * TILE; x < 207 * TILE; x += 11 * TILE) { const sx = screenX(x); if (sx < -20 || sx > viewport.width + 20) continue; ctx.fillStyle = "#d3925b"; ctx.fillRect(sx, screenY(517), 4, 3); ctx.fillRect(sx + 8, screenY(509), 4, 11); ctx.fillRect(sx + 16, screenY(505), 4, 15); }
  for (let x = 62 * TILE; x < 140 * TILE; x += 14 * TILE) { const sx = screenX(x); if (sx < -30 || sx > viewport.width + 30) continue; ctx.fillStyle = "rgba(112,195,188,.52)"; ctx.fillRect(sx, screenY(514), 4, 10); ctx.fillRect(sx + 4, screenY(506), 4, 18); }
}

function drawNode(node) {
  const sx = screenX(node.x), sy = screenY(node.y + Math.sin(state.t * 2 + node.bob) * 2);
  if (sx < -60 || sx > viewport.width + 60) return;
  const colors = { copper: ["#b86645", "#eda26c"], crystal: ["#4d9d9b", "#a0e7d2"], ember: ["#bd4f42", "#ffb36d"] }[node.type];
  ctx.save(); ctx.shadowBlur = 16; ctx.shadowColor = colors[1]; ctx.fillStyle = colors[0];
  ctx.fillRect(sx + 3, sy + 8, 18, 13); ctx.fillStyle = colors[1]; ctx.fillRect(sx + 7, sy + 3, 8, 17); ctx.fillRect(sx + 14, sy + 8, 6, 7); ctx.shadowBlur = 0; ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.fillRect(sx + 8, sy + 5, 3, 5);
  if (node.hp < node.maxHp) { ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(sx, sy - 7, 25, 3); ctx.fillStyle = colors[1]; ctx.fillRect(sx, sy - 7, 25 * (node.hp / node.maxHp), 3); }
  ctx.restore();
}

function drawEnemy(enemy) {
  const sx = screenX(enemy.x), sy = screenY(enemy.y);
  if (sx < -100 || sx > viewport.width + 100) return;
  ctx.save(); ctx.translate(sx + enemy.w / 2, sy + enemy.h / 2); if (enemy.vx < 0) ctx.scale(-1, 1); if (enemy.hitFlash > 0) ctx.globalAlpha = .5;
  if (enemy.type === "slime") { ctx.fillStyle = enemy.color; ctx.beginPath(); ctx.moveTo(-enemy.w/2, enemy.h/2); ctx.quadraticCurveTo(-enemy.w/2, -enemy.h/2, 0, -enemy.h/2 + 4); ctx.quadraticCurveTo(enemy.w/2, -enemy.h/2, enemy.w/2, enemy.h/2); ctx.closePath(); ctx.fill(); ctx.fillStyle = "#18262a"; ctx.fillRect(-7, -4, 3, 4); ctx.fillRect(5, -4, 3, 4); }
  if (enemy.type === "moth" || enemy.type === "bat") { ctx.fillStyle = enemy.color; ctx.fillRect(-4, -5, 8, 13); ctx.fillRect(-enemy.w/2, -10, 12, 8); ctx.fillRect(enemy.w/2 - 12, -10, 12, 8); ctx.fillStyle = "#f5d694"; ctx.fillRect(-2, -4, 3, 3); }
  if (enemy.type === "sentry") { ctx.fillStyle = "#6f423a"; ctx.fillRect(-enemy.w/2, -enemy.h/2, enemy.w, enemy.h); ctx.fillStyle = enemy.color; ctx.fillRect(-9, -14, 18, 9); ctx.fillStyle = "#111820"; ctx.fillRect(-5, -11, 10, 5); ctx.fillStyle = "#e9b85b"; ctx.fillRect(-5, 3, 10, 4); }
  if (enemy.type === "emberling") { ctx.fillStyle = enemy.color; ctx.fillRect(-8, -11, 16, 25); ctx.fillRect(-13, -4, 26, 11); ctx.fillStyle = "#ffd078"; ctx.fillRect(-5, -8, 4, 5); ctx.fillRect(4, -8, 4, 5); ctx.fillStyle = "#652f32"; ctx.fillRect(-13, 10, 7, 6); ctx.fillRect(6, 10, 7, 6); }
  if (enemy.type === "warden") { ctx.shadowBlur = 24; ctx.shadowColor = "#ed7258"; ctx.fillStyle = "#744341"; ctx.fillRect(-30, -37, 60, 70); ctx.fillStyle = "#c9654d"; ctx.fillRect(-39, -27, 78, 23); ctx.fillStyle = "#f2ae61"; ctx.fillRect(-23, -50, 46, 13); ctx.fillStyle = "#221d29"; ctx.fillRect(-19, -19, 38, 28); ctx.fillStyle = "#e8cf8a"; ctx.fillRect(-12, -13, 7, 5); ctx.fillRect(7, -13, 7, 5); ctx.fillStyle = "#ed7258"; ctx.fillRect(-12, 11, 24, 5); ctx.shadowBlur = 0; }
  ctx.restore();
  if (enemy.type === "warden" || enemy.hp < enemy.maxHp) { const width = enemy.type === "warden" ? 92 : 30; ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(sx + enemy.w / 2 - width/2, sy - 11, width, 4); ctx.fillStyle = enemy.type === "warden" ? "#ed7258" : enemy.color; ctx.fillRect(sx + enemy.w / 2 - width/2, sy - 11, width * (enemy.hp / enemy.maxHp), 4); }
}

function drawProjectiles() {
  state.projectiles.forEach((p) => { const x = screenX(p.x), y = screenY(p.y); ctx.save(); ctx.shadowBlur = 12; ctx.shadowColor = p.color; ctx.fillStyle = p.color; ctx.fillRect(x - 7, y - 2, 14, 4); ctx.fillStyle = "#fff1bf"; ctx.fillRect(x - 2, y - 2, 4, 4); ctx.restore(); });
  state.enemyProjectiles.forEach((p) => { const x = screenX(p.x), y = screenY(p.y); ctx.save(); ctx.shadowBlur = 15; ctx.shadowColor = p.color; ctx.fillStyle = p.color; ctx.fillRect(x - 6, y - 6, 12, 12); ctx.fillStyle = "#ffd88a"; ctx.fillRect(x - 2, y - 2, 4, 4); ctx.restore(); });
}

function drawBeacon(beacon) {
  const x = screenX(beacon.x), y = screenY(beacon.y); if (x < -150 || x > viewport.width + 150) return; const pulse = 1 + Math.sin(state.t * 4) * .08; ctx.save(); ctx.globalAlpha = .12; ctx.fillStyle = "#ed7258"; ctx.beginPath(); ctx.arc(x, y - 12, 115 * pulse, 0, TAU); ctx.fill(); ctx.globalAlpha = .8; ctx.fillStyle = "#ed7258"; ctx.fillRect(x - 4, y - 28, 8, 28); ctx.fillStyle = "#ffcf7e"; ctx.fillRect(x - 7, y - 38, 14, 10); ctx.restore();
}

function drawPlayer() {
  const player = state.player; const x = screenX(player.x), y = screenY(player.y); ctx.save(); ctx.translate(x + player.w/2, y + player.h/2); if (player.facing < 0) ctx.scale(-1, 1); if (player.invuln > 0 && Math.floor(player.invuln * 14) % 2 === 0) ctx.globalAlpha = .4;
  ctx.fillStyle = "#293b43"; ctx.fillRect(-9, -3, 18, 22); ctx.fillStyle = "#db9860"; ctx.fillRect(-8, -12, 16, 12); ctx.fillStyle = "#d4aa68"; ctx.fillRect(-11, -18, 22, 8); ctx.fillStyle = "#f2cf88"; ctx.fillRect(-7, -15, 4, 3); ctx.fillStyle = "#a04f43"; ctx.fillRect(-8, 1, 16, 5); ctx.fillStyle = "#d88958"; ctx.fillRect(-14, -2, 6, 4); ctx.fillStyle = "#c0dfc4"; ctx.fillRect(-7, 19, 6, 10); ctx.fillRect(2, 19, 6, 10); ctx.fillStyle = "#172127"; ctx.fillRect(-9, 28, 8, 4); ctx.fillRect(2, 28, 8, 4);
  if (player.tool === 0) { ctx.strokeStyle = "#e9b85b"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(6, 2); ctx.lineTo(17, -14); ctx.stroke(); ctx.fillStyle = "#c17a4e"; ctx.fillRect(13, -17, 10, 4); }
  if (player.tool === 1) { ctx.fillStyle = "#e9b85b"; ctx.fillRect(8, 1, 19, 4); ctx.fillStyle = "#d88958"; ctx.fillRect(23, -3, 5, 12); }
  if (player.tool === 2) { ctx.fillStyle = "#ed7258"; ctx.fillRect(8, -6, 10, 15); ctx.fillStyle = "#ffd078"; ctx.fillRect(10, -11, 7, 7); }
  if (player.swing > 0) { ctx.strokeStyle = "rgba(255,233,175,.85)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(8, 2, 28, -1.1, .8); ctx.stroke(); }
  ctx.restore();
}

function drawParticles() { state.particles.forEach((p) => { ctx.globalAlpha = clamp(p.life * 2, 0, 1); ctx.fillStyle = p.color; ctx.fillRect(screenX(p.x), screenY(p.y), p.size, p.size); }); ctx.globalAlpha = 1; state.floatingText.forEach((p) => { ctx.globalAlpha = clamp(p.life, 0, 1); ctx.fillStyle = p.color; ctx.font = "800 12px Trebuchet MS"; ctx.textAlign = "center"; ctx.fillText(p.text, screenX(p.x), screenY(p.y)); }); ctx.globalAlpha = 1; }

function drawLighting() {
  const player = state.player; const px = screenX(player.x + player.w/2); const py = screenY(player.y + player.h/2); const glow = ctx.createRadialGradient(px, py, 20, px, py, 260); glow.addColorStop(0, "rgba(255,219,132,.15)"); glow.addColorStop(1, "rgba(255,219,132,0)"); ctx.fillStyle = glow; ctx.fillRect(px - 260, py - 260, 520, 520);
  state.beacons.forEach((beacon) => { const x = screenX(beacon.x), y = screenY(beacon.y - 25); const beaconGlow = ctx.createRadialGradient(x, y, 5, x, y, 135); beaconGlow.addColorStop(0, "rgba(255,152,100,.25)"); beaconGlow.addColorStop(1, "rgba(255,152,100,0)"); ctx.fillStyle = beaconGlow; ctx.fillRect(x - 135, y - 135, 270, 270); });
}

function gameLoop(now) {
  const dt = (now - lastFrame) / 1000; lastFrame = now;
  update(dt); draw(); requestAnimationFrame(gameLoop);
}

window.addEventListener("keydown", (event) => {
  const blocked = ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
  if (blocked.includes(event.code)) event.preventDefault();
  if (event.code === "Escape") { if (state.active && !state.upgradeOpen && !state.victory) { state.paused = !state.paused; state.paused ? showLayer("pause-screen") : hideLayer("pause-screen"); } return; }
  if (event.code === "Space" && !event.repeat) handleJump();
  if (event.code === "KeyE" && !event.repeat) interact();
  if (event.code === "KeyJ" && !event.repeat) handleUse();
  if (/^Digit[1-3]$/.test(event.code) && !event.repeat) selectTool(Number(event.code.slice(-1)) - 1);
  keys.add(event.code);
});
window.addEventListener("keyup", (event) => keys.delete(event.code));

canvas.addEventListener("pointermove", (event) => { const rect = canvas.getBoundingClientRect(); pointer.x = event.clientX - rect.left; pointer.y = event.clientY - rect.top; });
canvas.addEventListener("pointerdown", (event) => { pointer.down = true; if (state.active) handleUse(); });
window.addEventListener("pointerup", () => { pointer.down = false; });

document.querySelector("#start-button").addEventListener("click", startGame);
document.querySelector("#resume-button").addEventListener("click", () => { state.paused = false; hideLayer("pause-screen"); });
document.querySelector("#replay-button").addEventListener("click", () => { hideLayer("victory-screen"); startGame(); });
document.querySelectorAll("#mobile-controls button").forEach((button) => {
  const action = button.dataset.action;
  button.addEventListener("pointerdown", (event) => { event.preventDefault(); if (action === "left") keys.add("ArrowLeft"); if (action === "right") keys.add("ArrowRight"); if (action === "jump") handleJump(); if (action === "use") handleUse(); if (action === "interact") interact(); });
  button.addEventListener("pointerup", () => { keys.delete("ArrowLeft"); keys.delete("ArrowRight"); });
  button.addEventListener("pointercancel", () => { keys.delete("ArrowLeft"); keys.delete("ArrowRight"); });
});

resetGame();
requestAnimationFrame(gameLoop);
