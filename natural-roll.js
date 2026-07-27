import { DSNPatcher } from "./src/DSNPatcher.js";

console.log("%cNatural Roll %c| Script file parsed and running!", "color: #00ffaa; font-weight: bold; background: #222; padding: 2px 4px; border-radius: 3px;", "color: inherit;");

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

    game.settings.register("natural-roll", "enableTimeout", {
        name: "Enable Auto-Roll Timeout",
        hint: "Automatically roll the dice if they are not picked up after a certain amount of time.",
        scope: "world",
        config: true,
        restricted: true,
        type: Boolean,
        default: true
    });

    game.settings.register("natural-roll", "timeoutDuration", {
        name: "Auto-Roll Timeout (Seconds)",
        hint: "Number of seconds to wait before auto-rolling if the dice are not picked up.",
        scope: "world",
        config: true,
        restricted: true,
        type: Number,
        default: 15,
        range: {
            min: 3,
            max: 60,
            step: 1
        }
    });

    game.settings.register("natural-roll", "grabRadius", {
        name: "Grab Radius (Pixels)",
        hint: "Minimum pixel distance from a die required to grab/pick it up.",
        scope: "world",
        config: true,
        restricted: true,
        type: Number,
        default: 80,
        range: {
            min: 20,
            max: 200,
            step: 5
        }
    });

    DSNPatcher.init();
});

Hooks.once('ready', () => {
    console.log("Natural Roll | Hooks.once('ready') callback running.");
    if (!game.modules.get("dice-so-nice")?.active) {
        ui.notifications.warn("Natural Roll requires the 'Dice So Nice!' module to be installed and active.");
    }

    if (!game.user?.isGM) {
        const gmSettings = ["enableTimeout", "timeoutDuration", "grabRadius"];
        for (const settingName of gmSettings) {
            const setting = game.settings.settings.get(`natural-roll.${settingName}`);
            if (setting) {
                setting.config = false;
            }
        }
    }
});

Hooks.once("diceSoNiceReady", (dice3d) => {
    console.log("%cNatural Roll %c| diceSoNiceReady fired globally at top-level!", "color: #00ffaa; font-weight: bold; background: #222; padding: 2px 4px; border-radius: 3px;", "color: inherit;", dice3d);
});
