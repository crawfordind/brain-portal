"use client";

import { useEffect, useRef, useCallback, useState } from "react";

/**
 * Searchlight - An ambient animated light effect for the stream header.
 *
 * Uses canvas for GPU-accelerated rendering. The searchlight drifts lazily
 * in the top-left area, and reacts to scroll/typing/touch with bursts of movement.
 * Renders at reduced frame rate when idle to save battery.
 * Auto-sizes to container width on mobile.
 */

// Easing helper
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

// Clamp helper
function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function Searchlight() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 320, height: 180 });

  const stateRef = useRef({
    // Primary beam position & target
    x: 60,
    y: 40,
    targetX: 60,
    targetY: 40,
    // Secondary ambient orb
    orbX: 140,
    orbY: 70,
    orbTargetX: 140,
    orbTargetY: 70,
    // Beam properties
    beamAngle: -0.4,
    beamTargetAngle: -0.4,
    beamWidth: 50,
    beamIntensity: 1.0,
    // Interaction energy (0-1, decays over time)
    energy: 0,
    // Scroll velocity for directional response
    scrollVel: 0,
    // Keystroke burst counter
    burstCount: 0,
    burstDecay: 0,
    // Time tracking
    time: 0,
    lastFrame: 0,
    // Idle detection
    idleFrames: 0,
    isIdle: false,
    // Touch tracking
    lastTouchY: 0,
  });

  // Measure container width on mount and resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const w = container.offsetWidth;
      // On mobile (< 640px), use full container width; desktop caps at 320
      const width = Math.min(w, 400);
      const height = width < 300 ? 120 : 180;
      setDimensions({ width, height });
    };

    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Pick new drift targets for the ambient wander
  const pickNewTargets = useCallback(() => {
    const s = stateRef.current;
    const { width, height } = dimensions;
    const scale = width / 320;
    // Keep beam in top-left quadrant with some wander, scaled to canvas
    s.targetX = (30 + Math.random() * 100) * scale;
    s.targetY = (20 + Math.random() * 80) * (height / 180);
    s.beamTargetAngle = -0.6 + Math.random() * 0.5;
    // Secondary orb wanders wider
    s.orbTargetX = (80 + Math.random() * 160) * scale;
    s.orbTargetY = (30 + Math.random() * 100) * (height / 180);
  }, [dimensions]);

  // Handle scroll events
  const handleScroll = useCallback(() => {
    const s = stateRef.current;
    s.energy = clamp(s.energy + 0.3, 0, 1);
    s.scrollVel = 1;
    s.idleFrames = 0;
    s.isIdle = false;
    s.targetX = clamp(s.targetX + (Math.random() - 0.5) * 40, 20, dimensions.width * 0.5);
    s.targetY = clamp(s.targetY + (Math.random() - 0.3) * 30, 10, dimensions.height * 0.6);
  }, [dimensions]);

  // Handle keydown events
  const handleKeydown = useCallback(() => {
    const s = stateRef.current;
    s.burstCount = Math.min(s.burstCount + 1, 8);
    s.energy = clamp(s.energy + 0.15, 0, 1);
    s.idleFrames = 0;
    s.isIdle = false;
    s.beamTargetAngle += (Math.random() - 0.5) * 0.15;
    s.beamTargetAngle = clamp(s.beamTargetAngle, -0.9, 0.1);
  }, []);

  // Handle touch events for mobile
  const handleTouchStart = useCallback((e: TouchEvent) => {
    const s = stateRef.current;
    if (e.touches.length > 0) {
      s.lastTouchY = e.touches[0].clientY;
    }
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    const s = stateRef.current;
    if (e.touches.length > 0) {
      const touchY = e.touches[0].clientY;
      const delta = Math.abs(touchY - s.lastTouchY);
      s.lastTouchY = touchY;

      if (delta > 2) {
        s.energy = clamp(s.energy + 0.2, 0, 1);
        s.scrollVel = 1;
        s.idleFrames = 0;
        s.isIdle = false;
        s.targetX = clamp(s.targetX + (Math.random() - 0.5) * 30, 20, dimensions.width * 0.5);
        s.targetY = clamp(s.targetY + (Math.random() - 0.3) * 20, 10, dimensions.height * 0.6);
      }
    }
  }, [dimensions]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const { width, height } = dimensions;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    // Set up high-DPI canvas
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    let animId: number;
    const s = stateRef.current;

    // Reset positions scaled to new dimensions
    const scale = width / 320;
    s.x = 60 * scale;
    s.y = 40 * (height / 180);
    s.orbX = 140 * scale;
    s.orbY = 70 * (height / 180);

    pickNewTargets();
    const wanderTimer = setInterval(pickNewTargets, 3000 + Math.random() * 2000);

    const draw = (timestamp: number) => {
      if (!s.lastFrame) s.lastFrame = timestamp;
      const dt = Math.min((timestamp - s.lastFrame) / 1000, 0.1);
      s.lastFrame = timestamp;
      s.time += dt;

      // Idle detection - reduce frame rate when idle
      s.idleFrames++;
      if (s.idleFrames > 120) s.isIdle = true;
      if (s.isIdle && s.idleFrames % 3 !== 0) {
        animId = requestAnimationFrame(draw);
        return;
      }

      // Decay energy and scroll velocity
      s.energy *= 0.97;
      s.scrollVel *= 0.92;
      s.burstDecay = lerp(s.burstDecay, s.burstCount, 0.1);
      s.burstCount *= 0.95;
      if (s.burstCount < 0.01) s.burstCount = 0;

      // Smooth movement toward targets
      const moveSpeed = 0.02 + s.energy * 0.06;
      s.x = lerp(s.x, s.targetX, moveSpeed);
      s.y = lerp(s.y, s.targetY, moveSpeed);
      s.orbX = lerp(s.orbX, s.orbTargetX, 0.015);
      s.orbY = lerp(s.orbY, s.orbTargetY, 0.015);
      s.beamAngle = lerp(s.beamAngle, s.beamTargetAngle, 0.03);

      // Add subtle sine wave oscillation (scaled)
      const waveScale = scale;
      const waveX = Math.sin(s.time * 0.7) * 8 * waveScale;
      const waveY = Math.cos(s.time * 0.5) * 5 * (height / 180);
      const orbWaveX = Math.sin(s.time * 0.4 + 1) * 12 * waveScale;
      const orbWaveY = Math.cos(s.time * 0.3 + 2) * 8 * (height / 180);

      // Dynamic beam width based on energy
      const dynamicWidth = 50 + s.energy * 30 + s.burstDecay * 5;
      s.beamWidth = lerp(s.beamWidth, dynamicWidth, 0.05);

      // Clear canvas
      ctx.clearRect(0, 0, width, height);

      const cx = s.x + waveX;
      const cy = s.y + waveY;

      // === Primary searchlight beam (cone from source) ===
      const beamLen = (160 + s.energy * 60) * scale;

      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, beamLen);
      const baseAlpha = 0.06 + s.energy * 0.08;
      grad.addColorStop(0, `rgba(100, 220, 180, ${baseAlpha + 0.06})`);
      grad.addColorStop(0.3, `rgba(100, 220, 180, ${baseAlpha})`);
      grad.addColorStop(0.7, `rgba(100, 220, 180, ${baseAlpha * 0.4})`);
      grad.addColorStop(1, "rgba(100, 220, 180, 0)");

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.beginPath();
      const halfAngle = (s.beamWidth * Math.PI) / 180;
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, beamLen, s.beamAngle - halfAngle, s.beamAngle + halfAngle);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();

      // === Secondary ambient orb ===
      const orbCx = s.orbX + orbWaveX;
      const orbCy = s.orbY + orbWaveY;
      const orbRadius = (80 + s.energy * 30) * scale;
      const orbGrad = ctx.createRadialGradient(
        orbCx, orbCy, 0,
        orbCx, orbCy, orbRadius
      );
      const orbAlpha = 0.04 + s.energy * 0.04;
      orbGrad.addColorStop(0, `rgba(80, 180, 255, ${orbAlpha})`);
      orbGrad.addColorStop(0.5, `rgba(80, 180, 255, ${orbAlpha * 0.5})`);
      orbGrad.addColorStop(1, "rgba(80, 180, 255, 0)");

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.beginPath();
      ctx.arc(orbCx, orbCy, orbRadius, 0, Math.PI * 2);
      ctx.fillStyle = orbGrad;
      ctx.fill();
      ctx.restore();

      // === Typing burst particles ===
      if (s.burstDecay > 0.5) {
        const particleCount = Math.floor(s.burstDecay);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < particleCount; i++) {
          const angle = (i / particleCount) * Math.PI * 2 + s.time * 2;
          const dist = (15 + Math.sin(s.time * 3 + i) * 10 + s.burstDecay * 4) * scale;
          const px = cx + Math.cos(angle) * dist;
          const py = cy + Math.sin(angle) * dist;
          const pAlpha = 0.04 + s.burstDecay * 0.02;
          const pRadius = (3 + s.burstDecay) * scale;

          const pGrad = ctx.createRadialGradient(px, py, 0, px, py, pRadius);
          pGrad.addColorStop(0, `rgba(160, 240, 220, ${pAlpha})`);
          pGrad.addColorStop(1, "rgba(160, 240, 220, 0)");
          ctx.beginPath();
          ctx.arc(px, py, pRadius, 0, Math.PI * 2);
          ctx.fillStyle = pGrad;
          ctx.fill();
        }
        ctx.restore();
      }

      // === Soft glow at source point ===
      const glowRadius = (25 + s.energy * 15 + Math.sin(s.time * 1.5) * 3) * scale;
      const glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
      const glowAlpha = 0.08 + s.energy * 0.06;
      glowGrad.addColorStop(0, `rgba(120, 240, 200, ${glowAlpha})`);
      glowGrad.addColorStop(0.6, `rgba(120, 240, 200, ${glowAlpha * 0.3})`);
      glowGrad.addColorStop(1, "rgba(120, 240, 200, 0)");

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.beginPath();
      ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
      ctx.fillStyle = glowGrad;
      ctx.fill();
      ctx.restore();

      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);

    // Attach event listeners (passive for performance)
    window.addEventListener("scroll", handleScroll, { passive: true });
    document.addEventListener("keydown", handleKeydown, { passive: true });
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });

    // Also listen for scroll on the main content area
    const mainEl = document.querySelector("main");
    if (mainEl) {
      mainEl.addEventListener("scroll", handleScroll, { passive: true });
      mainEl.addEventListener("touchmove", handleTouchMove, { passive: true });
    }

    return () => {
      cancelAnimationFrame(animId);
      clearInterval(wanderTimer);
      window.removeEventListener("scroll", handleScroll);
      document.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      if (mainEl) {
        mainEl.removeEventListener("scroll", handleScroll);
        mainEl.removeEventListener("touchmove", handleTouchMove);
      }
    };
  }, [dimensions, pickNewTargets, handleScroll, handleKeydown, handleTouchStart, handleTouchMove]);

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0 overflow-hidden -z-0">
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{
          width: `${dimensions.width}px`,
          height: `${dimensions.height}px`,
          mixBlendMode: "screen",
        }}
      />
    </div>
  );
}
