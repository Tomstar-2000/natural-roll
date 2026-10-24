import { project, traceGroundCircle, drawGroundGlow, drawGlowDot } from "./Projection.js";
import { Spark3D } from "./Spark3D.js";

const GROW_FRAMES = 12;
const SUSTAIN_END = 52;
const COLLAPSE_FRAMES = 12;
const TUNNEL_RINGS = 9;
const TUNNEL_ARMS = 5;
const ARM_SAMPLES = 28;
const RIM_SEGMENTS = 72;
const MAX_MOTES = 70;

function easeOutBack(t) {
    const c = 1.6;
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
}

class PortalMote {
    constructor(radius, depth, hue, kind) {
        this.kind = kind;
        this.angle = Math.random() * Math.PI * 2;
        this.hue = hue + (Math.random() - 0.5) * 30;
        this.size = 0.9 + Math.random() * 1.5;
        this.alpha = 0;
        this.maxAlpha = 0.8 + Math.random() * 0.2;
        this.portalRadius = radius;
        this.depthLimit = depth;
        this.fading = false;

        if (kind === "inflow") {
            this.r = radius * (1.15 + Math.random() * 0.8);
            this.z = 3 + Math.random() * 16;
            this.vz = 0;
            this.spin = 0.05 + Math.random() * 0.04;
        } else {
            this.r = Math.random() * radius * 0.55;
            this.z = -depth * (0.2 + Math.random() * 0.3);
            this.vz = 1.4 + Math.random() * 2.2;
            this.spin = 0.03 + Math.random() * 0.03;
        }
    }

    get alive() {
        return !this.fading || this.alpha > 0;
    }

    get x() {
        return Math.cos(this.angle) * this.r;
    }

    get y() {
        return Math.sin(this.angle) * this.r;
    }

    update() {
        if (this.kind === "inflow") {
            this.angle += this.spin * (this.portalRadius / Math.max(this.r, 4));
            this.r *= 0.968;
            if (this.r < this.portalRadius * 0.95) {
                this.vz -= 0.35;
            } else {
                this.z *= 0.97;
            }
            this.z += this.vz;
            this.fading ||= this.z < -this.depthLimit * 0.6;
        } else {
            this.angle += this.spin;
            this.r *= 1.012;
            this.z += this.vz;
            this.vz *= 0.985;
            this.fading ||= this.z > this.portalRadius * 1.6;
        }

        if (this.fading) {
            this.alpha -= 0.06;
        } else {
            this.alpha = Math.min(this.maxAlpha, this.alpha + 0.12);
        }
    }

    draw(ctx, originX, originY) {
        const p = project(originX, originY, this.x, this.y, this.z);
        const depthFade = this.z < 0 ? Math.max(0, 1 + this.z / this.depthLimit) : 1;
        drawGlowDot(ctx, p.x, p.y, this.size * p.scale, this.hue, Math.max(0, this.alpha) * depthFade);
    }
}

export class PortalEffect {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.life = 0;
        this.targetRadius = 46 + Math.random() * 12;
        this.radius = 0;
        this.alpha = 1.0;
        this.rotation = Math.random() * Math.PI * 2;
        this.rotSpeed = 0.05 + Math.random() * 0.02;
        this.hue1 = 185 + Math.random() * 20;
        this.hue2 = 265 + Math.random() * 30;

