import { project, drawGroundGlow, drawGroundShadow, drawGroundRing, drawGlowDot } from "./Projection.js";
import { Spark3D } from "./Spark3D.js";

const SMOKE_HUE_MIN = 260;
const SMOKE_HUE_RANGE = 65;
const RING_COLOR = { h: 285, s: 90, l: 65 };
const POOL_COLOR = { h: 275, s: 90, l: 55 };

class SmokePuff {
    constructor() {
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.6 + Math.random() * 2.6;

        this.x = (Math.random() - 0.5) * 10;
        this.y = (Math.random() - 0.5) * 10;
        this.z = 4 + Math.random() * 10;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.vz = 0.6 + Math.random() * 1.2;

        this.radius = 10 + Math.random() * 16;
        this.growth = 0.7 + Math.random() * 0.9;
        this.hue = SMOKE_HUE_MIN + Math.random() * SMOKE_HUE_RANGE;
        this.alpha = 0.75 + Math.random() * 0.2;
        this.decay = 0.011 + Math.random() * 0.007;
        this.friction = 0.94 + Math.random() * 0.02;
    }

    get alive() {
        return this.alpha > 0;
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.z += this.vz;
        this.vx *= this.friction;
        this.vy *= this.friction;
        this.vz = this.vz * 0.95 + 0.015;
        this.radius += this.growth;
        this.growth *= 0.975;
        this.alpha -= this.decay;
    }

    depth() {
        return project(0, 0, this.x, this.y, this.z).depth;
    }

    draw(ctx, originX, originY) {
        if (this.alpha <= 0) return;
        const p = project(originX, originY, this.x, this.y, this.z);
        const r = this.radius * p.scale;
        const a = this.alpha;

        const gradient = ctx.createRadialGradient(
            p.x - r * 0.32, p.y - r * 0.38, r * 0.04,
            p.x, p.y, r
        );
        gradient.addColorStop(0, `hsla(${this.hue}, 80%, 82%, ${a * 0.85})`);
        gradient.addColorStop(0.35, `hsla(${this.hue}, 70%, 58%, ${a * 0.6})`);
        gradient.addColorStop(0.75, `hsla(${this.hue}, 75%, 30%, ${a * 0.28})`);
        gradient.addColorStop(1, `hsla(${this.hue}, 80%, 18%, 0)`);

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
    }
}

export class SmokeEffect {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.life = 0;

        const puffCount = 22 + Math.floor(Math.random() * 10);
        this.puffs = Array.from({ length: puffCount }, () => new SmokePuff());

        const sparkCount = 12 + Math.floor(Math.random() * 6);
        this.sparks = Array.from({ length: sparkCount }, () =>
            new Spark3D(SMOKE_HUE_MIN + Math.random() * SMOKE_HUE_RANGE, { speed: 0.9, lift: 0.9 })
        );
    }

    get alive() {
        return this.puffs.length > 0 || this.sparks.length > 0;
    }

    update() {
        this.life++;
        for (const puff of this.puffs) puff.update();
        for (const spark of this.sparks) spark.update();
        this.puffs = this.puffs.filter(p => p.alive);
        this.sparks = this.sparks.filter(s => s.alive);
    }

    draw(ctx) {
        const flash = Math.max(0, 1 - this.life / 14);
        const ringProgress = Math.min(1, this.life / 28);

        drawGroundShadow(ctx, this.x, this.y, 46 + this.life * 0.6, 0.35 * Math.max(0, 1 - this.life / 90));
        drawGroundGlow(ctx, this.x, this.y, 70, POOL_COLOR, 0.55 * flash);
        drawGroundRing(ctx, this.x, this.y, 12 + ringProgress * 70, 2.2 * (1 - ringProgress) + 0.4, RING_COLOR, 0.8 * (1 - ringProgress));

        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (const spark of this.sparks) spark.draw(ctx, this.x, this.y);
        if (flash > 0) {
            const core = project(this.x, this.y, 0, 0, 10);
            drawGlowDot(ctx, core.x, core.y, 9 * flash, 285, flash);
        }
        ctx.restore();

        const ordered = [...this.puffs].sort((a, b) => a.depth() - b.depth());
        ctx.save();
        for (const puff of ordered) puff.draw(ctx, this.x, this.y);
        ctx.restore();
    }
}
