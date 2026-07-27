import { log } from "./utils.js";

export function shouldAutoRoll(roll) {
    if (!game.modules.get("midi-qol")?.active) {
        return false;
    }
    
    try {
        const enableWorkflow = game.settings.get("midi-qol", "EnableWorkflow");
        if (enableWorkflow === false) {
            return false;
        }

        const config = globalThis.MidiQOL?.configSettings?.() || game.settings.get("midi-qol", "ConfigSettings") || {};
        const isGM = game.user?.isGM;
        
        const autoRollAttack = isGM ? config.gmAutoAttack : config.autoRollAttack;
        const autoRollDamage = isGM ? config.gmAutoDamage : config.autoRollDamage;

        const rollType = roll.options?.rollType || roll.options?.midiType;
        let isAttack = (rollType === "attack");
        let isDamage = (rollType === "damage");
        let isSave = (rollType === "save" || rollType === "saving" || rollType === "check");

        if (!rollType) {
            const flavor = (roll.options?.flavor || "").toLowerCase();
            if (flavor.includes("attack")) isAttack = true;
            if (flavor.includes("damage")) isDamage = true;
            if (flavor.includes("save") || flavor.includes("saving") || flavor.includes("check")) isSave = true;
        }

        log("Evaluating MidiQOL settings for roll type:", {
            rollType,
            isAttack,
            isDamage,
            isSave,
            autoRollAttack,
            autoRollDamage
        });

        if (isAttack && (autoRollAttack === true || autoRollAttack === "always")) {
            return true;
        }
        if (isDamage && (autoRollDamage === "always" || autoRollDamage === "onHit")) {
            return true;
        }
        
        if (isSave) {
            if (isGM) {
                const rollNPCSaves = config.rollNPCSaves || "none";
                const rollNPCLinkedSaves = config.rollNPCLinkedSaves || "none";
                if (rollNPCSaves.startsWith("auto") || rollNPCLinkedSaves.startsWith("auto")) {
                    return true;
                }
            } else {
                const playerRollSaves = config.playerRollSaves || "none";
                if (playerRollSaves.startsWith("auto")) {
                    return true;
                }
            }
        }
    } catch (e) {
        console.warn("Natural Roll | Error reading midi-qol settings:", e);
    }

    return false;
}
