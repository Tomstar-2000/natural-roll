# Changelog

All notable changes to the **Natural Roll** module will be documented in this file.

## [1.5.6] - 2026-09-21

### Fixed

- **Parenthetical & Compound Formula Support**: Fixed an issue where formulas containing nested parenthetical terms with mathematical operations and special system dice (e.g. `/r (1DG*100)+(1d6*10)+1DB`) failed to spawn all dice simultaneously or failed to evaluate arithmetic operations properly. Inner sub-rolls within parenthetical terms are now permitted to evaluate without premature manual interception so that the top-level roll orchestrates all dice together.
- **Recursive Roll Totals & Custom Die Labels**: Updated `applyFaceValuesToRoll` to recursively traverse and re-evaluate all inner rolls (`ParentheticalTerm` and `PoolTerm`), properly re-evaluating arithmetic expressions and totals when physics face values are applied, and dynamically preserving custom system die labels via `getResultLabel`.

## [1.5.5] - 2026-09-21

### Fixed

- **Compound & Percentile Dice Evaluation**: Resolved an issue where compound rolls (e.g. multi-digit dice such as D66 or percentile d100 rolled as tens and units) were not correctly evaluated and reflected in chat messages and roll results. Multi-mesh rolls now properly resolve their respective digit places and divisors, calculating accurate combined outcomes for percentile dice and compound dice expressions.
- **Percentile Die Result Labels**: Fixed result label formatting for tens dice (`d100` notation) so that face values are properly represented (such as displaying `"00"` for zero/hundred faces and appropriate decade labels) in Dice So Nice throw data.

## [1.5.4] - 2026-09-20

### Fixed

- **System-Agnostic Double Roll Prevention (PF2e & others)**: Resolved an issue where systems that evaluate multiple rolls sequentially as part of one action (e.g. PF2e splash damage, secondary damage instances) triggered a duplicate hold-and-roll prompt for each companion roll. A companion-roll guard now detects rolls that start within the same JS microtask chain as a completed manual roll (via an event-loop-aware flag cleared by `setTimeout(0)`) and silently skips the hold-and-roll for them. This is entirely system-agnostic and confirmed working on both Foundry V13 (DSN 5.3.4) and V14 (DSN 6+).

## [1.5.3] - 2026-09-20

### Fixed

- **DnD5e & Midi-QOL Double Roll Prevention**: Resolved an issue on DnD5e with Midi-QOL where evaluating an attack roll caused a duplicate hold-and-roll prompt due to Midi-QOL cloning the attack roll and re-submitting it without a message ID, while ensuring legitimate rerolls (inspiration, luck, abilities) proceed as expected.
- **Memory Leak & Out-of-Memory (OOM) Mitigations**: Prevented browser tab crashes and memory leaks by bounding `recentReplays` and `recentChatMessageRolls` history sizes, guarding against duplicate particle canvas overlays, cleaning up unreferenced global resize listeners, and properly purging pending grab timeouts.

## [1.5.2] - 2026-09-19

### Note

> **DO NOT enable Dice So Nice's new built-in "Interactive Rolls" setting using this module.** DSN's interactive roll feature uses Foundry's pseudo-random number generator (RNG) as its base result, whereas **Natural Roll** determines outcomes purely through real-time 3D physics simulations and does not hook into this API.

### Added

- **Dual Foundry V13 & V14 Architecture Support**: Full cross-version compatibility supporting both Foundry V14 (Latest DSN v6+ with `startUnifiedBatch`, top-down camera in XZ-plane, and `ThrowPipeline`) and Foundry V13 (DSN v5.3.4 with Z-axis camera in XY-plane).
- **Physics-Driven Swing & Idle Sway Motion**: Added responsive swinging and tilting motion to dice while held and dragged, driven by pointer velocity and smoothed via spring physics. Dice gently breathe and sway with organic, desynchronized multi-die phase shifts when held stationary.
- **Robust Engine Resolution**: Implemented `getThrowEngine` resolution helper to seamlessly bridge `DiceBox` and `ThrowEngine` across all roll, replay, and interaction handlers.

### Fixed

