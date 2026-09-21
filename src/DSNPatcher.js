import { log, error, getAuthorizedUsers, getAuthorizedUsersFromMessage } from "./utils.js";
import { shouldAutoRoll as dnd5eShouldAutoRoll, getRollType as dnd5eGetRollType } from "./systems/dnd5e.js";
import { shouldAutoRoll as daggerheartShouldAutoRoll, preEvaluate as daggerheartPreEvaluate, preEvaluateInit as daggerheartPreEvaluateInit } from "./systems/daggerheart.js";
import { DiceInteractionManager } from "./DiceInteractionManager.js";

function getSystemRollType(roll) {
    const systemId = game.system?.id;
    if (systemId === "dnd5e") {
        return dnd5eGetRollType(roll);
    }
    return roll?.options?.rollType || null;
}

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

function extractRollMode(messageText) {
    if (!messageText) return null;
    const clean = messageText.replace(/<[^>]*>/g, "").trim();
    if (clean.startsWith("/selfroll") || clean.startsWith("/self")) {
        return "selfroll";
    }
    if (clean.startsWith("/gmr") || clean.startsWith("/gmroll") || clean.startsWith("/pr")) {
        return "gmroll";
    }
    if (clean.startsWith("/br") || clean.startsWith("/blindroll")) {
        return "blindroll";
    }
    return null;
}

function buildVisibilityPayload(rollMode) {
    if (!rollMode) return null;
    return {
        whisper: rollMode === "selfroll" ? [game.user.id] : (rollMode === "gmroll" || rollMode === "blindroll" ? game.users.filter(u => u.isGM).map(u => u.id) : null),
        blind: rollMode === "blindroll",
        rollMode: rollMode
    };
}

async function handleEngineBatch(context, throws, persistentThrowData, callback, originalFn) {
    if (!game.settings.get("natural-roll", "enabled")) {
        return persistentThrowData !== undefined
            ? originalFn.call(context, throws, persistentThrowData, callback)
            : originalFn.call(context, throws, callback);
    }

    const isReplay = throws.some(t => t.isNaturalRollReplay);
    const actualEngine = context.throwEngine || context;

    if (isReplay) {
        log("Playing manual roll replay (batch).");
        const replayPayload = throws.find(t => t.isNaturalRollReplay)?.replayPayload;
        if (replayPayload) {
            DiceInteractionManager.prepareReplayIntercept(actualEngine, replayPayload);
        }
        return persistentThrowData !== undefined
            ? originalFn.call(context, throws, persistentThrowData, callback)
            : originalFn.call(context, throws, callback);
    }

    const isManual = throws.some(t => t.isNaturalRollManual || t.dice?.some(d => d.options?.isNaturalRollManual));

    if (!isManual) {
        log("Bypassing manual roll (not a manual roll or auto-roll matched).");
        return persistentThrowData !== undefined
            ? originalFn.call(context, throws, persistentThrowData, callback)
            : originalFn.call(context, throws, callback);
    }

    const rollingUserId = throws.find(t => t.naturalRollUser)?.naturalRollUser || throws[0]?.dice?.[0]?.options?.naturalRollUser || game.user.id;
    log("Triggering manual hold-and-roll screen.");
    await DiceInteractionManager.handleHoldAndRoll(actualEngine, throws, callback, rollingUserId);
}

