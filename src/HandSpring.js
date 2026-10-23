const MIN_FREQUENCY_HZ = 4.5;
const MAX_FREQUENCY_HZ = 7.0;
const DAMPING_RATIO = 0.55;
const MAX_FRAME_DT = 1 / 30;
const MAX_SUBSTEP_DT = 1 / 120;

export function createDieSpring(position) {
    const frequency = MIN_FREQUENCY_HZ + Math.random() * (MAX_FREQUENCY_HZ - MIN_FREQUENCY_HZ);
    return {
        pos: { x: position.x, y: position.y, z: position.z },
        vel: { x: 0, y: 0, z: 0 },
        omega: frequency * Math.PI * 2
    };
}

export function snapDieSpring(spring, position) {
    return {
        ...spring,
        pos: { x: position.x, y: position.y, z: position.z },
        vel: { x: 0, y: 0, z: 0 }
    };
}

export function stepDieSpring(spring, target, dtSeconds) {
    const total = Math.min(Math.max(dtSeconds, 0), MAX_FRAME_DT);
    if (total <= 0) return spring;

    const k = spring.omega * spring.omega;
    const c = 2 * DAMPING_RATIO * spring.omega;
    const steps = Math.ceil(total / MAX_SUBSTEP_DT);
    const h = total / steps;

    let { x: px, y: py, z: pz } = spring.pos;
    let { x: vx, y: vy, z: vz } = spring.vel;
    for (let i = 0; i < steps; i++) {
        vx += (k * (target.x - px) - c * vx) * h;
        vy += (k * (target.y - py) - c * vy) * h;
        vz += (k * (target.z - pz) - c * vz) * h;
        px += vx * h;
        py += vy * h;
        pz += vz * h;
    }

    return {
        ...spring,
        pos: { x: px, y: py, z: pz },
        vel: { x: vx, y: vy, z: vz }
    };
}
