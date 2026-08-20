# Changelog

All notable changes to the **Natural Roll** module will be documented in this file.

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
