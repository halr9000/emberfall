const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createElement(dataset = {}) {
  const handlers = new Map();
  const classes = new Set();
  return {
    dataset,
    style: {},
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      toggle: (name, force) => {
        const shouldAdd = force ?? !classes.has(name);
        if (shouldAdd) classes.add(name);
        else classes.delete(name);
        return shouldAdd;
      }
    },
    addEventListener: (name, handler) => handlers.set(name, handler),
    dispatch: (name, event = {}) => handlers.get(name)?.(event),
    appendChild: () => {},
    remove: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0 })
  };
}

function loadGame(width = 1280) {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "game.js"), "utf8");
  let now = 0;
  const selectors = new Map();
  const listeners = new Map();
  const elementFor = (selector) => {
    if (!selectors.has(selector)) selectors.set(selector, createElement());
    return selectors.get(selector);
  };
  const toolSlots = Array.from({ length: 3 }, (_, index) => createElement({ tool: String(index) }));
  const mobileButtons = ["left", "right", "jump", "use", "interact"].map((action) => createElement({ action }));
  const routeDots = Array.from({ length: 4 }, () => createElement());
  const context2d = { setTransform: () => {} };
  const math = Object.create(Math);
  math.random = () => 0.5;
  const canvas = Object.assign(elementFor("#game"), {
    getContext: () => context2d,
    width: 0,
    height: 0
  });
  const window = {
    innerWidth: width,
    innerHeight: 800,
    devicePixelRatio: 1,
    addEventListener: (name, handler) => listeners.set(name, handler)
  };
  const document = {
    querySelector: elementFor,
    querySelectorAll: (selector) => {
      if (selector === ".tool-slot") return toolSlots;
      if (selector === "#mobile-controls button") return mobileButtons;
      if (selector === ".route-dot") return routeDots;
      return [];
    },
    createElement: () => createElement()
  };
  const sandbox = {
    document,
    window,
    performance: { now: () => now },
    Math: math,
    requestAnimationFrame: () => 0,
    setTimeout: () => 1,
    clearTimeout: () => {},
    console
  };
  vm.runInNewContext(source, sandbox, { filename: "src/game.js" });

  return {
    state: () => vm.runInContext("state", sandbox),
    click: (selector) => elementFor(selector).dispatch("click"),
    press: (code) => listeners.get("keydown")({ code, repeat: false, preventDefault: () => {} }),
    release: (code) => listeners.get("keyup")({ code }),
    pointerDown: () => canvas.dispatch("pointerdown", {}),
    mobile: (action, type, pointerId = 1) => {
      const event = { pointerId, preventDefault: () => {} };
      mobileButtons.find((button) => button.dataset.action === action).dispatch(type, event);
      if (type === "pointerup" || type === "pointercancel") listeners.get(type)?.(event);
    },
    step: (dt) => {
      now += dt * 1000;
      vm.runInContext(`update(${dt})`, sandbox);
    }
  };
}

function supportHeight(state, node) {
  const support = state.world.platforms.find((platform) => platform.kind !== "ground" && node.x + node.w > platform.x && node.x < platform.x + platform.w);
  return support?.y ?? 520;
}

test("the player can walk, jump, and mine the first copper without taking damage", () => {
  const game = loadGame();
  game.click("#start-button");

  const state = game.state();
  const copper = state.nodes.find((node) => node.type === "copper");
  const startingHealth = state.player.hp;
  game.press("ArrowRight");
  for (let frame = 0; frame < 15; frame += 1) game.step(0.035);
  game.release("ArrowRight");

  assert.ok(state.player.x >= 400, "the player should reach pickaxe range of the first ore");
  assert.equal(state.player.hp, startingHealth, "near-camp movement should not expose the player to distant enemies");

  game.press("Space");
  game.step(0.035);
  game.release("Space");

  game.press("KeyJ");
  game.release("KeyJ");

  assert.equal(copper.hp, 2, "a jump followed by a pickaxe hit should chip the first copper node");
});

test("the camera follows eastward movement on a phone-sized screen", () => {
  const game = loadGame(390);
  game.click("#start-button");

  const state = game.state();
  game.press("ArrowRight");
  for (let frame = 0; frame < 90; frame += 1) game.step(0.035);
  game.release("ArrowRight");

  const playerScreenX = state.player.x - state.camera.x;
  assert.ok(state.camera.x > 0, "the camera should scroll east as the player advances");
  assert.ok(playerScreenX >= 0 && playerScreenX < 390, "the player should remain visible in the viewport");
});

