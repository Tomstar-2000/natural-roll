import { log } from "./utils.js";

export class DiceInteractionManager {
    static async handleHoldAndRoll(throwEngine, throws, callback) {
        if (throwEngine.rolling) return;

        throwEngine.throws = null;
        throwEngine.callback = null;
        throwEngine.clearDice();

        let countNewDice = 0;
        const maxDiceNumber = game.settings.get("dice-so-nice", "maxDiceNumber");
        const workerSpecs = [];

        const GRAB_LIFT_EPHEMERAL = 0.05;
        const spawnPos = { x: 0, y: GRAB_LIFT_EPHEMERAL, z: 0 };

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

                    const angle = (i / notationVectors.dice.length) * Math.PI * 2;
                    const radius = 0.02;
                    const pos = {
                        x: spawnPos.x + Math.cos(angle) * radius,
                        y: spawnPos.y + (i * 0.01),
                        z: spawnPos.z + Math.sin(angle) * radius
                    };
                    die.vectors.pos = pos;
                    die.vectors.velocity = { x: 0, y: 0, z: 0 };
                    die.vectors.angle = { x: 0, y: 0, z: 0 };

                    let appearance = throwEngine.dicefactory.getAppearanceForDice(
                        notationVectors.dsnConfig.appearance,
                        die.type,
                        die
                    );

                    await throwEngine.spawnDiceMesh(
                        die,
                        appearance,
                        notationVectors.dsnConfig.diceLibrary,
                        workerSpecs
                    );

                    const dicemesh = throwEngine.diceList[throwEngine.diceList.length - 1];
                    if (dicemesh && dicemesh.parent) {
                        dicemesh.parent.position.set(pos.x, pos.y, pos.z);
                    }
                    spawned++;
                }
            }

            throwEngine.minIterations = 0;
            if (workerSpecs.length > 0) {
                await throwEngine.physicsWorker.exec('createDiceBatch', workerSpecs);
            }
        }

        log("Spawned dice batch:", throws);

        throwEngine.iteration = 0;
        throwEngine.addDiceToScene();

        const dsnBox = game.dice3d.box;
        for (const die of throwEngine.diceList) {
            die.sim = { dead: false };
            const worldPos = die.parent ? die.parent.position : die.position;
            await dsnBox.physicsWorker.exec("addConstraint", { id: die.id, pos: worldPos });
        }

        const dsnCanvas = game.dice3d.canvas;
        if (dsnCanvas) {
            dsnCanvas.style.display = "";
            dsnCanvas.style.pointerEvents = "auto";
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
            spawnPos
        };

        let timeoutId = null;
        const clearRollTimeout = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
        };

        let isUpdatingConstraint = false;
        const updateConstraints = async (pos3D) => {
            if (isUpdatingConstraint) return;
            isUpdatingConstraint = true;
            try {
                const positions = {};
                interactionState.heldDice.forEach((die, index) => {
                    const angle = (index / interactionState.heldDice.length) * Math.PI * 2;
                    const radius = 0.02;
                    positions[die.id] = {
                        x: pos3D.x + Math.cos(angle) * radius,
                        y: pos3D.y,
                        z: pos3D.z + Math.sin(angle) * radius
                    };
                });
                await throwEngine.physicsWorker.exec("updateConstraint", { positions });
            } catch (err) {
                console.error("Natural Roll | Error updating constraints:", err);
            } finally {
                isUpdatingConstraint = false;
            }
        };

        const isClickNearAnyDie = (clientX, clientY) => {
            const diceScene = game.dice3d?.box?.diceScene;
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
            if (e.pointerType && e.pointerType !== "mouse") return;

            if (e.target !== dsnCanvas && !dsnCanvas.contains(e.target)) {
                return;
            }

            if (!isClickNearAnyDie(e.clientX, e.clientY)) {
                return;
            }

            clearRollTimeout();

            const pos3D = DiceInteractionManager.get3DCoords(e);
            if (!pos3D) return;

            e.stopPropagation();
            e.preventDefault();

            interactionState.isDragging = true;
            const now = performance.now();
            interactionState.dragStart = { x: e.clientX, y: e.clientY, time: now, pos3D };
            interactionState.moveHistory = [{ x: e.clientX, y: e.clientY, time: now, pos3D }];

            log("User grabbed dice.");

            updateConstraints(pos3D);
        };

        const onPointerMove = (e) => {
            if (!interactionState.isDragging) return;
            if (e.pointerType && e.pointerType !== "mouse") return;

            const pos3D = DiceInteractionManager.get3DCoords(e);
            if (!pos3D) return;

            e.stopPropagation();
            e.preventDefault();

            const now = performance.now();
            interactionState.moveHistory.push({ x: e.clientX, y: e.clientY, time: now, pos3D });
            
            const cutoff = now - 150;
            interactionState.moveHistory = interactionState.moveHistory.filter(p => p.time >= cutoff);

            updateConstraints(pos3D);
        };

        const onPointerUp = async (e) => {
            if (!interactionState.isDragging) return;
            interactionState.isDragging = false;

            e.stopPropagation();
            e.preventDefault();

            clearRollTimeout();

            window.removeEventListener("pointerdown", onPointerDown, true);
            window.removeEventListener("pointermove", onPointerMove, true);
            window.removeEventListener("pointerup", onPointerUp, true);

            const now = performance.now();
            const refPoint = interactionState.moveHistory.find(p => {
                const age = now - p.time;
                return age >= 50 && age <= 120;
            }) || interactionState.moveHistory[0] || interactionState.dragStart;
            
            const duration = Math.max(16, now - refPoint.time);
            
            const dxPixels = e.clientX - refPoint.x;
            const dyPixels = e.clientY - refPoint.y;
            const distPixels = Math.sqrt(dxPixels * dxPixels + dyPixels * dyPixels);

            const posStart3D = refPoint.pos3D;
            const posEnd3D = DiceInteractionManager.get3DCoords(e) || posStart3D;
            const dx3D = posEnd3D.x - posStart3D.x;
            const dz3D = posEnd3D.z - posStart3D.z;
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

            const velocity = {
                x: dirX * tossSpeed,
                y: lift,
                z: dirZ * tossSpeed
            };

            const spinMultiplier = 0.35 + (tossSpeed / 5.0) * 0.65;
            const baseSpin = 15 + Math.random() * 5;

            log("User flicked/tossed dice.", {
                direction: { x: dirX, z: dirZ },
                calculatedSpeed: tossSpeed,
                velocityVector: velocity,
                spinMultiplier
            });

            throwEngine.rolling = true;
            throwEngine._simulationReady = false;

            await throwEngine.physicsWorker.exec("removeConstraint", {
                ids: interactionState.heldDice.map(d => d.id)
            });

            const impulses = {};
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

            if (dsnCanvas) {
                dsnCanvas.style.pointerEvents = "none";
            }

            const simResult = await throwEngine.physicsWorker.exec('simulateThrow', {
                minIterations: throwEngine.minIterations,
                nbIterationsBetweenRolls: throwEngine.nbIterationsBetweenRolls,
                framerate: throwEngine.framerate,
                canBeFlipped: game.settings.get("dice-so-nice", "diceCanBeFlipped"),
                impulses: impulses
            });

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
                    throwEngine.swapDiceFace(dicemesh, faceValues[dicemesh.id]);
                    dicemesh.result = null;
                }
            }

            throwEngine.detectedCollides = throwEngine.soundManager.generateCollisionSounds(detectedCollides);
            throwEngine.iteration = 0;
            throwEngine.callback = callback;
            throwEngine.throws = throws;

            throwEngine.running = (new Date()).getTime();
            throwEngine._simulationReady = true;
        };

        const executeAutoRoll = async () => {
            clearRollTimeout();
            window.removeEventListener("pointerdown", onPointerDown, true);
            window.removeEventListener("pointermove", onPointerMove, true);
            window.removeEventListener("pointerup", onPointerUp, true);

            const randomAngle = Math.random() * Math.PI * 2;
            const dirX = Math.cos(randomAngle);
            const dirZ = Math.sin(randomAngle);
            const tossSpeed = 1.5;
            const lift = 0.5;

            const velocity = {
                x: dirX * tossSpeed,
                y: lift,
                z: dirZ * tossSpeed
            };

            const spinMultiplier = 0.65;
            const baseSpin = 15 + Math.random() * 5;

            log("Auto-roll timeout triggered. Rolling dice automatically.");
            
            throwEngine.rolling = true;
            throwEngine._simulationReady = false;

            await throwEngine.physicsWorker.exec("removeConstraint", {
                ids: interactionState.heldDice.map(d => d.id)
            });

            const impulses = {};
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

            if (dsnCanvas) {
                dsnCanvas.style.pointerEvents = "none";
            }

            const simResult = await throwEngine.physicsWorker.exec('simulateThrow', {
                minIterations: throwEngine.minIterations,
                nbIterationsBetweenRolls: throwEngine.nbIterationsBetweenRolls,
                framerate: throwEngine.framerate,
                canBeFlipped: game.settings.get("dice-so-nice", "diceCanBeFlipped"),
                impulses: impulses
            });

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
                    throwEngine.swapDiceFace(dicemesh, faceValues[dicemesh.id]);
                    dicemesh.result = null;
                }
            }

            throwEngine.detectedCollides = throwEngine.soundManager.generateCollisionSounds(detectedCollides);
            throwEngine.iteration = 0;
            throwEngine.callback = callback;
            throwEngine.throws = throws;

            throwEngine.running = (new Date()).getTime();
            throwEngine._simulationReady = true;
        };

        if (game.settings.get("natural-roll", "enableTimeout")) {
            const durationSec = game.settings.get("natural-roll", "timeoutDuration") || 15;
            timeoutId = setTimeout(executeAutoRoll, durationSec * 1000);
        }

        window.addEventListener("pointerdown", onPointerDown, true);
        window.addEventListener("pointermove", onPointerMove, true);
        window.addEventListener("pointerup", onPointerUp, true);
    }

    static get3DCoords(event) {
        const dsnCanvas = game.dice3d?.canvas;
        if (!dsnCanvas) return null;

        const rect = dsnCanvas.getBoundingClientRect();
        const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        const diceScene = game.dice3d.box?.diceScene;
        if (!diceScene) return null;

        diceScene.raycaster.setFromCamera({ x: ndcX, y: ndcY }, diceScene.camera);

        const GRAB_LIFT_EPHEMERAL = 0.05;
        const ray = diceScene.raycaster.ray;
        const Oy = ray.origin.y;
        const Dy = ray.direction.y;
        
        if (Math.abs(Dy) < 1e-6) return null;
        
        const t = (GRAB_LIFT_EPHEMERAL - Oy) / Dy;
        const hit = {
            x: ray.origin.x + t * ray.direction.x,
            y: GRAB_LIFT_EPHEMERAL,
            z: ray.origin.z + t * ray.direction.z
        };

        return hit;
    }
}
