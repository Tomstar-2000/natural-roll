import { project, drawGlowDot } from "./Projection.js";

const GRAVITY = 0.32;
const AIR_FRICTION = 0.97;
const BOUNCE_DAMPING = 0.42;
const GROUND_FRICTION = 0.7;
const MAX_TRAIL = 5;

export class Spark3D {
    constructor(hue, { speed = 1, lift = 1 } = {}) {
        const angle = Math.random() * Math.PI * 2;
        const horizontal = (1.5 + Math.random() * 4.5) * speed;

        this.x = 0;
        this.y = 0;
        this.z = 2 + Math.random() * 6;
        this.vx = Math.cos(angle) * horizontal;
        this.vy = Math.sin(angle) * horizontal;
        this.vz = (2.5 + Math.random() * 3.5) * lift;

        this.hue = hue + (Math.random() - 0.5) * 24;
        this.radius = 0.9 + Math.random() * 1.4;
        this.alpha = 1.0;
        this.decay = 0.018 + Math.random() * 0.022;
        this.trail = [];
    }

    get alive() {
        return this.alpha > 0;
    }

    update() {
        this.trail.push({ x: this.x, y: this.y, z: this.z });
        if (this.trail.length > MAX_TRAIL) {
            this.trail.shift();
        }

        this.x += this.vx;
        this.y += this.vy;
        this.z += this.vz;

        this.vx *= AIR_FRICTION;
        this.vy *= AIR_FRICTION;
        this.vz -= GRAVITY;

        if (this.z < 0) {
            this.z = 0;
            this.vz = -this.vz * BOUNCE_DAMPING;
            this.vx *= GROUND_FRICTION;
            this.vy *= GROUND_FRICTION;
        }

        this.alpha -= this.decay;
    }

    draw(ctx, originX, originY) {
        if (this.alpha <= 0) return;
        const head = project(originX, originY, this.x, this.y, this.z);

        if (this.trail.length > 1) {
            const tail = project(originX, originY, this.trail[0].x, this.trail[0].y, this.trail[0].z);
            const gradient = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
            gradient.addColorStop(0, `hsla(${this.hue}, 100%, 70%, 0)`);
            gradient.addColorStop(1, `hsla(${this.hue}, 100%, 85%, ${this.alpha * 0.8})`);
            ctx.strokeStyle = gradient;
            ctx.lineWidth = this.radius * head.scale * 1.4;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(tail.x, tail.y);
            ctx.lineTo(head.x, head.y);
            ctx.stroke();
        }

        drawGlowDot(ctx, head.x, head.y, this.radius * head.scale, this.hue, this.alpha);
    }
}
