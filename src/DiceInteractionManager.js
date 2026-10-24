import { log, error, getAuthorizedUsers } from "./utils.js";
import { ParticleManager } from "./ParticleManager.js";
import { DSNAppearanceResolver } from "./DSNAppearanceResolver.js";
import { ReplayManager } from "./ReplayManager.js";
import { DiceThrowDataBuilder } from "./DiceThrowDataBuilder.js";
import { buildDieThrow } from "./ThrowPhysics.js";
import { getDsnEngine } from "./engines/DsnEngine.js";
import { createDieSpring, snapDieSpring, stepDieSpring } from "./HandSpring.js";
import { estimateFlick } from "./FlickEstimator.js";
import {
    getCanvasElement,
    getThrowEngine,
    setEngineRolling,
    setEngineRunning,
    renderDSNScene,
    disposeObject3D,
    stopDSNTicker,
    getPlaybackDurationMs,
    LANDING_GRACE_MS,
    getDieScreenFraction
} from "./DSNUtils.js";

const HOLD_WATCHDOG_MS = 15000;
const HOLD_HEARTBEAT_MS = 5000;
const SIMULATION_WATCHDOG_MS = 30000;

let lastPointerPos = { x: 0, y: 0 };
if (typeof window !== "undefined") {
    window.addEventListener("pointermove", (e) => {
        lastPointerPos.x = e.clientX;
        lastPointerPos.y = e.clientY;
    }, { passive: true });
}

export class DiceInteractionManager {
    static get recentReplays() { return ReplayManager.recentReplays; }
    static set recentReplays(v) { ReplayManager.recentReplays = v; }
    static get recentChatMessageRolls() { return ReplayManager.recentChatMessageRolls; }
    static set recentChatMessageRolls(v) { ReplayManager.recentChatMessageRolls = v; }
    static get activeGrabs() { return ReplayManager.activeGrabs; }
    static set activeGrabs(v) { ReplayManager.activeGrabs = v; }
    static get activeGrabTimeouts() { return ReplayManager.activeGrabTimeouts; }
    static set activeGrabTimeouts(v) { ReplayManager.activeGrabTimeouts = v; }
    static get lastCompletedRollTime() { return ReplayManager.lastCompletedRollTime; }
    static set lastCompletedRollTime(v) { ReplayManager.lastCompletedRollTime = v; }
    static get replayQueue() { return ReplayManager.replayQueue; }
    static set replayQueue(v) { ReplayManager.replayQueue = v; }
    static get isReplayExecuting() { return ReplayManager.isReplayExecuting; }
    static set isReplayExecuting(v) { ReplayManager.isReplayExecuting = v; }
    static lastCompletedFormula = "";
    static lastCompletedRollType = null;
    static lastCompletedResults = [];

    static _getMeshesForRoll(termMeshes, rIdx, meshesPerRoll) {
        const meshesForRoll = termMeshes.filter(m => {
            const rollerId = m.userData?.rollerId || "";
            return rollerId.endsWith(`-${rIdx}`) || (!rollerId.includes(`-${rIdx}`) && rIdx === 0);
        });
        return meshesForRoll.length === meshesPerRoll
            ? meshesForRoll
            : termMeshes.slice(rIdx * meshesPerRoll, (rIdx + 1) * meshesPerRoll);
    }

    static _computePercentile(activeMeshes, faceValues) {
        let tensMesh = activeMeshes.find(m => {
            const type = m.notation?.type || m.notation?.vectors?.type || m.shape;
            const digitPlace = m.userData?.digitPlace ?? m.notation?.digitPlace;
            return type === "d100" || digitPlace?.divisor === 10;
        }) || activeMeshes[0];

        let unitsMesh = activeMeshes.find(m => {
            const type = m.notation?.type || m.notation?.vectors?.type || m.shape;
            const digitPlace = m.userData?.digitPlace ?? m.notation?.digitPlace;
            return m !== tensMesh && (type === "d10" || digitPlace?.divisor === 1);
        }) || activeMeshes[1];

        const tensVal = tensMesh ? faceValues[tensMesh.id] : undefined;
        const unitsVal = unitsMesh ? faceValues[unitsMesh.id] : undefined;
        if (tensVal === undefined && unitsVal === undefined) return null;

        let tens = 0;
        if (tensVal !== undefined) {
            tens = (tensVal === 100 || tensVal === 10) ? 0 : (tensVal >= 10 ? tensVal % 100 : (tensVal * 10) % 100);
        }
        const units = unitsVal !== undefined ? unitsVal % 10 : 0;
        const total = tens + units;
        return total === 0 ? 100 : total;
    }

    static _computeCompound(activeMeshes, faceValues) {
        activeMeshes.sort((a, b) => {
            const divA = (a.userData?.digitPlace ?? a.notation?.digitPlace)?.divisor ?? 0;
            const divB = (b.userData?.digitPlace ?? b.notation?.digitPlace)?.divisor ?? 0;
            return divB - divA;
        });

        let combinedDigits = "";
        let hasValue = false;
        for (const mesh of activeMeshes) {
            const val = faceValues[mesh.id];
            if (val !== undefined && val !== null) {
                hasValue = true;
                combinedDigits += String(val);
            }
        }
        return hasValue ? parseInt(combinedDigits, 10) : null;
    }

    static _formatResultLabel(die, dicemesh, finalVal, roll) {
        if (die.type === "d100" || dicemesh?.notation?.type === "d100") {
            return (finalVal === 10 || finalVal === 100 || finalVal === 0) ? "00" : (finalVal < 10 ? (finalVal * 10).toString() : finalVal.toString());
        }
        const termId = die.options?.naturalRollDieId;
        const dieTerm = roll?.dice?.find(dt => dt.options?.naturalRollDieId === termId) || die.fvttDie;
        if (dieTerm && typeof dieTerm.getResultLabel === "function") {
            try {
                const lbl = dieTerm.getResultLabel({ result: finalVal });
                return (lbl !== undefined && lbl !== null) ? String(lbl) : finalVal.toString();
            } catch (e) {
                return finalVal.toString();
            }
        }
        return finalVal.toString();
    }

