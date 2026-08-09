import { log } from "./utils.js";

let lastPointerPos = { x: 0, y: 0 };
if (typeof window !== "undefined") {
    window.addEventListener("pointermove", (e) => {
        lastPointerPos.x = e.clientX;
        lastPointerPos.y = e.clientY;
    }, { passive: true });
}

export class DiceInteractionManager {
    static cleanup(throwEngine) {
        if (!throwEngine) return;
        const state = throwEngine._naturalRollState;
        if (!state) return;

        if (state.timeoutId) {
            clearTimeout(state.timeoutId);
            state.timeoutId = null;
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

        throwEngine._naturalRollState = null;
    }

    static async handleHoldAndRoll(throwEngine, throws, callback) {
        if (throwEngine.rolling) return;

        DiceInteractionManager.cleanup(throwEngine);

        throwEngine._simulationReady = false;
        throwEngine.throws = null;
        throwEngine.callback = null;
        throwEngine.clearDice();

        let countNewDice = 0;
        const maxDiceNumber = game.settings.get("dice-so-nice", "maxDiceNumber");
        const workerSpecs = [];

        const isV13 = !throwEngine.spawnDiceMesh;

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
        let spawnPos = isV13 ? { x: 0, y: 0, z: defaultRadius } : { x: 0, y: 0.05, z: 0 };

        if (game.settings.get("natural-roll", "spawnAtCursor")) {
            const cursor3D = DiceInteractionManager.get3DCoords({
                clientX: lastPointerPos.x,
                clientY: lastPointerPos.y
            }, isV13 ? defaultRadius : 0.05);
            if (cursor3D) {
                spawnPos = cursor3D;
            }
        }

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

                    const goldenAngle = 137.5 * (Math.PI / 180);
                    const c = (game.settings.get("natural-roll", "diceSpread") ?? 0.06) * (isV13 ? 4200 : 1.0);
                    const r = c * Math.sqrt(spawned);
                    const theta = spawned * goldenAngle;

                    const radius = isV13 ? getDieRadius(die.type) : 0.05;
                    const pos = isV13 ? {
                        x: spawnPos.x + Math.cos(theta) * r,
                        y: spawnPos.y + Math.sin(theta) * r,
                        z: radius + (spawned * 0.003)
                    } : {
                        x: spawnPos.x + Math.cos(theta) * r,
                        y: spawnPos.y + (spawned * 0.003),
                        z: spawnPos.z + Math.sin(theta) * r
                    };
                    die.vectors.pos = pos;
                    die.vectors.velocity = { x: 0, y: 0, z: 0 };
                    die.vectors.angle = { x: 0, y: 0, z: 0 };

                    let appearance = throwEngine.dicefactory.getAppearanceForDice(
                        notationVectors.dsnConfig.appearance,
                        die.type,
                        die
                    );
                    die.appearance = appearance;

                    if (isV13) {
                        await throwEngine.spawnDice(die, appearance);
                    } else {
                        await throwEngine.spawnDiceMesh(
                            die,
                            appearance,
                            notationVectors.dsnConfig.diceLibrary,
                            workerSpecs
                        );
                    }

                    const dicemesh = throwEngine.diceList[throwEngine.diceList.length - 1];
                    if (dicemesh && dicemesh.parent) {
                        dicemesh.parent.position.set(pos.x, pos.y, pos.z);
                    }
                    spawned++;
                }
            }

