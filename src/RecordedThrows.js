import { log } from "./utils.js";
import { getThrowEngine } from "./DSNUtils.js";

const VIEW_MARGIN = 0.08;

/**
 * Throws recorded somewhere else (e.g. on a companion device) and carried in the roll itself, so every client
 * plays the same throw when Dice So Nice shows the roll, through the replay intercept.
 *
 * A recording sits in a dice term's options (see api.recordThrow):
 *   {
 *     id: string,                        unique per recording
 *     frames: number,                    frames at Dice So Nice's 60 per second, from the moment of release
 *     dice: [{
 *       type: "d20",                     Dice So Nice die type (a d100 is a "d100" and a "d10")
 *       value: 14,                       the face value Dice So Nice reads at rest (its shape's faceValues)
 *       positions: [x, y, z, ...],       one per frame, Y up, in die units (a die of preset scale s has radius s)
 *       quaternions: [x, y, z, w, ...]   one per frame, in Dice So Nice's shape orientation
 *     }],
 *     collisions: [[frame, "dice" | "table", strength 0-1], ...]   optional, for sounds
 *     area: [minX, minZ, maxX, maxZ]     optional, the table the dice were thrown on (die units); the throw is
 *                                        then fitted into each viewer's Dice So Nice view (see fitArea)
 *   }
 */
export const RECORDING_OPTION = "naturalRollRecording";

export class RecordedThrows {
    /**
     * The replay payload for a Dice So Nice throw whose dice all carry recordings, or null.
     * Trajectories are matched to the throw's dice by order (`matchByOrder`): clients spawn the dice of a
     * chat message through different paths, not all of which give the meshes Natural Roll's ids.
     */
    static buildReplayPayload(context, throws) {
        const dice = (throws || []).flatMap(t => t.dice || []);
        if (!dice.length || !dice.every(d => d.options?.[RECORDING_OPTION]?.dice?.length)) return null;

        const throwEngine = getThrowEngine(context);
        const scale = throwEngine?.dicefactory?.baseScale || game.dice3d?.box?.dicefactory?.baseScale;
        if (!scale) return null;

        const used = new Map();
        const assigned = [];
        for (const die of dice) {
            const recording = die.options[RECORDING_OPTION];
            const taken = used.get(recording.id) ?? new Set();
            used.set(recording.id, taken);
            const free = recording.dice.map((entry, i) => i).filter(i => !taken.has(i));
            const index = free.find(i => recording.dice[i].type === die.type) ?? free[0];
            if (index === undefined) return null;
            taken.add(index);
            assigned.push({ die, recording, entry: recording.dice[index] });
        }

        const frames = Math.min(1001, Math.max(...assigned.map(({ recording }) => recording.frames || 0)));
        if (frames < 2) return null;

        const fit = fitArea(assigned[0].recording.area, scale);
        const trajectories = [];
        const faceValues = {};
        const finalQuaternions = {};
        for (const [index, { entry }] of assigned.entries()) {
            const rollerId = `recorded-${index}`;
            const positions = pad(fit.positions(entry.positions), 3, frames);
            const quaternions = pad(fit.quaternions(entry.quaternions), 4, frames);
            trajectories.push({ id: rollerId, positions, quaternions });
            faceValues[rollerId] = entry.value;
            const last = quaternions.length - 4;
            finalQuaternions[rollerId] = { x: quaternions[last], y: quaternions[last + 1], z: quaternions[last + 2], w: quaternions[last + 3] };
        }

        const detectedCollides = new Array(1000);
        for (const { recording, die } of assigned) {
            for (const [frame, source, strength] of recording.collisions || []) {
                if (frame >= detectedCollides.length || detectedCollides[frame]) continue;
                detectedCollides[frame] = source === "dice"
                    ? ["dice", die.type, die.appearance?.material ?? "plastic", strength]
                    : ["table", null, null, strength];
            }
        }

        log(`Playing a recorded throw of ${assigned.length} dice (${frames} frames).`);
        return {
            user: null,
            matchByOrder: true,
            trajectories,
            faceValues,
            finalQuaternions,
            detectedCollides,
            iterationsNeeded: frames - 1,
            deads: trajectories.map(() => false)
        };
    }
}

/** Hold the last frame until every die has the same number of frames. */
function pad(values, stride, frames) {
    const out = values.slice(0, frames * stride);
    const last = out.slice(-stride);
    while (out.length < frames * stride) out.push(...last);
    return out;
}

/**
 * How to place a recorded throw in this client's Dice So Nice view. The table it was thrown on (e.g. a tall,
 * narrow phone) rarely has the view's shape (a wide screen), so the throw is centred, turned a quarter turn
 * when that fits better (from bottom-to-top to left-to-right: a rotation keeps every bounce exact), and its
 * travel scaled down if it would still leave the view. Heights and the dice themselves keep their size.
 */
function fitArea(area, scale) {
    const identity = {
        positions: (values) => values.map(v => v * scale),
        quaternions: (values) => values.slice()
    };
    const view = visibleTable();
    if (!Array.isArray(area) || area.length !== 4 || !area.every(Number.isFinite) || !view) return identity;

    const [minX, minZ, maxX, maxZ] = area;
    const width = (maxX - minX) * scale;
    const depth = (maxZ - minZ) * scale;
    if (width <= 0 || depth <= 0) return identity;
    const viewWidth = (view.maxX - view.minX) * (1 - 2 * VIEW_MARGIN);
    const viewDepth = (view.maxZ - view.minZ) * (1 - 2 * VIEW_MARGIN);
    const straight = Math.min(1, viewWidth / width, viewDepth / depth);
    const turned = Math.min(1, viewWidth / depth, viewDepth / width);
    const turn = turned > straight;
    const travel = Math.max(straight, turned);

    const fromX = (minX + maxX) / 2;
    const fromZ = (minZ + maxZ) / 2;
    const toX = (view.minX + view.maxX) / 2;
    const toZ = (view.minZ + view.maxZ) / 2;
    const half = Math.SQRT1_2;
    return {
        positions(values) {
            const out = new Array(values.length);
            for (let i = 0; i < values.length; i += 3) {
                const x = (values[i] - fromX) * scale * travel;
                const z = (values[i + 2] - fromZ) * scale * travel;
                out[i] = toX + (turn ? -z : x);
                out[i + 1] = values[i + 1] * scale;
                out[i + 2] = toZ + (turn ? x : z);
            }
            return out;
        },
        quaternions(values) {
            if (!turn) return values.slice();
            const out = new Array(values.length);
            for (let i = 0; i < values.length; i += 4) {
                const [x, y, z, w] = [values[i], values[i + 1], values[i + 2], values[i + 3]];
                out[i] = half * (x - z);
                out[i + 1] = half * (y - w);
                out[i + 2] = half * (z + x);
                out[i + 3] = half * (w + y);
            }
            return out;
        }
    };
}

function visibleTable() {
    const camera = (game.dice3d?.box?.diceScene || game.dice3d?.box)?.camera;
    if (!camera?.position) return null;
    const Vector3 = camera.position.constructor;
    const points = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
        const direction = new Vector3(x, y, 0.5).unproject(camera).sub(camera.position).normalize();
        if (direction.y >= 0) return null;
        return camera.position.clone().addScaledVector(direction, -camera.position.y / direction.y);
    });
    if (points.some(point => !point)) return null;
    return {
        minX: Math.min(...points.map(p => p.x)),
        maxX: Math.max(...points.map(p => p.x)),
        minZ: Math.min(...points.map(p => p.z)),
        maxZ: Math.max(...points.map(p => p.z))
    };
}
