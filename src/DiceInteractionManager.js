import { log, error, getAuthorizedUsers } from "./utils.js";
import { ParticleManager } from "./ParticleManager.js";

function getCanvasElement(canvas) {
    if (!canvas) return null;
    if (canvas.jquery && typeof canvas.get === "function") {
        return canvas.get(0);
    }
    if (canvas[0] instanceof HTMLElement) {
        return canvas[0];
    }
    if (canvas instanceof HTMLElement) {
        return canvas;
    }
    return canvas;
}

function getThrowEngine(engine) {
    if (!engine) return game.dice3d?.box?.throwEngine || game.dice3d?.box || null;
    return engine.throwEngine || game.dice3d?.box?.throwEngine || engine;
}

function setEngineRolling(engine, value) {
    if (!engine) return;
    try { engine.rolling = value; } catch (e) {}
    if (engine.throwEngine) {
        try { engine.throwEngine.rolling = value; } catch (e) {}
    }
}

function setEngineRunning(engine, value) {
    if (!engine) return;
    try { engine.running = value; } catch (e) {}
    if (engine.throwEngine) {
        try { engine.throwEngine.running = value; } catch (e) {}
    }
}

function renderDSNScene(engine) {
    const throwEngine = getThrowEngine(engine);

    const diceScene = throwEngine?.diceScene || game.dice3d?.box?.diceScene;
    const scene3D = diceScene?.scene || throwEngine?.scene || game.dice3d?.box?.scene;
    if (scene3D) {
        try { scene3D.updateMatrixWorld(true); } catch (e) {}
    }
    (game.dice3d?.box?.renderScene || throwEngine?.diceScene?.renderScene)?.call(game.dice3d?.box || throwEngine?.diceScene);
}

let lastPointerPos = { x: 0, y: 0 };
if (typeof window !== "undefined") {
    window.addEventListener("pointermove", (e) => {
        lastPointerPos.x = e.clientX;
        lastPointerPos.y = e.clientY;
    }, { passive: true });
}

export class DiceInteractionManager {
    static recentReplays = [];
    static recentChatMessageRolls = [];
    static activeGrabs = new Set();
    static lastCompletedRollTime = 0;
    static replayQueue = [];
    static isReplayExecuting = false;

