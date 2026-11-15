# Mammoth Space Battles tech tree

Open index.html in a browser from this folder. Keep the files together. No installation or server is needed. In Design view, select a node to inspect its prerequisites, unlocks and notes. Use Fit map for an overview or scroll the map at actual size.

Choose Player view from the header, or append ?view=player to the browser address. The starting workbench is already satisfied. Other root nodes are available, and the preview shows the rest as locked until all their prerequisites are marked complete. Progress is simulated and saved in this browser when local storage is available. It has no connection to a game save. Undo completion clears progress that depends on that unlock.

## Editing with Codex

Open this repository in a Codex chat and point Codex to [`docs/tools/tech-tree/tech-tree.js`](tech-tree.js).

For example, ask: “Add a smelting unlock after Basic tools. Keep its inputs and the source of iron open. Update the tech-tree data and check the prerequisites.” Refresh the browser after the edit. Both views read the same file.

- **nodes** holds each unlock, with a stable unique ID, title, zero-based phase index and player description. Optional notes appear in Design view. Set pending to a short explanation for an unresolved recipe. It appears in both views and player progress cannot complete that node. Use starting: true for a prerequisite-free unlock the player already has at the beginning. Preserve IDs when renaming to retain progress and references.
- **edges** holds [prerequisite ID, unlock ID] pairs. All incoming prerequisites are required. Leave an edge out while a proposed dependency is open. Unknown IDs, duplicate edges and cycles trigger an error in the app.
- **firstAcquisition** holds directed [source ID, unlock ID] pairs for the first route to a material. These are shown as dashed paths and count toward preview progression.
- **conversions** holds [input ID, output ID, recipe label] triples. Both directions may be listed, and these recipes have no effect on prerequisite edges or progress.
- **operations** holds [source ID, target ID, description] triples for operating relationships, shown on both component cards in the inspector. These have no effect on crafting prerequisites or progress.
- **opening** holds Design view notes about the starting conditions and tentative opening sequence.
- **loop** holds repeatable expedition steps. These are displayed below the tree and have no effect on unlock states.
- **phases** provides the phase labels. The graph computes columns from prerequisites and uses source node order for nodes at the same depth. Optional minColumn places a node farther right without adding prerequisites.

The starting workbench and wood from moon flora are available without crafting prerequisites. Vines grant rope immediately. String follows rope on the first acquisition path. Both reversible recipes appear in the inspector. Iron is a root node while its acquisition gate is open.

## Game spec notes

- **Mammoth Jetpack.** The heavy starting jetpack reaches nearly the entire moon in short bursts. It overheats, needs time to cool down, and cannot escape the moon. It remains useful for local exploration and may get upgrades.
- **Copper and the workshop.** Finding Copper unlocks the Advanced Workbench recipe. Build the station with Copper at the starting workbench. The exact source of Copper and whether reaching it requires a jetpack are open. Both the Continuous Rocket and Cockpit use Copper at the Advanced Workbench.
- **Freeform spacecraft.** Place components in any configuration and attempt to fly. Controllable flight needs a cockpit, a Control Router and propulsion. Fuel tanks supply the rockets. One cockpit, one Control Router, one tank and two rockets is one possible build. Part counts and layout are player choices. The tree tracks access to part types for this first launch path.
- **Control Router.** In the planned ship-layout UI, select this component to choose what pressing left, right, up and down in the cockpit does to the rockets. The prototype preview assumes the router is obtainable. Its crafting ingredients and station are open. It is the last currently planned moon-tier component.
- **First launch.** Continuous Rocket supplies sustained thrust without the jetpack’s burst cooldown and is intended to enable flight beyond the moon. The expedition loop is to configure a ship, go off-moon, bring back and unload resources, then build or repair and repeat. Crude Rocket Fuel is a separate draft recipe with a second ingredient still to be decided.

### Moon Moon and the next propulsion tier

- **First destination and landing.** Moon Moon is a large asteroid orbiting the starting moon. Tune the best starting ship on Crude Rocket Fuel to just reach and land there with a narrow margin. The descent should feel like a lander game in the custom craft the player built, with handling that takes practice. Crude Rocket Fuel remains a draft recipe. The launch preview assumes access to it. Return fuel balance is open.
- **First mining trips.** Land and disembark, traverse with the jetpack and grappling gear, break plentiful Borate Crystal deposits with a placeholder impact tool, then carry small loads back to the craft by hand and return to base. The impact tool type and recipe are open.
- **High-performance propulsion.** Recovering Borate Crystals unlocks the abstract High-Performance Rocket Fuel recipe. Using that fuel requires a compatible High-Performance Rocket Engine. The engine requires Carbon Fibre, the working name for a draft lightweight material shared with a lighter, stronger Carbon Fibre Cockpit. The material source and recipe, along with the remaining part and fuel recipe details, are open.
- **Later destinations.** Other asteroids and other moons remain expedition possibilities. The preview places them after the first Borate Crystal trip to show the planned order.


### Later ship components

- The Generator charges the Battery. The Battery can power the Rail Gun, Tractor Beam and Energy Tether. These are operating relationships. Recipes, materials and acquisition are open.
- The Space Grappling Hook and Rope is a single early mechanical towing component. It attaches to cargo and tows it using rope physics. Energy Tether is the more advanced option.
- The Shield Generator already exists in the prototype. Its exact power hookup, recipe, materials and acquisition are open.
- The Gyroscopic Stabilizer rotates the spacecraft by changing the spin of an internal gyro and exchanging angular momentum with the hull. It could offer a more compact, controllable alternative to steering with thrusters. Its recipe, materials and acquisition are open.
- Explosive Shells are an optional Rail Gun item for breaking up asteroids during mining. The Rail Gun retains its normal firing option. Shell compatibility is an operating relationship. The shell recipe, materials and acquisition are open.