    static applyFaceValuesToRoll(roll, localDiceList, faceValues) {
        if (!roll) return;
        const rollDice = (roll.dice && roll.dice.length > 0)
            ? roll.dice
            : (roll.terms || []).filter(t => t.faces || t.results);

        rollDice.forEach(term => {
            const termRollerId = term.options?.naturalRollDieId;
            if (!termRollerId) return;

            const termMeshes = localDiceList.filter(mesh => mesh.userData?.rollerId?.startsWith(termRollerId));
            if (!termMeshes.length) return;

            const totalRolls = term.results?.length || 0;
            const meshesPerRoll = totalRolls > 0 ? termMeshes.length / totalRolls : 1;

            if (term.faces === 100) {
                for (let rIdx = 0; rIdx < totalRolls; rIdx++) {
                    const activeMeshes = DiceInteractionManager._getMeshesForRoll(termMeshes, rIdx, meshesPerRoll);
                    const total = DiceInteractionManager._computePercentile(activeMeshes, faceValues);
                    if (total !== null && term.results?.[rIdx]) {
                        term.results[rIdx].result = total;
                    }
                }
            } else if (meshesPerRoll > 1 && Number.isInteger(meshesPerRoll)) {
                for (let rIdx = 0; rIdx < totalRolls; rIdx++) {
                    const activeMeshes = DiceInteractionManager._getMeshesForRoll(termMeshes, rIdx, meshesPerRoll);
                    const total = DiceInteractionManager._computeCompound(activeMeshes, faceValues);
                    if (total !== null && !isNaN(total) && term.results?.[rIdx]) {
                        term.results[rIdx].result = total;
                    }
                }
            } else {
                termMeshes.forEach((mesh, index) => {
                    const finalVal = faceValues[mesh.id];
                    if (finalVal !== undefined && finalVal !== null && term.results?.[index]) {
                        term.results[index].result = finalVal;
                    }
                });
            }
        });

        const reevaluateTotals = (targetRoll) => {
            if (!targetRoll || !targetRoll.terms) return;
            for (const term of targetRoll.terms) {
                if (term.roll) {
                    reevaluateTotals(term.roll);
                } else if (term.rolls) {
                    for (const subRoll of term.rolls) {
                        reevaluateTotals(subRoll);
                    }
                }
                if (term.results) {
                    term._total = term.results.reduce((sum, r) => sum + (r.active && !r.discarded ? r.result : 0), 0);
                }
            }
            if (typeof targetRoll._evaluateTotal === "function") {
                targetRoll._total = targetRoll._evaluateTotal();
            } else if (targetRoll.terms) {
                targetRoll._total = targetRoll.terms.reduce((sum, t) => sum + (t.total || 0), 0);
            }
        };

        reevaluateTotals(roll);

        const completedDice = (roll.dice && roll.dice.length > 0)
            ? roll.dice
            : (roll.terms || []).filter(t => t.faces || t.results);
        DiceInteractionManager.lastCompletedResults = completedDice.flatMap(d => (d.results || []).map(r => r.result)).sort();
        DiceInteractionManager.lastCompletedRollTime = Date.now();
    }

    static pruneRecentReplays() {
        return ReplayManager.pruneRecentReplays();
    }

    static cleanup(engine, resolvePromise = true) {
        if (!engine) return;
        const throwEngine = getThrowEngine(engine);

        ReplayManager.cleanupReplayState(throwEngine);

        if (resolvePromise && !throwEngine._naturalRollBypassResolveOnClear) {
            const roll = game.dice3d?._currentLocalRoll;
            if (roll && typeof roll._naturalRollResolve === "function") {
                roll._naturalRollResolve(roll);
            }
        }

        const state = throwEngine._naturalRollState;
        if (!state) return;

        if (state.timeoutId) {
            clearTimeout(state.timeoutId);
            state.timeoutId = null;
        }
        if (state.heartbeatId) {
            clearInterval(state.heartbeatId);
            state.heartbeatId = null;
        }

        state._active = false;
        if (state.swingRafId !== null) {
            cancelAnimationFrame(state.swingRafId);
            state.swingRafId = null;
        }

        for (const die of (state.heldDice || [])) {
            try {
                const obj = (die.parent && !die.parent.isScene && die.parent.type !== "Scene")
                    ? die.parent : die;
                const baseQuaternion = die.userData?.naturalRollBaseQuaternion;
                if (baseQuaternion && obj.quaternion?.copy) {
                    obj.quaternion.copy(baseQuaternion);
                } else if (obj.rotation?.set) {
                    obj.rotation.set(0, 0, 0);
                } else if (obj.quaternion?.identity) {
                    obj.quaternion.identity();
                }
            } catch(e) {}
        }

        if (state.onPointerDown) {
            window.removeEventListener("pointerdown", state.onPointerDown, true);
        }
        if (state.onPointerMove) {
            window.removeEventListener("pointermove", state.onPointerMove, true);
        }
        if (state.onPointerUp) {
            window.removeEventListener("pointerup", state.onPointerUp, true);
        }
        if (state.updateCursor) {
            window.removeEventListener("pointermove", state.updateCursor);
        }

        const dsnCanvas = game.dice3d?.canvas?.[0] || game.dice3d?.canvas;
        if (dsnCanvas) {
            dsnCanvas.style.cursor = "";
        }
        if (typeof document !== "undefined") {
            if (document.body) {
                document.body.style.cursor = "";
            }
            const styleEl = document.getElementById("natural-roll-cursor-lock");
            if (styleEl) {
                styleEl.remove();
            }
        }
        stopDSNTicker();
        for (const die of (throwEngine.diceList || []).concat(throwEngine.deadDiceList || [])) {
            if (die?.userData) {
                die.userData.constrained = false;
            }
        }

        throwEngine._naturalRollState = null;
        setEngineRolling(throwEngine, false);
    }