- **V13 DSN `animateThrow` Destructuring TypeError**: Resolved `TypeError: (destructured parameter) is undefined` in DSN v5.3.4 by patching `physicsWorker.exec` to safely handle idle `playStep` queries during manual holds, and intercepting PIXI ticker nodes directly via linked-list inspection.
- **Cursor Tracking & Mouse Drag Follow**: Fixed cursor coordinate raycasting and canvas projection across both Z-oriented (V13) and Y-oriented (V14) camera spaces so held dice stay centered directly under the user's mouse cursor during drag gestures.
- **Multi-Dice Spacing Across Versions**: Calibrated geometric spawn offsets and spacing calculations for both V13 and V14 coordinate spaces, preventing held dice from clipping or touching regardless of pool size.
- **Bundled THREE Dependency Removal**: Removed reliance on global `THREE` variables across the swing loop and cleanup handlers, ensuring compatibility with ES-module bundled Three.js instances in DSN v6+.
- **Immediate Chat Card Display**: Linked manual roll resolution directly to physical simulation rest duration, eliminating post-throw delays before chat cards render.
- **Manual Roll Detection for Dice Notations**: Enhanced `startUnifiedBatch` and `start_throw` checks to inspect `dice[].options.isNaturalRollManual` in addition to top-level throw options.

## [1.5.1] - 2026-08-27

### Added

- **Magical Special Effects Style Options**: Introduced the client settings choice `magicalEffectStyle` supporting three visual effect styles: **Magical Smoke**, **Lightning Strike**, and **Dimensional Portal**.
- **Socket Style Synchronization**: Transmits the rolling user's selected style over sockets so remote roll replays display identically across all clients.

### Fixed

- **Rapid Same-Formula Consecutive Roll Lockout**: Decreased the consecutive same-formula roll duplicate safeguard timeout from `5000ms` to `500ms` and implemented object-level identity checks via `_naturalRollIntercepted` properties to prevent duplicate prompts without blocking rapid consecutive rolls.
- **Consecutive Roll Bypass in DSN Hooks**: Restricted the `lastCompletedRollTime` duplicate bypass check to only run when `messageID` is present to prevent blocking subsequent roll renders.
- **Canvas Projection & Bundled THREE Dependencies**: Removed the dependency on `globalThis.THREE` by cloning Three.js `Vector3` properties directly from dice meshes. Projected starting coordinates from trajectory positions inside `prepareReplayIntercept` to ensure replays spawn effects at the exact 3D start pixels instead of the screen center.

## [1.5.0] - 2026-08-20

### Added

- **Roll Visibility & Audience Control**: Added visibility boundaries to manual dice grabs and roll replays to fully support Foundry VTT's standard roll/message modes (Public Roll, Private GM Roll, Blind GM Roll, and Self Roll).
- **V13/V14 Roll/Message Mode Compatibility**: Fully supports V13/V14 `messageMode` options (`self` / `selfroll`, `gm` / `gmroll`, `blind` / `blindroll`).
- **DOM Selector Fallbacks**: Added fallback checks to query active message mode selection buttons directly from the sidebar (`#message-modes button[aria-pressed="true"]`) to dynamically capture sheet and weapon rolls.
- **Immediate Blind Roll Hiding**: Implemented instant canvas hiding and dice clearing for non-GM players when throwing blind rolls, while still routing the 3D replay to the GM's screen.

## [1.4.0] - 2026-08-20

### Added

- **Capture & Trigger Process Overhaul**: Replaced the global `nextRollIsManual` flag with robust, object-level tracking. Manual state is now marked directly on the `Roll` terms (`die.options.isNaturalRollManual`) and tracked using unique group IDs (`naturalRollDieId`). Additionally, added `game.dice3d._showAnimation` hooking to detect and bypass duplicate render passes and route manual roll replication correctly.
- **Synchronized Replay System**: Broadcasts manual rolls to remote clients, reconstructing the exact 3D physics roll animations using captured trajectory matrices (`quaternionsBuffers`, `positionsBuffers`, iterations, collisions, and landing face values) for perfect visual fidelity across players.
- **Client Settings for Replay Control**: Added the `enableReplay` configuration setting, enabling players to toggle manual roll replay playback on or off.
- **Additional Daggerheart System Support**: Added integration for the Daggerheart system (`daggerheart.js`), setting DSN Hope and Fear presets automatically.
- **Still Foundry v13.351 / Dice So Nice v5.2.5 Backward Compatibility**: Added full compatibility for Foundry v13.351 and Dice So Nice v5.2.5 environments.

### Fixed

- **Dice Tray & Multi-Dice Replay Sync**: Prevented standard Dice So Nice socket sync from hijacking manual rolls, and prioritized mesh-specific unique suffix IDs (`${termId}-${dicedata.id}`) over shared term options. This ensures both values and physical trajectories match perfectly on remote player clients for dice tray rolls and multiple-dice pools.
- **Foundry v13 / DSN v13 Compatibility**: Resolved v13 pointerup crashes and incorrect replay landing values by temporarily applying final quaternions and world matrix transformations, fetching calculated values with `await dicemesh.getValue()`, and bypassing default `swapDiceFace` rotation adjustments during replay.
- **Auto-Roll Timeout Alignment**: Synced simulated face results back to the Foundry `Roll` instance during auto-roll timeouts, ensuring chat message values match the physical landing and preventing duplicate animations from playing on remote clients.

