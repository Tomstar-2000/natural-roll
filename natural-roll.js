import { DSNPatcher } from "./src/DSNPatcher.js";
import { DiceInteractionManager } from "./src/DiceInteractionManager.js";

console.log("%cNatural Roll %c| Script file parsed and running!", "color: #00ffaa; font-weight: bold; background: #222; padding: 2px 4px; border-radius: 3px;", "color: inherit;");

Hooks.once('init', () => {
    console.log("Natural Roll | Hooks.once('init') callback running.");
    game.settings.register("natural-roll", "enabled", {
        name: "NATURAL_ROLL.Settings.Enabled.Name",
        hint: "NATURAL_ROLL.Settings.Enabled.Hint",
        scope: "client",
        config: true,
        requiresReload: false,
        type: Boolean,
        default: true
    });

    game.settings.register("natural-roll", "flickMultiplier", {
        name: "NATURAL_ROLL.Settings.FlickMultiplier.Name",
        hint: "NATURAL_ROLL.Settings.FlickMultiplier.Hint",
        scope: "client",
        config: true,
        requiresReload: false,
        type: Number,
        default: 1.0,
        range: {
            min: 0.1,
            max: 5.0,
            step: 0.1
        }
    });

    game.settings.register("natural-roll", "enableTimeout", {
        name: "NATURAL_ROLL.Settings.EnableTimeout.Name",
        hint: "NATURAL_ROLL.Settings.EnableTimeout.Hint",
        scope: "world",
        config: true,
        restricted: true,
        requiresReload: false,
        type: Boolean,
        default: true
    });

    game.settings.register("natural-roll", "timeoutDuration", {
        name: "NATURAL_ROLL.Settings.TimeoutDuration.Name",
        hint: "NATURAL_ROLL.Settings.TimeoutDuration.Hint",
        scope: "world",
        config: true,
        restricted: true,
        requiresReload: false,
        type: Number,
        default: 15,
        range: {
            min: 3,
            max: 60,
            step: 1
        }
    });

    game.settings.register("natural-roll", "grabRadius", {
        name: "NATURAL_ROLL.Settings.GrabRadius.Name",
        hint: "NATURAL_ROLL.Settings.GrabRadius.Hint",
        scope: "world",
        config: true,
        restricted: true,
        requiresReload: false,
        type: Number,
        default: 80,
        range: {
            min: 20,
            max: 200,
            step: 5
        }
    });

    game.settings.register("natural-roll", "spawnAtCursor", {
        name: "NATURAL_ROLL.Settings.SpawnAtCursor.Name",
        hint: "NATURAL_ROLL.Settings.SpawnAtCursor.Hint",
        scope: "client",
        config: true,
        requiresReload: false,
        type: Boolean,
        default: false
    });

    game.settings.register("natural-roll", "enableRattleSfx", {
        name: "NATURAL_ROLL.Settings.EnableRattleSfx.Name",
        hint: "NATURAL_ROLL.Settings.EnableRattleSfx.Hint",
        scope: "client",
        config: true,
        requiresReload: false,
        type: Boolean,
        default: true
    });

    game.settings.register("natural-roll", "diceSpread", {
        name: "NATURAL_ROLL.Settings.DiceSpread.Name",
        hint: "NATURAL_ROLL.Settings.DiceSpread.Hint",
        scope: "client",
        config: true,
        requiresReload: false,
        type: Number,
        default: 0.06,
        range: {
            min: 0.04,
            max: 0.12,
            step: 0.01
        }
    });

    game.settings.register("natural-roll", "enableReplay", {
        name: "NATURAL_ROLL.Settings.EnableReplay.Name",
        hint: "NATURAL_ROLL.Settings.EnableReplay.Hint",
        scope: "client",
        config: true,
        requiresReload: false,
        type: Boolean,
        default: true
    });

    DSNPatcher.init();
});

const initReady = () => {
    console.log("Natural Roll | Hooks.once('ready') callback running.");
    if (!game.modules.get("dice-so-nice")?.active) {
        ui.notifications.warn(game.i18n.localize("NATURAL_ROLL.Warnings.DsnRequired"));
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

    game.socket.on("module.natural-roll", (payload) => {
        console.log("Natural Roll | Received socket event module.natural-roll:", payload);
        if (payload.authorizedUsers && !payload.authorizedUsers.includes(game.user.id)) {
            console.log("Natural Roll | Bypassing socket event: Current user is not authorized to see this roll.");
            return;
        }
        if (payload.type === "grab") {
            DiceInteractionManager.handleGrab(payload);
        } else {
            DiceInteractionManager.handleReplay(payload);
        }
    });
};

if (game.ready) {
    initReady();
} else {
    Hooks.once('ready', initReady);
}

Hooks.once("diceSoNiceReady", (dice3d) => {
    console.log("%cNatural Roll %c| diceSoNiceReady fired globally at top-level!", "color: #00ffaa; font-weight: bold; background: #222; padding: 2px 4px; border-radius: 3px;", "color: inherit;", dice3d);
});
