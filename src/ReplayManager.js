import { log, error } from "./utils.js";
import { ParticleManager } from "./ParticleManager.js";
import { getCanvasElement, getThrowEngine, setEngineRunning } from "./DSNUtils.js";

export class ReplayManager {
    static recentReplays = [];
    static recentChatMessageRolls = [];
    static activeGrabs = new Set();
    static activeGrabTimeouts = new Map();
    static lastCompletedRollTime = 0;
    static replayQueue = [];
    static isReplayExecuting = false;

    static pruneRecentReplays() {
        const now = Date.now();
        this.recentReplays = (this.recentReplays || []).filter(r => r && (now - r.timestamp) < 15000);
        if (this.recentReplays.length > 50) {
            this.recentReplays = this.recentReplays.slice(-50);
        }
    }

    static cleanupReplayState(engine) {
        if (!engine) return;
        const throwEngine = getThrowEngine(engine);

        const isReplayActive = game.dice3d?._naturalRollReplayPrepared || game.dice3d?._naturalRollReplayActive;
        const isReplayFinished = game.dice3d?._naturalRollReplayActive && (throwEngine.iteration >= (throwEngine.iterationsNeeded || 0));

        if (!isReplayActive || isReplayFinished) {
            if (game.dice3d) {
                game.dice3d._naturalRollReplayPrepared = false;
                game.dice3d._naturalRollReplayActive = false;

                const replayingUser = throwEngine._naturalRollReplayingUser;
                if (replayingUser) {
                    game.dice3d._activeReplayResolves = game.dice3d._activeReplayResolves || {};
                    if (game.dice3d._activeReplayResolves[replayingUser]) {
                        game.dice3d._activeReplayResolves[replayingUser]();

                        if (game.dice3d._activeReplayResolve === game.dice3d._activeReplayResolves[replayingUser]) {
                            game.dice3d._activeReplayResolve = null;
                            game.dice3d._activeReplayPromise = null;
                        }

                        delete game.dice3d._activeReplayResolves[replayingUser];
                    }
                    if (game.dice3d._activeReplayPromises) {
                        delete game.dice3d._activeReplayPromises[replayingUser];
                    }
                }
            }
            const worker = throwEngine.physicsWorker || game.dice3d?.box?.physicsWorker;
            if (worker && worker._originalExec) {
                worker.exec = worker._originalExec;
                delete worker._originalExec;
                log("Replay Interceptor: restored original worker.exec in cleanup");
            }

            setTimeout(() => {
                if (this.replayQueue && this.replayQueue.length > 0) {
                    const nextPayload = this.replayQueue.shift();
                    log("Replay Queue: playing next queued replay from user:", nextPayload.user);
                    this.isReplayExecuting = false;
                    this.handleReplay(nextPayload, true);
                } else {
                    this.isReplayExecuting = false;
                }
            }, 100);
        }
    }

    static handleGrab(payload) {
        if (!game.dice3d) return;
        if (payload.user === game.user.id) return;

        this.activeGrabs = this.activeGrabs || new Set();
        this.activeGrabTimeouts = this.activeGrabTimeouts || new Map();

        if (this.activeGrabTimeouts.has(payload.user)) {
            clearTimeout(this.activeGrabTimeouts.get(payload.user));
        }

        this.activeGrabs.add(payload.user);
        const timer = setTimeout(() => {
            if (this.activeGrabs) {
                this.activeGrabs.delete(payload.user);
            }
            if (this.activeGrabTimeouts) {
                this.activeGrabTimeouts.delete(payload.user);
            }
        }, 30000);
        this.activeGrabTimeouts.set(payload.user, timer);

        log(`Grab state activated for remote user ${payload.user}. Pending throw rendering will be suppressed.`);
    }

