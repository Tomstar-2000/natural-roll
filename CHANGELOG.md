# Changelog

All notable changes to the **Natural Roll** module will be documented in this file.

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
