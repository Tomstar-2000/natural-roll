export const VIEW_ELEVATION = 0.62;
export const SIN_E = Math.sin(VIEW_ELEVATION);
export const COS_E = Math.cos(VIEW_ELEVATION);
const FOCAL_LENGTH = 520;
const MAX_DEPTH = FOCAL_LENGTH * 0.8;

export function project(originX, originY, x, y, z) {
    const depth = Math.min(z * SIN_E - y * COS_E, MAX_DEPTH);
    const scale = FOCAL_LENGTH / (FOCAL_LENGTH - depth);
    return {
        x: originX + x * scale,
        y: originY - (y * SIN_E + z * COS_E) * scale,
        scale,
        depth
    };
}

export function traceGroundCircle(ctx, originX, originY, radius, z = 0, segments = 48) {
    ctx.beginPath();
    for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const p = project(originX, originY, Math.cos(angle) * radius, Math.sin(angle) * radius, z);
        if (i === 0) {
            ctx.moveTo(p.x, p.y);
        } else {
            ctx.lineTo(p.x, p.y);
        }
    }
    ctx.closePath();
}

export function drawGroundGlow(ctx, originX, originY, radius, color, alpha) {
    if (alpha <= 0 || radius <= 0) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.translate(originX, originY);
    ctx.scale(1, SIN_E);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    gradient.addColorStop(0, `hsla(${color.h}, ${color.s}%, ${color.l}%, ${alpha})`);
    gradient.addColorStop(0.4, `hsla(${color.h}, ${color.s}%, ${color.l * 0.8}%, ${alpha * 0.45})`);
    gradient.addColorStop(1, `hsla(${color.h}, ${color.s}%, ${color.l * 0.6}%, 0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

export function drawGroundShadow(ctx, originX, originY, radius, alpha) {
    if (alpha <= 0 || radius <= 0) return;
    ctx.save();
    ctx.translate(originX, originY);
    ctx.scale(1, SIN_E);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    gradient.addColorStop(0, `rgba(4, 0, 12, ${alpha})`);
    gradient.addColorStop(1, "rgba(4, 0, 12, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

export function drawGroundRing(ctx, originX, originY, radius, width, color, alpha) {
    if (alpha <= 0 || radius <= 0) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    traceGroundCircle(ctx, originX, originY, radius);
    ctx.strokeStyle = `hsla(${color.h}, ${color.s}%, ${color.l}%, ${alpha * 0.35})`;
    ctx.lineWidth = width * 2.6;
    ctx.stroke();
    ctx.strokeStyle = `hsla(${color.h}, ${color.s}%, ${Math.min(95, color.l + 20)}%, ${alpha})`;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.restore();
}

export function drawGlowDot(ctx, x, y, radius, hue, alpha) {
    if (alpha <= 0 || radius <= 0) return;
    ctx.fillStyle = `hsla(${hue}, 100%, 62%, ${alpha * 0.22})`;
    ctx.beginPath();
    ctx.arc(x, y, radius * 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `hsla(${hue}, 100%, 90%, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
}
