import { DSNPatcher } from "./src/DSNPatcher.js";

console.log("%cNatural Roll %c| Script file parsed and running!", "color: #00ffaa; font-weight: bold; background: #222; padding: 2px 4px; border-radius: 3px;", "color: inherit;");

// Register Module Hooks
Hooks.once('init', () => {
    console.log("Natural Roll | Hooks.once('init') callback running.");
    game.settings.register("natural-roll", "enabled", {
        name: "Enable Natural Roll",
        hint: "Intercept rolls and hold them on the canvas. Drag and flick to roll.",
        scope: "client",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register("natural-roll", "flickMultiplier", {
        name: "Flick Strength",
        hint: "Multiplier for your flick speed.",
        scope: "client",
        config: true,
        type: Number,
        default: 1.0,
        range: {
            min: 0.1,
            max: 5.0,
            step: 0.1
        }
    });

    // Initialize module hook listeners early to avoid load-order ready hook race conditions
    DSNPatcher.init();
});

Hooks.once('ready', () => {
    console.log("Natural Roll | Hooks.once('ready') callback running.");
    if (!game.modules.get("dice-so-nice")?.active) {
        ui.notifications.warn("Natural Roll requires the 'Dice So Nice!' module to be installed and active.");
    }
});

// Direct top-level hook registration just in case
Hooks.once("diceSoNiceReady", (dice3d) => {
    console.log("%cNatural Roll %c| diceSoNiceReady fired globally at top-level!", "color: #00ffaa; font-weight: bold; background: #222; padding: 2px 4px; border-radius: 3px;", "color: inherit;", dice3d);
});
