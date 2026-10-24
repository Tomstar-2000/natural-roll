import { project, drawGroundGlow, drawGroundShadow, drawGroundRing, drawGlowDot } from "./Projection.js";
import { Spark3D } from "./Spark3D.js";

const BOLT_STEPS = 16;
const FLICKER_FRAMES = 8;
const IMPACT_COLOR = { h: 200, s: 100, l: 70 };
const RING_COLOR = { h: 195, s: 100, l: 68 };
const SPARK_HUE = 195;

function buildBolt(startX, startY, endX, endY) {
    const points = [{ x: startX, y: startY }];
    const branches = [];

    for (let i = 1; i <= BOLT_STEPS; i++) {
        const progress = i / BOLT_STEPS;
        const jitter = i === BOLT_STEPS ? 0 : (1 - progress * 0.7) * 42 * (Math.random() - 0.5);
        const point = {
            x: startX + (endX - startX) * progress + jitter,
            y: startY + (endY - startY) * progress
        };
        points.push(point);

        if (i > 3 && i < BOLT_STEPS - 3 && Math.random() < 0.32) {
            branches.push(buildBranch(point, (endY - startY) / BOLT_STEPS, progress));
        }
    }
    return { points, branches };
}

function buildBranch(origin, stepHeight, progress) {
    const points = [origin];
    const direction = Math.random() < 0.5 ? -1 : 1;
    const length = 3 + Math.floor(Math.random() * 3);
    let current = origin;
    for (let j = 0; j < length; j++) {
        current = {
            x: current.x + direction * (10 + Math.random() * 22) + (Math.random() - 0.5) * 18,
            y: current.y + stepHeight * (0.5 + Math.random() * 0.4)
        };
        points.push(current);
    }
    return { points, progress };
}

function strokeTapered(ctx, points, baseWidth, startProgress, endProgress) {
    for (let i = 1; i < points.length; i++) {
        const t = startProgress + (endProgress - startProgress) * (i / (points.length - 1));
        ctx.lineWidth = baseWidth * (0.35 + t * 0.9);
        ctx.beginPath();
        ctx.moveTo(points[i - 1].x, points[i - 1].y);
        ctx.lineTo(points[i].x, points[i].y);
        ctx.stroke();
    }
}

export class LightningEffect {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.life = 0;
        this.alpha = 1.0;
        this.boltAlpha = 1.0;
        this.width = 2.6 + Math.random() * 1.4;

        const startX = x + (Math.random() - 0.5) * 140;
        this.bolt = buildBolt(startX, 0, x, y);

        const sparkCount = 24 + Math.floor(Math.random() * 10);
        this.sparks = Array.from({ length: sparkCount }, () => new Spark3D(SPARK_HUE, { speed: 1.3, lift: 1.25 }));
    }

    get alive() {
        return this.alpha > 0 || this.sparks.length > 0;
    }

    update() {
        this.life++;
        if (this.life < FLICKER_FRAMES) {
            this.boltAlpha = Math.random() < 0.35 ? 0.2 : 1.0;
        } else {
            this.boltAlpha = Math.max(0, this.boltAlpha - 0.11);
        }
        this.alpha = Math.max(0, 1 - this.life / 70);

        for (const spark of this.sparks) spark.update();
        this.sparks = this.sparks.filter(s => s.alive);
    }

    drawBolt(ctx) {
        const a = this.boltAlpha;
        if (a <= 0) return;

        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        const passes = [
            { color: `rgba(40, 120, 255, ${a * 0.18})`, width: this.width * 7 },
            { color: `rgba(80, 180, 255, ${a * 0.45})`, width: this.width * 2.6 },
            { color: `rgba(255, 255, 255, ${a})`, width: this.width }
        ];

        for (const pass of passes) {
            ctx.strokeStyle = pass.color;
            strokeTapered(ctx, this.bolt.points, pass.width, 0, 1);
            for (const branch of this.bolt.branches) {
                strokeTapered(ctx, branch.points, pass.width * 0.55, branch.progress, branch.progress * 0.6);
            }
        }
    }

    draw(ctx) {
        const impact = Math.max(0, 1 - this.life / 22);
        const ringProgress = Math.min(1, this.life / 24);

        drawGroundShadow(ctx, this.x, this.y, 34, 0.45 * this.alpha);
        drawGroundGlow(ctx, this.x, this.y, 110, IMPACT_COLOR, 0.7 * impact);
        drawGroundRing(ctx, this.x, this.y, 8 + ringProgress * 85, 3 * (1 - ringProgress) + 0.5, RING_COLOR, 0.9 * (1 - ringProgress));

        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        this.drawBolt(ctx);

        if (impact > 0) {
            const bloom = project(this.x, this.y, 0, 0, 6);
            drawGlowDot(ctx, bloom.x, bloom.y, 7 * impact * bloom.scale, 200, impact * this.boltAlpha);
        }

        for (const spark of this.sparks) spark.draw(ctx, this.x, this.y);
        ctx.restore();
    }
}