            throwEngine.minIterations = 0;
            if (!isV13 && workerSpecs.length > 0) {
                await throwEngine.physicsWorker.exec('createDiceBatch', workerSpecs);
            }
        }

        log("Spawned dice batch:", throws);

        throwEngine.iteration = 0;
        throwEngine.addDiceToScene();

        const dsnBox = game.dice3d.box;
        for (const die of throwEngine.diceList) {
            die.sim = { dead: false };
        }

        if (!isV13) {
            for (const die of throwEngine.diceList) {
                const worldPos = die.parent ? die.parent.position : die.position;
                await dsnBox.physicsWorker.exec("addConstraint", { id: die.id, pos: worldPos });
            }
        }



        dsnBox.isVisible = true;
        dsnBox.last_time = 0;
        dsnBox._preparingThrow = false;
        canvas.app.ticker.add(dsnBox.animateThrow, dsnBox);

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
            spawnTime: performance.now()
        };

        throwEngine._naturalRollState = interactionState;

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
                        diceMaterial: soundSurface,
                        strength: volume
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

        let isUpdatingConstraint = false;
        const updateConstraints = async (pos3D) => {
            if (isUpdatingConstraint) return;
            isUpdatingConstraint = true;
            try {
                const positions = {};
                interactionState.heldDice.forEach((die, index) => {
                    const goldenAngle = 137.5 * (Math.PI / 180);
                    const c = (game.settings.get("natural-roll", "diceSpread") ?? 0.06) * (isV13 ? 4200 : 1.0);
                    const r = c * Math.sqrt(index);
                    const theta = index * goldenAngle;
                    if (isV13) {
                        const radius = getDieRadius(die.type);
                        const targetX = pos3D.x + Math.cos(theta) * r;
                        const targetY = pos3D.y + Math.sin(theta) * r;
                        const targetZ = radius + 5;
                        if (die.parent) {
                            die.parent.position.set(targetX, targetY, targetZ);
                        } else {
                            die.position.set(targetX, targetY, targetZ);
                        }
                    } else {
                        const targetX = pos3D.x + Math.cos(theta) * r;
                        const targetY = pos3D.y;
                        const targetZ = pos3D.z + Math.sin(theta) * r;
                        positions[die.id] = {
                            x: targetX,
                            y: targetY,
                            z: targetZ
                        };
                    }
                });
                if (isV13) {
                    throwEngine.renderScene();
                } else {
                    await throwEngine.physicsWorker.exec("updateConstraint", { positions });
                }
            } catch (err) {
                console.error("Natural Roll | Error updating constraints:", err);
            } finally {
                isUpdatingConstraint = false;
            }
        };
        const isClickNearAnyDie = (clientX, clientY) => {
            const diceScene = game.dice3d?.box?.diceScene || game.dice3d?.box;
            if (!diceScene || !diceScene.camera) return true;

            const camera = diceScene.camera;
            const rect = dsnCanvas.getBoundingClientRect();
            const width = rect.width;
            const height = rect.height;

            const THREE = globalThis.THREE;
            if (!THREE) return true;

            const tempV = new THREE.Vector3();
            const grabRadius = game.settings.get("natural-roll", "grabRadius") || 80;

            for (const die of interactionState.heldDice) {
                const diePos = die.parent ? die.parent.position : die.position;
                if (!diePos) continue;

                tempV.set(diePos.x, diePos.y, diePos.z);
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

            return false;
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

            const pos3D = DiceInteractionManager.get3DCoords(e, isV13 ? 30 : 0.05);
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

            const pos3D = DiceInteractionManager.get3DCoords(e, isV13 ? 30 : 0.05);
            if (!pos3D) return;

            e.stopPropagation();
            e.preventDefault();

            const now = performance.now();
            interactionState.moveHistory.push({ x: e.clientX, y: e.clientY, time: now, pos3D });
            
            const cutoff = now - 150;
            interactionState.moveHistory = interactionState.moveHistory.filter(p => p.time >= cutoff);

            if (interactionState.moveHistory.length >= 2) {
                const prev = interactionState.moveHistory[interactionState.moveHistory.length - 2];
                const dx = e.clientX - prev.x;
                const dy = e.clientY - prev.y;
                const dt = now - prev.time;
                if (dt > 0) {
                    const speed = Math.sqrt(dx * dx + dy * dy) / dt;
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
            
            DiceInteractionManager.cleanup(throwEngine);

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
                const posEnd3D = DiceInteractionManager.get3DCoords(e, isV13 ? 30 : 0.05) || posStart3D;
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
                const velocity = isV13 ? {
                    x: dirX * tossSpeed * v13Scale,
                    y: dirZ * tossSpeed * v13Scale,
                    z: lift * v13Scale
                } : {
                    x: dirX * tossSpeed,
                    y: lift,
                    z: dirZ * tossSpeed
                };

                const spinMultiplier = 0.35 + (tossSpeed / 5.0) * 0.65;
                const baseSpin = isV13 ? (25 + Math.random() * 10) : (15 + Math.random() * 5);

                log("User flicked/tossed dice.", {
                    direction: { x: dirX, z: dirZ },
                    calculatedSpeed: tossSpeed,
                    velocityVector: velocity,
                    spinMultiplier
                });

                throwEngine.rolling = true;
                throwEngine._simulationReady = false;

                if (isV13) {
                    await throwEngine.physicsWorker.exec("removeDice", interactionState.heldDice.map(d => d.id));
                    for (const die of interactionState.heldDice) {
                        const pos = die.parent ? die.parent.position : die.position;
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
                    console.error("Natural Roll | simulateThrow failed");
                    throwEngine.rolling = false;
                    callback?.(throws);
                    return;
                }

                const { ids, quaternionsBuffers, positionsBuffers, detectedCollides, iterationsNeeded, faceValues } = simResult;
                const quaternions = quaternionsBuffers.map(buffer => new Float32Array(buffer));
                const positions = positionsBuffers.map(buffer => new Float32Array(buffer));

                throwEngine.iterationsNeeded = iterationsNeeded;
                const idToIndex = new Map();
                ids.forEach((id, index) => idToIndex.set(id, index));

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

                throwEngine.detectedCollides = throwEngine.soundManager.generateCollisionSounds(detectedCollides);
                throwEngine.iteration = 0;
                throwEngine.callback = callback;
                throwEngine.throws = throws;

                throwEngine.running = (new Date()).getTime();
                throwEngine._simulationReady = true;
            } catch (err) {
                console.error("Natural Roll | Error resolving pointerup simulation:", err);
                throwEngine.rolling = false;
                callback?.(throws);
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
                const velocity = isV13 ? {
                    x: dirX * tossSpeed * v13Scale,
                    y: dirZ * tossSpeed * v13Scale,
                    z: lift * v13Scale
                } : {
                    x: dirX * tossSpeed,
                    y: lift,
                    z: dirZ * tossSpeed
                };

                const spinMultiplier = 0.65;
                const baseSpin = isV13 ? (25 + Math.random() * 10) : (15 + Math.random() * 5);

                log("Auto-roll timeout triggered. Rolling dice automatically.");
                
                throwEngine.rolling = true;
                throwEngine._simulationReady = false;

                if (isV13) {
                    await throwEngine.physicsWorker.exec("removeDice", interactionState.heldDice.map(d => d.id));
                    for (const die of interactionState.heldDice) {
                        const pos = die.parent ? die.parent.position : die.position;
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
                    console.error("Natural Roll | simulateThrow failed on auto-roll");
                    throwEngine.rolling = false;
                    callback?.(throws);
                    return;
                }

                const { ids, quaternionsBuffers, positionsBuffers, detectedCollides, iterationsNeeded, faceValues } = simResult;
                const quaternions = quaternionsBuffers.map(buffer => new Float32Array(buffer));
                const positions = positionsBuffers.map(buffer => new Float32Array(buffer));

                throwEngine.iterationsNeeded = iterationsNeeded;
                const idToIndex = new Map();
                ids.forEach((id, index) => idToIndex.set(id, index));

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

                throwEngine.detectedCollides = throwEngine.soundManager.generateCollisionSounds(detectedCollides);
                throwEngine.iteration = 0;
                throwEngine.callback = callback;
                throwEngine.throws = throws;

                throwEngine.running = (new Date()).getTime();
                throwEngine._simulationReady = true;
            } catch (err) {
                console.error("Natural Roll | Error executing auto-roll simulation:", err);
                throwEngine.rolling = false;
                callback?.(throws);
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

    static get3DCoords(event, heightPlane = 0.05) {
        const dsnCanvas = game.dice3d?.canvas?.[0] || game.dice3d?.canvas;
        if (!dsnCanvas) return null;

        const rect = dsnCanvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;

        const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        const diceScene = game.dice3d?.box?.diceScene || game.dice3d?.box;
        if (!diceScene || !diceScene.raycaster || !diceScene.camera) return null;

        diceScene.raycaster.setFromCamera({ x: ndcX, y: ndcY }, diceScene.camera);

        const isV13 = !game.dice3d.box.throwEngine;
        if (isV13) {
            const ray = diceScene.raycaster.ray;
            const Oz = ray.origin.z;
            const Dz = ray.direction.z;
            
            if (Math.abs(Dz) < 1e-6) return null;
            
            const t = (heightPlane - Oz) / Dz;
            return {
                x: ray.origin.x + t * ray.direction.x,
                y: ray.origin.y + t * ray.direction.y,
                z: heightPlane
            };
        } else {
            const ray = diceScene.raycaster.ray;
            const Oy = ray.origin.y;
            const Dy = ray.direction.y;
            
            if (Math.abs(Dy) < 1e-6) return null;
            
            const t = (heightPlane - Oy) / Dy;
            return {
                x: ray.origin.x + t * ray.direction.x,
                y: heightPlane,
                z: ray.origin.z + t * ray.direction.z
            };
        }
    }
}