    static async handleHoldAndRoll(engine, throws, callback, rollingUserId) {
        const throwEngine = getThrowEngine(engine);
        if (!throwEngine) return;

        if (throwEngine._naturalRollState?._active) {
            log("Hold-and-roll screen already active. Ignoring duplicate invocation.");
            return;
        }

        setEngineRolling(throwEngine, false);

        throwEngine._naturalRollBypassResolveOnClear = true;
        DiceInteractionManager.cleanup(throwEngine);

        const dsnEngine = getDsnEngine();
        await dsnEngine.prepareWorkerForHold(throwEngine);

        throwEngine._simulationReady = false;
        throwEngine.throws = null;

        stopDSNTicker();

        if (typeof throwEngine.clearAll === "function") {
            try { await throwEngine.clearAll(); } catch (e) {}
        } else if (typeof throwEngine.clearDice === "function") {
            throwEngine.clearDice();
        }

        if (throwEngine.diceScene?.scene) {
            for (let k = throwEngine.diceScene.scene.children.length - 1; k >= 0; k--) {
                const child = throwEngine.diceScene.scene.children[k];
                if (child && (child.type === "Group" || child.isGroup)) {
                    throwEngine.diceScene.scene.remove(child);
                    disposeObject3D(child);
                }
            }
        }

        log("Broadcasting manual roll grab event...");
        const targetUserId = rollingUserId || game.user.id;
        const roll = game.dice3d?._currentLocalRoll;
        const authorizedUsers = getAuthorizedUsers(roll);
        game.socket.emit("module.natural-roll", {
            type: "grab",
            user: targetUserId,
            authorizedUsers: authorizedUsers
        });

        let countNewDice = 0;
        const maxDiceNumber = game.settings.get("dice-so-nice", "maxDiceNumber");
        const workerSpecs = [];

        if (game.dice3d?.canvas?.show) {
            game.dice3d.canvas.show();
        }
        const dsnCanvas = game.dice3d?.canvas?.[0] || game.dice3d?.canvas;
        if (dsnCanvas) {
            dsnCanvas.style.display = "";
            dsnCanvas.style.pointerEvents = "auto";
        }

        const getDieRadius = (dieType) => {
            const diceobj = throwEngine.dicefactory.get(dieType);
            const baseScale = throwEngine.dicefactory.baseScale || 50;
            const scopedScale = (throwEngine.renderer?.scopedTextureCache?.type === "board") ? baseScale : 60;
            const scaleMultiplier = (diceobj && typeof diceobj.scale === "number") ? diceobj.scale : 1.0;
            return scaleMultiplier * (scopedScale / 100) * 50;
        };

        const rect = dsnCanvas ? dsnCanvas.getBoundingClientRect() : { left: 0, top: 0, width: (typeof window !== "undefined" ? window.innerWidth : 1920), height: (typeof window !== "undefined" ? window.innerHeight : 1080) };
        const centerCoords = DiceInteractionManager.get3DCoords({
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2
        }, dsnEngine.spawnPlaneHeight, throwEngine) || dsnEngine.centerFallback();

        let spawnPos = centerCoords;

        if (game.settings.get("natural-roll", "spawnAtCursor") && lastPointerPos.x > 0 && lastPointerPos.y > 0) {
            const cursor3D = DiceInteractionManager.get3DCoords({
                clientX: lastPointerPos.x,
                clientY: lastPointerPos.y
            }, dsnEngine.spawnPlaneHeight, throwEngine);
            if (cursor3D) {
                spawnPos = cursor3D;
            }
        }

        const getFormationSpacing = () => {
            const rawSpread = game.settings.get("natural-roll", "diceSpread") ?? 0.06;
            const dieRadius = throwEngine.diceList.length > 0
                ? getDieRadius(throwEngine.diceList[0]?.type || "d6")
                : 30;
            return dsnEngine.formationSpacing(rawSpread, dieRadius);
        };

        const getDiceOffset = (index, totalDice) => {
            const c = getFormationSpacing();

            if (totalDice <= 1) {
                return { dx: 0, dy: 0, dz: 0 };
            }

            if (totalDice === 2) {
                const offset = c * 0.5;
                const dx = (index === 0) ? -offset : offset;
                return dsnEngine.planeOffset(dx, 0);
            }

            if (totalDice === 3) {
                const radius = c * 0.6;
                const angle = (index * (2 * Math.PI / 3)) - (Math.PI / 2);
                const dx = radius * Math.cos(angle);
                const dOther = radius * Math.sin(angle);
                return dsnEngine.planeOffset(dx, dOther);
            }

            const goldenAngle = 137.5 * (Math.PI / 180);
            const r = (c * 0.6) * Math.sqrt(index + 0.5);
            const theta = index * goldenAngle;
            const dx = Math.cos(theta) * r;
            const dOther = Math.sin(theta) * r;
            return dsnEngine.planeOffset(dx, dOther);
        };

        const setDieWorldPosition = (die, x, y, z) => {
            const isParentScene = !die.parent || die.parent.isScene || die.parent.type === "Scene" || die.parent === throwEngine.diceScene?.scene;
            if (isParentScene) {
                die.position.set(x, y, z);
            } else {
                die.position.set(0, 0, 0);
                die.parent.position.set(x, y, z);
            }
        };

        const getDieWorldPosition = (die) => {
            const isParentScene = !die.parent || die.parent.isScene || die.parent.type === "Scene" || die.parent === throwEngine.diceScene?.scene;
            if (isParentScene) {
                return die.position;
            }
            return die.parent.position;
        };

        if (throws && throws.length > 0) {
            for (const notation of throws) {
                throwEngine.getVectors(notation, { x: 0, y: 0 }, 0, 1);
                countNewDice += notation.dice.length;
            }

            let spawned = 0;
            for (let j = 0; j < throws.length && spawned < maxDiceNumber; j++) {
                let notationVectors = throws[j];
                for (let i = 0, len = notationVectors.dice.length; i < len && spawned < maxDiceNumber; ++i) {
                    const die = notationVectors.dice[i];
                    die.startAtIteration = 0;

                    const offset = getDiceOffset(spawned, countNewDice);
                    const pos = dsnEngine.spawnPosition(spawnPos, offset, getDieRadius(die.type), spawned);
                    die.vectors.pos = pos;
                    die.vectors.velocity = { x: 0, y: 0, z: 0 };
                    die.vectors.angle = { x: 0, y: 0, z: 0 };

                    const appearance = DSNAppearanceResolver.resolveDieAppearance({
                        throwEngine,
                        die,
                        notationVectors,
                        rollingUserId
                    });
                    die.appearance = appearance;

                    await dsnEngine.spawnDie(throwEngine, die, appearance, notationVectors, workerSpecs);

                    const dicemesh = throwEngine.diceList[throwEngine.diceList.length - 1];
                    if (dicemesh) {
                        setDieWorldPosition(dicemesh, pos.x, pos.y, pos.z);
                        if (dicemesh.userData?.materialData) {
                            die.appearance = DSNAppearanceResolver.mergeMaterialData(die.appearance, dicemesh.userData.materialData);
                        }
                    }
                    spawned++;
                }
            }

            throwEngine.minIterations = 0;
            await dsnEngine.commitSpawnedDice(throwEngine, workerSpecs);
        }

        throwEngine.iteration = 0;
        throwEngine.addDiceToScene();

        const getHeldObject = (die) => (die.parent && !die.parent.isScene && die.parent.type !== "Scene")
            ? die.parent : die;

        const dsnBox = game.dice3d.box;
        for (const die of throwEngine.diceList) {
            die.sim = null;
            die.visible = true;
            die.userData = die.userData || {};
            die.userData.constrained = true;
            if (die.parent && die.parent !== throwEngine.diceScene?.scene && !die.parent.isScene) {
                die.parent.visible = true;
                die.parent.userData = die.parent.userData || {};
                die.parent.userData.constrained = true;
            }

            dsnEngine.initHeldOrientation(die, getHeldObject(die));
        }

        const interactionState = {
            throwEngine,
            throws,
            callback,
            heldDice: [...throwEngine.diceList],
            isDragging: false,
            dragStart: null,
            moveHistory: [],
            spawnPos,
            pointerId: undefined,
            timeoutId: null,
            heartbeatId: null,
            onPointerDown: null,
            onPointerMove: null,
            onPointerUp: null,
            updateCursor: null,
            lastRattleTime: 0,
            spawnTime: performance.now(),
            naturalRollId: throwEngine.naturalRollId,

            tiltX: 0,
            tiltY: 0,
            velX: 0,
            velY: 0,
            lastMoveTime: performance.now(),
            lastMoveX: null,
            lastMoveY: null,
            swingRafId: null,
            lastFrameTime: null,
            heldTargets: new Map(),
            dieSprings: new Map(),
            _active: true
        };

        throwEngine._naturalRollState = interactionState;

        const heldRoll = game.dice3d?._currentLocalRoll;
        const isHoldAlive = () => interactionState._active
            && throwEngine._naturalRollState === interactionState
            && dsnCanvas?.isConnected !== false;
        const armHoldWatchdog = () => heldRoll?._naturalRollArmTimeout?.(HOLD_WATCHDOG_MS);

        armHoldWatchdog();
        interactionState.heartbeatId = setInterval(() => {
            if (isHoldAlive()) {
                armHoldWatchdog();
                return;
            }
            clearInterval(interactionState.heartbeatId);
            interactionState.heartbeatId = null;
        }, HOLD_HEARTBEAT_MS);

        const resolveRollWhenLanded = (roll, iterations) => {
            throwEngine.callback = function(...args) {
                try {
                    return callback?.apply(this, args);
                } finally {
                    roll?._naturalRollResolve?.(roll);
                }
            };
            roll?._naturalRollArmTimeout?.(getPlaybackDurationMs(throwEngine, iterations) + LANDING_GRACE_MS);
        };

        let isUpdatingConstraintWorker = false;
        let pendingWorkerPositions = null;

        const getHeldTarget = (pos3D, die, index, totalHeld) => {
            return dsnEngine.heldTarget(pos3D, getDiceOffset(index, totalHeld), getDieRadius(die.type));
        };

        const sendWorkerPositions = (positions) => {
            pendingWorkerPositions = positions;
            if (isUpdatingConstraintWorker) return;
            isUpdatingConstraintWorker = true;
            (async () => {
                try {
                    while (pendingWorkerPositions) {
                        const toSend = pendingWorkerPositions;
                        pendingWorkerPositions = null;
                        await throwEngine.physicsWorker.exec("updateConstraint", { positions: toSend });
                    }
                } catch (e) {
                    error("Error updating physics worker constraints:", e);
                } finally {
                    isUpdatingConstraintWorker = false;
                }
            })();
        };

        const applyHeldPositions = () => {
            const positions = {};
            for (const die of interactionState.heldDice) {
                const spring = interactionState.dieSprings.get(die.id);
                if (!spring) continue;
                setDieWorldPosition(die, spring.pos.x, spring.pos.y, spring.pos.z);
                positions[die.id] = { ...spring.pos };
            }
            if (dsnEngine.usesWorkerConstraints && throwEngine.physicsWorker) {
                sendWorkerPositions(positions);
            }
        };

        const updateConstraints = (pos3D, { snap = false } = {}) => {
            try {
                const totalHeld = interactionState.heldDice.length;
                interactionState.heldTargets = new Map(interactionState.heldDice.map((die, index) =>
                    [die.id, getHeldTarget(pos3D, die, index, totalHeld)]
                ));
                if (!snap) return;

                interactionState.dieSprings = new Map(interactionState.heldDice.map(die => {
                    const target = interactionState.heldTargets.get(die.id);
                    const existing = interactionState.dieSprings.get(die.id);
                    return [die.id, existing ? snapDieSpring(existing, target) : createDieSpring(target)];
                }));
                applyHeldPositions();
                renderDSNScene(throwEngine);
            } catch (err) {
                error("Error updating constraints:", err);
            }
        };

        const springPositionEpsilon = getFormationSpacing() * 1e-4;

        const stepHeldDice = (dtSeconds) => {
            if (!dtSeconds || interactionState.heldTargets.size === 0) return;
            let moved = false;
            const nextSprings = new Map(interactionState.dieSprings);
            for (const die of interactionState.heldDice) {
                const spring = interactionState.dieSprings.get(die.id);
                const target = interactionState.heldTargets.get(die.id);
                if (!spring || !target) continue;
                const stepped = stepDieSpring(spring, target, dtSeconds);
                const delta = Math.max(
                    Math.abs(stepped.pos.x - spring.pos.x),
                    Math.abs(stepped.pos.y - spring.pos.y),
                    Math.abs(stepped.pos.z - spring.pos.z)
                );
                moved = moved || delta > springPositionEpsilon;
                nextSprings.set(die.id, stepped);
            }
            interactionState.dieSprings = nextSprings;
            if (moved) {
                applyHeldPositions();
            }
        };

        dsnBox.isVisible = true;
        dsnBox.last_time = 0;
        dsnBox._preparingThrow = false;

        if (game.dice3d?._beforeShow) {
            game.dice3d._beforeShow();
        } else if (game.dice3d?.showCanvas) {
            game.dice3d.showCanvas();
        }

        if (dsnCanvas) {
            dsnCanvas.style.display = "";
            dsnCanvas.style.opacity = "1";
            dsnCanvas.style.pointerEvents = "auto";
        }

        updateConstraints(spawnPos, { snap: true });

        await dsnEngine.attachHoldConstraints(throwEngine, throwEngine.diceList, getDieWorldPosition);

        renderDSNScene(throwEngine);

        const TILT_SENSITIVITY = 0.08;
        const TILT_MAX         = 0.7;
        const SPRING_K         = 0.16;
        const VEL_DECAY        = 0.85;
        const IDLE_SWAY_PERIOD = 2400;
        const IDLE_AMPLITUDE   = 0.08;

        const swingLoop = () => {
            if (!interactionState._active) return;

            const now = performance.now();
            const idleMs = now - (interactionState.lastMoveTime || now);

            const frameDt = interactionState.lastFrameTime !== null ? (now - interactionState.lastFrameTime) / 1000 : 0;
            interactionState.lastFrameTime = now;
            try {
                stepHeldDice(frameDt);
            } catch (e) {
                error("Error stepping held dice:", e);
            }

            interactionState.velX *= VEL_DECAY;
            interactionState.velY *= VEL_DECAY;

            let targetX = Math.max(-TILT_MAX, Math.min(TILT_MAX, interactionState.velY * TILT_SENSITIVITY));
            let targetY = Math.max(-TILT_MAX, Math.min(TILT_MAX, -interactionState.velX * TILT_SENSITIVITY));

            const t = now / IDLE_SWAY_PERIOD;
            const idleFactor = interactionState.isDragging ? 0.3 : 1.0;
            const swayPhase = t * 2 * Math.PI;
            targetX += Math.sin(swayPhase) * IDLE_AMPLITUDE * idleFactor;
            targetY += Math.cos(swayPhase * 0.7) * (IDLE_AMPLITUDE * 0.8) * idleFactor;

            interactionState.tiltX += (targetX - interactionState.tiltX) * SPRING_K;
            interactionState.tiltY += (targetY - interactionState.tiltY) * SPRING_K;

            try {
                const diceScene = throwEngine?.diceScene || game.dice3d?.box?.diceScene || game.dice3d?.box;
                const camera = diceScene?.camera;

                const sampleObj = interactionState.heldDice[0];
                const sampleRot = sampleObj?.quaternion || camera?.quaternion;

                for (let i = 0; i < interactionState.heldDice.length; i++) {
                    const die = interactionState.heldDice[i];
                    const obj = getHeldObject(die);

                    const diePhase = i * 0.45;
                    const curTiltX = interactionState.tiltX + Math.sin(swayPhase + diePhase) * 0.02;
                    const curTiltY = interactionState.tiltY + Math.cos(swayPhase * 0.8 + diePhase) * 0.02;

                    dsnEngine.applyHeldTilt(obj, curTiltX, curTiltY, Math.sin(swayPhase + diePhase), die.userData?.naturalRollBaseQuaternion);
                }

                renderDSNScene(throwEngine);
            } catch(e) {

            }

            interactionState.swingRafId = requestAnimationFrame(swingLoop);
        };
        interactionState.swingRafId = requestAnimationFrame(swingLoop);

        const clearRollTimeout = () => {
            if (interactionState.timeoutId) {
                clearTimeout(interactionState.timeoutId);
                interactionState.timeoutId = null;
            }
        };

        const playShakeSound = () => {
            if (!game.settings.get("natural-roll", "enableRattleSfx")) return;
            try {
                const soundManager = game.dice3d?.box?.soundManager;
                const soundSurface = soundManager?.soundsSurface || "plastic";
                const volume = (soundManager?.volume ?? 0.5) * 0.5;

                if (soundManager && typeof soundManager.eventCollide === "function") {
                    soundManager.eventCollide({
                        source: "dice",
                        diceType: "d6",
                        force: volume
                    });
                } else if (soundManager && typeof soundManager.play === "function") {
                    soundManager.play("collision", volume);
                } else {
                    const src = `modules/dice-so-nice/sfx/sounds/${soundSurface}/collision.wav`;
                    const audioHelperClass = globalThis.foundry?.audio?.AudioHelper || globalThis.AudioHelper;
                    if (audioHelperClass) {
                        audioHelperClass.play({ src, volume }, false);
                    } else if (game.audio && typeof game.audio.play === "function") {
                        game.audio.play(src, { volume });
                    }
                }
            } catch (e) {
                console.warn("Natural Roll | Failed to play shake sound:", e);
            }
        };
        const isClickNearAnyDie = (clientX, clientY) => {
            const diceScene = game.dice3d?.box?.diceScene || game.dice3d?.box;
            if (!diceScene || !diceScene.camera) return true;

            const camera = diceScene.camera;
            const rect = dsnCanvas.getBoundingClientRect();
            const width = rect.width;
            const height = rect.height;

            const grabRadius = Math.max(game.settings.get("natural-roll", "grabRadius") || 120, 160);

            for (const die of interactionState.heldDice) {
                const diePos = getDieWorldPosition(die);
                if (!diePos) continue;

                const tempV = diePos.clone();
                tempV.project(camera);

                const x = ((tempV.x + 1) * width) / 2 + rect.left;
                const y = ((-tempV.y + 1) * height) / 2 + rect.top;

                const dx = clientX - x;
                const dy = clientY - y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < grabRadius) {
                    return true;
                }
            }

            return true;
        };

