# Emberfall // Field Test 01

Emberfall is a small, replayable vertical slice inspired by the prototype's **copper → Warden** thread.

The point of the slice is a complete first session, not a systems demo:

1. Mine copper around the meadow camp.
2. Wake the copper workshop and fabricate the rivet sling.
3. Traverse the Glowroot Grotto, switching between pickaxe and ranged shots.
4. Bring glow and ember to the forge and choose one of three mutations.
5. Wake the Warden and use the arena pillars, movement, and your mutation to win.

There are three biomes, five normal enemy behaviors, a boss with two attack patterns, a checkpoint, three tools, destructible resource nodes, a procedural tile language, and a mobile control strip. The route is deliberately compact: a first run should land around 20–35 minutes depending on how much the player explores and how often they get knocked out.

## Play

The public browser build is available at <https://halr9000.github.io/emberfall/>.

## Run it

```bash
npm run dev
```

Then open <http://localhost:4173>.

Controls: `A/D` or arrows to move, `Space` to jump, left click or `J` to use the equipped tool, `1–3` to swap tools, `E` to interact, `Esc` to pause.

## Handoff-friendly art

All current tiles and actors are drawn in `src/game.js` from a small palette instead of being packed into an opaque image. A collaborator can replace the tile, landmark, or actor drawing functions independently without touching progression, collision, or combat.
