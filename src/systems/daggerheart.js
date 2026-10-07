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

export async function preEvaluate(roll) {
    try {
        const dHope = roll.dHope;
        const dFear = roll.dFear;
        const isFateRoll = roll.options?.title === "Fate Roll" 
            || roll.data?.fateType 
            || roll.options?.headerTitle === "Hope"
            || roll.options?.headerTitle === "Fear"
            || roll.options?.roll?.type === "fate" 
            || roll.options?.type === "fate" 
            || roll.formula?.toLowerCase().includes("fate");

        if (dHope || dFear || isFateRoll) {
            let appearanceSettings = null;
            try {
                appearanceSettings = game.settings?.get?.("daggerheart", "Appearance")?.diceSoNiceData;
            } catch (e) {}

            const hopeData = appearanceSettings?.hope;
            const fearData = appearanceSettings?.fear;
            const advData = appearanceSettings?.advantage;
            const disadvData = appearanceSettings?.disadvantage;

            const applyPresetToTerm = (term, preset, modifier, defaultColorset) => {
                if (!term) return;

                if (modifier) {
                    if (!term.modifiers) {
                        term.modifiers = [modifier];
                    } else if (!term.modifiers.includes(modifier)) {
                        term.modifiers.push(modifier);
                    }
                }

                term.options = term.options || {};
                if (preset) {
                    Object.assign(term.options, preset);
                    term.options.appearance = { ...(term.options.appearance || {}), ...preset };
                } else if (defaultColorset) {
                    if (!term.options.colorset) {
                        term.options.colorset = defaultColorset;
                    }
                    if (!term.options.appearance) {
                        term.options.appearance = { colorset: defaultColorset };
                    } else if (!term.options.appearance.colorset) {
                        term.options.appearance.colorset = defaultColorset;
                    }
                }
            };

            const diceTerms = (roll.dice && roll.dice.length > 0) 
                ? roll.dice 
                : (roll.terms || []).filter(t => t.faces || t.results);

            if (diceTerms.length === 0) return;

            if (dHope && dFear) {
                applyPresetToTerm(diceTerms[0], hopeData, 'h', 'daggerheart-hope-colorset');
                applyPresetToTerm(diceTerms[1], fearData, 'f', 'daggerheart-fear-colorset');

                const advantageState = roll.options?.roll?.advantage?.type ?? roll.options?.roll?.advantage;
                if (diceTerms[2] && advantageState) {
                    const isAdv = advantageState === 1;
                    const advPreset = isAdv ? advData : disadvData;
                    const advMod = isAdv ? 'a' : 'd';
                    const advColorset = isAdv ? 'daggerheart-advantage-colorset' : 'daggerheart-disadvantage-colorset';
                    applyPresetToTerm(diceTerms[2], advPreset, advMod, advColorset);
                }
            } else if (isFateRoll) {
                const isFearFate = roll.data?.fateType?.toLowerCase() === "fear" || roll.options?.headerTitle?.toLowerCase() === "fear";
                const fatePreset = isFearFate ? fearData : hopeData;
                const fateMod = isFearFate ? 'f' : 'h';
                const fateColorset = isFearFate ? 'daggerheart-fear-colorset' : 'daggerheart-hope-colorset';
                applyPresetToTerm(diceTerms[0], fatePreset, fateMod, fateColorset);
            } else if (dHope) {
                applyPresetToTerm(diceTerms[0], hopeData, 'h', 'daggerheart-hope-colorset');
            } else if (dFear) {
                applyPresetToTerm(diceTerms[0], fearData, 'f', 'daggerheart-fear-colorset');
            }
        }
    } catch (err) {
        error("Error setting Daggerheart presets during Roll.evaluate:", err);
    }
}