    static handleReplay(payload, isFromQueue = false) {
        if (!game.dice3d) return;
        if (payload.user === game.user.id) return;

        const replayResults = Object.values(payload.faceValues || {}).sort();
        const now = Date.now();

        if (!isFromQueue) {
            this.pruneRecentReplays();
            this.recentReplays.push({
                user: payload.user,
                results: replayResults,
                timestamp: now
            });

            if (game.dice3d) {
                game.dice3d._activeReplayPromises = game.dice3d._activeReplayPromises || {};
                game.dice3d._activeReplayResolves = game.dice3d._activeReplayResolves || {};

                let resolveReplay;
                const userPromise = new Promise(resolve => {
                    resolveReplay = resolve;
                });

                game.dice3d._activeReplayPromises[payload.user] = userPromise;
                game.dice3d._activeReplayResolves[payload.user] = resolveReplay;

                game.dice3d._activeReplayPromise = userPromise;
                game.dice3d._activeReplayResolve = resolveReplay;

                setTimeout(() => {
                    if (game.dice3d?._activeReplayResolves?.[payload.user] === resolveReplay) {
                        try { resolveReplay(); } catch (e) {}
                        delete game.dice3d._activeReplayResolves[payload.user];
                        if (game.dice3d._activeReplayPromises?.[payload.user] === userPromise) {
                            delete game.dice3d._activeReplayPromises[payload.user];
                        }
                    }
                }, 15000);
            }

            this.replayQueue = this.replayQueue || [];
            if (this.isReplayExecuting) {
                log("Replay Queue: another replay is active. Queueing payload from user:", payload.user);
                this.replayQueue.push(payload);
                return;
            }
        } else {
            if (game.dice3d && game.dice3d._activeReplayPromises?.[payload.user]) {
                game.dice3d._activeReplayPromise = game.dice3d._activeReplayPromises[payload.user];
                game.dice3d._activeReplayResolve = game.dice3d._activeReplayResolves[payload.user];
            }
        }

        if (this.activeGrabs) {
            this.activeGrabs.delete(payload.user);
        }
        if (this.activeGrabTimeouts?.has(payload.user)) {
            clearTimeout(this.activeGrabTimeouts.get(payload.user));
            this.activeGrabTimeouts.delete(payload.user);
        }

        if (!game.settings.get("natural-roll", "enableReplay")) {
            log("Replay is disabled by user settings, ignoring playback but caching completed timestamp.");
            this.lastCompletedRollTime = Date.now();
            return;
        }

        log("Received manual roll replay payload from user:", payload.user);

        this.recentChatMessageRolls = this.recentChatMessageRolls || [];
        const matchedChatIndex = this.recentChatMessageRolls.findIndex(chat => {
            return JSON.stringify(chat.results) === JSON.stringify(replayResults) &&
                   (now - chat.timestamp) < 5000;
        });

        if (matchedChatIndex !== -1) {
            this.recentChatMessageRolls.splice(matchedChatIndex, 1);
            log("Bypassing socket replay: ChatMessage animation has already played.");
            return;
        }

        const throws = payload.throws;
        for (const t of throws) {
            t.isNaturalRollReplay = true;
            t.replayPayload = payload;
        }

        this.isReplayExecuting = true;

        const showData = {
            throws: throws,
            isNaturalRollReplay: true
        };

        const rollingUser = game.users.get(payload.user);
        game.dice3d.show(showData, rollingUser || null, false);
    }