        const onPointerDown = (e) => {
            if (performance.now() - interactionState.spawnTime < 200) return;

            if (e.pointerType && e.pointerType !== "mouse" && e.pointerType !== "touch" && e.pointerType !== "pen") return;

            if (e.target !== dsnCanvas && !dsnCanvas.contains(e.target)) {
                return;
            }

            if (!isClickNearAnyDie(e.clientX, e.clientY)) {
                return;
            }

            if (interactionState.pointerId !== undefined) return;

            clearRollTimeout();

            const pos3D = DiceInteractionManager.get3DCoords(e, dsnEngine.pointerPlaneHeight, throwEngine);
            if (!pos3D) return;

            e.stopPropagation();
            e.preventDefault();

            interactionState.isDragging = true;
            interactionState.pointerId = e.pointerId;
            const now = performance.now();
            interactionState.dragStart = { x: e.clientX, y: e.clientY, time: now, pos3D };
            interactionState.moveHistory = [{ x: e.clientX, y: e.clientY, time: now, pos3D }];

            if (typeof document !== "undefined") {
                if (document.body) {
                    document.body.style.cursor = "grabbing";
                }
                let styleEl = document.getElementById("natural-roll-cursor-lock");
                if (!styleEl) {
                    styleEl = document.createElement("style");
                    styleEl.id = "natural-roll-cursor-lock";
                    styleEl.innerHTML = "* { cursor: grabbing !important; }";
                    document.head.appendChild(styleEl);
                }
            }
            if (dsnCanvas) {
                dsnCanvas.style.cursor = "grabbing";
            }

            log("User grabbed dice.");

            updateConstraints(pos3D);
        };