## [1.3.2] - 2026-08-12

### Fixed

- **DSN v14 Physics Calibration**: scaled horizontal throw velocities by `3.0` and calibrated initial rotational spin (`baseSpin` increased to `40-55` rad/s) under v14 to match modern DSN force scales, preventing dice from slowing down instantly or sliding flat.
- **Bouncing Height Controls**: Kept the vertical lift velocity unscaled under v14 to prevent dice from flying too high in DSN v14's physics environment.

## [1.3.1] - 2026-08-09

### Added

- **Foundry v13.351 / Dice So Nice v5.2.5 Backward Compatibility**: Added full compatibility for Foundry v13.351 and Dice So Nice v5.2.5 environments.

### Fixed

- **Coordinate System Shifts**: Supported Z-vertical layouts in v13 (compared to Y-vertical layouts in v14) to prevent dice from spawning/dragging under the table or offset.
- **Physics Engine Launch Bug**: Calculated proper radii based on DSN scales to sit the dice correctly on the table and prevent CANNON.js from shooting them into the sky upon pointerup/release.
- **Velocity & Spin Scaling**: Scaled toss/lift velocities by a factor of 2000 and base spin under v13 to match DSN v13 pixel-scale physics coordinates, resolving instant slowing.
- **Initial Canvas Sizing**: Ensured the jQuery canvas wraps are shown at the start of interactions to prevent bounding rectangle measurements from failing with 0px (generating `NaN` coordinates).
- **Sound Setting & AudioHelper Warnings**: Added fallback queries for sound settings (`soundsSurface`, `soundsVolume`) and resolved global `AudioHelper` deprecation warnings in Foundry v13.

## [1.3.0] - 2026-08-09

### Added

- **Localization**: Added full translation and localization support for English, Spanish, French, and German settings names, hints, and notification warnings.

## [1.2.1] - 2026-08-02

### Added

- **Dice Spread / Spacing Setting**: Added a user setting to configure the spacing scale of the initial dice pool (range `0.04` to `0.12`, default `0.06`).

### Fixed

- **Settings Save Reload Bug**: Added explicit `requiresReload: false` to all setting registrations to prevent the first-time settings save from triggering an unwanted application reload and failing to persist configurations.

## [1.1.1] - 2026-08-01

### Fixed

- **Subsequent Roll Auto-Roll**: Fixed an issue where `throwEngine._simulationReady` was not reset to `false` when a new roll started, causing subsequent rolls to immediately auto-roll.
- **F11 Full Screen Auto-Roll**: Implemented a `200ms` input cooldown on pointer grabs after dice spawn to prevent the click that initiated the roll from instantly grabbing and releasing/rolling the dice when in full screen.
- **DSN Re-initialization & Resize**: Added synchronous DSN patching helpers and hooked them into `show` and `showForRoll` to ensure the module stays hooked even when DSN dynamically rebuilds the `throwEngine` during browser resizes/F11 toggles.
- **DSN settings ReferenceError**: Added safety catch blocks around DSN settings queries for `soundSurface` and `soundVolume` with graceful fallbacks and descriptive warnings to avoid `ReferenceError` crashes on certain DSN versions.

## [1.1.0] - 2026-08-01

### Added

- **Spawn Dice at Cursor**: Added a new configuration setting allowing players to spawn dice directly under their mouse cursor instead of at the center of the screen.
- **Rattle Sound Effects**: Added interactive rattling collision sound effects that trigger when shaking or dragging the dice in your hand. Supports DSN material surfaces and volume configurations.
- **Mobile/Touch Compatibility**: Extended pointer events to support `touch` and `pen` pointer types, including `pointerId` tracking to isolate multi-touch conflicts.
- **Golden Spiral Layout**: Replaced the static circle layout with a dynamic Fermat's spiral layout (using a spacing constant of `0.09`) to spread out large pools of dice cleanly.
- **Global Style Cursor Lock**: Added a dynamic cursor lock stylesheet (`* { cursor: grabbing !important; }`) during drag gestures to prevent the pointer style from resetting to a default pointer when hovering over nested sheet panels or buttons.

### Fixed

- **Stale Event Listeners & Timeouts**: Implemented try-catch-finally blocks and a unified `cleanup()` method to guarantee listeners and timeouts are detached after physics execution or auto-rolls.
- **Canvas Reset Hooks**: Hooked into DSN's `clearDice()` playback sequence to automatically invoke the cleanup method if a roll is cleared or canceled by the system.
- **Dice Spawning Squish**: Resolved clipping issues when multiple dice are held by setting the spacing constant to `0.09` and centering the first die exactly at the grab location.