    static cleanup(engine, resolvePromise = true) {
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
                if (DiceInteractionManager.replayQueue && DiceInteractionManager.replayQueue.length > 0) {
                    const nextPayload = DiceInteractionManager.replayQueue.shift();
                    log("Replay Queue: playing next queued replay from user:", nextPayload.user);
                    DiceInteractionManager.isReplayExecuting = false;
                    DiceInteractionManager.handleReplay(nextPayload, true);
                } else {
                    DiceInteractionManager.isReplayExecuting = false;
                }
            }, 100);
        }

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

        state._active = false;
        if (state.swingRafId !== null) {
            cancelAnimationFrame(state.swingRafId);
            state.swingRafId = null;
        }

        for (const die of (state.heldDice || [])) {
            try {
                const obj = (die.parent && !die.parent.isScene && die.parent.type !== "Scene")
                    ? die.parent : die;
                if (obj.rotation?.set) {
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
        if (game.dice3d?.box) {
            const box = game.dice3d.box;
            if (typeof box.removeTicker === "function") {
                try { box.removeTicker(box.animateThrow); } catch(e) {}
                if (box._originalAnimateThrow) {
                    try { box.removeTicker(box._originalAnimateThrow); } catch(e) {}
                }
            } else {
                try { canvas.app?.ticker?.remove(box.animateThrow, box); } catch(e) {}
                if (box._originalAnimateThrow) {
                    try { canvas.app?.ticker?.remove(box._originalAnimateThrow, box); } catch(e) {}
                }
            }
        }
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
        setEngineRolling(throwEngine, false);

        throwEngine._naturalRollBypassResolveOnClear = true;
        DiceInteractionManager.cleanup(throwEngine);

        const isV13 = (game.release?.generation !== undefined ? game.release.generation <= 13 : (game.version ? parseInt(game.version) <= 13 : !throwEngine.spawnDiceMesh));
        if (!isV13 && throwEngine.physicsWorker) {
            try {
                await throwEngine.physicsWorker.exec("removeConstraint", {});
                const oldIds = (throwEngine.diceList || []).concat(throwEngine.deadDiceList || []).map(d => d.id);
                if (oldIds.length > 0) {
                    await throwEngine.physicsWorker.exec("removeDice", oldIds);
                }
            } catch (e) {}
        }

        throwEngine._simulationReady = false;
        throwEngine.throws = null;

        if (isV13 && throwEngine.physicsWorker && !throwEngine.physicsWorker._naturalRollHoldPatch) {
            const originalExec = throwEngine.physicsWorker.exec.bind(throwEngine.physicsWorker);
            throwEngine.physicsWorker._naturalRollHoldPatch = true;
            throwEngine.physicsWorker._naturalRollOriginalExec = originalExec;
            throwEngine.physicsWorker.exec = async function(cmd, ...args) {
                if (cmd === "playStep" && throwEngine._simulationReady === false) {
                    return { ids: null, worldAsleep: true };
                }
                return originalExec(cmd, ...args);
            };
        }

        if (game.dice3d?.box) {
            const box = game.dice3d.box;
            if (typeof box.removeTicker === "function") {
                try { box.removeTicker(box.animateThrow); } catch(e) {}
                if (box._originalAnimateThrow) {
                    try { box.removeTicker(box._originalAnimateThrow); } catch(e) {}
                }
            } else {
                try { canvas.app?.ticker?.remove(box.animateThrow, box); } catch(e) {}
                if (box._originalAnimateThrow) {
                    try { canvas.app?.ticker?.remove(box._originalAnimateThrow, box); } catch(e) {}
                }
            }
        }

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

        const defaultRadius = 25;
        const rect = dsnCanvas ? dsnCanvas.getBoundingClientRect() : { left: 0, top: 0, width: (typeof window !== "undefined" ? window.innerWidth : 1920), height: (typeof window !== "undefined" ? window.innerHeight : 1080) };
        const centerCoords = DiceInteractionManager.get3DCoords({
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2
        }, isV13 ? defaultRadius : 0.1, throwEngine) || (isV13 ? { x: 0, y: 0, z: defaultRadius } : { x: 0, y: 0.1, z: 0 });

        let spawnPos = centerCoords;

        if (game.settings.get("natural-roll", "spawnAtCursor") && lastPointerPos.x > 0 && lastPointerPos.y > 0) {
            const cursor3D = DiceInteractionManager.get3DCoords({
                clientX: lastPointerPos.x,
                clientY: lastPointerPos.y
            }, isV13 ? defaultRadius : 0.1, throwEngine);
            if (cursor3D) {
                spawnPos = cursor3D;
            }
        }

        const getDiceOffset = (index, totalDice) => {
            const rawSpread = game.settings.get("natural-roll", "diceSpread") ?? 0.06;

            let c;
            if (isV13) {

                const dieRadius = throwEngine.diceList.length > 0
                    ? getDieRadius(throwEngine.diceList[0]?.type || "d6")
                    : 30;

                c = dieRadius * (2 + rawSpread * 50);
            } else {
                c = rawSpread * 3.0;
            }

            if (totalDice <= 1) {
                return { dx: 0, dy: 0, dz: 0 };
            }

            if (totalDice === 2) {
                const offset = c * 0.5;
                const dx = (index === 0) ? -offset : offset;
                return isV13 ? { dx, dy: 0, dz: 0 } : { dx, dy: 0, dz: 0 };
            }

            if (totalDice === 3) {
                const radius = c * 0.6;
                const angle = (index * (2 * Math.PI / 3)) - (Math.PI / 2);
                const dx = radius * Math.cos(angle);
                const dOther = radius * Math.sin(angle);
                return isV13 ? { dx, dy: dOther, dz: 0 } : { dx, dy: 0, dz: dOther };
            }

            const goldenAngle = 137.5 * (Math.PI / 180);
            const r = (c * 0.6) * Math.sqrt(index + 0.5);
            const theta = index * goldenAngle;
            const dx = Math.cos(theta) * r;
            const dOther = Math.sin(theta) * r;
            return isV13 ? { dx, dy: dOther, dz: 0 } : { dx, dy: 0, dz: dOther };
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
                    const radius = isV13 ? getDieRadius(die.type) : 0.1;
                    const pos = isV13 ? {
                        x: spawnPos.x + offset.dx,
                        y: spawnPos.y + offset.dy,
                        z: radius + (spawned * 0.003)
                    } : {
                        x: spawnPos.x + offset.dx,
                        y: (spawnPos.y || 0.1) + (spawned * 0.003),
                        z: spawnPos.z + offset.dz
                    };
                    die.vectors.pos = pos;
                    die.vectors.velocity = { x: 0, y: 0, z: 0 };
                    die.vectors.angle = { x: 0, y: 0, z: 0 };

                    let appearance = throwEngine.dicefactory.getAppearanceForDice(
                        notationVectors.dsnConfig.appearance,
                        die.type,
                        die
                    );
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
                    if (appearance && (!appearance.system || !throwEngine.dicefactory.systems?.has(appearance.system))) {
                        appearance.system = "standard";
                    }
                    die.appearance = appearance;

                    if (isV13) {
                        await throwEngine.spawnDice(die, appearance);
                    } else if (throwEngine.spawnDiceMesh) {
                        await throwEngine.spawnDiceMesh(
                            die,
                            appearance,
                            notationVectors.dsnConfig.diceLibrary,
                            workerSpecs
                        );
                    } else {
                        await throwEngine.spawnDice(
                            die,
                            appearance,
                            notationVectors.dsnConfig.diceLibrary,
                            workerSpecs
                        );
                    }

                    const dicemesh = throwEngine.diceList[throwEngine.diceList.length - 1];
                    if (dicemesh) {
                        setDieWorldPosition(dicemesh, pos.x, pos.y, pos.z);
                    }
                    spawned++;
                }
            }

            throwEngine.minIterations = 0;
            if (!isV13 && workerSpecs.length > 0) {
                await throwEngine.physicsWorker.exec('createDiceBatch', workerSpecs);
            }
        }

        throwEngine.iteration = 0;
        throwEngine.addDiceToScene();

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
            _active: true
        };

        throwEngine._naturalRollState = interactionState;

        let isUpdatingConstraintWorker = false;
        let pendingWorkerPositions = null;

        const updateConstraints = (pos3D) => {
            try {
                const positions = {};
                const totalHeld = interactionState.heldDice.length;
                interactionState.heldDice.forEach((die, index) => {
                    const offset = getDiceOffset(index, totalHeld);
                    if (isV13) {
                        const radius = getDieRadius(die.type);
                        const targetX = pos3D.x + offset.dx;
                        const targetY = pos3D.y + offset.dy;
                        const targetZ = radius + 5;
                        setDieWorldPosition(die, targetX, targetY, targetZ);
                    } else {
                        const targetX = pos3D.x + offset.dx;
                        const targetY = pos3D.y || 0.1;
                        const targetZ = (pos3D.z || 0) + offset.dz;
                        positions[die.id] = {
                            x: targetX,
                            y: targetY,
                            z: targetZ
                        };
                        setDieWorldPosition(die, targetX, targetY, targetZ);
                    }
                });
                renderDSNScene(throwEngine);

                if (!isV13 && throwEngine.physicsWorker) {
                    pendingWorkerPositions = positions;
                    if (!isUpdatingConstraintWorker) {
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
                    }
                }
            } catch (err) {
                error("Error updating constraints:", err);
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

        updateConstraints(spawnPos);

        if (!isV13 && throwEngine.physicsWorker) {
            for (const die of throwEngine.diceList) {
                const worldPos = getDieWorldPosition(die);
                try {
                    await throwEngine.physicsWorker.exec("addConstraint", { id: die.id, pos: worldPos });
                } catch (e) {}
            }
        }

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
                    const obj = (die.parent && !die.parent.isScene && die.parent.type !== "Scene")
                        ? die.parent : die;

                    const diePhase = i * 0.45;
                    const curTiltX = interactionState.tiltX + Math.sin(swayPhase + diePhase) * 0.02;
                    const curTiltY = interactionState.tiltY + Math.cos(swayPhase * 0.8 + diePhase) * 0.02;

                    if (isV13) {

                        obj.rotation.x = curTiltX;
                        obj.rotation.y = curTiltY;
                        obj.rotation.z = Math.sin(swayPhase + diePhase) * 0.04;
                    } else {

                        obj.rotation.x = curTiltX;
                        obj.rotation.z = -curTiltY;
                        obj.rotation.y = Math.sin(swayPhase + diePhase) * 0.05;
                    }
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

            const pos3D = DiceInteractionManager.get3DCoords(e, isV13 ? 30 : 0.1, throwEngine);
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

            const pos3D = DiceInteractionManager.get3DCoords(e, isV13 ? 30 : 0.1, throwEngine);
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

            interactionState.moveHistory.push({ x: e.clientX, y: e.clientY, time: now, pos3D });
            const cutoff = now - 150;
            interactionState.moveHistory = interactionState.moveHistory.filter(p => p.time >= cutoff);

            if (interactionState.moveHistory.length >= 2) {
                const prev = interactionState.moveHistory[interactionState.moveHistory.length - 2];
                const dx = e.clientX - prev.x;
                const dy = e.clientY - prev.y;
                const dtp = now - prev.time;
                if (dtp > 0) {
                    const speed = Math.sqrt(dx * dx + dy * dy) / dtp;
                    if (speed > 1.5) {
                        if (now - interactionState.lastRattleTime > 120) {
                            interactionState.lastRattleTime = now;
                            playShakeSound();
                        }
                    }
                }
            }

            updateConstraints(pos3D);
        };

        const onPointerUp = async (e) => {
            if (!interactionState.isDragging) return;
            if (e.pointerId !== interactionState.pointerId) return;

            e.stopPropagation();
            e.preventDefault();

            const dragStart = interactionState.dragStart;
            const moveHistory = interactionState.moveHistory;

            DiceInteractionManager.cleanup(throwEngine, false);

            try {
                const now = performance.now();
                const refPoint = moveHistory.find(p => {
                    const age = now - p.time;
                    return age >= 50 && age <= 120;
                }) || moveHistory[0] || dragStart;

                const duration = Math.max(16, now - refPoint.time);

                const dxPixels = e.clientX - refPoint.x;
                const dyPixels = e.clientY - refPoint.y;
                const distPixels = Math.sqrt(dxPixels * dxPixels + dyPixels * dyPixels);

                const posStart3D = refPoint.pos3D;
                const posEnd3D = DiceInteractionManager.get3DCoords(e, isV13 ? 30 : 0.1, throwEngine) || posStart3D;
                const dx3D = posEnd3D.x - posStart3D.x;
                const dz3D = isV13 ? (posEnd3D.y - posStart3D.y) : (posEnd3D.z - posStart3D.z);
                const dist3D = Math.sqrt(dx3D * dx3D + dz3D * dz3D);

                let tossSpeed = 0.4;
                let dirX = 1;
                let dirZ = 1;

                if (dist3D > 0.005) {
                    dirX = dx3D / dist3D;
                    dirZ = dz3D / dist3D;
                } else {
                    const randomAngle = Math.random() * Math.PI * 2;
                    dirX = Math.cos(randomAngle);
                    dirZ = Math.sin(randomAngle);
                }

                if (distPixels > 5) {
                    const speed2D = distPixels / (duration / 1000);
                    const multiplier = game.settings.get("natural-roll", "flickMultiplier") || 1.0;
                    const effectiveSpeed = speed2D * multiplier;

                    const minPxSpeed = 50;
                    const maxPxSpeed = 2500;

                    if (effectiveSpeed > minPxSpeed) {
                        const normalized = (effectiveSpeed - minPxSpeed) / (maxPxSpeed - minPxSpeed);
                        tossSpeed = Math.max(0.4, Math.min(5.0, 0.4 + normalized * 4.6));
                    }
                }

                const lift = 0.2 + (tossSpeed / 5.0) * 0.9;

                const v13Scale = 2000;
                const v14Scale = 3.0;
                const velocity = isV13 ? {
                    x: dirX * tossSpeed * v13Scale,
                    y: dirZ * tossSpeed * v13Scale,
                    z: lift * v13Scale
                } : {
                    x: dirX * tossSpeed,
                    y: lift,
                    z: dirZ * tossSpeed * v14Scale
                };

                const spinMultiplier = 0.35 + (tossSpeed / 5.0) * 0.65;
                const baseSpin = isV13 ? (25 + Math.random() * 10) : (40 + Math.random() * 15);

                log("User flicked/tossed dice.", {
                    direction: { x: dirX, z: dirZ },
                    calculatedSpeed: tossSpeed,
                    velocityVector: velocity,
                    spinMultiplier
                });

                for (const die of interactionState.heldDice) {
                    if (die?.userData) {
                        die.userData.constrained = false;
                    }
                }
                setEngineRolling(throwEngine, true);
                throwEngine._simulationReady = false;

                if (isV13) {
                    await throwEngine.physicsWorker.exec("removeDice", interactionState.heldDice.map(d => d.id));
                    for (const die of interactionState.heldDice) {
                        const pos = getDieWorldPosition(die);
                        log("Recreating v13 die", { id: die.id, pos, velocity });
                        const vectordata = {
                            type: die.notation.type,
                            pos: { x: pos.x, y: pos.y, z: pos.z },
                            velocity: velocity,
                            angle: {
                                x: (Math.random() < 0.5 ? -1 : 1) * baseSpin * spinMultiplier,
                                y: (Math.random() < 0.5 ? -1 : 1) * baseSpin * spinMultiplier,
                                z: (Math.random() < 0.5 ? -1 : 1) * baseSpin * spinMultiplier
                            },
                            axis: { x: 0, y: 0, z: 0, a: 0 }
                        };
                        const diceobj = throwEngine.dicefactory.get(die.notation.type);
                        let mass = diceobj.mass;
                        const material = die.appearance?.material || "plastic";
                        switch (material) {
                            case "metal": mass *= 7; break;
                            case "wood": mass *= 0.65; break;
                            case "glass": mass *= 2; break;
                            case "stone": mass *= 1.5; break;
                        }
                        await throwEngine.physicsWorker.exec('createDice', {
                            id: die.id,
                            shape: diceobj.shape,
                            material: material,
                            vectordata: vectordata,
                            mass: mass,
                            startAtIteration: 0,
                            options: die.options
                        });
                        await throwEngine.physicsWorker.exec('addDice', die.id);
                    }
                } else {
                    await throwEngine.physicsWorker.exec("removeConstraint", {
                        ids: interactionState.heldDice.map(d => d.id)
                    });
                }

                const impulses = {};
                if (!isV13) {
                    for (const d of interactionState.heldDice) {
                        impulses[d.id] = {
                            velocity,
                            angularVelocity: {
                                x: (Math.random() < 0.5 ? -1 : 1) * baseSpin * spinMultiplier,
                                y: (Math.random() < 0.5 ? -1 : 1) * baseSpin * spinMultiplier,
                                z: (Math.random() < 0.5 ? -1 : 1) * baseSpin * spinMultiplier
                            }
                        };
                    }
                }

                if (dsnCanvas) {
                    dsnCanvas.style.pointerEvents = "none";
                }

                const simParams = {
                    minIterations: throwEngine.minIterations,
                    nbIterationsBetweenRolls: throwEngine.nbIterationsBetweenRolls,
                    framerate: throwEngine.framerate,
                    canBeFlipped: game.settings.get("dice-so-nice", "diceCanBeFlipped")
                };
                if (!isV13) {
                    simParams.impulses = impulses;
                }

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
                if (game.dice3d?.box && isV13) {
                    try {
                        game.dice3d.box.quaternions = quaternions;
                        game.dice3d.box.positions = positions;
                        game.dice3d.box.ids = ids;
                        game.dice3d.box.iterationsNeeded = iterationsNeeded;
                    } catch (e) {}
                }
                const idToIndex = new Map();
                ids.forEach((id, index) => idToIndex.set(id, index));

                let faceValues = simResult.faceValues;
                if (isV13) {
                    faceValues = {};
                    for (const dicemesh of throwEngine.diceList) {
                        if (dicemesh) {
                            const index = idToIndex.get(dicemesh.id);
                            if (index !== undefined && quaternions[index]) {
                                const stepCount = quaternions[index].length / 4;
                                if (stepCount > 0) {
                                    const lastStep = stepCount - 1;
                                    const origQ = dicemesh.quaternion.clone();
                                    dicemesh.quaternion.set(
                                        quaternions[index][lastStep * 4],
                                        quaternions[index][lastStep * 4 + 1],
                                        quaternions[index][lastStep * 4 + 2],
                                        quaternions[index][lastStep * 4 + 3]
                                    );
                                    dicemesh.updateMatrix();
                                    dicemesh.updateMatrixWorld(true);
                                    const val = await dicemesh.getValue();
                                    faceValues[dicemesh.id] = parseInt(val);
                                    dicemesh.quaternion.copy(origQ);
                                    dicemesh.updateMatrix();
                                    dicemesh.updateMatrixWorld(true);
                                }
                            }
                        }
                    }
                    simResult.faceValues = faceValues;
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

                const roll = game.dice3d?._currentLocalRoll;
                if (roll) {
                    const rollDice = roll.dice || [];
                    const localDiceList = [...throwEngine.diceList, ...throwEngine.deadDiceList];

                    rollDice.forEach(term => {
                        const termRollerId = term.options?.naturalRollDieId;
                        if (!termRollerId) return;

                        const termMeshes = localDiceList.filter(mesh => mesh.userData?.rollerId?.startsWith(termRollerId));
                        termMeshes.forEach((mesh, index) => {
                            const finalVal = faceValues[mesh.id];
                            if (finalVal !== undefined && term.results?.[index]) {
                                term.results[index].result = finalVal;
                            }
                        });
                    });

                    roll.terms.forEach(t => {
                        if (t.results) {
                            t._total = t.results.reduce((sum, r) => sum + (r.active && !r.discarded ? r.result : 0), 0);
                        }
                    });

                    if (typeof roll._evaluateTotal === "function") {
                        roll._total = roll._evaluateTotal();
                    } else {
                        roll._total = roll.terms.reduce((sum, t) => sum + (t.total || 0), 0);
                    }

                    DiceInteractionManager.lastCompletedRollTime = Date.now();
                }

                if (throws) {
                    const localDiceList = [...throwEngine.diceList, ...throwEngine.deadDiceList];
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
                                        d.resultLabel = finalVal.toString();
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

                    let stepInterval = 16.67;
                    const fr = throwEngine.framerate;
                    if (fr) {
                        if (fr > 50) {
                            stepInterval = 1000 / fr;
                        } else if (fr < 0.1) {
                            stepInterval = fr * 1000;
                        } else {
                            stepInterval = fr;
                        }
                    }
                    const durationMs = (iterationsNeeded || 150) * stepInterval + 200;
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
                        if (isV13) {
                            await throwEngine.swapDiceFace(dicemesh);
                        } else {
                            throwEngine.swapDiceFace(dicemesh, finalVal);
                        }
                        dicemesh.result = null;
                    }
                }

                throwEngine.detectedCollides = throwEngine.soundManager?.generateCollisionSounds ? throwEngine.soundManager.generateCollisionSounds(detectedCollides) : detectedCollides;
                throwEngine.iteration = 0;
                throwEngine.callback = callback;
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

                DiceInteractionManager.recentReplays = DiceInteractionManager.recentReplays || [];
                DiceInteractionManager.recentReplays.push({
                    user: game.user.id,
                    results: Object.values(simResult.faceValues || {}).sort(),
                    timestamp: Date.now()
                });

                DiceInteractionManager.broadcastRoll(throwEngine, throws, simResult, interactionState.naturalRollId);
                delete throwEngine._naturalRollBypassResolveOnClear;

                const restDurationMs = Math.max(300, Math.min(3000, ((simResult.iterationsNeeded || 60) / 60) * 1000));
                setTimeout(() => {
                    if (roll && typeof roll._naturalRollResolve === "function") {
                        roll._naturalRollResolve(roll);
                    }
                }, restDurationMs);
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
            DiceInteractionManager.cleanup(throwEngine);

            try {
                const randomAngle = Math.random() * Math.PI * 2;
                const dirX = Math.cos(randomAngle);
                const dirZ = Math.sin(randomAngle);
                const tossSpeed = 1.5;
                const lift = 0.5;

                const v13Scale = 2000;
                const v14Scale = 3.0;
                const velocity = isV13 ? {
                    x: dirX * tossSpeed * v13Scale,
                    y: dirZ * tossSpeed * v13Scale,
                    z: lift * v13Scale
                } : {
                    x: dirX * tossSpeed * v14Scale,
                    y: lift,
                    z: dirZ * tossSpeed * v14Scale
                };

                const spinMultiplier = 0.65;
                const baseSpin = isV13 ? (25 + Math.random() * 10) : (40 + Math.random() * 15);

                log("Auto-roll timeout triggered. Rolling dice automatically.");

                for (const die of interactionState.heldDice) {
                    if (die?.userData) {
                        die.userData.constrained = false;
                    }
                }
                setEngineRolling(throwEngine, true);
                throwEngine._simulationReady = false;

                if (isV13) {
                    await throwEngine.physicsWorker.exec("removeDice", interactionState.heldDice.map(d => d.id));
                    for (const die of interactionState.heldDice) {
                        const pos = getDieWorldPosition(die);
                        const vectordata = {
                            type: die.notation.type,
                            pos: { x: pos.x, y: pos.y, z: pos.z },
                            velocity: velocity,
                            angle: {
                                x: (Math.random() < 0.5 ? -1 : 1) * baseSpin * spinMultiplier,
                                y: (Math.random() < 0.5 ? -1 : 1) * baseSpin * spinMultiplier,
                                z: (Math.random() < 0.5 ? -1 : 1) * baseSpin * spinMultiplier
                            },
                            axis: { x: 0, y: 0, z: 0, a: 0 }
                        };
                        const diceobj = throwEngine.dicefactory.get(die.notation.type);
                        let mass = diceobj.mass;
                        const material = die.appearance?.material || "plastic";
                        switch (material) {
                            case "metal": mass *= 7; break;
                            case "wood": mass *= 0.65; break;
                            case "glass": mass *= 2; break;
                            case "stone": mass *= 1.5; break;
                        }
                        await throwEngine.physicsWorker.exec('createDice', {
                            id: die.id,
                            shape: diceobj.shape,
                            material: material,
                            vectordata: vectordata,
                            mass: mass,
                            startAtIteration: 0,
                            options: die.options
                        });
                        await throwEngine.physicsWorker.exec('addDice', die.id);
                    }
                } else {
                    await throwEngine.physicsWorker.exec("removeConstraint", {
                        ids: interactionState.heldDice.map(d => d.id)
                    });
                }

                const impulses = {};
                if (!isV13) {
                    for (const d of interactionState.heldDice) {
                        impulses[d.id] = {
                            velocity,
                            angularVelocity: {
                                x: (Math.random() < 0.5 ? -1 : 1) * baseSpin * spinMultiplier,
                                y: (Math.random() < 0.5 ? -1 : 1) * baseSpin * spinMultiplier,
                                z: (Math.random() < 0.5 ? -1 : 1) * baseSpin * spinMultiplier
                            }
                        };
                    }
                }

                if (dsnCanvas) {
                    dsnCanvas.style.pointerEvents = "none";
                }

                const simParams = {
                    minIterations: throwEngine.minIterations,
                    nbIterationsBetweenRolls: throwEngine.nbIterationsBetweenRolls,
                    framerate: throwEngine.framerate,
                    canBeFlipped: game.settings.get("dice-so-nice", "diceCanBeFlipped")
                };
                if (!isV13) {
                    simParams.impulses = impulses;
                }

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

                let faceValues = simResult.faceValues;
                if (isV13) {
                    faceValues = {};
                    for (const dicemesh of throwEngine.diceList) {
                        if (dicemesh) {
                            const index = idToIndex.get(dicemesh.id);
                            if (index !== undefined && quaternions[index]) {
                                const stepCount = quaternions[index].length / 4;
                                if (stepCount > 0) {
                                    const lastStep = stepCount - 1;
                                    const origQ = dicemesh.quaternion.clone();
                                    dicemesh.quaternion.set(
                                        quaternions[index][lastStep * 4],
                                        quaternions[index][lastStep * 4 + 1],
                                        quaternions[index][lastStep * 4 + 2],
                                        quaternions[index][lastStep * 4 + 3]
                                    );
                                    dicemesh.updateMatrix();
                                    dicemesh.updateMatrixWorld(true);
                                    const val = await dicemesh.getValue();
                                    faceValues[dicemesh.id] = parseInt(val);
                                    dicemesh.quaternion.copy(origQ);
                                    dicemesh.updateMatrix();
                                    dicemesh.updateMatrixWorld(true);
                                }
                            }
                        }
                    }
                    simResult.faceValues = faceValues;
                }

                const roll = game.dice3d?._currentLocalRoll;
                if (roll) {
                    const rollDice = roll.dice || [];
                    const localDiceList = [...throwEngine.diceList, ...throwEngine.deadDiceList];

                    rollDice.forEach(term => {
                        const termRollerId = term.options?.naturalRollDieId;
                        if (!termRollerId) return;

                        const termMeshes = localDiceList.filter(mesh => mesh.userData?.rollerId?.startsWith(termRollerId));
                        termMeshes.forEach((mesh, index) => {
                            const finalVal = faceValues[mesh.id];
                            if (finalVal !== undefined && finalVal !== null && term.results?.[index]) {
                                term.results[index].result = finalVal;
                            }
                        });
                    });

                    roll.terms.forEach(t => {
                        if (t.results) {
                            t._total = t.results.reduce((sum, r) => sum + (r.active && !r.discarded ? r.result : 0), 0);
                        }
                    });

                    if (typeof roll._evaluateTotal === "function") {
                        roll._total = roll._evaluateTotal();
                    } else {
                        roll._total = roll.terms.reduce((sum, t) => sum + (t.total || 0), 0);
                    }
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
                        if (isV13) {
                            await throwEngine.swapDiceFace(dicemesh);
                        } else {
                            throwEngine.swapDiceFace(dicemesh, faceValues[dicemesh.id]);
                        }
                        dicemesh.result = null;
                    }
                }

                throwEngine.detectedCollides = throwEngine.soundManager?.generateCollisionSounds ? throwEngine.soundManager.generateCollisionSounds(detectedCollides) : detectedCollides;
                throwEngine.iteration = 0;
                throwEngine.callback = callback;
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

                DiceInteractionManager.recentReplays = DiceInteractionManager.recentReplays || [];
                DiceInteractionManager.recentReplays.push({
                    user: game.user.id,
                    results: Object.values(simResult.faceValues || {}).sort(),
                    timestamp: Date.now()
                });

                DiceInteractionManager.lastCompletedRollTime = Date.now();

                DiceInteractionManager.broadcastRoll(throwEngine, throws, simResult, interactionState.naturalRollId);

                const restDurationMs = Math.max(300, Math.min(3000, ((simResult.iterationsNeeded || 60) / 60) * 1000));
                setTimeout(() => {
                    const roll = game.dice3d?._currentLocalRoll;
                    if (roll && typeof roll._naturalRollResolve === "function") {
                        roll._naturalRollResolve(roll);
                    }
                }, restDurationMs);
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

            const trajectories = ids.map((id, index) => {
                const qArr = Array.from(new Float32Array(quaternionsBuffers[index]));
                const pArr = Array.from(new Float32Array(positionsBuffers[index]));

                const dicemesh = localDiceList.find(d => d.id === id);
                const rollerId = dicemesh?.userData?.rollerId || dicemesh?.options?.naturalRollDieId || id;

                return {
                    id: rollerId,
                    quaternions: qArr,
                    positions: pArr
                };
            });

            const mappedFaceValues = {};
            for (const [localId, val] of Object.entries(faceValues || {})) {
                const dicemesh = localDiceList.find(d => d.id === Number(localId));
                const rollerId = dicemesh?.userData?.rollerId || dicemesh?.options?.naturalRollDieId || localId;
                mappedFaceValues[rollerId] = val;
            }

            const mappedFinalQuaternions = {};
            for (const [localId, val] of Object.entries(finalQuaternions || {})) {
                const dicemesh = localDiceList.find(d => d.id === Number(localId));
                const rollerId = dicemesh?.userData?.rollerId || dicemesh?.options?.naturalRollDieId || localId;
                mappedFinalQuaternions[rollerId] = val;
            }

            const sanitizedThrows = throws.map(t => {
                return {
                    dice: (t.dice || []).map(d => {
                        return {
                            type: d.type,
                            id: d.options?.naturalRollDieId ? `${d.options.naturalRollDieId}-${d.id}` : d.id,
                            result: d.result,
                            resultLabel: d.resultLabel,
                            fvttResult: d.fvttResult,
                            vectors: d.vectors ? {
                                pos: d.vectors.pos,
                                velocity: d.vectors.velocity,
                                angle: d.vectors.angle
                            } : undefined,
                            options: d.options,
                            appearance: d.appearance ? {
                                colorset: d.appearance.colorset,
                                labelColor: d.appearance.labelColor,
                                diceColor: d.appearance.diceColor,
                                outlineColor: d.appearance.outlineColor,
                                edgeColor: d.appearance.edgeColor,
                                material: d.appearance.material,
                                font: d.appearance.font,
                                foreground: d.appearance.foreground,
                                background: d.appearance.background,
                                outline: d.appearance.outline,
                                edge: d.appearance.edge,
                                texture: d.appearance.texture,
                                fontScale: d.appearance.fontScale
                            } : undefined
                        };
                    }),
                    dsnConfig: t.dsnConfig ? {
                        appearance: t.dsnConfig.appearance,
                        diceLibrary: t.dsnConfig.diceLibrary
                    } : undefined,
                    isNaturalRollReplay: true,
                    isNaturalRollManual: true
                };
            });

            const roll = game.dice3d?._currentLocalRoll;
            const authorizedUsers = getAuthorizedUsers(roll);
            const payload = {
                user: game.user.id,
                naturalRollId: naturalRollId,
                throws: sanitizedThrows,
                trajectories: trajectories,
                detectedCollides: detectedCollides,
                iterationsNeeded: iterationsNeeded,
                faceValues: mappedFaceValues,
                finalQuaternions: mappedFinalQuaternions,
                deads: deads ? Array.from(deads) : undefined,
                screenWidth: game.dice3d?.canvas?.clientWidth || window.innerWidth,
                screenHeight: game.dice3d?.canvas?.clientHeight || window.innerHeight,
                authorizedUsers: authorizedUsers,
                magicalEffectStyle: game.settings.get("natural-roll", "magicalEffectStyle")
            };

            log("Broadcasting manual roll replay payload to other players...", payload);
            game.socket.emit("module.natural-roll", {
                type: "throw",
                payload: payload
            });
        } catch (err) {
            error("Failed to broadcast manual roll results:", err);
        }
    }

    static handleGrab(payload) {
        if (!game.dice3d) return;
        if (payload.user === game.user.id) return;

        DiceInteractionManager.activeGrabs = DiceInteractionManager.activeGrabs || new Set();
        DiceInteractionManager.activeGrabs.add(payload.user);
        log(`Grab state activated for remote user ${payload.user}. Pending throw rendering will be suppressed.`);
    }

    static handleReplay(payload, isFromQueue = false) {
        if (!game.dice3d) return;
        if (payload.user === game.user.id) return;

        const replayResults = Object.values(payload.faceValues || {}).sort();
        const now = Date.now();

        if (!isFromQueue) {
            DiceInteractionManager.recentReplays = DiceInteractionManager.recentReplays || [];
            DiceInteractionManager.recentReplays.push({
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
            }

            DiceInteractionManager.replayQueue = DiceInteractionManager.replayQueue || [];
            if (DiceInteractionManager.isReplayExecuting) {
                log("Replay Queue: another replay is active. Queueing payload from user:", payload.user);
                DiceInteractionManager.replayQueue.push(payload);
                return;
            }
        } else {
            if (game.dice3d && game.dice3d._activeReplayPromises?.[payload.user]) {
                game.dice3d._activeReplayPromise = game.dice3d._activeReplayPromises[payload.user];
                game.dice3d._activeReplayResolve = game.dice3d._activeReplayResolves[payload.user];
            }
        }

        if (DiceInteractionManager.activeGrabs) {
            DiceInteractionManager.activeGrabs.delete(payload.user);
        }

        if (!game.settings.get("natural-roll", "enableReplay")) {
            log("Replay is disabled by user settings, ignoring playback but caching completed timestamp.");
            DiceInteractionManager.lastCompletedRollTime = Date.now();
            return;
        }

        log("Received manual roll replay payload from user:", payload.user);

        DiceInteractionManager.recentChatMessageRolls = DiceInteractionManager.recentChatMessageRolls || [];
        const matchedChatIndex = DiceInteractionManager.recentChatMessageRolls.findIndex(chat => {
            return JSON.stringify(chat.results) === JSON.stringify(replayResults) &&
                   (now - chat.timestamp) < 5000;
        });

        if (matchedChatIndex !== -1) {
            DiceInteractionManager.recentChatMessageRolls.splice(matchedChatIndex, 1);
            log("Bypassing socket replay: ChatMessage animation has already played.");
            return;
        }

        const throws = payload.throws;
        for (const t of throws) {
            t.isNaturalRollReplay = true;
            t.replayPayload = payload;
        }

        DiceInteractionManager.isReplayExecuting = true;

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
                    const rollerId = dicemesh.userData?.rollerId || dicemesh.options?.naturalRollDieId || dicemesh.id;
                    if (rollerId !== undefined) {
                        faceValues[dicemesh.id] = replayPayload.faceValues[rollerId];
                    }
                });

                const finalQuaternions = {};
                localDiceList.forEach(dicemesh => {
                    const rollerId = dicemesh.userData?.rollerId || dicemesh.options?.naturalRollDieId || dicemesh.id;
                    if (rollerId !== undefined) {
                        finalQuaternions[dicemesh.id] = replayPayload.finalQuaternions?.[rollerId];
                    }
                });

                log("Replay Interceptor: returning mock simulateThrow result", {
                    localIds,
                    mappedDice: localDiceList.map(d => ({ id: d.id, rollerId: d.userData?.rollerId || d.options?.naturalRollDieId || d.id, type: d.notation?.type })),
                    trajectoryIds: replayPayload.trajectories.map(t => t.id),
                    faceValues,
                    finalQuaternionsKeys: Object.keys(finalQuaternions)
                });

                const rollerWidth = replayPayload.screenWidth || 1920;
                const rollerHeight = replayPayload.screenHeight || 1080;
                const receiverWidth = game.dice3d?.canvas?.clientWidth || window.innerWidth;
                const receiverHeight = game.dice3d?.canvas?.clientHeight || window.innerHeight;

                const scaleX = receiverWidth / rollerWidth;
                const scaleY = receiverHeight / rollerHeight;
                const scale = Math.min(scaleX, scaleY);

                const quaternionsBuffers = [];
                const positionsBuffers = [];
                const deads = [];

                localIds.forEach(localId => {
                    const dicemesh = localDiceList.find(d => d.id === localId);
                    const rollerId = dicemesh?.userData?.rollerId || dicemesh?.options?.naturalRollDieId || dicemesh?.id;
                    const rollerIndex = replayPayload.trajectories.findIndex(t => t.id === rollerId);

                    if (rollerIndex !== -1) {
                        const trajectory = replayPayload.trajectories[rollerIndex];
                        quaternionsBuffers.push(new Float32Array(trajectory.quaternions).buffer);

                        try {
                            if (game.settings.get("natural-roll", "enableMagicalEffects")) {
                                const canvasRaw = game.dice3d?.canvas;
                                const dsnCanvas = getCanvasElement(canvasRaw);
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

            return worker._originalExec.call(this, method, params);
        };
    }

    static triggerMagicalEffectsForDice(throwEngine, diceList) {
        try {
            log("triggerMagicalEffectsForDice called with", diceList?.length, "dice.");
            if (!game.settings.get("natural-roll", "enableMagicalEffects")) {
                log("Magical effects are disabled in settings.");
                return;
            }
            const canvasRaw = game.dice3d?.canvas;
            const dsnCanvas = getCanvasElement(canvasRaw);
            if (!dsnCanvas) {
                log("No DSN canvas found.");
                return;
            }

            const diceScene = game.dice3d?.box?.diceScene || game.dice3d?.box;
            if (!diceScene || !diceScene.camera) {
                log("No DSN camera or diceScene found.");
                return;
            }

            const camera = diceScene.camera;
            const rect = dsnCanvas.getBoundingClientRect();
            const width = rect.width;
            const height = rect.height;
            log(`DSN canvas bounds: width=${width}, height=${height}, left=${rect.left}, top=${rect.top}`);

            let count = 0;
            for (const die of diceList) {
                if (!die) continue;
                const diePos = die.parent ? die.parent.position : die.position;
                if (!diePos) {
                    log("Die has no position property.");
                    continue;
                }

                const tempV = diePos.clone();
                tempV.project(camera);

                const x = ((tempV.x + 1) * width) / 2 + rect.left;
                const y = ((-tempV.y + 1) * height) / 2 + rect.top;

                log(`Projected 3D position (${diePos.x}, ${diePos.y}, ${diePos.z}) to screen (${x}, ${y})`);

                if (isNaN(x) || isNaN(y)) {
                    log("Projected coordinates are NaN!");
                    continue;
                }

                ParticleManager.spawnEffect(x, y);
                count++;
            }
            log(`Successfully triggered magical effects for ${count} dice.`);
        } catch (err) {
            error("Error rendering magical effects:", err);
        }
    }
}