export class DSNPatcher {
    static init() {
        Hooks.on("chatMessage", (chatLog, messageText, chatData) => {
            const rollMode = extractRollMode(messageText);
            if (rollMode) {
                globalThis._naturalRollMessageVisibility = buildVisibilityPayload(rollMode);
                setTimeout(() => {
                    if (globalThis._naturalRollMessageVisibility?.rollMode === rollMode) {
                        globalThis._naturalRollMessageVisibility = null;
                    }
                }, 15000);
            }
        });

        const originalProcessMessage = ChatLog.prototype.processMessage;
        if (originalProcessMessage) {
            ChatLog.prototype.processMessage = async function(message, ...args) {
                const rollMode = extractRollMode(message);
                if (rollMode) {
                    globalThis._naturalRollMessageVisibility = buildVisibilityPayload(rollMode);
                }
                try {
                    return await originalProcessMessage.call(this, message, ...args);
                } finally {
                    globalThis._naturalRollMessageVisibility = null;
                }
            };
        }

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

        const applyMessageVisibility = (targetRoll) => {
            if (!targetRoll || !globalThis._naturalRollMessageVisibility) return;
            targetRoll.options = targetRoll.options || {};
            targetRoll.options.rollMode = targetRoll.options.rollMode || globalThis._naturalRollMessageVisibility.rollMode;
            targetRoll.options.blind = targetRoll.options.blind !== undefined ? targetRoll.options.blind : globalThis._naturalRollMessageVisibility.blind;
            targetRoll.options.whisper = targetRoll.options.whisper || globalThis._naturalRollMessageVisibility.whisper;
        };

        let evaluateDepth = 0;
        const originalEvaluate = Roll.prototype.evaluate;
        Roll.prototype.evaluate = async function(options = {}) {
            evaluateDepth++;
            try {
                const preEvalIsAuto = shouldAutoRoll(this);
                if (!preEvalIsAuto) {
                    applyMessageVisibility(this);
                }
                if (game.system?.id === "daggerheart") {
                    daggerheartPreEvaluateInit(this);
                }
                const roll = await originalEvaluate.call(this, options);
                const isAuto = shouldAutoRoll(roll);
                if (!isAuto) {
                    applyMessageVisibility(roll);
                }
                if (!game.settings.get("natural-roll", "enabled")) return roll;

                if (isAuto) return roll;

                if (evaluateDepth > 1) {
                    return roll;
                }

                if (roll._naturalRollIntercepted) {
                    return roll;
                }

                if (game.dice3d?._currentLocalRoll && game.dice3d._currentLocalRoll !== roll) {
                    if (!game.dice3d._currentLocalRoll._evaluated) {
                        return roll;
                    }
                }

                roll._naturalRollIntercepted = true;

                if (DiceInteractionManager._companionWindowActive) {
                    log("Skipping hold-and-roll for companion roll (same microtask chain as completed manual roll).");
                    roll.options = roll.options || {};
                    roll.options._naturalRollCompleted = true;
                    roll._naturalRollCompleted = true;
                    return roll;
                }

                roll.options = roll.options || {};
                roll.options.isNaturalRollManual = true;

                if (game.system?.id === "daggerheart") {
                    await daggerheartPreEvaluate(roll);
                }

                if (game.dice3d) {
                    game.dice3d._currentLocalRoll = roll;

                    let timeoutId;
                    const timeoutPromise = new Promise((resolve) => {
                        timeoutId = setTimeout(() => resolve(roll), 60000);
                    });
                    const manualRollPromise = new Promise((resolve) => {
                        roll._naturalRollResolve = () => {
                            if (timeoutId) clearTimeout(timeoutId);
                            resolve(roll);
                        };
                    });
                    try {
                        const dsnPromise = game.dice3d.showForRoll(roll, game.user, true);
                        if (dsnPromise && typeof dsnPromise.catch === "function") {
                            dsnPromise.catch(err => error("DSN showForRoll error:", err));
                        }
                        await Promise.race([manualRollPromise, timeoutPromise]);
                    } catch (err) {
                        error("Error playing manual roll in Roll.evaluate:", err);
                    } finally {
                        if (timeoutId) clearTimeout(timeoutId);
                        roll._naturalRollCompleted = true;
                        roll.options = roll.options || {};
                        roll.options._naturalRollCompleted = true;
                        DiceInteractionManager.lastCompletedFormula = roll.formula;
                        DiceInteractionManager.lastCompletedRollType = getSystemRollType(roll);
                        DiceInteractionManager.lastCompletedResults = roll.dice ? roll.dice.flatMap(d => (d.results || []).map(r => r.result)).sort() : [];
                        DiceInteractionManager.lastCompletedRollTime = Date.now();
                        DiceInteractionManager._companionWindowActive = true;
                        if (DiceInteractionManager._companionWindowTimer) {
                            clearTimeout(DiceInteractionManager._companionWindowTimer);
                        }
                        DiceInteractionManager._companionWindowTimer = setTimeout(() => {
                            DiceInteractionManager._companionWindowActive = false;
                            DiceInteractionManager._companionWindowTimer = null;
                        }, 0);
                        if (game.dice3d) {
                            game.dice3d._currentLocalRoll = null;
                            game.dice3d._isLocalRollInitiation = false;
                        }
                        delete roll._naturalRollResolve;
                    }
                }
                return roll;
            } finally {
                evaluateDepth--;
            }
        };

        Hooks.on("preCreateChatMessage", (message, options, userId) => {
            const authorId = message.author?.id || message.user?.id || userId;
            if (authorId && authorId !== game.user.id) return;

            const rolls = message.rolls || [];
            if (rolls.length === 0) return;

            const isAutoRoll = rolls.some(roll => shouldAutoRoll(roll));
            if (isAutoRoll) return;

            const isRollCompleted = (r) => {
                if (!r) return false;
                if (r._naturalRollCompleted || r.options?._naturalRollCompleted) return true;
                if (r._evaluated) return true;
                const dice = r.dice || [];
                if (dice.length > 0 && dice.every(d => (d.results || []).length > 0)) {
                    return true;
                }
                if (r.total !== undefined && r.total !== null && !isNaN(r.total)) {
                    return true;
                }
                return false;
            };

            const now = Date.now();
            const messageDiceResults = rolls.flatMap(r => (r.dice || []).flatMap(d => (d.results || []).map(res => res.result))).sort();
            const matchesRecentManualRoll = (
                DiceInteractionManager.lastCompletedResults?.length > 0 &&
                (now - (DiceInteractionManager.lastCompletedRollTime || 0) < 6000) &&
                JSON.stringify(DiceInteractionManager.lastCompletedResults) === JSON.stringify(messageDiceResults)
            );

            const allAlreadyCompleted = rolls.every(isRollCompleted) || matchesRecentManualRoll;
            if (allAlreadyCompleted) {
                message.updateSource({
                    "flags.natural-roll.alreadyRendered": true,
                    "flags.dice-so-nice.interactive": false
                });
                DiceInteractionManager.lastCompletedRollTime = Date.now();
                return;
            }

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

            const updates = {
                rolls: serializedRolls,
                "flags.dice-so-nice.interactive": false
            };
            message.updateSource(updates);

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
                user: game.user.id,
                authorizedUsers: getAuthorizedUsersFromMessage(message)
            });
        });
    }

    static patchDSNSync() {
        if (!game.dice3d?.box) return;
        if (game.dice3d.box.animateThrow && !game.dice3d.box._originalAnimateThrow) {
            const originalBoxAnimateThrow = game.dice3d.box.animateThrow;
            game.dice3d.box._originalAnimateThrow = originalBoxAnimateThrow;
            const wrappedBoxAnimateThrow = function(delta) {
                const actualEngine = this.throwEngine || this;

                if (actualEngine._simulationReady === false) {
                    try { canvas.app?.ticker?.remove(this.animateThrow, this); } catch(e) {}
                    return;
                }

                if (!this.rolling && !actualEngine.rolling) {
                    try { canvas.app?.ticker?.remove(this.animateThrow, this); } catch(e) {}
                    return;
                }

                const isNaturalRollHoldActive = !!actualEngine._naturalRollState?._active;
                if (isNaturalRollHoldActive) {
                    const diceList = actualEngine.diceList || this.diceList || [];
                    if (diceList.length === 0) {
                        return;
                    }
                    for (const die of diceList) {
                        if (!die || !die.sim || !die.sim.stepPositions || !die.sim.stepPositions.length) {
                            return;
                        }
                    }
                }
                try {
                    const res = originalBoxAnimateThrow.call(this, delta);
                    if (res && typeof res.catch === "function") {
                        res.catch(() => {});
                    }
                    return res;
                } catch (e) {
                    return;
                }
            };
            game.dice3d.box.animateThrow = wrappedBoxAnimateThrow;

            try {
                const ticker = canvas.app?.ticker;
                if (ticker?._head) {
                    let node = ticker._head.next;
                    while (node) {
                        if (node.fn === originalBoxAnimateThrow && node.context === game.dice3d.box) {
                            node.fn = wrappedBoxAnimateThrow;
                            log("Natural Roll | Swapped pre-registered animateThrow ticker node to patched wrapper.");
                        }
                        node = node.next;
                    }
                }
            } catch(e) {}
        }

        if (game.dice3d.box._originalAnimateThrow && game.dice3d.box.animateThrow !== game.dice3d.box._originalAnimateThrow) {
            try {
                const ticker = canvas.app?.ticker;
                const box = game.dice3d.box;
                const originalFn = box._originalAnimateThrow;
                const wrappedFn = box.animateThrow;
                if (ticker?._head) {
                    let node = ticker._head.next;
                    while (node) {
                        if (node.fn === originalFn && node.context === box) {
                            node.fn = wrappedFn;
                            log("Natural Roll | Re-scan: swapped stale animateThrow ticker node to patched wrapper.");
                        }
                        node = node.next;
                    }
                }
            } catch(e) {}
        }

        const targets = [];
        if (game.dice3d.box.throwEngine) {
            targets.push(game.dice3d.box.throwEngine.constructor.prototype);
        }
        targets.push(game.dice3d.box.constructor.prototype);

        for (const engineProto of targets) {
            if (engineProto._patchedForNaturalRoll) continue;
            engineProto._patchedForNaturalRoll = true;
            log("Patching throwEngine prototype methods (sync).");

            if (engineProto.startUnifiedBatch) {
                const originalStartUnifiedBatch = engineProto.startUnifiedBatch;
                engineProto.startUnifiedBatch = function(throws, persistentThrowData, callback) {
                    return handleEngineBatch(this, throws, persistentThrowData, callback, originalStartUnifiedBatch);
                };
            } else if (engineProto.start_throw) {
                const originalStartThrow = engineProto.start_throw;
                engineProto.start_throw = function(throws, callback) {
                    return handleEngineBatch(this, throws, undefined, callback, originalStartThrow);
                };
            }

            if (engineProto.updateThrowPlayback) {
                const originalUpdateThrowPlayback = engineProto.updateThrowPlayback;
                engineProto.updateThrowPlayback = function(neededSteps) {
                    const actualEngine = this.throwEngine || this;
                    if (actualEngine._simulationReady === false) {
                        return;
                    }
                    return originalUpdateThrowPlayback.call(this, neededSteps);
                };
            }

            if (engineProto.animateThrow && !engineProto._originalAnimateThrow) {
                const originalAnimateThrow = engineProto.animateThrow;
                engineProto._originalAnimateThrow = originalAnimateThrow;
                engineProto.animateThrow = function(delta) {
                    const actualEngine = this.throwEngine || this;

                    if (actualEngine._simulationReady === false) {
                        try { canvas.app?.ticker?.remove(this.animateThrow, this); } catch(e) {}
                        return;
                    }

                    if (!this.rolling && !actualEngine.rolling) {
                        try { canvas.app?.ticker?.remove(this.animateThrow, this); } catch(e) {}
                        return;
                    }

                    const isNaturalRollHoldActive = !!actualEngine._naturalRollState?._active;
                    if (isNaturalRollHoldActive) {
                        const diceList = actualEngine.diceList || this.diceList || [];
                        if (diceList.length === 0) {
                            return;
                        }
                        for (const die of diceList) {
                            if (!die || !die.sim || !die.sim.stepPositions || !die.sim.stepPositions.length) {
                                return;
                            }
                        }
                    }
                    try {
                        const res = originalAnimateThrow.call(this, delta);
                        if (res && typeof res.catch === "function") {
                            res.catch(() => {});
                        }
                        return res;
                    } catch (e) {
                        return;
                    }
                };

                try {
                    const ticker = canvas.app?.ticker;
                    const box = game.dice3d?.box;
                    if (ticker?._head && box) {
                        let node = ticker._head.next;
                        while (node) {
                            if (node.fn === originalAnimateThrow && node.context === box) {

                                node.fn = engineProto.animateThrow;
                                log("Natural Roll | Swapped pre-registered animateThrow prototype ticker node to patched wrapper.");
                            }
                            node = node.next;
                        }
                    }
                } catch(e) {}
            }

            if (engineProto.spawnDiceMesh) {
                const originalSpawnDiceMesh = engineProto.spawnDiceMesh;
                engineProto.spawnDiceMesh = async function(dicedata, appearance, diceLibrary, workerSpecs) {
                    if (dicedata && (dicedata.id === undefined || dicedata.id === null)) {
                        dicedata.id = foundry?.utils?.randomID ? foundry.utils.randomID() : ((typeof globalThis.randomID === "function") ? globalThis.randomID() : Math.random().toString(36).substring(2, 15));
                    }
                    const result = await originalSpawnDiceMesh.call(this, dicedata, appearance, diceLibrary, workerSpecs);
                    const actualEngine = this.throwEngine || this;
                    const dicemesh = result || actualEngine.diceList?.[actualEngine.diceList.length - 1];
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
                        dicedata.id = foundry?.utils?.randomID ? foundry.utils.randomID() : ((typeof globalThis.randomID === "function") ? globalThis.randomID() : Math.random().toString(36).substring(2, 15));
                    }
                    const result = await originalSpawnDice.call(this, dicedata, appearance, diceLibrary);
                    const actualEngine = this.throwEngine || this;
                    const dicemesh = result || actualEngine.diceList?.[actualEngine.diceList.length - 1];
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
                const actualEngine = this.throwEngine || this;
                DiceInteractionManager.cleanup(actualEngine);
                return originalClearDice ? originalClearDice.apply(this, arguments) : undefined;
            };

            const originalClearAll = engineProto.clearAll;
            if (originalClearAll) {
                engineProto.clearAll = function() {
                    const actualEngine = this.throwEngine || this;
                    DiceInteractionManager.cleanup(actualEngine);
                    return originalClearAll.apply(this, arguments);
                };
            }

            log("Patched Dice So Nice! ThrowEngine prototype successfully.");
        }
    }

    static async patchDSN() {
        log("patchDSN() starting.");

        if (game.dice3d?._boxReady) {
            log("Waiting for game.dice3d._boxReady promise to resolve...");
            await game.dice3d._boxReady;
        }

        DSNPatcher.patchDSNSync();

        const patchTarget = (target) => {
            if (!target || target._patchedForNaturalRoll) return;
            target._patchedForNaturalRoll = true;

            const originalShowForRoll = target.showForRoll;
            if (originalShowForRoll) {
                target.showForRoll = function(roll, user = game.user, synchronize, users, blind, messageID, speaker, options) {
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
                    let rollingUserId = user?.id || user || game.user.id;
                    if (messageID) {
                        const msg = game.messages.get(messageID);
                        if (msg) {
                            rollingUserId = msg.author?.id || msg.user?.id || rollingUserId;
                        }
                    }
                    const now = Date.now();
                    const msg = messageID ? game.messages.get(messageID) : null;
                    const isAlreadyRendered = msg?.flags?.["natural-roll"]?.alreadyRendered;
                    const rollCompleted = roll._naturalRollCompleted || roll.options?._naturalRollCompleted;
                    const currentRollType = getSystemRollType(roll);
                    const isSameRollType = !DiceInteractionManager.lastCompletedRollType || !currentRollType || (DiceInteractionManager.lastCompletedRollType === currentRollType);
                    const isSameFormula = DiceInteractionManager.lastCompletedFormula && (DiceInteractionManager.lastCompletedFormula === roll.formula);
                    const isLocalEvaluateRoll = (game.dice3d?._currentLocalRoll === roll);
                    const hasSameResults = (
                        DiceInteractionManager.lastCompletedResults?.length > 0 &&
                        JSON.stringify(DiceInteractionManager.lastCompletedResults) === JSON.stringify(rollResults)
                    );
                    const isRecentCompletedRollMatch = (
                        !isLocalEvaluateRoll &&
                        rollingUserId === game.user.id &&
                        (now - (DiceInteractionManager.lastCompletedRollTime || 0) < 6000) &&
                        isSameRollType &&
                        isSameFormula &&
                        hasSameResults
                    );

                    const isCompanionRollInTransactionWindow = (
                        !isLocalEvaluateRoll &&
                        rollingUserId === game.user.id &&
                        !!DiceInteractionManager._companionWindowActive
                    );

                    if (rollingUserId === game.user.id && (isAlreadyRendered || rollCompleted || isRecentCompletedRollMatch || isCompanionRollInTransactionWindow)) {
                        log(`Bypassing duplicate showForRoll for rolling user: roll already completed or companion roll.`);
                        if (game.dice3d?._currentLocalRoll === roll) {
                            game.dice3d._currentLocalRoll = null;
                        }
                        if (messageID) {
                            try {
                                Hooks.callAll("diceSoNiceRollComplete", messageID);
                            } catch (e) {}
                        }
                        return Promise.resolve(false);
                    }

                    const isAutoRollAtGrab = shouldAutoRoll(roll);
                    const isRollingUser = (!isAutoRollAtGrab && !messageID && synchronize !== false) || (rollingUserId === game.user.id && !!game.dice3d._isLocalRollInitiation);

                    if (!isAutoRollAtGrab && !messageID && synchronize !== false) {
                        game.dice3d._isLocalRollInitiation = true;
                        game.dice3d._currentLocalRoll = roll;

                        log(`Emitting grab event for showForRoll without messageID`);
                        game.socket.emit("module.natural-roll", {
                            type: "grab",
                            user: rollingUserId,
                            authorizedUsers: getAuthorizedUsers(roll, users)
                        });
                    }

                    if (!isRollingUser) {
                        const isManual = roll.options?.isNaturalRollManual || rollDice.some(d => d.options?.isNaturalRollManual);
                        if (isManual && !game.settings.get("natural-roll", "enableReplay")) {
                            log("Bypassing manual roll on remote client: Replay is disabled.");
                            game.dice3d._currentLocalRoll = null;
                            if (messageID) {
                                try { Hooks.callAll("diceSoNiceRollComplete", messageID); } catch (e) {}
                            }
                            return Promise.resolve(false);
                        }

                        DiceInteractionManager.pruneRecentReplays();
                        const matchedReplayIndex = DiceInteractionManager.recentReplays.findIndex(replay => {
                            return replay.user === rollingUserId &&
                                   JSON.stringify(replay.results) === JSON.stringify(rollResults) &&
                                   (now - replay.timestamp) < 8000;
                        });

                        if (matchedReplayIndex !== -1) {
                            DiceInteractionManager.recentReplays.splice(matchedReplayIndex, 1);
                            game.dice3d._currentLocalRoll = null;
                            if (messageID) {
                                try { Hooks.callAll("diceSoNiceRollComplete", messageID); } catch (e) {}
                            }
                            const activePromise = game.dice3d?._activeReplayPromises?.[rollingUserId] || game.dice3d?._activeReplayPromise;
                            if (activePromise) {
                                return activePromise.then(() => false);
                            }
                            return Promise.resolve(false);
                        }
                    }

                    if (isRollingUser) {
                        const isAuto = shouldAutoRoll(roll);
                        rollDice.forEach(die => {
                            die.options = die.options || {};
                            die.options.naturalRollDieId = die.options.naturalRollDieId || (foundry?.utils?.randomID ? foundry.utils.randomID() : ((typeof globalThis.randomID === "function") ? globalThis.randomID() : Math.random().toString(36).substring(2, 15)));
                            if (!isAuto) {
                                die.options.isNaturalRollManual = true;
                            }
                        });
                    }

                    const cleanup = () => {
                        const autoRoll = shouldAutoRoll(roll);
                        if (!autoRoll) return;
                        if (game.dice3d?._currentLocalRoll === roll) {
                            game.dice3d._currentLocalRoll = null;
                        }
                        if (game.dice3d) {
                            game.dice3d._isLocalRollInitiation = false;
                        }
                    };

                    let promise;
                    const isAutoRollForChain = shouldAutoRoll(roll);
                    game.dice3d._lastShowForRollWasAutoRoll = isAutoRollForChain;
                    if (!isRollingUser) {
                        promise = originalShowForRoll.call(this, roll, user, synchronize, users, blind, messageID, speaker, options);
                    } else {
                        const syncOption = isAutoRollForChain ? synchronize : false;
                        promise = originalShowForRoll.call(this, roll, user, syncOption, users, blind, messageID, speaker, options);
                    }

                    if (promise && typeof promise.then === "function") {
                        promise.finally(cleanup);
                    } else {
                        cleanup();
                    }
                    return promise;
                };
            }

            const originalShow = target.show;
            if (originalShow) {
                target.show = function(data, user = game.user, synchronize = false, users = null, blind, speaker = null) {
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
                        const throwEngineForReset = game.dice3d.box?.throwEngine || game.dice3d.box;
                        if (throwEngineForReset && throwEngineForReset._simulationReady === false) {
                            delete throwEngineForReset._simulationReady;
                        }
                        const worker = game.dice3d.box?.physicsWorker;
                        if (worker && worker._originalExec) {
                            worker.exec = worker._originalExec;
                            delete worker._originalExec;
                            log("Replay Interceptor: force restored original worker.exec for new normal roll");
                        }
                        const dicefactory = throwEngineForReset?.dicefactory || game.dice3d.box?.dicefactory;
                        if (dicefactory && dicefactory._naturalRollOriginalGetAppearance) {
                            dicefactory.getAppearanceForDice = dicefactory._naturalRollOriginalGetAppearance;
                            delete dicefactory._naturalRollOriginalGetAppearance;
                        }
                    }

                    const isRollingUser = !!synchronize || !!game.dice3d._isLocalRollInitiation;

                    const isAutoRoll = !!game.dice3d._lastShowForRollWasAutoRoll;
                    game.dice3d._lastShowForRollWasAutoRoll = false;

                    const isManual = (isRollingUser && !isReplay && !isAutoRoll) || data.throws?.some(t => t.dice?.some(d => d.options?.isNaturalRollManual));

                    if (isManual) {
                        if (data.throws) {
                            for (const t of data.throws) {
                                t.isNaturalRollManual = true;
                                t.naturalRollUser = rollingUserId;
                            }
                        }
                    }

                    if (!isRollingUser && !isAutoRoll) {
                        const isManualRoll = data.throws?.some(t => t.isNaturalRollManual || t.dice?.some(d => d.options?.isNaturalRollManual));
                        const isGrabActive = DiceInteractionManager.activeGrabs?.has(rollingUserId);

                        if ((isManualRoll || isGrabActive) && !isReplay) {
                            log(`Bypassing manual/grab roll rendering for remote user ${rollingUserId}.`);
                            return Promise.resolve(false);
                        }
                    }

                    return originalShow.call(this, data, user, synchronize, users, blind, speaker);
                };
            }

            const originalShowAnimation = target._showAnimation;
            if (originalShowAnimation) {
                target._showAnimation = function(data, config) {
                    DSNPatcher.patchDSNSync();
                    if (!game.settings.get("natural-roll", "enabled")) {
                        return originalShowAnimation.call(this, data, config);
                    }

                    const rollingUserId = data.naturalRollUser || data.user?.id || data.user || data.throws?.[0]?.user || game.user.id;
                    const isRollingUser = (rollingUserId === game.user.id);
                    const isReplay = data.isNaturalRollReplay || data.throws?.some(t => t.isNaturalRollReplay);

                    const isNaturalRollManualThrow = data.throws?.some(t => t.isNaturalRollManual || t.dice?.some(d => d.options?.isNaturalRollManual));

                    if (!isRollingUser && isNaturalRollManualThrow && !isReplay) {
                        log("Bypassing duplicate _showAnimation (already handled by manual roll, socket replay, or replay disabled).");
                        const activePromise = game.dice3d?._activeReplayPromises?.[rollingUserId] || game.dice3d?._activeReplayPromise;
                        if (activePromise) {
                            return activePromise.then(() => false);
                        }
                        return Promise.resolve(false);
                    }

                    return originalShowAnimation.call(this, data, config);
                };
            }
        };

        if (game.dice3d) {
            log("Patching game.dice3d methods.");
            patchTarget(game.dice3d);
            if (game.dice3d.pipeline) {
                patchTarget(game.dice3d.pipeline);
            }
            if (game.dice3d.box) {
                patchTarget(game.dice3d.box);
                if (game.dice3d.box.animateThrow && !game.dice3d.box._originalAnimateThrow) {
                    const originalBoxAnimateThrow = game.dice3d.box.animateThrow;
                    game.dice3d.box._originalAnimateThrow = originalBoxAnimateThrow;
                    const wrappedBoxAnimateThrow = function(delta) {
                        const actualEngine = this.throwEngine || this;

                        if (actualEngine._simulationReady === false) {
                            try { canvas.app?.ticker?.remove(this.animateThrow, this); } catch(e) {}
                            return;
                        }

                        if (!this.rolling && !actualEngine.rolling) {
                            try { canvas.app?.ticker?.remove(this.animateThrow, this); } catch(e) {}
                            return;
                        }
                        const diceList = actualEngine.diceList || this.diceList || [];
                        if (diceList.length === 0) {
                            return;
                        }
                        for (const die of diceList) {
                            if (!die || !die.sim || !die.sim.stepPositions || !die.sim.stepPositions.length) {
                                return;
                            }
                        }
                        try {
                            const res = originalBoxAnimateThrow.call(this, delta);
                            if (res && typeof res.catch === "function") {
                                res.catch(() => {});
                            }
                            return res;
                        } catch (e) {
                            return;
                        }
                    };
                    game.dice3d.box.animateThrow = wrappedBoxAnimateThrow;

                    try {
                        const ticker = canvas.app?.ticker;
                        if (ticker?._head) {
                            let node = ticker._head.next;
                            while (node) {
                                if (node.fn === originalBoxAnimateThrow && node.context === game.dice3d.box) {
                                    node.fn = wrappedBoxAnimateThrow;
                                    log("Natural Roll | Swapped pre-registered animateThrow ticker node to patched wrapper.");
                                }
                                node = node.next;
                            }
                        }
                    } catch(e) {}
                }
            }
            if (game.dice3d.pipeline) {
                log("Patching game.dice3d.pipeline methods.");
                patchTarget(game.dice3d.pipeline);
                if (game.dice3d.pipeline.constructor?.prototype) {
                    patchTarget(game.dice3d.pipeline.constructor.prototype);
                }
            }
            log("Patched game.dice3d methods successfully.");
        }
    }
}

