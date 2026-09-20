import { log } from "./utils.js";

export class DSNAppearanceResolver {
    static resolveDieAppearance({ throwEngine, die, notationVectors = {}, rollingUserId = null }) {
        if (die.resolvedAppearance) {
            return die.resolvedAppearance;
        }

        const dicefactory = throwEngine?.dicefactory;
        const rollingUserDoc = (rollingUserId ? game.users?.get(rollingUserId) : null) || game.user;

        const baseConfigAppearance = notationVectors?.dsnConfig?.appearance
            || (game.dice3d?.constructor?.ALL_CUSTOMIZATION ? game.dice3d.constructor.ALL_CUSTOMIZATION(rollingUserDoc, dicefactory)?.appearance : null)
            || (game.dice3d?.constructor?.APPEARANCE ? game.dice3d.constructor.APPEARANCE(rollingUserDoc) : null)
            || (game.dice3d?.ALL_CUSTOMIZATION ? game.dice3d.ALL_CUSTOMIZATION(rollingUserDoc, dicefactory)?.appearance : null)
            || (game.dice3d?.APPEARANCE ? game.dice3d.APPEARANCE(rollingUserDoc) : null)
            || dicefactory?.userAppearance;

        const flavorToTry = die.options?.flavor 
            || die.options?.damageType 
            || game.dice3d?._currentLocalRoll?.options?.flavor 
            || game.dice3d?._currentLocalRoll?.options?.type;

        if (flavorToTry && !die.options?.flavor) {
            die.options = die.options || {};
            die.options.flavor = flavorToTry;
        }

        let appearance = dicefactory?.getAppearanceForDice(
            baseConfigAppearance,
            die.type,
            die
        ) || {};

        if (flavorToTry && !die.options?.colorset) {
            const colorsetData = this.getColorsetData(flavorToTry);
            if (colorsetData) {
                appearance.colorset = flavorToTry;
                if (colorsetData.foreground) appearance.foreground = colorsetData.foreground;
                if (colorsetData.background) appearance.background = colorsetData.background;
                if (colorsetData.outline) appearance.outline = colorsetData.outline;
                if (colorsetData.edge) appearance.edge = colorsetData.edge;
                if (colorsetData.texture) appearance.texture = colorsetData.texture;
                if (colorsetData.material) appearance.material = colorsetData.material;
                if (colorsetData.font) appearance.font = colorsetData.font;
            }
        }

        if (die.options?.appearance) {
            appearance = foundry.utils.mergeObject(appearance, die.options.appearance);
        }
        if (die.options?.colorset) {
            appearance.colorset = die.options.colorset;
        }
        if (die.options?.diceColor) {
            appearance.diceColor = die.options.diceColor;
            appearance.background = die.options.diceColor;
        }
        if (die.options?.labelColor) {
            appearance.labelColor = die.options.labelColor;
            appearance.foreground = die.options.labelColor;
        }
        if (die.options?.outlineColor) {
            appearance.outlineColor = die.options.outlineColor;
            appearance.outline = die.options.outlineColor;
        }
        if (die.options?.edgeColor) {
            appearance.edgeColor = die.options.edgeColor;
            appearance.edge = die.options.edgeColor;
        }
        if (die.options?.texture) {
            appearance.texture = die.options.texture;
        }
        if (die.options?.material) {
            appearance.material = die.options.material;
        }
        if (die.options?.system) {
            appearance.system = die.options.system;
        }

        if (appearance && (!appearance.system || !dicefactory?.systems?.has(appearance.system))) {
            appearance.system = "standard";
        }

        return appearance;
    }

    static getColorsetData(colorsetName) {
        if (!colorsetName) return null;

        const dsnColorSets = game.dice3d?.exports?.COLORSETS 
            || game.dice3d?.constructor?.COLORSETS 
            || game.dice3d?.CONFIG?.()?.COLORSETS 
            || {};

        if (!dsnColorSets[colorsetName]) {
            return null;
        }

        const getColorSetFn = game.dice3d?.exports?.DiceColors?.getColorSet
            || game.dice3d?.constructor?.DiceColors?.getColorSet
            || globalThis.DiceColors?.getColorSet;

        return getColorSetFn ? getColorSetFn(colorsetName) : null;
    }

    static mergeMaterialData(appearance = {}, matData) {
        if (!matData) return appearance;
        return foundry.utils.mergeObject(appearance, {
            background: Array.isArray(matData.background) ? matData.background[0] : (matData.background || appearance.background),
            foreground: Array.isArray(matData.foreground) ? matData.foreground[0] : (matData.foreground || appearance.foreground),
            outline: Array.isArray(matData.outline) ? matData.outline[0] : (matData.outline || appearance.outline),
            edge: Array.isArray(matData.edge) ? matData.edge[0] : (matData.edge || appearance.edge),
            texture: matData.texture?.name || (typeof matData.texture === "string" ? matData.texture : (appearance.texture?.name || appearance.texture)),
            material: matData.material || appearance.material,
            font: matData.font || appearance.font,
            fontScale: matData.fontScale ?? appearance.fontScale
        });
    }
}
