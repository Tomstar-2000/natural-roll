import { log, error } from "./utils.js";
import { ParticleManager } from "./ParticleManager.js";
import { RECORDING_OPTION } from "./RecordedThrows.js";
import { getCanvasElement, getThrowEngine, setEngineRunning, getPlaybackDurationMs, LANDING_GRACE_MS, getDieScreenFraction, screenFractionToClient } from "./DSNUtils.js";

const REPLAY_SAFETY_TIMEOUT_MS = 15000;

/** The last frame a die has a pose in (a zero quaternion marks frames past its end). */
function lastPoseFrame(quaternions) {
    for (let f = Math.floor(quaternions.length / 4) - 1; f >= 0; f--) {
        if (quaternions[f * 4] || quaternions[f * 4 + 1] || quaternions[f * 4 + 2] || quaternions[f * 4 + 3]) return f;
    }
    return -1;
}

/**
 * Rebuild a replayed die's physics body where the replay leaves it, at rest. The replay stands in for Dice So
 * Nice's simulation, so the body would otherwise keep its spawn pose and throw velocity, and the next real
 * simulation (e.g. of a later roll, while the die stays on the table as a persistent die) would throw it again.
 */
async function restBodyAtReplayEnd(exec, worker, spec, positions, quaternions) {
    const f = lastPoseFrame(quaternions);
    if (f < 0) return;
    const [x, y, z, w] = quaternions.slice(f * 4, f * 4 + 4);
    const angle = 2 * Math.acos(Math.max(-1, Math.min(1, w)));
    const s = Math.sqrt(Math.max(0, 1 - w * w));
    const axis = s < 1e-6 ? { x: 1, y: 0, z: 0, a: 0 } : { x: x / s, y: y / s, z: z / s, a: angle / (2 * Math.PI) };
    const vectordata = {
        ...spec.vectordata,
        pos: { x: positions[f * 3], y: positions[f * 3 + 1], z: positions[f * 3 + 2] },
        axis,
        angle: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 }
    };
    await exec.call(worker, "removeDice", [spec.id]);
    await exec.call(worker, "createDice", { ...spec, vectordata, startAtIteration: 0 });
    await exec.call(worker, "addDice", spec.id);
    log(`Replay: die ${spec.id} placed at rest where its throw ends.`);
}

function backfillLeadingFrames(buffer, stride) {
    const frameCount = Math.floor(buffer.length / stride);
    const isEmpty = (frame) => {
        for (let k = 0; k < stride; k++) {
            if (buffer[frame * stride + k] !== 0) return false;
        }
        return true;
    };

    let firstRecorded = 0;
    while (firstRecorded < frameCount && isEmpty(firstRecorded)) firstRecorded++;
    if (firstRecorded === 0 || firstRecorded >= frameCount) return buffer;

    const filled = Float32Array.from(buffer);
    for (let f = 0; f < firstRecorded; f++) {
        filled.copyWithin(f * stride, firstRecorded * stride, (firstRecorded + 1) * stride);
    }
    return filled;
}