        const onPointerMove = (e) => {
            if (!interactionState.isDragging) return;
            if (e.pointerId !== interactionState.pointerId) return;

            const pos3D = DiceInteractionManager.get3DCoords(e, dsnEngine.pointerPlaneHeight, throwEngine);
            if (!pos3D) return;

            e.stopPropagation();
            e.preventDefault();

            const now = performance.now();
            const dt = Math.max(1, now - (interactionState.lastMoveTime || now));

            if (interactionState.lastMoveX !== null) {
                const rawVx = (e.clientX - interactionState.lastMoveX) / dt;
                const rawVy = (e.clientY - interactionState.lastMoveY) / dt;

                const alpha = Math.min(1, dt / 30);
                interactionState.velX = interactionState.velX * (1 - alpha) + rawVx * alpha;
                interactionState.velY = interactionState.velY * (1 - alpha) + rawVy * alpha;
            }
            interactionState.lastMoveX = e.clientX;
            interactionState.lastMoveY = e.clientY;
            interactionState.lastMoveTime = now;

            const coalesced = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
            const samples = coalesced.length > 1 ? coalesced : [e];
            for (const sample of samples) {
                const samplePos3D = sample === e ? pos3D : DiceInteractionManager.get3DCoords(sample, dsnEngine.pointerPlaneHeight, throwEngine);
                if (!samplePos3D) continue;
                const sampleTime = (Number.isFinite(sample.timeStamp) && Math.abs(now - sample.timeStamp) < 1000)
                    ? Math.min(sample.timeStamp, now)
                    : now;
                interactionState.moveHistory.push({ x: sample.clientX, y: sample.clientY, time: sampleTime, pos3D: samplePos3D });
            }
            const cutoff = now - 150;
            interactionState.moveHistory = interactionState.moveHistory.filter(p => p.time >= cutoff);

            const handSpeed = Math.hypot(interactionState.velX, interactionState.velY);
            if (handSpeed > 1.5 && now - interactionState.lastRattleTime > 120) {
                interactionState.lastRattleTime = now;
                playShakeSound();
            }

            updateConstraints(pos3D);
        };

        const captureHeldOrientations = () => new Map(interactionState.heldDice.map(die => {
            const q = getHeldObject(die).quaternion;
            return [die.id, q ? { x: q.x, y: q.y, z: q.z, w: q.w } : null];
        }));

        const buildDieThrows = (throwParams) => new Map(
            interactionState.heldDice.map(die => [die.id, buildDieThrow({ engine: dsnEngine, ...throwParams })])
        );

        const launchHeldDice = async (dieThrows, heldOrientations) => {
            heldRoll?._naturalRollArmTimeout?.(SIMULATION_WATCHDOG_MS);
            for (const die of interactionState.heldDice) {
                if (die?.userData) {
                    die.userData.constrained = false;
                }
            }
            setEngineRolling(throwEngine, true);
            throwEngine._simulationReady = false;

            return dsnEngine.launchHeldDice({
                throwEngine,
                heldDice: interactionState.heldDice,
                dieThrows,
                heldOrientations,
                getDieWorldPosition,
                log
            });
        };

