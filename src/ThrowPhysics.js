const V13_VELOCITY_SCALE = 2000;
const V14_VELOCITY_SCALE = 3.0;

const DIRECTION_JITTER_RAD = 0.12;
const SPEED_JITTER = 0.10;
const LIFT_JITTER = 0.15;
const SPIN_JITTER = 0.20;

const TOPSPIN_WEIGHT = 0.8;
const WOBBLE_WEIGHT = 0.5;

const jitter = (amount) => 1 + (Math.random() * 2 - 1) * amount;

function normalize(v) {
    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    if (len < 1e-9) return { x: 1, y: 0, z: 0 };
    return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function randomUnitVector() {
    const z = Math.random() * 2 - 1;
    const theta = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    return { x: r * Math.cos(theta), y: r * Math.sin(theta), z };
}

export function randomUnitQuaternion() {
    const u1 = Math.random();
    const u2 = Math.random() * Math.PI * 2;
    const u3 = Math.random() * Math.PI * 2;
    const a = Math.sqrt(1 - u1);
    const b = Math.sqrt(u1);
    return {
        x: a * Math.sin(u2),
        y: a * Math.cos(u2),
        z: b * Math.sin(u3),
        w: b * Math.cos(u3)
    };
}

export function quaternionToAxisTurns(q) {
    if (!q) return { x: 0, y: 0, z: 0, a: 0 };
    const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w) || 1;
    const w = Math.max(-1, Math.min(1, q.w / len));
    const angle = 2 * Math.acos(w);
    const s = Math.sqrt(1 - w * w);
    if (s < 1e-6) return { x: 1, y: 0, z: 0, a: 0 };
    return {
        x: q.x / len / s,
        y: q.y / len / s,
        z: q.z / len / s,
        a: angle / (Math.PI * 2)
    };
}

export function buildDieThrow({ isV13, dirX, dirZ, tossSpeed, lift, baseSpin, spinMultiplier }) {
    const angle = Math.atan2(dirZ, dirX) + (Math.random() * 2 - 1) * DIRECTION_JITTER_RAD;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const speed = tossSpeed * jitter(SPEED_JITTER);
    const dieLift = lift * jitter(LIFT_JITTER);

    const topspinAxis = isV13 ? { x: -dz, y: dx, z: 0 } : { x: dz, y: 0, z: -dx };
    const wobble = randomUnitVector();
    const spinAxis = normalize({
        x: topspinAxis.x * TOPSPIN_WEIGHT + wobble.x * WOBBLE_WEIGHT,
        y: topspinAxis.y * TOPSPIN_WEIGHT + wobble.y * WOBBLE_WEIGHT,
        z: topspinAxis.z * TOPSPIN_WEIGHT + wobble.z * WOBBLE_WEIGHT
    });

    const spinMagnitude = baseSpin * spinMultiplier * Math.sqrt(3) * jitter(SPIN_JITTER);

    const velocity = isV13 ? {
        x: dx * speed * V13_VELOCITY_SCALE,
        y: dz * speed * V13_VELOCITY_SCALE,
        z: dieLift * V13_VELOCITY_SCALE
    } : {
        x: dx * speed * V14_VELOCITY_SCALE,
        y: dieLift,
        z: dz * speed * V14_VELOCITY_SCALE
    };

    return {
        velocity,
        angularVelocity: {
            x: spinAxis.x * spinMagnitude,
            y: spinAxis.y * spinMagnitude,
            z: spinAxis.z * spinMagnitude
        }
    };
}
