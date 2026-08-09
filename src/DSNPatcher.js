import { log } from "./utils.js";
import { shouldAutoRoll as dnd5eShouldAutoRoll } from "./systems/dnd5e.js";
import { DiceInteractionManager } from "./DiceInteractionManager.js";

function shouldAutoRoll(roll) {
    const systemId = game.system?.id;
    if (systemId === "dnd5e") {
        return dnd5eShouldAutoRoll(roll);
    }
    return false;
}


let nextRollIsManual = false;

export class DSNPatcher {
    static init() {
        log("init() method called.");
        Hooks.on("diceSoNiceReady", () => {
            log("diceSoNiceReady fired inside init().");
            DSNPatcher.patchDSN();
        });

        if (game.dice3d) {
            log("game.dice3d already exists, patching immediately.");
            DSNPatcher.patchDSN();
        }
    }

    static patchDSNSync() {
        if (!game.dice3d?.box) return;
        const throwEngine = game.dice3d.box.throwEngine || game.dice3d.box;
        const engineProto = throwEngine.constructor.prototype;
        if (engineProto._patchedForNaturalRoll) return;

        engineProto._patchedForNaturalRoll = true;
        log("Patching throwEngine prototype methods (sync).");

        if (engineProto.startUnifiedBatch) {
            const originalStartUnifiedBatch = engineProto.startUnifiedBatch;
            engineProto.startUnifiedBatch = async function(throws, persistentThrowData, callback) {
                if (!game.settings.get("natural-roll", "enabled")) {
                    return originalStartUnifiedBatch.call(this, throws, persistentThrowData, callback);
                }

                const isManual = throws.some(t => t.isNaturalRollManual);

                if (!isManual) {
                    log("Bypassing manual roll (auto-roll matched).");
                    return originalStartUnifiedBatch.call(this, throws, persistentThrowData, callback);
                }

                log("Triggering manual hold-and-roll screen.");
                await DiceInteractionManager.handleHoldAndRoll(this, throws, callback);
            };
        } else if (engineProto.start_throw) {
            const originalStartThrow = engineProto.start_throw;
            engineProto.start_throw = async function(throws, callback) {
                if (!game.settings.get("natural-roll", "enabled")) {
                    return originalStartThrow.call(this, throws, callback);
                }

                const isManual = throws.some(t => t.isNaturalRollManual);

                if (!isManual) {
                    log("Bypassing manual roll (auto-roll matched).");
                    return originalStartThrow.call(this, throws, callback);
                }

                log("Triggering manual hold-and-roll screen.");
                await DiceInteractionManager.handleHoldAndRoll(this, throws, callback);
            };
        }
        
        if (engineProto.updateThrowPlayback) {
            const originalUpdateThrowPlayback = engineProto.updateThrowPlayback;
            engineProto.updateThrowPlayback = function(neededSteps) {
                if (this._simulationReady === false) {
                    return;
                }
                return originalUpdateThrowPlayback.call(this, neededSteps);
            };
        } else if (engineProto.animateThrow) {
            const originalAnimateThrow = engineProto.animateThrow;
            engineProto.animateThrow = function() {
                if (this._simulationReady === false) {
                    if (this.isVisible) {
                        this.renderScene();
                    }
                    return;
                }
                return originalAnimateThrow.apply(this, arguments);
            };
        }

        const originalClearDice = engineProto.clearDice;
        engineProto.clearDice = function() {
            DiceInteractionManager.cleanup(this);
            return originalClearDice.apply(this, arguments);
        };
        
        log("Patched Dice So Nice! ThrowEngine prototype successfully.");
    }

    static async patchDSN() {
        log("patchDSN() starting.");
        
        if (game.dice3d?._boxReady) {
            log("Waiting for game.dice3d._boxReady promise to resolve...");
            await game.dice3d._boxReady;
        }

        DSNPatcher.patchDSNSync();

        if (!game.dice3d._patchedForNaturalRoll) {
            game.dice3d._patchedForNaturalRoll = true;
            log("Patching game.dice3d methods.");

            const originalShowForRoll = game.dice3d.showForRoll;
            game.dice3d.showForRoll = function(roll, user, synchronize, users, blind, messageID, speaker, options) {
                DSNPatcher.patchDSNSync();
                if (!game.settings.get("natural-roll", "enabled")) {
                    return originalShowForRoll.call(this, roll, user, synchronize, users, blind, messageID, speaker, options);
                }

                const rollingUserId = user?.id || game.user.id;
                const isRollingUser = (rollingUserId === game.user.id);

                if (!isRollingUser) {
                    return originalShowForRoll.call(this, roll, user, synchronize, users, blind, messageID, speaker, options);
                }

                const autoRoll = shouldAutoRoll(roll);
                nextRollIsManual = !autoRoll;

                log(`showForRoll evaluated: autoRoll=${autoRoll}`);

                return originalShowForRoll.call(this, roll, user, synchronize, users, blind, messageID, speaker, options);
            };

            const originalShow = game.dice3d.show;
            game.dice3d.show = function(data, user, synchronize, users, blind, speaker) {
                DSNPatcher.patchDSNSync();
                if (!game.settings.get("natural-roll", "enabled")) {
                    return originalShow.call(this, data, user, synchronize, users, blind, speaker);
                }

                const rollingUserId = user?.id || game.user.id;
                const isRollingUser = (rollingUserId === game.user.id);

                if (isRollingUser && nextRollIsManual) {
                    if (data.throws) {
                        for (const t of data.throws) {
                            t.isNaturalRollManual = true;
                        }
                    }
                    nextRollIsManual = false;
                }

                if (!isRollingUser) {
                    const isManual = data.throws?.some(t => t.isNaturalRollManual);
                    if (isManual) {
                        log("Bypassing manual roll rendering for remote user.");
                        return Promise.resolve(false);
                    }
                }

                return originalShow.call(this, data, user, synchronize, users, blind, speaker);
            };
            log("Patched game.dice3d methods successfully.");
        }
    }
}
