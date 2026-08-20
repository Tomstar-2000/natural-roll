import { error } from "../utils.js";

export function shouldAutoRoll(roll) {
    return false;
}

export function preEvaluateInit(roll) {
    if (typeof roll.dHope !== "undefined") {
        const _ = roll.dHope;
    }
    if (typeof roll.dFear !== "undefined") {
        const _ = roll.dFear;
    }
}

async function localGetDiceSoNicePreset(type, faces) {
    if (!game.dice3d) return null;
    const system = game.dice3d.DiceFactory.systems.get(type.system)?.dice?.get(faces);
    if (!system) return null;

    if (system.modelFile && !system.modelLoaded) {
        await system.loadModel(game.dice3d.DiceFactory.loaderGLTF);
    } else {
        await system.loadTextures();
    }

    return {
        modelFile: system.modelFile,
        appearance: {
            ...system.appearance,
            colorset: type.colorset,
            font: type.font,
            fontScale: type.fontScale,
            ...type
        },
        sfx: {}
    };
}

async function localGetDiceSoNicePresets(roll, hopeFaces, fearFaces, advantageFaces = 'd6') {
    const appearanceSettings = game.settings.get("daggerheart", "Appearance")?.diceSoNiceData;
    if (!appearanceSettings) return null;

    return {
        hope: await localGetDiceSoNicePreset(appearanceSettings.hope, hopeFaces),
        fear: await localGetDiceSoNicePreset(appearanceSettings.fear, fearFaces),
        advantage: await localGetDiceSoNicePreset(appearanceSettings.advantage, advantageFaces),
        disadvantage: await localGetDiceSoNicePreset(appearanceSettings.disadvantage, advantageFaces)
    };
}

export async function preEvaluate(roll) {
    try {
        const dHope = roll.dHope;
        const dFear = roll.dFear;
        if (dHope && dFear) {
            const advantageState = roll.options?.roll?.advantage?.type ?? roll.options?.roll?.advantage;
            const advantageFaces = "d" + (roll.data?.rules?.roll?.defaultAdvantageDice ? Number.parseInt(roll.data.rules.roll.defaultAdvantageDice) : 6);
            const hopeFaces = "d" + (dHope.faces ?? roll.data?.rules?.dualityRoll?.defaultHopeDice ?? 12);
            const fearFaces = "d" + (dFear.faces ?? roll.data?.rules?.dualityRoll?.defaultFearDice ?? 12);

            const presets = await localGetDiceSoNicePresets(
                roll,
                hopeFaces,
                fearFaces,
                advantageFaces
            );
            if (presets) {
                if (roll.dice[0]) roll.dice[0].options = presets.hope;
                if (roll.dice[1]) roll.dice[1].options = presets.fear;
                if (roll.dice[2] && advantageState) {
                    roll.dice[2].options = advantageState === 1 ? presets.advantage : presets.disadvantage;
                }
            }
        }
    } catch (err) {
        error("Error setting Daggerheart presets during Roll.evaluate:", err);
    }
}
