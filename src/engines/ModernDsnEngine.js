const VELOCITY_SCALE = 3.0;
const TABLE_HEIGHT = 0.1;
const FORMATION_SPREAD_FACTOR = 3.0;
const SWAY_YAW = 0.05;

export const ModernDsnEngine = Object.freeze({
    id: "modern",
    label: "Dice So Nice 6+ (modern engine)",

    pointerPlaneHeight: TABLE_HEIGHT,
    spawnPlaneHeight: TABLE_HEIGHT,
    mirrorsSimulationToBox: false,

    centerFallback() {
        return { x: 0, y: TABLE_HEIGHT, z: 0 };
    },

    formationSpacing(rawSpread) {
        return rawSpread * FORMATION_SPREAD_FACTOR;
    },

    planeOffset(dx, dPlane) {
        return { dx, dy: 0, dz: dPlane };
    },

    spawnPosition(spawnPos, offset, _dieRadius, index) {
        return {
            x: spawnPos.x + offset.dx,
            y: (spawnPos.y || TABLE_HEIGHT) + (index * 0.003),
            z: spawnPos.z + offset.dz
        };
    },

    heldTarget(pos3D, offset) {
        return {
            x: pos3D.x + offset.dx,
            y: pos3D.y || TABLE_HEIGHT,
            z: (pos3D.z || 0) + offset.dz
        };
    },

    planarDepthDelta(a, b) {
        return b.z - a.z;
    },

    baseSpin() {
        return 40 + Math.random() * 15;
    },

    throwVectors(dx, dz, speed, lift) {
        return {
            topspinAxis: { x: dz, y: 0, z: -dx },
            velocity: {
                x: dx * speed * VELOCITY_SCALE,
                y: lift,
                z: dz * speed * VELOCITY_SCALE
            }
        };
    },

    async prepareWorkerForHold(throwEngine) {
        const worker = throwEngine.physicsWorker;
        if (!worker) return;
        try {
            await worker.exec("removeConstraint", {});
            const oldIds = (throwEngine.diceList || []).concat(throwEngine.deadDiceList || []).map(d => d.id);
            if (oldIds.length > 0) {
                await worker.exec("removeDice", oldIds);
            }
        } catch (e) {}
    },

    async spawnDie(throwEngine, die, appearance, notationVectors, workerSpecs) {
        const diceLibrary = notationVectors.dsnConfig.diceLibrary;
        if (throwEngine.spawnDiceMesh) {
            await throwEngine.spawnDiceMesh(die, appearance, diceLibrary, workerSpecs);
        } else {
            await throwEngine.spawnDice(die, appearance, diceLibrary, workerSpecs);
        }
    },

    async commitSpawnedDice(throwEngine, workerSpecs) {
        if (workerSpecs.length > 0) {
            await throwEngine.physicsWorker.exec("createDiceBatch", workerSpecs);
        }
    },

    initHeldOrientation() {},

    usesWorkerConstraints: true,

    async attachHoldConstraints(throwEngine, dice, getDieWorldPosition) {
        if (!throwEngine.physicsWorker) return;
        for (const die of dice) {
            try {
                await throwEngine.physicsWorker.exec("addConstraint", { id: die.id, pos: getDieWorldPosition(die) });
            } catch (e) {}
        }
    },

    applyHeldTilt(obj, tiltX, tiltY, sway) {
        obj.rotation.x = tiltX;
        obj.rotation.z = -tiltY;
        obj.rotation.y = sway * SWAY_YAW;
    },

    async launchHeldDice({ throwEngine, heldDice, dieThrows }) {
        await throwEngine.physicsWorker.exec("removeConstraint", {
            ids: heldDice.map(d => d.id)
        });
        return Object.fromEntries(heldDice.map(d => [d.id, dieThrows.get(d.id)]));
    },

    simulationParams(baseParams, impulses) {
        return { ...baseParams, impulses };
    },

    async resolveFaceValues(_throwEngine, simResult) {
        return simResult.faceValues;
    },

    async swapDiceFace(throwEngine, dicemesh, value) {
        throwEngine.swapDiceFace(dicemesh, value);
    }
});
