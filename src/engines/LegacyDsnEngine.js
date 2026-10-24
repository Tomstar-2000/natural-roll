import { randomUnitQuaternion, quaternionToAxisTurns } from "../ThrowPhysics.js";

const VELOCITY_SCALE = 2000;
const POINTER_PLANE_HEIGHT = 30;
const SPAWN_PLANE_HEIGHT = 25;
const HELD_LIFT = 5;
const FORMATION_SPREAD_FACTOR = 50;
const SWAY_ROLL = 0.04;

const MATERIAL_MASS = {
    metal: 7,
    wood: 0.65,
    glass: 2,
    stone: 1.5
};

export const LegacyDsnEngine = Object.freeze({
    id: "legacy",
    label: "Dice So Nice 5.x and earlier (legacy engine)",

    pointerPlaneHeight: POINTER_PLANE_HEIGHT,
    spawnPlaneHeight: SPAWN_PLANE_HEIGHT,
    mirrorsSimulationToBox: true,

    centerFallback() {
        return { x: 0, y: 0, z: SPAWN_PLANE_HEIGHT };
    },

    formationSpacing(rawSpread, dieRadius) {
        return dieRadius * (2 + rawSpread * FORMATION_SPREAD_FACTOR);
    },

    planeOffset(dx, dPlane) {
        return { dx, dy: dPlane, dz: 0 };
    },

    spawnPosition(spawnPos, offset, dieRadius, index) {
        return {
            x: spawnPos.x + offset.dx,
            y: spawnPos.y + offset.dy,
            z: dieRadius + (index * 0.003)
        };
    },

    heldTarget(pos3D, offset, dieRadius) {
        return {
            x: pos3D.x + offset.dx,
            y: pos3D.y + offset.dy,
            z: dieRadius + HELD_LIFT
        };
    },

    planarDepthDelta(a, b) {
        return b.y - a.y;
    },

    baseSpin() {
        return 25 + Math.random() * 10;
    },

    throwVectors(dx, dz, speed, lift) {
        return {
            topspinAxis: { x: -dz, y: dx, z: 0 },
            velocity: {
                x: dx * speed * VELOCITY_SCALE,
                y: dz * speed * VELOCITY_SCALE,
                z: lift * VELOCITY_SCALE
            }
        };
    },

    async prepareWorkerForHold(throwEngine) {
        const worker = throwEngine.physicsWorker;
        if (!worker || worker._naturalRollHoldPatch) return;
        const originalExec = worker.exec.bind(worker);
        worker._naturalRollHoldPatch = true;
        worker._naturalRollOriginalExec = originalExec;
        worker.exec = async function(cmd, ...args) {
            if (cmd === "playStep" && throwEngine._simulationReady === false) {
                return { ids: null, worldAsleep: true };
            }
            return originalExec(cmd, ...args);
        };
    },

    async spawnDie(throwEngine, die, appearance) {
        await throwEngine.spawnDice(die, appearance);
    },

    async commitSpawnedDice() {},

    initHeldOrientation(die, heldObj) {
        if (!heldObj.quaternion?.clone) return;
        const q = randomUnitQuaternion();
        heldObj.quaternion.set(q.x, q.y, q.z, q.w);
        die.userData.naturalRollBaseQuaternion = heldObj.quaternion.clone();
    },

    usesWorkerConstraints: false,

    async attachHoldConstraints() {},

    applyHeldTilt(obj, tiltX, tiltY, sway, baseQuaternion) {
        obj.rotation.set(tiltX, tiltY, sway * SWAY_ROLL);
        if (baseQuaternion) {
            obj.quaternion.multiply(baseQuaternion);
        }
    },

    async launchHeldDice({ throwEngine, heldDice, dieThrows, heldOrientations, getDieWorldPosition, log }) {
        await throwEngine.physicsWorker.exec("removeDice", heldDice.map(d => d.id));
        for (const die of heldDice) {
            const pos = getDieWorldPosition(die);
            const dieThrow = dieThrows.get(die.id);
            log("Recreating legacy die", { id: die.id, pos, velocity: dieThrow.velocity });
            const diceobj = throwEngine.dicefactory.get(die.notation.type);
            const material = die.appearance?.material || "plastic";
            const mass = diceobj.mass * (MATERIAL_MASS[material] ?? 1);
            await throwEngine.physicsWorker.exec("createDice", {
                id: die.id,
                shape: diceobj.shape,
                material,
                vectordata: {
                    type: die.notation.type,
                    pos: { x: pos.x, y: pos.y, z: pos.z },
                    velocity: dieThrow.velocity,
                    angle: dieThrow.angularVelocity,
                    axis: quaternionToAxisTurns(heldOrientations.get(die.id))
                },
                mass,
                startAtIteration: 0,
                options: die.options
            });
            await throwEngine.physicsWorker.exec("addDice", die.id);
        }
        return {};
    },

    simulationParams(baseParams) {
        return { ...baseParams };
    },

    async resolveFaceValues(throwEngine, simResult, quaternions, idToIndex) {
        const faceValues = {};
        for (const dicemesh of throwEngine.diceList) {
            if (!dicemesh) continue;
            const index = idToIndex.get(dicemesh.id);
            const steps = index !== undefined ? quaternions[index] : null;
            if (!steps || steps.length < 4) continue;

            const lastStep = steps.length / 4 - 1;
            const origQ = dicemesh.quaternion.clone();
            dicemesh.quaternion.set(
                steps[lastStep * 4],
                steps[lastStep * 4 + 1],
                steps[lastStep * 4 + 2],
                steps[lastStep * 4 + 3]
            );
            dicemesh.updateMatrix();
            dicemesh.updateMatrixWorld(true);
            const val = await dicemesh.getValue();
            faceValues[dicemesh.id] = parseInt(val);
            dicemesh.quaternion.copy(origQ);
            dicemesh.updateMatrix();
            dicemesh.updateMatrixWorld(true);
        }
        return faceValues;
    },

    async swapDiceFace(throwEngine, dicemesh) {
        await throwEngine.swapDiceFace(dicemesh);
    }
});