        const onPointerUp = async (e) => {
            if (!interactionState.isDragging) return;
            if (e.pointerId !== interactionState.pointerId) return;

            e.stopPropagation();
            e.preventDefault();

            const dragStart = interactionState.dragStart;
            const moveHistory = interactionState.moveHistory;
            const heldOrientations = captureHeldOrientations();

            DiceInteractionManager.cleanup(throwEngine, false);

            try {
                const now = performance.now();
                const lastSample = moveHistory[moveHistory.length - 1] || dragStart;
                const posEnd3D = DiceInteractionManager.get3DCoords(e, dsnEngine.pointerPlaneHeight, throwEngine) || lastSample?.pos3D;
                const flick = estimateFlick(moveHistory, { x: e.clientX, y: e.clientY, time: now, pos3D: posEnd3D }, dsnEngine);

                let tossSpeed = 0.4;
                let dirX = 1;
                let dirZ = 1;

                if (flick.direction) {
                    dirX = flick.direction.x;
                    dirZ = flick.direction.z;
                } else {
                    const randomAngle = Math.random() * Math.PI * 2;
                    dirX = Math.cos(randomAngle);
                    dirZ = Math.sin(randomAngle);
                }

                const multiplier = game.settings.get("natural-roll", "flickMultiplier") || 1.0;
                const effectiveSpeed = flick.speed * multiplier;
                const minPxSpeed = 50;
                const maxPxSpeed = 2500;

                if (effectiveSpeed > minPxSpeed) {
                    const normalized = (effectiveSpeed - minPxSpeed) / (maxPxSpeed - minPxSpeed);
                    tossSpeed = Math.max(0.4, Math.min(5.0, 0.4 + normalized * 4.6));
                }

                const lift = 0.2 + (tossSpeed / 5.0) * 0.9;
                const spinMultiplier = 0.35 + (tossSpeed / 5.0) * 0.65;
                const baseSpin = dsnEngine.baseSpin();

                log("User flicked/tossed dice.", {
                    direction: { x: dirX, z: dirZ },
                    calculatedSpeed: tossSpeed,
                    spinMultiplier
                });

                const dieThrows = buildDieThrows({ dirX, dirZ, tossSpeed, lift, baseSpin, spinMultiplier });
                const impulses = await launchHeldDice(dieThrows, heldOrientations);

                if (dsnCanvas) {
                    dsnCanvas.style.pointerEvents = "none";
                }

                const simParams = dsnEngine.simulationParams({
                    minIterations: throwEngine.minIterations,
                    nbIterationsBetweenRolls: throwEngine.nbIterationsBetweenRolls,
                    framerate: throwEngine.framerate,
                    canBeFlipped: game.settings.get("dice-so-nice", "diceCanBeFlipped")
                }, impulses);

                const simResult = await throwEngine.physicsWorker.exec('simulateThrow', simParams);

                if (!simResult) {
                    error("simulateThrow failed");
                    setEngineRolling(throwEngine, false);
                    callback?.(throws);
                    return;
                }

                const { ids, quaternionsBuffers, positionsBuffers, detectedCollides, iterationsNeeded } = simResult;
                const quaternions = quaternionsBuffers.map(buffer => new Float32Array(buffer));
                const positions = positionsBuffers.map(buffer => new Float32Array(buffer));

                throwEngine.iterationsNeeded = iterationsNeeded;
                throwEngine.quaternions = quaternions;
                throwEngine.positions = positions;
                throwEngine.ids = ids;
                if (game.dice3d?.box && dsnEngine.mirrorsSimulationToBox) {
                    try {
                        game.dice3d.box.quaternions = quaternions;
                        game.dice3d.box.positions = positions;
                        game.dice3d.box.ids = ids;
                        game.dice3d.box.iterationsNeeded = iterationsNeeded;
                    } catch (e) {}
                }
                const idToIndex = new Map();
                ids.forEach((id, index) => idToIndex.set(id, index));

                const faceValues = await dsnEngine.resolveFaceValues(throwEngine, simResult, quaternions, idToIndex);
                simResult.faceValues = faceValues;

                const ephemeralDiceList = [...throwEngine.diceList, ...throwEngine.deadDiceList];
                for (const dice of ephemeralDiceList) {
                    const index = idToIndex.get(dice.id);
                    if (index !== undefined) {
                        dice.sim = {
                            dead: false,
                            stepQuaternions: quaternions[index],
                            stepPositions: positions[index]
                        };
                    }
                }

                const localDiceList = [...throwEngine.diceList, ...throwEngine.deadDiceList];
                const roll = game.dice3d?._currentLocalRoll;
                if (roll) {
                    DiceInteractionManager.applyFaceValuesToRoll(roll, localDiceList, faceValues);
                }

                if (throws) {
                    throws.forEach(t => {
                        if (t.dice) {
                            t.dice.forEach(d => {
                                const dicemesh = localDiceList.find(mesh =>
                                    mesh.userData?.rollerId === `${d.options?.naturalRollDieId}-${d.id}` ||
                                    mesh.userData?.rollerId === d.options?.naturalRollDieId ||
                                    mesh.id === d.id
                                );
                                if (dicemesh) {
                                    const finalVal = faceValues[dicemesh.id];
                                    if (finalVal !== undefined && finalVal !== null) {
                                        d.result = finalVal;
                                        d.resultLabel = DiceInteractionManager._formatResultLabel(d, dicemesh, finalVal, roll);
                                        dicemesh.result = finalVal;
                                    }
                                }
                            });
                        }
                    });
                }

                let checkRollMode = roll?.options?.messageMode || roll?.options?.rollMode;
                if (!checkRollMode && typeof document !== "undefined") {
                    const activeModeButton = document.querySelector('#message-modes button[aria-pressed="true"]');
                    if (activeModeButton) {
                        checkRollMode = activeModeButton.dataset.mode;
                    } else {
                        const selectEl = document.querySelector('select[name="rollMode"]');
                        if (selectEl) {
                            checkRollMode = selectEl.value;
                        }
                    }
                }
                if (!checkRollMode) {
                    checkRollMode = game.settings.get("core", "rollMode");
                }
                const isBlind = checkRollMode === "blind" || checkRollMode === "blindroll" || roll?.options?.blind || globalThis._naturalRollMessageVisibility?.blind;
                if (isBlind && !game.user.isGM) {
                    DiceInteractionManager.broadcastRoll(throwEngine, throws, simResult, interactionState.naturalRollId);

                    if (game.settings.get("natural-roll", "enableMagicalEffects")) {
                        DiceInteractionManager.triggerMagicalEffectsForDice(throwEngine, throwEngine.diceList);
                    }

                    throwEngine._naturalRollBypassResolveOnClear = true;
                    if (typeof throwEngine.clearDice === "function") {
                        throwEngine.clearDice();
                    } else if (typeof throwEngine.clearAll === "function") {
                        throwEngine.clearAll();
                    }
                    setEngineRolling(throwEngine, false);

                    if (game.dice3d?.canvas?.hide) {
                        game.dice3d.canvas.hide();
                    }
                    const dsnCanvas = game.dice3d?.canvas?.[0] || game.dice3d?.canvas;
                    if (dsnCanvas) {
                        dsnCanvas.style.display = "none";
                        dsnCanvas.style.cursor = "";
                    }
                    if (typeof document !== "undefined") {
                        if (document.body) {
                            document.body.style.cursor = "";
                        }
                        const styleEl = document.getElementById("natural-roll-cursor-lock");
                        if (styleEl) {
                            styleEl.remove();
                        }
                    }

                    const durationMs = getPlaybackDurationMs(throwEngine, iterationsNeeded) + LANDING_GRACE_MS;
                    roll?._naturalRollArmTimeout?.(null);
                    setTimeout(() => {
                        if (roll && typeof roll._naturalRollResolve === "function") {
                            roll._naturalRollResolve(roll);
                        }
                        delete throwEngine._naturalRollBypassResolveOnClear;
                    }, durationMs);

                    callback?.(throws);
                    return;
                }

                for (const dicemesh of throwEngine.diceList) {
                    if (dicemesh) {
                        const finalVal = faceValues[dicemesh.id];
                        if (finalVal !== undefined) {
                            dicemesh.forcedResult = finalVal;
                        }
                        await dsnEngine.swapDiceFace(throwEngine, dicemesh, finalVal);
                        dicemesh.result = null;
                    }
                }

                throwEngine.detectedCollides = throwEngine.soundManager?.generateCollisionSounds ? throwEngine.soundManager.generateCollisionSounds(detectedCollides) : detectedCollides;
                throwEngine.iteration = 0;
                resolveRollWhenLanded(roll, iterationsNeeded);
                throwEngine.throws = throws;

                const nowTime = (new Date()).getTime();
                setEngineRunning(throwEngine, nowTime);
                throwEngine.last_time = nowTime;
                setEngineRolling(throwEngine, true);
                throwEngine._simulationReady = true;

                if (game.dice3d?.box) {
                    try { game.dice3d.box._simulationReady = true; } catch (e) {}
                    if (game.dice3d.box.animateThrow) {
                        canvas.app?.ticker?.add(game.dice3d.box.animateThrow, game.dice3d.box);
                    }
                }

                DiceInteractionManager.pruneRecentReplays();
                DiceInteractionManager.recentReplays.push({
                    user: game.user.id,
                    results: Object.values(simResult.faceValues || {}).sort(),
                    timestamp: Date.now()
                });

                DiceInteractionManager.broadcastRoll(throwEngine, throws, simResult, interactionState.naturalRollId);
                delete throwEngine._naturalRollBypassResolveOnClear;
            } catch (err) {
                error("Error resolving pointerup simulation:", err);
                setEngineRolling(throwEngine, false);
                delete throwEngine._naturalRollBypassResolveOnClear;
                try { callback?.(throws); } catch (e) {}
                const roll = game.dice3d?._currentLocalRoll;
                if (roll && typeof roll._naturalRollResolve === "function") {
                    try { roll._naturalRollResolve(roll); } catch (e) {}
                }
            }
        };

