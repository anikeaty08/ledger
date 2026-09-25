"use client";

import { useEffect, useRef } from "react";

interface Twinkle {
  x: number;
  y: number;
  age: number;
  duration: number;
  size: number;
}

const GRID_SPACING = 42;
const CURSOR_RADIUS = 170;
const MAX_TWINKLES = 24;

/** Dot grid that drifts gently, parts around the cursor and throws off small sparkles. Decorative only:
 *  hidden from assistive tech, paused offscreen, and a single still frame under reduced motion. */
export function HeroTwinkle() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const cursor = { x: -1000, y: -1000, active: false };
    const twinkles: Twinkle[] = [];
    let width = 0;
    let height = 0;
    let frame = 0;
    let running = false;
    let previousTime = performance.now();
    let lastTrailAt = 0;

    const colors = () =>
      document.documentElement.dataset.theme === "light"
        ? { dot: "38, 99, 158", accent: "0, 82, 255", spark: "0, 82, 255" }
        : { dot: "135, 145, 158", accent: "45, 156, 255", spark: "255, 255, 255" };

    const addTwinkle = (x: number, y: number, size = 1) => {
      if (twinkles.length >= MAX_TWINKLES) twinkles.shift();
      twinkles.push({ x, y, age: 0, duration: 520 + Math.random() * 440, size: size * (0.8 + Math.random() * 1.2) });
    };

    const draw = (time: number) => {
      const elapsed = Math.min(time - previousTime, 40);
      previousTime = time;
      const c = colors();
      context.clearRect(0, 0, width, height);

      const still = reducedMotion.matches;
      const drift = still ? 0 : time * 0.00055;
      for (let y = GRID_SPACING / 2; y < height; y += GRID_SPACING) {
        for (let x = GRID_SPACING / 2; x < width; x += GRID_SPACING) {
          const wave = Math.sin(x * 0.018 + y * 0.012 + drift) * 1.4;
          const dx = x - cursor.x;
          const dy = y - cursor.y;
          const distance = Math.hypot(dx, dy) || 1;
          const influence = cursor.active && !still ? Math.max(0, 1 - distance / CURSOR_RADIUS) : 0;
          const push = influence * influence * 10;
          context.fillStyle = `rgba(${influence > 0.16 ? c.accent : c.dot}, ${0.1 + influence * 0.58})`;
          context.beginPath();
          context.arc(x + (dx / distance) * push, y + wave + (dy / distance) * push, 0.8 + influence * 1.45, 0, Math.PI * 2);
          context.fill();
        }
      }

      if (!still && Math.random() < 0.018) addTwinkle(Math.random() * width, Math.random() * height, 0.75);

      for (let i = twinkles.length - 1; i >= 0; i -= 1) {
        const t = twinkles[i]!;
        t.age += elapsed;
        if (t.age >= t.duration || still) {
          twinkles.splice(i, 1);
          continue;
        }
        const progress = t.age / t.duration;
        const alpha = Math.sin(progress * Math.PI) * 0.8;
        const r = t.size * (2.2 + progress * 3.6);
        context.strokeStyle = `rgba(${c.accent}, ${alpha})`;
        context.lineWidth = 0.8;
        context.beginPath();
        context.moveTo(t.x - r, t.y);
        context.lineTo(t.x + r, t.y);
        context.moveTo(t.x, t.y - r);
        context.lineTo(t.x, t.y + r);
        context.stroke();
        context.fillStyle = `rgba(${c.spark}, ${alpha})`;
        context.beginPath();
        context.arc(t.x, t.y, Math.max(0.7, t.size), 0, Math.PI * 2);
        context.fill();
      }

      frame = running && !still ? requestAnimationFrame(draw) : 0;
    };

    const start = () => {
      if (running) return;
      running = true;
      previousTime = performance.now();
      frame = requestAnimationFrame(draw);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(frame);
    };

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (!running || reducedMotion.matches) draw(performance.now());
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!finePointer.matches) return;
      const bounds = canvas.getBoundingClientRect();
      cursor.x = event.clientX - bounds.left;
      cursor.y = event.clientY - bounds.top;
      cursor.active = cursor.x >= 0 && cursor.x <= width && cursor.y >= 0 && cursor.y <= height;
      if (cursor.active && event.timeStamp - lastTrailAt > 42) {
        addTwinkle(cursor.x, cursor.y, 1.35);
        lastTrailAt = event.timeStamp;
      }
    };
    const onPointerLeave = () => {
      cursor.active = false;
    };
    // Redraw the still frame when the theme flips under reduced motion.
    const themeObserver = new MutationObserver(() => {
      if (reducedMotion.matches) draw(performance.now());
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const visibility = new IntersectionObserver(([entry]) => (entry?.isIntersecting ? start() : stop()));
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    visibility.observe(canvas);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("blur", onPointerLeave);
    document.addEventListener("pointerleave", onPointerLeave);
    resize();

    return () => {
      stop();
      themeObserver.disconnect();
      visibility.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("blur", onPointerLeave);
      document.removeEventListener("pointerleave", onPointerLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full opacity-75 [mask-image:linear-gradient(to_bottom,black,transparent_92%)]"
    />
  );
}
