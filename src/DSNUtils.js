export function getCanvasElement(canvas) {
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

export function getThrowEngine(engine) {
    if (!engine) return game.dice3d?.box?.throwEngine || game.dice3d?.box || null;
    return engine.throwEngine || game.dice3d?.box?.throwEngine || engine;
}

export function setEngineRolling(engine, value) {
    if (!engine) return;
    try { engine.rolling = value; } catch (e) {}
    if (engine.throwEngine) {
        try { engine.throwEngine.rolling = value; } catch (e) {}
    }
}

export function setEngineRunning(engine, value) {
    if (!engine) return;
    try { engine.running = value; } catch (e) {}
    if (engine.throwEngine) {
        try { engine.throwEngine.running = value; } catch (e) {}
    }
}

export function renderDSNScene(engine) {
    const throwEngine = getThrowEngine(engine);

    const diceScene = throwEngine?.diceScene || game.dice3d?.box?.diceScene;
    const scene3D = diceScene?.scene || throwEngine?.scene || game.dice3d?.box?.scene;
    if (scene3D) {
        try { scene3D.updateMatrixWorld(true); } catch (e) {}
    }
    (game.dice3d?.box?.renderScene || throwEngine?.diceScene?.renderScene)?.call(game.dice3d?.box || throwEngine?.diceScene);
}

export function disposeObject3D(obj) {
    if (!obj) return;
    try {
        if (typeof obj.traverse === "function") {
            obj.traverse(child => {
                if (child.geometry && typeof child.geometry.dispose === "function") {
                    try { child.geometry.dispose(); } catch (e) {}
                }
                if (child.material) {
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    for (const mat of materials) {
                        if (!mat) continue;
                        if (typeof mat.dispose === "function") {
                            try { mat.dispose(); } catch (e) {}
                        }
                    }
                }
            });
        }
    } catch (e) {}
}

export function stopDSNTicker() {
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
}