        const executeAutoRoll = async () => {
            const heldOrientations = captureHeldOrientations();
            DiceInteractionManager.cleanup(throwEngine);

            try {
                const randomAngle = Math.random() * Math.PI * 2;
                const dirX = Math.cos(randomAngle);
                const dirZ = Math.sin(randomAngle);
                const tossSpeed = 1.5;
                const lift = 0.5;

                const spinMultiplier = 0.65;
                const baseSpin = dsnEngine.baseSpin();

                log("Auto-roll timeout triggered. Rolling dice automatically.");

                const dieThrows = buildDieThrows({ dirX, dirZ, tossSpeed, lift, baseSpin, spinMultiplier });
                const impulses = await launchHeldDice(dieThrows, heldOrientations);

                if (dsnCanvas) {
                    dsnCanvas.style.pointerEvents = "none";
                }

                const simParams = dsnEngine.simulationParams({
                    minIterations: throwEngine.minIterations,
                    nbIterationsBetweenRolls: throwEngine.nbIterationsBetweenRolls,
                    framerate: throwEngine.framerate,
                    canBeFlipped: game.settings.get("dice-so-nice", "diceCanBeFlipped")
                }, impulses);

                const simResult = await throwEngine.physicsWorker.exec('simulateThrow', simParams);

                if (!simResult) {
                    error("simulateThrow failed on auto-roll");
                    setEngineRolling(throwEngine, false);
                    callback?.(throws);
                    return;
                }

                const { ids, quaternionsBuffers, positionsBuffers, detectedCollides, iterationsNeeded } = simResult;
                const quaternions = quaternionsBuffers.map(buffer => new Float32Array(buffer));
                const positions = positionsBuffers.map(buffer => new Float32Array(buffer));

                throwEngine.iterationsNeeded = iterationsNeeded;
                throwEngine.quaternions = quaternions;
                throwEngine.positions = positions;
                throwEngine.ids = ids;
                if (game.dice3d?.box) {
                    game.dice3d.box.quaternions = quaternions;
                    game.dice3d.box.positions = positions;
                    game.dice3d.box.ids = ids;
                    game.dice3d.box.iterationsNeeded = iterationsNeeded;
                }
                const idToIndex = new Map();
                ids.forEach((id, index) => idToIndex.set(id, index));

                const faceValues = await dsnEngine.resolveFaceValues(throwEngine, simResult, quaternions, idToIndex);
                simResult.faceValues = faceValues;

                const roll = game.dice3d?._currentLocalRoll;
                if (roll) {
                    const localDiceList = [...throwEngine.diceList, ...throwEngine.deadDiceList];
                    DiceInteractionManager.applyFaceValuesToRoll(roll, localDiceList, faceValues);
                }

                const ephemeralDiceList = [...throwEngine.diceList, ...throwEngine.deadDiceList];
                for (const dice of ephemeralDiceList) {
                    const index = idToIndex.get(dice.id);
                    if (index !== undefined) {
                        dice.sim = {
                            dead: false,
                            stepQuaternions: quaternions[index],
                            stepPositions: positions[index]
                        };
                    }
                }

                for (const dicemesh of throwEngine.diceList) {
                    if (dicemesh) {
                        await dsnEngine.swapDiceFace(throwEngine, dicemesh, faceValues[dicemesh.id]);
                        dicemesh.result = null;
                    }
                }

                throwEngine.detectedCollides = throwEngine.soundManager?.generateCollisionSounds ? throwEngine.soundManager.generateCollisionSounds(detectedCollides) : detectedCollides;
                throwEngine.iteration = 0;
                resolveRollWhenLanded(roll, iterationsNeeded);
                throwEngine.throws = throws;

                const nowTime = (new Date()).getTime();
                setEngineRunning(throwEngine, nowTime);
                throwEngine.last_time = nowTime;
                setEngineRolling(throwEngine, true);
                throwEngine._simulationReady = true;

                if (game.dice3d?.box) {
                    try { game.dice3d.box._simulationReady = true; } catch (e) {}
                    if (game.dice3d.box.animateThrow) {
                        canvas.app?.ticker?.add(game.dice3d.box.animateThrow, game.dice3d.box);
                    }
                }

                DiceInteractionManager.pruneRecentReplays();
                DiceInteractionManager.recentReplays.push({
                    user: game.user.id,
                    results: Object.values(simResult.faceValues || {}).sort(),
                    timestamp: Date.now()
                });

                DiceInteractionManager.lastCompletedRollTime = Date.now();

                DiceInteractionManager.broadcastRoll(throwEngine, throws, simResult, interactionState.naturalRollId);
            } catch (err) {
                error("Error executing auto-roll simulation:", err);
                setEngineRolling(throwEngine, false);
                delete throwEngine._naturalRollBypassResolveOnClear;
                try { callback?.(throws); } catch (e) {}
                const roll = game.dice3d?._currentLocalRoll;
                if (roll && typeof roll._naturalRollResolve === "function") {
                    try { roll._naturalRollResolve(roll); } catch (e) {}
                }
            }
        };

