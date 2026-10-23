const PEAK_WINDOW_MS = 100;
const MIN_SEGMENT_MS = 24;
const STILL_PX = 2;

const STOP_FADE_START_MS = 40;
const STOP_FADE_END_MS = 120;
const MIN_DIRECTION_LENGTH = 1e-6;

const distance2D = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

function getRestDuration(samples, release) {
    let restSince = release.time;
    for (let i = samples.length - 1; i >= 0; i--) {
        if (distance2D(samples[i], release) > STILL_PX) break;
        restSince = samples[i].time;
    }
    return release.time - restSince;
}

function findPeakSegment(samples, release) {
    let peak = null;
    for (let end = samples.length - 1; end > 0; end--) {
        const b = samples[end];
        if (release.time - b.time > PEAK_WINDOW_MS) break;

        let start = end - 1;
        while (start > 0 && b.time - samples[start].time < MIN_SEGMENT_MS) start--;
        const a = samples[start];
        const dtMs = b.time - a.time;
        if (dtMs <= 0) continue;

        const speed = distance2D(a, b) / (dtMs / 1000);
        if (!peak || speed > peak.speed) peak = { speed, a, b };
    }
    return peak;
}

function getHorizontalDirection(a, b, isV13) {
    if (!a?.pos3D || !b?.pos3D) return null;
    const dx = b.pos3D.x - a.pos3D.x;
    const dz = isV13 ? (b.pos3D.y - a.pos3D.y) : (b.pos3D.z - a.pos3D.z);
    const len = Math.hypot(dx, dz);
    return len > MIN_DIRECTION_LENGTH ? { x: dx / len, z: dz / len } : null;
}

export function estimateFlick(history, release, isV13) {
    const samples = [...(history || []).filter(s => s && s.time <= release.time), release]
        .sort((a, b) => a.time - b.time);

    const peak = findPeakSegment(samples, release);
    if (!peak) return { speed: 0, direction: null };

    const restMs = getRestDuration(samples.slice(0, -1), release);
    const fade = Math.min(1, Math.max(0, (restMs - STOP_FADE_START_MS) / (STOP_FADE_END_MS - STOP_FADE_START_MS)));

    return {
        speed: peak.speed * (1 - fade),
        direction: getHorizontalDirection(peak.a, peak.b, isV13)
    };
}
