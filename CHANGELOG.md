# Changelog

All notable changes to the **Natural Roll** module will be documented in this file.

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