    static prepareReplayIntercept(engine, replayPayload) {
        const throwEngine = getThrowEngine(engine);
        const worker = throwEngine?.physicsWorker || game.dice3d?.box?.physicsWorker;
        if (!worker) return;

        log("Replay Interceptor: preparing to return mock simulateThrow result");
        if (game.dice3d) {
            game.dice3d._naturalRollReplayPrepared = true;
            game.dice3d._naturalRollReplayActive = false;
            if (throwEngine) {
                throwEngine._naturalRollReplayingUser = replayPayload.user;
            }
        }
        if (!worker._originalExec) {
            worker._originalExec = worker.exec;
        }

        const dicefactory = throwEngine?.dicefactory || game.dice3d?.box?.dicefactory;
        if (dicefactory && !dicefactory._naturalRollOriginalGetAppearance) {
            dicefactory._naturalRollOriginalGetAppearance = dicefactory.getAppearanceForDice;
            dicefactory.getAppearanceForDice = function(appearanceConfig, diceType, dieContext) {
                if (dieContext?.appearance) {
                    return foundry.utils.duplicate(dieContext.appearance);
                }
                return dicefactory._naturalRollOriginalGetAppearance.call(this, appearanceConfig, diceType, dieContext);
            };
        }

        worker.exec = async function(method, params) {
            if (method === 'simulateThrow') {
                if (game.dice3d) {
                    game.dice3d._naturalRollReplayPrepared = false;
                    game.dice3d._naturalRollReplayActive = true;
                }
                const localDiceList = [...(throwEngine?.diceList || []), ...(throwEngine?.deadDiceList || [])];
                const localIds = localDiceList.map(d => d.id);

                const faceValues = {};
                localDiceList.forEach(dicemesh => {
                    const rollerId = dicemesh?.userData?.rollerId || dicemesh?.options?.naturalRollDieId || dicemesh?.id;
                    let targetValue = replayPayload.faceValues?.[rollerId];

                    if (targetValue === undefined) {
                        const fallbackVals = Object.values(replayPayload.faceValues || {});
                        if (fallbackVals.length > 0) {
                            targetValue = fallbackVals[0];
                        }
                    }

                    if (targetValue !== undefined) {
                        faceValues[dicemesh.id] = targetValue;
                    }
                });

                const finalQuaternions = {};
                localDiceList.forEach(dicemesh => {
                    const rollerId = dicemesh?.userData?.rollerId || dicemesh?.options?.naturalRollDieId || dicemesh?.id;
                    let targetQuat = replayPayload.finalQuaternions?.[rollerId];
                    if (!targetQuat) {
                        const fallbackQuats = Object.values(replayPayload.finalQuaternions || {});
                        if (fallbackQuats.length > 0) {
                            targetQuat = fallbackQuats[0];
                        }
                    }
                    if (targetQuat) {
                        finalQuaternions[dicemesh.id] = targetQuat;
                    }
                });

                const quaternionsBuffers = [];
                const positionsBuffers = [];
                const deads = [];

                let scale = 1.0;
                const canvasRaw = game.dice3d?.canvas;
                const dsnCanvas = getCanvasElement(canvasRaw);
                const currentWidth = dsnCanvas ? dsnCanvas.clientWidth : window.innerWidth;
                if (replayPayload.screenWidth && currentWidth) {
                    scale = currentWidth / replayPayload.screenWidth;
                }

                localIds.forEach(localId => {
                    const dicemesh = localDiceList.find(d => d.id === localId);
                    const rollerId = dicemesh?.userData?.rollerId || dicemesh?.options?.naturalRollDieId || dicemesh?.id;
                    const rollerIndex = replayPayload.trajectories.findIndex(t => t.id === rollerId);

                    if (rollerIndex !== -1) {
                        const trajectory = replayPayload.trajectories[rollerIndex];
                        quaternionsBuffers.push(new Float32Array(trajectory.quaternions).buffer);

                        try {
                            if (game.settings.get("natural-roll", "enableMagicalEffects")) {
                                const diceScene = game.dice3d?.box?.diceScene || game.dice3d?.box;
                                if (dsnCanvas && diceScene && diceScene.camera && trajectory.positions?.length >= 3) {
                                    const camera = diceScene.camera;
                                    const rect = dsnCanvas.getBoundingClientRect();
                                    const width = rect.width;
                                    const height = rect.height;

                                    const pX = trajectory.positions[0] * scale;
                                    const pY = trajectory.positions[1] * scale;
                                    const pZ = trajectory.positions[2] * scale;

                                    if (dicemesh && dicemesh.position) {
                                        const tempV = dicemesh.position.clone();
                                        tempV.set(pX, pY, pZ);
                                        tempV.project(camera);

                                        const screenX = ((tempV.x + 1) * width) / 2 + rect.left;
                                        const screenY = ((-tempV.y + 1) * height) / 2 + rect.top;

                                        const effectStyle = replayPayload.magicalEffectStyle || game.settings.get("natural-roll", "magicalEffectStyle") || "smoke";
                                        log(`Replay spawn magical effect (${effectStyle}) at screen coordinates: (${screenX}, ${screenY}) for die ${localId}`);
                                        ParticleManager.spawnEffect(screenX, screenY, effectStyle);
                                    }
                                }
                            }
                        } catch (err) {
                            error("Error triggering replay magical effect:", err);
                        }

                        const posArray = new Float32Array(trajectory.positions);
                        for (let i = 0; i < posArray.length; i++) {
                            posArray[i] *= scale;
                        }
                        positionsBuffers.push(posArray.buffer);

                        deads.push(replayPayload.deads?.[rollerIndex] ?? false);
                    } else {
                        quaternionsBuffers.push(new Float32Array(1001 * 4).buffer);
                        positionsBuffers.push(new Float32Array(1001 * 3).buffer);
                        deads.push(false);
                    }
                });

                setEngineRunning(throwEngine, (new Date()).getTime());
                throwEngine._simulationReady = true;
                if (game.dice3d?.box) {
                    game.dice3d.box._simulationReady = true;
                }

                const replayRestMs = Math.max(300, Math.min(3000, ((replayPayload.iterationsNeeded || 60) / 60) * 1000));
                setTimeout(() => {
                    const replayingUser = replayPayload.user;
                    if (replayingUser && game.dice3d?._activeReplayResolves?.[replayingUser]) {
                        game.dice3d._activeReplayResolves[replayingUser]();
                        delete game.dice3d._activeReplayResolves[replayingUser];
                    }
                    if (dicefactory?._naturalRollOriginalGetAppearance) {
                        dicefactory.getAppearanceForDice = dicefactory._naturalRollOriginalGetAppearance;
                        delete dicefactory._naturalRollOriginalGetAppearance;
                    }
                    if (worker?._originalExec) {
                        worker.exec = worker._originalExec;
                        delete worker._originalExec;
                    }
                }, replayRestMs);

                return {
                    ids: localIds,
                    quaternionsBuffers,
                    positionsBuffers,
                    detectedCollides: replayPayload.detectedCollides,
                    iterationsNeeded: replayPayload.iterationsNeeded,
                    faceValues: faceValues,
                    deads,
                    finalQuaternions: finalQuaternions
                };
            }

            if (method === 'playStep') {
                return { ids: [], worldAsleep: true };
            }

            if (typeof worker._originalExec === "function") {
                return worker._originalExec.call(this, method, params);
            }
            return { ids: [], worldAsleep: true };
        };
    }
}
