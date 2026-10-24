import { log, error } from "./utils.js";
import { getCanvasElement } from "./DSNUtils.js";
import { SmokeEffect } from "./effects/SmokeEffect.js";
import { LightningEffect } from "./effects/LightningEffect.js";
import { PortalEffect } from "./effects/PortalEffect.js";

const EFFECT_TYPES = {
    smoke: SmokeEffect,
    lightning: LightningEffect,
    portal: PortalEffect
};

export class ParticleManager {
    static canvas = null;
    static ctx = null;
    static effects = [];
    static flashAlpha = 0;
    static animationId = null;
    static resizeListenerAttached = false;
    static MAX_EFFECTS = 16;

    static initialize() {
        if (this.canvas && document.body.contains(this.canvas)) return;

        log("Initializing ParticleManager overlay canvas in viewport-fixed mode.");
        let overlay = document.getElementById("natural-roll-particle-overlay");
        if (!overlay) {
            overlay = document.createElement("canvas");
            overlay.id = "natural-roll-particle-overlay";

            overlay.style.position = "fixed";
            overlay.style.top = "0";
            overlay.style.left = "0";
            overlay.style.width = "100vw";
            overlay.style.height = "100vh";
            overlay.style.pointerEvents = "none";
            overlay.style.zIndex = "999999";

            document.body.appendChild(overlay);
        }

        this.canvas = overlay;
        this.ctx = overlay.getContext("2d");
        this.resizeCanvas();

        if (!this.resizeListenerAttached) {
            this.resizeListenerAttached = true;
            window.addEventListener("resize", () => this.resizeCanvas());
        }
    }

    static resizeCanvas() {
        if (!this.canvas) return;
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.canvas.style.top = "0px";
        this.canvas.style.left = "0px";
    }

    static spawnEffect(x, y, styleOverride = null) {
        if (!game.settings.get("natural-roll", "enableMagicalEffects")) return;

        this.initialize();
        this.resizeCanvas();

        const style = styleOverride || game.settings.get("natural-roll", "magicalEffectStyle") || "smoke";
        const EffectType = EFFECT_TYPES[style] || SmokeEffect;
        log(`Spawning ${style} effect at screen coordinates (${x}, ${y})`);

        if (this.effects.length < this.MAX_EFFECTS) {
            this.effects.push(new EffectType(x, y));
        }
        if (EffectType === LightningEffect) {
            this.flashAlpha = 0.16;
        }

        this.startLoop();
    }

    static startLoop() {
        if (this.animationId !== null) return;

        const loop = () => {
            this.update();
            this.draw();

            if (this.effects.length > 0 || this.flashAlpha > 0) {
                this.animationId = requestAnimationFrame(loop);
            } else {
                this.animationId = null;
                this.clear();
            }
        };
        this.animationId = requestAnimationFrame(loop);
    }

    static update() {
        if (this.flashAlpha > 0) {
            this.flashAlpha = Math.max(0, this.flashAlpha - 0.025);
        }

        for (const effect of this.effects) effect.update();
        this.effects = this.effects.filter(effect => effect.alive);
    }

    static draw() {
        if (!this.ctx || !this.canvas) return;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        if (this.flashAlpha > 0) {
            this.ctx.fillStyle = `rgba(225, 240, 255, ${this.flashAlpha})`;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        const ordered = [...this.effects].sort((a, b) => a.y - b.y);
        for (const effect of ordered) {
            effect.draw(this.ctx);
        }
    }

    static clear() {
        if (this.ctx && this.canvas) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    static spawnEffectsForDice(throwEngine, diceList) {
        try {
            log("spawnEffectsForDice called with", diceList?.length, "dice.");
            if (!game.settings.get("natural-roll", "enableMagicalEffects")) {
                log("Magical effects are disabled in settings.");
                return;
            }
            const canvasRaw = game.dice3d?.canvas;
            const dsnCanvas = getCanvasElement(canvasRaw);
            if (!dsnCanvas) {
                log("No DSN canvas found.");
                return;
            }

            const diceScene = game.dice3d?.box?.diceScene || game.dice3d?.box;
            if (!diceScene || !diceScene.camera) {
                log("No DSN camera or diceScene found.");
                return;
            }

            const camera = diceScene.camera;
            const rect = dsnCanvas.getBoundingClientRect();
            const width = rect.width;
            const height = rect.height;
            log(`DSN canvas bounds: width=${width}, height=${height}, left=${rect.left}, top=${rect.top}`);

            let count = 0;
            for (const die of (diceList || [])) {
                if (!die) continue;
                const diePos = die.parent ? die.parent.position : die.position;
                if (!diePos) {
                    log("Die has no position property.");
                    continue;
                }

                const tempV = diePos.clone();
                tempV.project(camera);

                const x = ((tempV.x + 1) * width) / 2 + rect.left;
                const y = ((-tempV.y + 1) * height) / 2 + rect.top;

                log(`Projected 3D position (${diePos.x}, ${diePos.y}, ${diePos.z}) to screen (${x}, ${y})`);

                if (isNaN(x) || isNaN(y)) {
                    log("Projected coordinates are NaN!");
                    continue;
                }

                this.spawnEffect(x, y);
                count++;
            }
            log(`Successfully triggered magical effects for ${count} dice.`);
        } catch (err) {
            error("Error rendering magical effects:", err);
        }
    }
}