        const updateCursor = (e) => {
            if (interactionState.isDragging) {
                if (typeof document !== "undefined" && document.body) {
                    document.body.style.cursor = "grabbing";
                }
                dsnCanvas.style.cursor = "grabbing";
            } else if (isClickNearAnyDie(e.clientX, e.clientY)) {
                if (typeof document !== "undefined" && document.body) {
                    document.body.style.cursor = "";
                }
                dsnCanvas.style.cursor = "grab";
            } else {
                if (typeof document !== "undefined" && document.body) {
                    document.body.style.cursor = "";
                }
                dsnCanvas.style.cursor = "";
            }
        };

        interactionState.onPointerDown = onPointerDown;
        interactionState.onPointerMove = onPointerMove;
        interactionState.onPointerUp = onPointerUp;
        interactionState.updateCursor = updateCursor;

        if (game.settings.get("natural-roll", "enableTimeout")) {
            const durationSec = game.settings.get("natural-roll", "timeoutDuration") || 15;
            interactionState.timeoutId = setTimeout(executeAutoRoll, durationSec * 1000);
        }

        window.addEventListener("pointerdown", onPointerDown, true);
        window.addEventListener("pointermove", onPointerMove, true);
        window.addEventListener("pointerup", onPointerUp, true);
        window.addEventListener("pointermove", updateCursor);
    }

    static getDieRadius(dice) {
        if (dice.shape === 'd4') return 0.6;
        if (dice.shape === 'd6') return 0.7;
        if (dice.shape === 'd8') return 0.8;
        if (dice.shape === 'd10' || dice.shape === 'd100') return 0.9;
        if (dice.shape === 'd12') return 1.0;
        if (dice.shape === 'd20') return 1.1;
        return 0.8;
    }

    static get3DCoords(event, heightPlane = 0.1, engine = null) {
        const dsnCanvas = game.dice3d?.canvas?.[0] || game.dice3d?.canvas;
        const rect = dsnCanvas?.getBoundingClientRect?.() || {
            left: 0,
            top: 0,
            width: typeof window !== "undefined" ? window.innerWidth : 1920,
            height: typeof window !== "undefined" ? window.innerHeight : 1080
        };

        const width = rect.width || (typeof window !== "undefined" ? window.innerWidth : 1920);
        const height = rect.height || (typeof window !== "undefined" ? window.innerHeight : 1080);
        const left = rect.left || 0;
        const top = rect.top || 0;

        const clientX = (event && typeof event.clientX === "number") ? event.clientX : (left + width / 2);
        const clientY = (event && typeof event.clientY === "number") ? event.clientY : (top + height / 2);

        const ndcX = ((clientX - left) / width) * 2 - 1;
        const ndcY = -((clientY - top) / height) * 2 + 1;

        const diceScene = game.dice3d?.box?.diceScene || game.dice3d?.box;
        if (!diceScene || !diceScene.camera) return null;

        const raycaster = diceScene.raycaster || new THREE.Raycaster();
        raycaster.setFromCamera({ x: ndcX, y: ndcY }, diceScene.camera);
        const ray = raycaster.ray;

        const Dy = ray.direction.y;
        const Dz = ray.direction.z;

        const isZOriented = Math.abs(Dz) > Math.abs(Dy) * 2;

        if (isZOriented) {

            if (Math.abs(Dz) > 1e-6) {
                const t = (0 - ray.origin.z) / Dz;
                return {
                    x: ray.origin.x + t * ray.direction.x,
                    y: ray.origin.y + t * ray.direction.y,
                    z: 0
                };
            }
        } else {

            if (Math.abs(Dy) > 1e-6) {
                const t = (heightPlane - ray.origin.y) / Dy;
                return {
                    x: ray.origin.x + t * ray.direction.x,
                    y: heightPlane,
                    z: ray.origin.z + t * ray.direction.z
                };
            }
        }

        return null;
    }

    static broadcastRoll(engine, throws, simResult, naturalRollId) {
        if (!game.socket) return;
        const throwEngine = engine?.throwEngine || engine;

        try {
            const { ids, quaternionsBuffers, positionsBuffers, detectedCollides, iterationsNeeded, faceValues, deads, finalQuaternions } = simResult;

            const localDiceList = [...(throwEngine.diceList || []), ...(throwEngine.deadDiceList || [])];

            const neededSteps = Math.min(1001, (iterationsNeeded || 150) + 10);
            const trajectories = ids.map((id, index) => {
                const rawQ = new Float32Array(quaternionsBuffers[index]);
                const rawP = new Float32Array(positionsBuffers[index]);
                const qArr = Array.from(rawQ.subarray(0, neededSteps * 4));
                const pArr = Array.from(rawP.subarray(0, neededSteps * 3));

                const dicemesh = localDiceList.find(d => d.id === id);
                const rollerId = dicemesh?.userData?.rollerId || dicemesh?.options?.naturalRollDieId || id;

                return {
                    id: rollerId,
                    quaternions: qArr,
                    positions: pArr,
                    release: getDieScreenFraction(dicemesh)
                };
            });

            DiceThrowDataBuilder.broadcastManualRollPayload({
                naturalRollId,
                throws,
                localDiceList,
                faceValues,
                finalQuaternions,
                trajectories,
                detectedCollides,
                iterationsNeeded,
                deads
            });
        } catch (err) {
            error("Failed to broadcast manual roll results:", err);
        }
    }

    static handleGrab(payload) {
        return ReplayManager.handleGrab(payload);
    }

    static handleReplay(payload, isFromQueue = false) {
        return ReplayManager.handleReplay(payload, isFromQueue);
    }

    static prepareReplayIntercept(engine, replayPayload) {
        return ReplayManager.prepareReplayIntercept(engine, replayPayload);
    }

    static triggerMagicalEffectsForDice(throwEngine, diceList) {
        return ParticleManager.spawnEffectsForDice(throwEngine, diceList);
    }
}

