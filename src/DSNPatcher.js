import { log, error } from "./utils.js";
import { shouldAutoRoll as dnd5eShouldAutoRoll } from "./systems/dnd5e.js";
import { shouldAutoRoll as daggerheartShouldAutoRoll, preEvaluate as daggerheartPreEvaluate, preEvaluateInit as daggerheartPreEvaluateInit } from "./systems/daggerheart.js";
import { DiceInteractionManager } from "./DiceInteractionManager.js";

function shouldAutoRoll(roll) {
    const systemId = game.system?.id;
    if (systemId === "dnd5e") {
        return dnd5eShouldAutoRoll(roll);
    }
    if (systemId === "daggerheart") {
        return daggerheartShouldAutoRoll(roll);
    }
    return false;
}


let nextRollIsManual = false;

export class DSNPatcher {
    static init() {
        const RollTermClass = foundry.dice?.terms?.RollTerm;
        if (RollTermClass) {
            Object.defineProperty(RollTermClass.prototype, "options", {
                get() {
                    return this._options || {};
                },
                set(val) {
                    const oldOptions = this._options || {};
                    this._options = val || {};
                    if (oldOptions.naturalRollDieId && !this._options.naturalRollDieId) {
                        this._options.naturalRollDieId = oldOptions.naturalRollDieId;
                    }
                    if (oldOptions.isNaturalRollManual && !this._options.isNaturalRollManual) {
                        this._options.isNaturalRollManual = oldOptions.isNaturalRollManual;
                    }
                    if (oldOptions.appearance && !this._options.appearance) {
                        this._options.appearance = oldOptions.appearance;
                    }
                    if (oldOptions.modelFile && !this._options.modelFile) {
                        this._options.modelFile = oldOptions.modelFile;
                    }
                },
                configurable: true,
                enumerable: true
            });
        }

        Hooks.on("diceSoNiceReady", () => {
            log("diceSoNiceReady fired inside init().");
            DSNPatcher.patchDSN();
        });

        if (game.dice3d) {
            log("game.dice3d already exists, patching immediately.");
            DSNPatcher.patchDSN();
        }

        const originalEvaluate = Roll.prototype.evaluate;
        Roll.prototype.evaluate = async function(options = {}) {
            if (game.system?.id === "daggerheart") {
                daggerheartPreEvaluateInit(this);
            }
            const roll = await originalEvaluate.call(this, options);
            if (!game.settings.get("natural-roll", "enabled")) return roll;

            const isAuto = shouldAutoRoll(roll);
            if (isAuto) return roll;

            const timeSinceLastRoll = Date.now() - (DiceInteractionManager.lastCompletedRollTime || 0);
            const cleanFormula = (f) => f ? f.toLowerCase().replace(/[^0-9d+\-*/\s]/g, "").replace(/\s+/g, "") : "";
            const isSameFormula = cleanFormula(DiceInteractionManager.lastCompletedFormula) === cleanFormula(roll.formula);
            if (game.dice3d?._currentLocalRoll || (timeSinceLastRoll < 5000 && isSameFormula)) {
                return roll;
            }

            roll.options = roll.options || {};
            roll.options.isNaturalRollManual = true;

            if (game.system?.id === "daggerheart") {
                await daggerheartPreEvaluate(roll);
            }

            if (game.dice3d) {
                log("Intercepted Roll.evaluate for manual roll. Showing dice...");
                game.dice3d._currentLocalRoll = roll;

                const manualRollPromise = new Promise((resolve) => {
                    roll._naturalRollResolve = resolve;
                });
                try {
                    await game.dice3d.showForRoll(roll, game.user, true);
                    await manualRollPromise;
                } catch (err) {
                    error("Error playing manual roll in Roll.evaluate:", err);
                } finally {
                    DiceInteractionManager.lastCompletedFormula = roll.formula;
                    DiceInteractionManager.lastCompletedRollTime = Date.now();
                    game.dice3d._currentLocalRoll = null;
                    delete roll._naturalRollResolve;
                }
            }
            return roll;
        };

        Hooks.on("preCreateChatMessage", (message, options, userId) => {
            const authorId = message.author?.id || message.user?.id || userId;
            if (authorId && authorId !== game.user.id) return;

            const rolls = message.rolls || [];
            if (rolls.length === 0) return;

            const isAutoRoll = rolls.some(roll => shouldAutoRoll(roll));
            if (isAutoRoll) return;

            rolls.forEach(roll => {
                roll.options = roll.options || {};
                roll.options.isNaturalRollManual = true;
            });
            const serializedRolls = rolls.map(roll => {
                const rollJSON = roll.toJSON();
                rollJSON.options = rollJSON.options || {};
                rollJSON.options.isNaturalRollManual = true;
                return rollJSON;
            });
            message.updateSource({ rolls: serializedRolls });

            if (game.dice3d) {
                game.dice3d._isLocalRollInitiation = true;
                setTimeout(() => {
                    if (game.dice3d) {
                        game.dice3d._isLocalRollInitiation = false;
                    }
                }, 1000);
            }

            log("Broadcasting pre-grab event from preCreateChatMessage...");
            game.socket.emit("module.natural-roll", {
                type: "grab",
                user: game.user.id
            });
        });
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

                const isReplay = throws.some(t => t.isNaturalRollReplay);
                if (isReplay) {
                    log("Playing manual roll replay (unified batch).");
                    this._simulationReady = false;
                    const replayPayload = throws.find(t => t.isNaturalRollReplay)?.replayPayload;
                    if (replayPayload) {
                        DiceInteractionManager.prepareReplayIntercept(this, replayPayload);
                    }
                    return originalStartUnifiedBatch.call(this, throws, persistentThrowData, callback);
                }

                const isManual = throws.some(t => t.isNaturalRollManual);

                if (!isManual) {
                    log("Bypassing manual roll (auto-roll matched).");
                    return originalStartUnifiedBatch.call(this, throws, persistentThrowData, callback);
                }

                const rollingUserId = throws.find(t => t.naturalRollUser)?.naturalRollUser || game.user.id;
                log("Triggering manual hold-and-roll screen.");
                await DiceInteractionManager.handleHoldAndRoll(this, throws, callback, rollingUserId);
            };
        } else if (engineProto.start_throw) {
            const originalStartThrow = engineProto.start_throw;
            engineProto.start_throw = async function(throws, callback) {
                if (!game.settings.get("natural-roll", "enabled")) {
                    return originalStartThrow.call(this, throws, callback);
                }

                const isReplay = throws.some(t => t.isNaturalRollReplay);
                if (isReplay) {
                    log("Playing manual roll replay (start_throw).");
                    this._simulationReady = false;
                    const replayPayload = throws.find(t => t.isNaturalRollReplay)?.replayPayload;
                    if (replayPayload) {
                        DiceInteractionManager.prepareReplayIntercept(this, replayPayload);
                    }
                    return originalStartThrow.call(this, throws, callback);
                }

                const isManual = throws.some(t => t.isNaturalRollManual);

                if (!isManual) {
                    log("Bypassing manual roll (auto-roll matched).");
                    return originalStartThrow.call(this, throws, callback);
                }

                const rollingUserId = throws.find(t => t.naturalRollUser)?.naturalRollUser || game.user.id;
                log("Triggering manual hold-and-roll screen.");
                await DiceInteractionManager.handleHoldAndRoll(this, throws, callback, rollingUserId);
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

        if (engineProto.spawnDiceMesh) {
            const originalSpawnDiceMesh = engineProto.spawnDiceMesh;
            engineProto.spawnDiceMesh = async function(dicedata, appearance, diceLibrary, workerSpecs) {
                if (dicedata && (dicedata.id === undefined || dicedata.id === null)) {
                    dicedata.id = (typeof randomID === "function") ? randomID() : (foundry?.utils?.randomID ? foundry.utils.randomID() : Math.random().toString(36).substring(2, 15));
                }
                const result = await originalSpawnDiceMesh.call(this, dicedata, appearance, diceLibrary, workerSpecs);
                const dicemesh = this.diceList[this.diceList.length - 1];
                if (dicemesh) {
                    const termId = dicedata.options?.naturalRollDieId;
                    if (termId && dicedata.id && String(dicedata.id).startsWith(`${termId}-`)) {
                        dicemesh.userData.rollerId = dicedata.id;
                    } else {
                        dicemesh.userData.rollerId = termId ? `${termId}-${dicedata.id}` : dicedata.id;
                    }
                }
                return result;
            };
        }

        if (engineProto.spawnDice) {
            const originalSpawnDice = engineProto.spawnDice;
            engineProto.spawnDice = async function(dicedata, appearance, diceLibrary) {
                if (dicedata && (dicedata.id === undefined || dicedata.id === null)) {
                    dicedata.id = (typeof randomID === "function") ? randomID() : (foundry?.utils?.randomID ? foundry.utils.randomID() : Math.random().toString(36).substring(2, 15));
                }
                const result = await originalSpawnDice.call(this, dicedata, appearance, diceLibrary);
                const dicemesh = this.diceList[this.diceList.length - 1];
                if (dicemesh) {
                    const termId = dicedata.options?.naturalRollDieId;
                    if (termId && dicedata.id && String(dicedata.id).startsWith(`${termId}-`)) {
                        dicemesh.userData.rollerId = dicedata.id;
                    } else {
                        dicemesh.userData.rollerId = termId ? `${termId}-${dicedata.id}` : dicedata.id;
                    }
                }
                return result;
            };
        }

        if (engineProto.swapDiceFace) {
            const originalSwapDiceFace = engineProto.swapDiceFace;
            engineProto.swapDiceFace = function(dicemesh, faceValue) {
                if (game.dice3d?._naturalRollReplayActive) {
                    log("Bypassing swapDiceFace during replay");
                    return Promise.resolve();
                }
                return originalSwapDiceFace.call(this, dicemesh, faceValue);
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
            game.dice3d.showForRoll = function(roll, user = game.user, synchronize, users, blind, messageID, speaker, options) {
                DSNPatcher.patchDSNSync();
                if (!game.settings.get("natural-roll", "enabled")) {
                    return originalShowForRoll.call(this, roll, user, synchronize, users, blind, messageID, speaker, options);
                }

                const rollDice = roll.dice || [];
                if (!game.settings.get("natural-roll", "enableReplay")) {
                    rollDice.forEach(die => {
                        if (die.results) {
                            die.results.forEach(r => {
                                if (r.vectors) delete r.vectors;
                            });
                        }
                    });
                }
                const rollResults = rollDice.flatMap(d => (d.results || []).map(r => r.result)).sort();
                const hasResults = rollResults.length > 0;
                let rollingUserId = user?.id || user || game.user.id;
                if (messageID) {
                    const msg = game.messages.get(messageID);
                    if (msg) {
                        rollingUserId = msg.author?.id || msg.user?.id || rollingUserId;
                    }
                }
                const isRollingUser = (!messageID && synchronize !== false) || (rollingUserId === game.user.id && !!this._isLocalRollInitiation);

                if (!messageID && synchronize !== false) {
                    this._isLocalRollInitiation = true;
                    this._currentLocalRoll = roll;
                    
                    game.socket.emit("module.natural-roll", {
                        type: "grab",
                        user: rollingUserId
                    });
                }

                const now = Date.now();
                if (now - (DiceInteractionManager.lastCompletedRollTime || 0) < 8000) {
                    DiceInteractionManager.lastCompletedRollTime = 0;
                    this._currentLocalRoll = null;
                    return Promise.resolve(false);
                }

                if (!isRollingUser) {
                    const isManual = roll.options?.isNaturalRollManual || rollDice.some(d => d.options?.isNaturalRollManual);
                    if (isManual && !game.settings.get("natural-roll", "enableReplay")) {
                        log("Bypassing manual roll on remote client: Replay is disabled.");
                        this._currentLocalRoll = null;
                        return Promise.resolve(false);
                    }

                    DiceInteractionManager.recentReplays = DiceInteractionManager.recentReplays || [];
                    const matchedReplayIndex = DiceInteractionManager.recentReplays.findIndex(replay => {
                        return replay.user === rollingUserId &&
                               JSON.stringify(replay.results) === JSON.stringify(rollResults) &&
                               (now - replay.timestamp) < 8000;
                    });
                    
                    if (matchedReplayIndex !== -1) {
                        DiceInteractionManager.recentReplays.splice(matchedReplayIndex, 1);
                        this._currentLocalRoll = null;
                        return Promise.resolve(false);
                    }
                }

                if (isRollingUser) {
                    const isAuto = shouldAutoRoll(roll);
                    rollDice.forEach(die => {
                        die.options = die.options || {};
                        die.options.naturalRollDieId = die.options.naturalRollDieId || ((typeof randomID === "function") ? randomID() : (foundry?.utils?.randomID ? foundry.utils.randomID() : Math.random().toString(36).substring(2, 15)));
                        if (!isAuto) {
                            die.options.isNaturalRollManual = true;
                        }
                    });
                }

                const cleanup = () => {
                    const isAuto = shouldAutoRoll(roll);
                    if (!isRollingUser || isAuto) {
                        if (this._currentLocalRoll === roll) {
                            this._currentLocalRoll = null;
                        }
                    }
                    this._isLocalRollInitiation = false;
                };

                let promise;
                if (!isRollingUser) {
                    promise = originalShowForRoll.call(this, roll, user, synchronize, users, blind, messageID, speaker, options);
                } else {
                    const autoRoll = shouldAutoRoll(roll);
                    this._lastShowForRollWasAutoRoll = autoRoll;
                    const syncOption = autoRoll ? synchronize : false;
                    promise = originalShowForRoll.call(this, roll, user, syncOption, users, blind, messageID, speaker, options);
                }

                if (promise && typeof promise.then === "function") {
                    promise.finally(cleanup);
                } else {
                    cleanup();
                }
                return promise;
            };

            const originalShow = game.dice3d.show;
            game.dice3d.show = function(data, user = game.user, synchronize = false, users = null, blind, speaker = null) {
                DSNPatcher.patchDSNSync();
                if (!game.settings.get("natural-roll", "enabled")) {
                    return originalShow.call(this, data, user, synchronize, users, blind, speaker);
                }

                const rollingUserId = user?.id || user || game.user.id;
                data.naturalRollUser = rollingUserId;

                const isReplay = data.isNaturalRollReplay || data.throws?.some(t => t.isNaturalRollReplay);
                if (!isReplay && game.dice3d) {
                    game.dice3d._naturalRollReplayPrepared = false;
                    game.dice3d._naturalRollReplayActive = false;
                    const worker = this.box?.physicsWorker;
                    if (worker && worker._originalExec) {
                        worker.exec = worker._originalExec;
                        delete worker._originalExec;
                        log("Replay Interceptor: force restored original worker.exec for new normal roll");
                    }
                }

                const isRollingUser = !!synchronize || !!this._isLocalRollInitiation;

                const isAutoRoll = !!this._lastShowForRollWasAutoRoll;
                this._lastShowForRollWasAutoRoll = false;

                const isManual = isRollingUser && !isReplay && !isAutoRoll;

                if (isManual) {
                    if (data.throws) {
                        for (const t of data.throws) {
                            t.isNaturalRollManual = true;
                            t.naturalRollUser = rollingUserId;
                        }
                    }
                }

                if (!isRollingUser) {
                    const isManualRoll = data.throws?.some(t => t.isNaturalRollManual || t.dice?.some(d => d.options?.isNaturalRollManual));
                    const isGrabActive = DiceInteractionManager.activeGrabs?.has(rollingUserId);

                    if ((isManualRoll || isGrabActive) && !isReplay) {
                        log(`Bypassing manual/grab roll rendering for remote user ${rollingUserId}.`);
                        return Promise.resolve(false);
                    }
                }

                return originalShow.call(this, data, user, synchronize, users, blind, speaker);
            };

            const originalShowAnimation = game.dice3d._showAnimation;
            game.dice3d._showAnimation = function(data, config) {
                DSNPatcher.patchDSNSync();
                if (!game.settings.get("natural-roll", "enabled")) {
                    return originalShowAnimation.call(this, data, config);
                }

                const rollingUserId = data.naturalRollUser || data.user?.id || data.user || data.throws?.[0]?.user || game.user.id;
                const isRollingUser = (rollingUserId === game.user.id);
                const isManualRoll = data.throws?.some(t => t.dice?.some(d => d.options?.naturalRollDieId));
                const isReplay = data.isNaturalRollReplay || data.throws?.some(t => t.isNaturalRollReplay);

                const isGrabActive = DiceInteractionManager.activeGrabs?.has(rollingUserId);

                if (!isRollingUser && (isManualRoll || isGrabActive) && !isReplay) {
                    log("Bypassing duplicate _showAnimation (already handled by manual roll, grab, socket replay, or replay disabled).");
                    return Promise.resolve(false);
                }

                return originalShowAnimation.call(this, data, config);
            };

            log("Patched game.dice3d methods successfully.");
        }
    }
}
