import { log } from "./utils.js";

class Particle {
    constructor(x, y) {
        this.x = x;
        this.y = y;

        const angle = Math.random() * Math.PI * 2;
        const speed = 0.8 + Math.random() * 3.5;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed - (1.0 + Math.random() * 1.5);

        this.radius = 15 + Math.random() * 25;
        this.growth = 1.2 + Math.random() * 1.8;

        this.hue = 260 + Math.random() * 65;
        this.alpha = 0.8 + Math.random() * 0.2;
        this.decay = 0.008 + Math.random() * 0.006;

        this.friction = 0.94 + Math.random() * 0.02;
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;

        this.vx *= this.friction;
        this.vy *= this.friction;
        this.vy -= 0.05;

        this.radius += this.growth;
        this.alpha -= this.decay;
    }

    draw(ctx) {
        if (this.alpha <= 0 || this.radius <= 0) return;

        ctx.save();
        const gradient = ctx.createRadialGradient(
            this.x, this.y, this.radius * 0.05,
            this.x, this.y, this.radius
        );

        gradient.addColorStop(0, `hsla(${this.hue}, 95%, 68%, ${this.alpha})`);
        gradient.addColorStop(0.2, `hsla(${this.hue}, 85%, 58%, ${this.alpha * 0.7})`);
        gradient.addColorStop(0.6, `hsla(${this.hue}, 75%, 48%, ${this.alpha * 0.25})`);
        gradient.addColorStop(1, `hsla(${this.hue}, 65%, 40%, 0)`);

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

class Spark {
    constructor(x, y, hueOverride = null) {
        this.x = x;
        this.y = y;

        const angle = Math.random() * Math.PI * 2;
        const speed = 2.0 + Math.random() * 6.0;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed - 2.0;

        this.gravity = 0.18;
        this.alpha = 1.0;
        this.decay = 0.015 + Math.random() * 0.025;

        this.hue = hueOverride !== null ? hueOverride : (180 + Math.random() * 40);
        this.radius = 1.2 + Math.random() * 1.8;
        this.friction = 0.95;

        this.history = [];
        this.maxHistory = 4;
    }

    update() {
        this.history.push({ x: this.x, y: this.y });
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        }

        this.x += this.vx;
        this.y += this.vy;

        this.vx *= this.friction;
        this.vy *= this.friction;
        this.vy += this.gravity;

        this.alpha -= this.decay;
    }

    draw(ctx) {
        if (this.alpha <= 0) return;
        ctx.save();
        ctx.shadowBlur = 6;
        ctx.shadowColor = `hsla(${this.hue}, 100%, 75%, ${this.alpha})`;

        if (this.history.length > 1) {
            ctx.strokeStyle = `hsla(${this.hue}, 100%, 85%, ${this.alpha * 0.75})`;
            ctx.lineWidth = this.radius;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(this.history[0].x, this.history[0].y);
            for (let i = 1; i < this.history.length; i++) {
                ctx.lineTo(this.history[i].x, this.history[i].y);
            }
            ctx.stroke();
        } else {
            ctx.fillStyle = `hsla(${this.hue}, 100%, 90%, ${this.alpha})`;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
}

class PortalParticle {
    constructor(portalX, portalY, radius) {
        this.portalX = portalX;
        this.portalY = portalY;
        this.angle = Math.random() * Math.PI * 2;
        this.orbitRadius = radius * (0.85 + Math.random() * 0.3);

        this.baseAngularVelocity = 0.05 + Math.random() * 0.05;
        this.radialSpeed = 0.93 + Math.random() * 0.02;

        this.alpha = 0.9 + Math.random() * 0.1;
        this.decay = 0.015 + Math.random() * 0.015;
        this.radius = 1.0 + Math.random() * 1.8;

        this.hue = 185 + Math.random() * 95;

        this.x = this.portalX + Math.cos(this.angle) * this.orbitRadius;
        this.y = this.portalY + Math.sin(this.angle) * this.orbitRadius;
    }

    update() {
        const speedFactor = 1.8;
        const acceleration = (0.04 + this.baseAngularVelocity) / (this.orbitRadius * 0.045 + 0.12);
        this.angle += acceleration * speedFactor;

        this.orbitRadius *= this.radialSpeed;
        this.alpha -= this.decay;

        this.x = this.portalX + Math.cos(this.angle) * this.orbitRadius;
        this.y = this.portalY + Math.sin(this.angle) * this.orbitRadius;
    }

    draw(ctx) {
        if (this.alpha <= 0 || this.orbitRadius <= 2) return;
        ctx.save();
        ctx.shadowBlur = 5;
        ctx.shadowColor = `hsla(${this.hue}, 100%, 70%, ${this.alpha})`;
        ctx.fillStyle = `hsla(${this.hue}, 100%, 88%, ${this.alpha})`;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

class PortalVortex {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.radius = 0;
        this.currentRadius = 0;
        this.targetRadius = 48 + Math.random() * 12;

        this.rotation = 0;
        this.rotSpeed = 0.045 + Math.random() * 0.025;

        this.alpha = 1.0;
        this.phase = "grow";
        this.life = 0;

        this.hue1 = 185 + Math.random() * 20;
        this.hue2 = 265 + Math.random() * 30;
    }

    update() {
        this.life++;
        this.rotation += this.rotSpeed;

        if (this.phase === "grow") {
            this.radius += (this.targetRadius - this.radius) * 0.22;
            if (this.life > 10) {
                this.phase = "sustain";
            }
        } else if (this.phase === "sustain") {
            if (this.life > 34) {
                this.phase = "shrink";
            }
        } else if (this.phase === "shrink") {
            this.radius *= 0.78;
            this.alpha -= 0.11;
            if (this.radius < 1 || this.alpha <= 0) {
                this.phase = "done";
            }
        }

        const pulse = 1.0 + Math.sin(this.life * 0.45) * 0.035;
        this.currentRadius = this.radius * pulse;
    }

    draw(ctx) {
        if (this.alpha <= 0 || this.currentRadius <= 0) return;

        ctx.save();

        ctx.shadowBlur = 20;
        ctx.shadowColor = `hsla(${this.hue1}, 100%, 60%, ${this.alpha * 0.8})`;

        ctx.strokeStyle = `hsla(${this.hue2}, 100%, 65%, ${this.alpha})`;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.currentRadius, 0, Math.PI * 2);
        ctx.stroke();

        ctx.shadowBlur = 8;
        ctx.strokeStyle = `hsla(${this.hue1}, 100%, 75%, ${this.alpha * 0.85})`;
        ctx.lineWidth = 2.0;
        ctx.lineCap = "round";

        const numSpirals = 4;
        for (let s = 0; s < numSpirals; s++) {
            const startAngle = (s * Math.PI * 2 / numSpirals) + this.rotation;
            ctx.beginPath();

            const steps = 25;
            const startR = this.currentRadius * 0.12;
            const endR = this.currentRadius * 0.90;

            for (let j = 0; j <= steps; j++) {
                const progress = j / steps;
                const angle = startAngle + progress * Math.PI * 2.1;
                const r = startR + (endR - startR) * progress;

                const sx = this.x + Math.cos(angle) * r;
                const sy = this.y + Math.sin(angle) * r;

                if (j === 0) {
                    ctx.moveTo(sx, sy);
                } else {
                    ctx.lineTo(sx, sy);
                }
            }
            ctx.stroke();
        }

        ctx.fillStyle = `rgba(10, 5, 22, ${this.alpha * 0.98})`;
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.currentRadius * 0.55, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

class LightningStrike {
    constructor(targetX, targetY) {
        this.targetX = targetX;
        this.targetY = targetY;

        this.startX = targetX + (Math.random() - 0.5) * 120;
        this.startY = 0;

        this.segments = [];
        this.branches = [];
        this.alpha = 1.0;
        this.decay = 0.06 + Math.random() * 0.04;
        this.width = 2.5 + Math.random() * 1.5;
        this.life = 0;

        this.generatePath();
    }

    generatePath() {
        let curX = this.startX;
        let curY = this.startY;
        const steps = 14;
        const stepHeight = this.targetY / steps;

        for (let i = 1; i <= steps; i++) {
            const progress = i / steps;
            const targetXAtY = this.startX + (this.targetX - this.startX) * progress;
            const jitter = (1 - progress) * 45 * (Math.random() - 0.5);
            const nextX = targetXAtY + jitter;
            const nextY = curY + stepHeight;

            this.segments.push({ x1: curX, y1: curY, x2: nextX, y2: nextY });

            if (i > 3 && i < 11 && Math.random() < 0.35) {
                this.generateBranch(nextX, nextY, stepHeight);
            }

            curX = nextX;
            curY = nextY;
        }
    }

    generateBranch(startX, startY, stepHeight) {
        let curX = startX;
        let curY = startY;
        const branchSteps = 3 + Math.floor(Math.random() * 3);

        for (let j = 0; j < branchSteps; j++) {
            const nextX = curX + (Math.random() - 0.5) * 55 + (Math.random() < 0.5 ? -15 : 15);
            const nextY = curY + stepHeight * 0.7;
            this.branches.push({ x1: curX, y1: curY, x2: nextX, y2: nextY });
            curX = nextX;
            curY = nextY;
        }
    }

    update() {
        this.life++;
        if (this.life < 7) {
            this.alpha = Math.random() < 0.4 ? 0.15 : 1.0;
        } else {
            this.alpha -= this.decay * 1.4;
        }
    }

    draw(ctx) {
        if (this.alpha <= 0) return;

        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        ctx.shadowBlur = 12;
        ctx.shadowColor = `rgba(0, 180, 255, ${this.alpha * 0.85})`;
        ctx.strokeStyle = `rgba(0, 150, 255, ${this.alpha * 0.4})`;

        ctx.lineWidth = this.width * 2.5;
        ctx.beginPath();
        for (const seg of this.segments) {
            ctx.moveTo(seg.x1, seg.y1);
            ctx.lineTo(seg.x2, seg.y2);
        }
        ctx.stroke();

        ctx.lineWidth = this.width * 1.5;
        ctx.beginPath();
        for (const seg of this.branches) {
            ctx.moveTo(seg.x1, seg.y1);
            ctx.lineTo(seg.x2, seg.y2);
        }
        ctx.stroke();

        ctx.shadowBlur = 4;
        ctx.shadowColor = "rgba(255, 255, 255, 1)";
        ctx.strokeStyle = `rgba(255, 255, 255, ${this.alpha})`;

        ctx.lineWidth = this.width;
        ctx.beginPath();
        for (const seg of this.segments) {
            ctx.moveTo(seg.x1, seg.y1);
            ctx.lineTo(seg.x2, seg.y2);
        }
        ctx.stroke();

        ctx.lineWidth = this.width * 0.65;
        ctx.beginPath();
        for (const seg of this.branches) {
            ctx.moveTo(seg.x1, seg.y1);
            ctx.lineTo(seg.x2, seg.y2);
        }
        ctx.stroke();

        ctx.restore();
    }
}

export class ParticleManager {
    static canvas = null;
    static ctx = null;
    static particles = [];
    static lightningStrikes = [];
    static portalVortices = [];
    static flashAlpha = 0;
    static animationId = null;

    static initialize() {
        if (this.canvas) return;

        log("Initializing ParticleManager overlay canvas in viewport-fixed mode.");
        const overlay = document.createElement("canvas");
        overlay.id = "natural-roll-particle-overlay";

        overlay.style.position = "fixed";
        overlay.style.top = "0";
        overlay.style.left = "0";
        overlay.style.width = "100vw";
        overlay.style.height = "100vh";
        overlay.style.pointerEvents = "none";
        overlay.style.zIndex = "999999";

        document.body.appendChild(overlay);

        this.canvas = overlay;
        this.ctx = overlay.getContext("2d");
        this.resizeCanvas();

        window.addEventListener("resize", () => this.resizeCanvas());
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
        if (style === "lightning") {
            this.spawnLightningStrike(x, y);
        } else if (style === "portal") {
            this.spawnPortal(x, y);
        } else {
            this.spawnSmokePuff(x, y);
        }
    }

    static spawnSmokePuff(x, y) {
        log(`Spawning magical smoke puff at absolute screen coordinates (${x}, ${y})`);

        const count = 25 + Math.floor(Math.random() * 11);
        for (let i = 0; i < count; i++) {
            const offsetX = (Math.random() - 0.5) * 15;
            const offsetY = (Math.random() - 0.5) * 15;
            this.particles.push(new Particle(x + offsetX, y + offsetY));
        }

        const sparkCount = 10 + Math.floor(Math.random() * 6);
        for (let i = 0; i < sparkCount; i++) {
            const hue = 260 + Math.random() * 65;
            this.particles.push(new Spark(x, y, hue));
        }

        this.startLoop();
    }

    static spawnLightningStrike(x, y) {
        log(`Spawning lightning strike at target coordinates (${x}, ${y})`);

        this.lightningStrikes.push(new LightningStrike(x, y));

        this.flashAlpha = 0.16;

        const sparkCount = 22 + Math.floor(Math.random() * 8);
        for (let i = 0; i < sparkCount; i++) {
            this.particles.push(new Spark(x, y));
        }

        this.startLoop();
    }

    static spawnPortal(x, y) {
        log(`Spawning dimensional portal at target coordinates (${x}, ${y})`);

        const vortex = new PortalVortex(x, y);
        this.portalVortices.push(vortex);

        const count = 12 + Math.floor(Math.random() * 8);
        for (let i = 0; i < count; i++) {
            this.particles.push(new PortalParticle(x, y, vortex.targetRadius));
        }

        this.startLoop();
    }

    static startLoop() {
        if (this.animationId !== null) return;

        const loop = () => {
            this.update();
            this.draw();

            if (this.particles.length > 0 || this.lightningStrikes.length > 0 || this.portalVortices.length > 0 || this.flashAlpha > 0) {
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

        for (let i = this.portalVortices.length - 1; i >= 0; i--) {
            const vortex = this.portalVortices[i];
            vortex.update();
            if (vortex.phase === "done") {
                this.portalVortices.splice(i, 1);
            } else if (vortex.phase === "sustain" && Math.random() < 0.32) {
                this.particles.push(new PortalParticle(vortex.x, vortex.y, vortex.radius));
            }
        }

        for (let i = this.lightningStrikes.length - 1; i >= 0; i--) {
            const strike = this.lightningStrikes[i];
            strike.update();
            if (strike.alpha <= 0) {
                this.lightningStrikes.splice(i, 1);
            }
        }

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.update();
            if (p.alpha <= 0) {
                this.particles.splice(i, 1);
            }
        }
    }

    static draw() {
        if (!this.ctx || !this.canvas) return;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        if (this.flashAlpha > 0) {
            this.ctx.fillStyle = `rgba(225, 240, 255, ${this.flashAlpha})`;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        for (const vortex of this.portalVortices) {
            vortex.draw(this.ctx);
        }

        for (const strike of this.lightningStrikes) {
            strike.draw(this.ctx);
        }

        for (const p of this.particles) {
            p.draw(this.ctx);
        }
    }

    static clear() {
        if (this.ctx && this.canvas) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }
}