test("D and the right arrow both move the player east", () => {
  for (const code of ["KeyD", "ArrowRight"]) {
    const game = loadGame();
    game.click("#start-button");

    const state = game.state();
    const startingX = state.player.x;
    game.press(code);
    for (let frame = 0; frame < 8; frame += 1) game.step(0.035);
    game.release(code);

    assert.ok(state.player.x > startingX, `${code} should move east`);
  }
});

test("Space jumps and E activates the camp bedroll", () => {
  const game = loadGame();
  game.click("#start-button");

  const state = game.state();
  state.player.grounded = true;
  game.press("Space");
  assert.equal(state.player.vy, -520);

  state.player.grounded = true;
  game.press("KeyE");
  assert.equal(state.flags.bedroll, true);
});

test("touch controls move the player, jump, and interact", () => {
  const game = loadGame();
  game.click("#start-button");

  const state = game.state();
  const startingX = state.player.x;
  game.mobile("right", "pointerdown");
  for (let frame = 0; frame < 15; frame += 1) game.step(0.035);
  game.mobile("right", "pointerup");
  assert.ok(state.player.x > startingX);

  state.player.grounded = true;
  game.mobile("jump", "pointerdown");
  assert.equal(state.player.vy, -520);

  state.player.x = 10 * 32;
  state.player.y = 470;
  game.mobile("interact", "pointerdown");
  assert.equal(state.flags.bedroll, true);
});

test("a quick tap on the right touch control moves the player east", () => {
  const game = loadGame();
  game.click("#start-button");

  const state = game.state();
  const startingX = state.player.x;
  game.mobile("right", "pointerdown");
  game.mobile("right", "pointerup");
  for (let frame = 0; frame < 6; frame += 1) game.step(0.035);

  assert.ok(state.player.x >= startingX + 20, "a brief touch should visibly advance the player east");
});

test("releasing another touch control does not stop held eastward movement", () => {
  const game = loadGame();
  game.click("#start-button");

  const state = game.state();
  const startingX = state.player.x;
  game.mobile("right", "pointerdown", 1);
  game.mobile("use", "pointerdown", 2);
  game.mobile("use", "pointerup", 2);
  for (let frame = 0; frame < 8; frame += 1) game.step(0.035);
  game.mobile("right", "pointerup", 1);

  assert.ok(state.player.x > startingX, "releasing attack should leave the right direction pressed");
});

test("mouse and touch attack controls can mine a reachable copper node", () => {
  for (const input of ["mouse", "touch"]) {
    const game = loadGame();
    game.click("#start-button");

    const state = game.state();
    const copper = state.nodes.find((node) => node.type === "copper");
    state.player.x = copper.x - 42;
    state.player.y = copper.y - 14;
    state.player.facing = 1;
    if (input === "mouse") game.pointerDown();
    else game.mobile("use", "pointerdown");

    assert.equal(copper.hp, 2, `${input} attack input should chip copper`);
  }
});

test("every resource type can be struck from the surface above it", () => {
  const game = loadGame();
  game.click("#start-button");

  const state = game.state();
  state.enemies = [];
  for (const node of state.nodes) {
    state.player.x = node.x - 42;
    state.player.y = supportHeight(state, node) - state.player.h;
    state.player.vx = 0;
    state.player.vy = 0;
    state.player.grounded = true;
    state.player.facing = 1;
    state.player.attackCooldown = 0;

    game.press("Space");
    game.step(0.035);
    game.release("Space");
    game.press("KeyJ");
    game.release("KeyJ");

    assert.equal(node.hp, node.maxHp - 1, `${node.type} node ${node.id} should be within a jump and pickaxe strike`);
  }
});

test("three starter copper nodes unlock the Rivet Sling at the workshop", () => {
  const game = loadGame();
  game.click("#start-button");

  const state = game.state();
  state.enemies = [];
  const copperNodes = state.nodes.filter((node) => node.type === "copper").slice(0, 3);
  for (const node of copperNodes) {
    for (let hit = 0; hit < node.maxHp; hit += 1) {
      state.player.x = node.x - 42;
      state.player.y = node.y - 14;
      state.player.vx = 0;
      state.player.vy = 0;
      state.player.facing = 1;
      state.player.attackCooldown = 0;
      game.press("KeyJ");
      game.release("KeyJ");
    }
  }

  assert.equal(state.resources.copper, 3);
  state.player.x = 58 * 32;
  state.player.y = 480;
  state.player.grounded = true;
  game.press("KeyE");

  assert.equal(state.flags.workshop, true);
  assert.equal(state.player.tool, 1);
});
