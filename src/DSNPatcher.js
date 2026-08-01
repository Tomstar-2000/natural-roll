import { log } from "./utils.js";
import { shouldAutoRoll } from "./MidiQOLHelper.js";
import { DiceInteractionManager } from "./DiceInteractionManager.js";

let nextRollIsManual = false;

export class DSNPatcher {
    static init() {
        log("init() method called.");
        if (!game.dice3d) {
            log("game.dice3d not found, registering diceSoNiceReady listener.");
            Hooks.once("diceSoNiceReady", () => {
                log("diceSoNiceReady fired inside init().");
                DSNPatcher.patchDSN();
            });
        } else {
            log("game.dice3d already exists, patching immediately.");
            DSNPatcher.patchDSN();
        }
    }

    static async patchDSN() {
        log("patchDSN() starting.");
        
        if (game.dice3d?._boxReady) {
            log("Waiting for game.dice3d._boxReady promise to resolve...");
            await game.dice3d._boxReady;
        }

        if (!game.dice3d?.box?.throwEngine) {
            console.error("Natural Roll | ThrowEngine not found in game.dice3d even after waiting for box initialization!");
            return;
        }

        const throwEngine = game.dice3d.box.throwEngine;
        const originalStartUnifiedBatch = throwEngine.startUnifiedBatch;

        if (!throwEngine._patchedForNaturalRoll) {
            throwEngine._patchedForNaturalRoll = true;
            
            const originalUpdateThrowPlayback = throwEngine.updateThrowPlayback;
            throwEngine.updateThrowPlayback = function(neededSteps) {
                if (this._simulationReady === false) {
                    return;
                }
                return originalUpdateThrowPlayback.call(this, neededSteps);
            };

            const originalClearDice = throwEngine.clearDice;
            throwEngine.clearDice = function() {
                DiceInteractionManager.cleanup(this);
                return originalClearDice.apply(this, arguments);
            };
        }

        if (!game.dice3d._patchedForNaturalRoll) {
            game.dice3d._patchedForNaturalRoll = true;

            const originalShowForRoll = game.dice3d.showForRoll;
            game.dice3d.showForRoll = function(roll, user, synchronize, users, blind, messageID, speaker, options) {
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
        }

        throwEngine.startUnifiedBatch = async function(throws, persistentThrowData, callback) {
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
        log("Patched Dice So Nice! ThrowEngine successfully.");
    }
}
