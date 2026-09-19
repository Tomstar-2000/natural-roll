import { error } from "../utils.js";

export function shouldAutoRoll(roll) {
    return false;
}

export function preEvaluateInit(roll) {
    try {
        if (typeof roll.dHope !== "undefined") {
            const _ = roll.dHope;
        }
        if (typeof roll.dFear !== "undefined") {
            const _ = roll.dFear;
        }
    } catch (e) {}
}

function getDaggerheartDefaultPresets() {
    return {
        hope: {
            colorset: "daggerheart-hope-colorset",
            foreground: "#ffffff",
            background: "#ffe760",
            diceColor: "#ffe760",
            labelColor: "#ffffff",
            outlineColor: "#000000",
            edgeColor: "#ffffff",
            texture: "astralsea",
            material: "metal",
            system: "standard"
        },
        fear: {
            colorset: "daggerheart-fear-colorset",
            foreground: "#000000",
            background: "#0032b1",
            diceColor: "#0032b1",
            labelColor: "#000000",
            outlineColor: "#ffffff",
            edgeColor: "#000000",
            texture: "astralsea",
            material: "metal",
            system: "standard"
        },
        advantage: {
            colorset: "daggerheart-advantage-colorset",
            foreground: "#ffffff",
            background: "#008000",
            diceColor: "#008000",
            labelColor: "#ffffff",
            outlineColor: "#000000",
            edgeColor: "#ffffff",
            texture: "astralsea",
            material: "metal",
            system: "standard"
        },
        disadvantage: {
            colorset: "daggerheart-disadvantage-colorset",
            foreground: "#000000",
            background: "#b30000",
            diceColor: "#b30000",
            labelColor: "#000000",
            outlineColor: "#ffffff",
            edgeColor: "#000000",
            texture: "astralsea",
            material: "metal",
            system: "standard"
        }
    };
}

export async function preEvaluate(roll) {
    try {
        const dHope = roll.dHope;
        const dFear = roll.dFear;
        if (dHope && dFear) {
            let appearanceSettings = null;
            try {
                appearanceSettings = game.settings?.get?.("daggerheart", "Appearance")?.diceSoNiceData;
            } catch (e) {}

            const defaults = getDaggerheartDefaultPresets();

            const hopeData = appearanceSettings?.hope || defaults.hope;
            const fearData = appearanceSettings?.fear || defaults.fear;
            const advData = appearanceSettings?.advantage || defaults.advantage;
            const disadvData = appearanceSettings?.disadvantage || defaults.disadvantage;

            if (roll.dice[0]) {
                const hopePreset = foundry?.utils?.mergeObject ? foundry.utils.mergeObject(defaults.hope, hopeData) : { ...defaults.hope, ...hopeData };
                roll.dice[0].options = {
                    ...(roll.dice[0].options || {}),
                    ...hopePreset,
                    appearance: { ...hopePreset }
                };
            }

            if (roll.dice[1]) {
                const fearPreset = foundry?.utils?.mergeObject ? foundry.utils.mergeObject(defaults.fear, fearData) : { ...defaults.fear, ...fearData };
                roll.dice[1].options = {
                    ...(roll.dice[1].options || {}),
                    ...fearPreset,
                    appearance: { ...fearPreset }
                };
            }

            const advantageState = roll.options?.roll?.advantage?.type ?? roll.options?.roll?.advantage;
            if (roll.dice[2] && advantageState) {
                const advPreset = advantageState === 1
                    ? (foundry?.utils?.mergeObject ? foundry.utils.mergeObject(defaults.advantage, advData) : { ...defaults.advantage, ...advData })
                    : (foundry?.utils?.mergeObject ? foundry.utils.mergeObject(defaults.disadvantage, disadvData) : { ...defaults.disadvantage, ...disadvData });
                roll.dice[2].options = {
                    ...(roll.dice[2].options || {}),
                    ...advPreset,
                    appearance: { ...advPreset }
                };
            }
        }
    } catch (err) {
        error("Error setting Daggerheart presets during Roll.evaluate:", err);
    }
}