        this.motes = Array.from({ length: 16 }, () => this.createMote("inflow"));
        this.sparks = [];
        this.collapsed = false;
    }

    get depth() {
        return this.radius * 1.7;
    }

    get open() {
        return this.life <= SUSTAIN_END + COLLAPSE_FRAMES;
    }

    get alive() {
        return this.open || this.motes.length > 0 || this.sparks.length > 0;
    }

    createMote(kind) {
        const hue = kind === "inflow" ? this.hue1 : this.hue2;
        return new PortalMote(this.targetRadius, this.targetRadius * 1.7, hue, kind);
    }

    update() {
        this.life++;
        this.rotation += this.rotSpeed;

        if (this.life <= GROW_FRAMES) {
            this.radius = this.targetRadius * easeOutBack(this.life / GROW_FRAMES);
        } else if (this.life <= SUSTAIN_END) {
            this.radius = this.targetRadius * (1 + Math.sin(this.life * 0.4) * 0.03);
            if (this.motes.length < MAX_MOTES) {
                if (Math.random() < 0.55) this.motes.push(this.createMote("inflow"));
                if (Math.random() < 0.35) this.motes.push(this.createMote("outflow"));
            }
        } else if (this.open) {
            const t = (this.life - SUSTAIN_END) / COLLAPSE_FRAMES;
            this.radius = this.targetRadius * (1 - t * t);
            this.alpha = 1 - t * t;
            this.rotSpeed *= 1.08;
        } else if (!this.collapsed) {
            this.collapsed = true;
            this.radius = 0;
            this.alpha = 0;
            this.sparks = Array.from({ length: 16 }, () => new Spark3D(this.hue1, { speed: 0.9, lift: 1.1 }));
        }

        for (const mote of this.motes) mote.update();
        for (const spark of this.sparks) spark.update();
        this.motes = this.motes.filter(m => m.alive);
        this.sparks = this.sparks.filter(s => s.alive);
    }

    drawThroat(ctx) {
        const R = this.radius;
        const D = this.depth;
        const a = this.alpha;

        traceGroundCircle(ctx, this.x, this.y, R);
        ctx.fillStyle = `rgba(5, 2, 16, ${0.97 * a})`;
        ctx.fill();

        ctx.save();
        traceGroundCircle(ctx, this.x, this.y, R);
        ctx.clip();
        ctx.globalCompositeOperation = "lighter";

        const floor = project(this.x, this.y, 0, 0, -D);
        const coreR = R * 0.7 * floor.scale;
        const core = ctx.createRadialGradient(floor.x, floor.y, 0, floor.x, floor.y, coreR);
        core.addColorStop(0, `hsla(${this.hue1}, 100%, 92%, ${a * 0.95})`);
        core.addColorStop(0.35, `hsla(${this.hue2}, 100%, 60%, ${a * 0.5})`);
        core.addColorStop(1, `hsla(${this.hue2}, 100%, 40%, 0)`);
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(floor.x, floor.y, coreR, 0, Math.PI * 2);
        ctx.fill();

        const flow = (this.life * 0.05) % 1;
        for (let k = 0; k < TUNNEL_RINGS; k++) {
            const t = (k + flow) / TUNNEL_RINGS;
            const hue = this.hue1 + (this.hue2 - this.hue1) * t;
            traceGroundCircle(ctx, this.x, this.y, R * (1 - 0.6 * t), -D * t, 40);
            ctx.strokeStyle = `hsla(${hue}, 100%, ${70 - t * 25}%, ${a * 0.5 * (1 - t) * Math.min(1, t * 6)})`;
            ctx.lineWidth = 1.6 * (1 - t * 0.5);
            ctx.stroke();
        }

        ctx.lineCap = "round";
        for (let s = 0; s < TUNNEL_ARMS; s++) {
            const start = (s / TUNNEL_ARMS) * Math.PI * 2 + this.rotation;
            let prev = null;
            for (let j = 0; j <= ARM_SAMPLES; j++) {
                const t = j / ARM_SAMPLES;
                const angle = start + t * Math.PI * 2.4;
                const r = R * 0.97 * (1 - 0.6 * t);
                const p = project(this.x, this.y, Math.cos(angle) * r, Math.sin(angle) * r, -D * t);
                if (prev) {
                    const hue = this.hue1 + (this.hue2 - this.hue1) * t;
                    ctx.strokeStyle = `hsla(${hue}, 100%, 72%, ${a * 0.85 * (1 - t)})`;
                    ctx.lineWidth = 2.4 * p.scale * (1 - t * 0.6);
                    ctx.beginPath();
                    ctx.moveTo(prev.x, prev.y);
                    ctx.lineTo(p.x, p.y);
                    ctx.stroke();
                }
                prev = p;
            }
        }

        for (const mote of this.motes) {
            if (mote.z < 0) mote.draw(ctx, this.x, this.y);
        }
        ctx.restore();
    }

    drawRim(ctx, nearHalf) {
        const R = this.radius;
        const a = this.alpha * (nearHalf ? 1 : 0.75);
        const rimWidth = Math.max(1.5, R * 0.085);

        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.lineCap = "round";

        for (let i = 0; i < RIM_SEGMENTS; i++) {
            const a0 = (i / RIM_SEGMENTS) * Math.PI * 2;
            const a1 = ((i + 1) / RIM_SEGMENTS) * Math.PI * 2;
            const mid = (a0 + a1) / 2;
            if ((Math.sin(mid) < 0) !== nearHalf) continue;

            const p0 = project(this.x, this.y, Math.cos(a0) * R, Math.sin(a0) * R, 2);
            const p1 = project(this.x, this.y, Math.cos(a1) * R, Math.sin(a1) * R, 2);
            const w = rimWidth * (p0.scale + p1.scale) / 2;
            const energy = 0.55 + 0.45 * Math.sin(mid * 3 - this.rotation * 2.2);

            const passes = [
                { color: `hsla(${this.hue2}, 100%, 55%, ${a * 0.18})`, width: w * 3.2, lift: 0 },
                { color: `hsla(${this.hue2}, 100%, 58%, ${a * (0.5 + energy * 0.3)})`, width: w, lift: 0 },
                { color: `hsla(${this.hue1}, 100%, 88%, ${a * energy})`, width: w * 0.35, lift: w * 0.28 }
            ];
            for (const pass of passes) {
                ctx.strokeStyle = pass.color;
                ctx.lineWidth = pass.width;
                ctx.beginPath();
                ctx.moveTo(p0.x, p0.y - pass.lift);
                ctx.lineTo(p1.x, p1.y - pass.lift);
                ctx.stroke();
            }
        }
        ctx.restore();
    }

    drawLightColumn(ctx) {
        const R = this.radius;
        const height = R * 3.2;
        const pulse = 0.75 + Math.sin(this.life * 0.3) * 0.25;
        const alpha = this.alpha * pulse * Math.min(1, this.life / GROW_FRAMES) * 0.32;
        if (alpha <= 0 || R <= 0) return;

        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.translate(this.x, this.y - height * 0.55);
        ctx.scale(R / height * 1.1, 1);
        const gradient = ctx.createRadialGradient(0, height * 0.3, 0, 0, 0, height * 0.75);
        gradient.addColorStop(0, `hsla(${this.hue1}, 100%, 80%, ${alpha})`);
        gradient.addColorStop(0.5, `hsla(${this.hue2}, 100%, 60%, ${alpha * 0.4})`);
        gradient.addColorStop(1, `hsla(${this.hue2}, 100%, 50%, 0)`);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(0, 0, height * 0.75, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    drawMotesAbove(ctx, nearSide) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (const mote of this.motes) {
            if (mote.z >= 0 && (mote.y < 0) === nearSide) mote.draw(ctx, this.x, this.y);
        }
        ctx.restore();
    }

    draw(ctx) {
        if (this.open && this.radius > 0.5) {
            drawGroundGlow(ctx, this.x, this.y, this.radius * 2.6, { h: this.hue2, s: 100, l: 55 }, 0.5 * this.alpha);
            this.drawThroat(ctx);
            this.drawRim(ctx, false);
            this.drawMotesAbove(ctx, false);
            this.drawRim(ctx, true);
            this.drawMotesAbove(ctx, true);
            this.drawLightColumn(ctx);
        } else {
            this.drawMotesAbove(ctx, false);
            this.drawMotesAbove(ctx, true);
        }

        if (this.sparks.length > 0) {
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            for (const spark of this.sparks) spark.draw(ctx, this.x, this.y);
            ctx.restore();
        }
    }
}
