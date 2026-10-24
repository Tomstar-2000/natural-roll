import { log } from "../utils.js";
import { LegacyDsnEngine } from "./LegacyDsnEngine.js";
import { ModernDsnEngine } from "./ModernDsnEngine.js";

const MODERN_ENGINE_MIN_MAJOR = 6;

let resolvedEngine = null;

function parseMajorVersion(version) {
    const match = /^\s*v?(\d+)/.exec(String(version ?? ""));
    return match ? Number(match[1]) : null;
}

function detectByVersion() {
    const major = parseMajorVersion(game.modules?.get("dice-so-nice")?.version);
    if (major === null) return null;
    return major >= MODERN_ENGINE_MIN_MAJOR ? ModernDsnEngine : LegacyDsnEngine;
}

function detectByFeatures() {
    const box = game.dice3d?.box;
    if (!box) return null;
    return box.diceScene && box.throwEngine ? ModernDsnEngine : LegacyDsnEngine;
}

export function getDsnEngine() {
    if (resolvedEngine) return resolvedEngine;

    const engine = detectByVersion() || detectByFeatures();
    if (!engine) {
        return (game.release?.generation ?? 13) >= 14 ? ModernDsnEngine : LegacyDsnEngine;
    }

    resolvedEngine = engine;
    log(`Using ${engine.label} adapter (Dice So Nice ${game.modules?.get("dice-so-nice")?.version ?? "unknown"}).`);
    return resolvedEngine;
}