function placeDieAt(dicemesh, x, y, z) {
    const parent = dicemesh.parent;
    const holder = parent && !parent.isScene && parent.type !== "Scene" ? parent : dicemesh;
    holder.position?.set(x, y, z);
}

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

                const replaySafetyMs = Math.max(
                    REPLAY_SAFETY_TIMEOUT_MS,
                    getPlaybackDurationMs(game.dice3d.box, payload.iterationsNeeded) + LANDING_GRACE_MS
                );
                setTimeout(() => {
                    if (game.dice3d?._activeReplayResolves?.[payload.user] === resolveReplay) {
                        try { resolveReplay(); } catch (e) {}
                        delete game.dice3d._activeReplayResolves[payload.user];
                        if (game.dice3d._activeReplayPromises?.[payload.user] === userPromise) {
                            delete game.dice3d._activeReplayPromises[payload.user];
                        }
                    }
                }, replaySafetyMs);
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
            dicefactory.getAppearanceForDice = function(appearanceConfig, diceType, dieContext, ...rest) {
                if (dieContext?.appearance && !dieContext.options?.[RECORDING_OPTION]) {
                    return foundry.utils.duplicate(dieContext.appearance);
                }
                return dicefactory._naturalRollOriginalGetAppearance.call(this, appearanceConfig, diceType, dieContext, ...rest);
            };
        }

        const bodySpecs = new Map();
        worker.exec = async function(method, params) {
            if (method === 'createDiceBatch' && Array.isArray(params)) {
                for (const spec of params) bodySpecs.set(spec.id, spec);
            }
            if (method === 'simulateThrow') {
                if (game.dice3d) {
                    game.dice3d._naturalRollReplayPrepared = false;
                    game.dice3d._naturalRollReplayActive = true;
                }
                const localDiceList = [...(throwEngine?.diceList || []), ...(throwEngine?.deadDiceList || [])];
                const localIds = localDiceList.map(d => d.id);
                const throwDice = throwEngine?.diceList || [];
                const rollerIdOf = (dicemesh) => {
                    if (!replayPayload.matchByOrder) return dicemesh?.userData?.rollerId || dicemesh?.options?.naturalRollDieId || dicemesh?.id;
                    const index = throwDice.indexOf(dicemesh);
                    return index === -1 ? undefined : replayPayload.trajectories[index]?.id;
                };

                const faceValues = {};
                localDiceList.forEach(dicemesh => {
                    const rollerId = rollerIdOf(dicemesh);
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
                    const rollerId = rollerIdOf(dicemesh);
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

                for (const localId of localIds) {
                    const dicemesh = localDiceList.find(d => d.id === localId);
                    const rollerId = rollerIdOf(dicemesh);
                    const rollerIndex = replayPayload.trajectories.findIndex(t => t.id === rollerId);

                    if (rollerIndex !== -1) {
                        const trajectory = replayPayload.trajectories[rollerIndex];
                        const quatArray = backfillLeadingFrames(new Float32Array(trajectory.quaternions), 4);
                        quaternionsBuffers.push(quatArray.buffer);

                        const posArray = backfillLeadingFrames(
                            new Float32Array(trajectory.positions).map(v => v * scale),
                            3
                        );
                        positionsBuffers.push(posArray.buffer);

                        if (dicemesh && posArray.length >= 3) {
                            placeDieAt(dicemesh, posArray[0], posArray[1], posArray[2]);
                        }

                        const spec = bodySpecs.get(localId);
                        if (spec && typeof worker._originalExec === "function") {
                            try {
                                await restBodyAtReplayEnd(worker._originalExec, worker, spec, posArray, quatArray);
                            } catch (err) {
                                error("Error placing a replayed die's physics body:", err);
                            }
                        }

                        try {
                            if (game.settings.get("natural-roll", "enableMagicalEffects") && dicemesh) {
                                log(`Replay die ${localId} start position (${posArray[0]}, ${posArray[1]}, ${posArray[2]}), roller release fraction:`, trajectory.release);
                                const screenPos = trajectory.release
                                    ? screenFractionToClient(trajectory.release)
                                    : (() => {
                                        const fraction = getDieScreenFraction(dicemesh);
                                        return fraction ? screenFractionToClient(fraction) : null;
                                    })();

                                if (screenPos) {
                                    const effectStyle = replayPayload.magicalEffectStyle || game.settings.get("natural-roll", "magicalEffectStyle") || "smoke";
                                    log(`Replay spawn magical effect (${effectStyle}) at screen coordinates: (${screenPos.x}, ${screenPos.y}) for die ${localId}`);
                                    ParticleManager.spawnEffect(screenPos.x, screenPos.y, effectStyle);
                                }
                            }
                        } catch (err) {
                            error("Error triggering replay magical effect:", err);
                        }

                        deads.push(replayPayload.deads?.[rollerIndex] ?? false);
                    } else {
                        const at = dicemesh?.parent?.type === "Scene" ? dicemesh : dicemesh?.parent;
                        const quaternions = new Float32Array(1001 * 4);
                        const positions = new Float32Array(1001 * 3);
                        if (at) {
                            for (let f = 0; f < 1001; f++) {
                                quaternions.set([at.quaternion.x, at.quaternion.y, at.quaternion.z, at.quaternion.w], f * 4);
                                positions.set([at.position.x, at.position.y, at.position.z], f * 3);
                            }
                        }
                        quaternionsBuffers.push(quaternions.buffer);
                        positionsBuffers.push(positions.buffer);
                        deads.push(true);
                    }
                }

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
