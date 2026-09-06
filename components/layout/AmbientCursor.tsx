"use client";

import { useEffect, useRef } from "react";

// A short light wake that fades away when the native pointer stops.
export function AmbientCursor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = window.matchMedia("(pointer: fine)");
    let points: Array<{ x: number; y: number; born: number }> = [];
    let frame = 0;
    let width = 0;
    let height = 0;

    const clear = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      points = [];
      context.clearRect(0, 0, width, height);
    };
    const resize = () => {
      clear();
      width = window.innerWidth;
      height = window.innerHeight;
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * scale;
      canvas.height = height * scale;
      context.setTransform(scale, 0, 0, scale, 0, 0);
    };
    const render = (now: number) => {
      points = points.filter((point) => now - point.born < 420);
      context.clearRect(0, 0, width, height);
      context.lineCap = "round";
      for (let i = 1; i < points.length; i += 1) {
        const alpha = Math.max(0, 1 - (now - points[i].born) / 420);
        context.beginPath();
        context.moveTo(points[i - 1].x, points[i - 1].y);
        context.lineTo(points[i].x, points[i].y);
        context.strokeStyle = `rgba(133, 221, 224, ${alpha * 0.48})`;
        context.lineWidth = alpha * 1.6;
        context.shadowColor = "rgba(123, 141, 255, 0.5)";
        context.shadowBlur = 9;
        context.stroke();
      }
      frame = points.length ? requestAnimationFrame(render) : 0;
    };
    const move = (event: PointerEvent) => {
      if (motion.matches || !pointer.matches || event.pointerType === "touch") return;
      points.push({ x: event.clientX, y: event.clientY, born: performance.now() });
      if (points.length > 36) points.shift();
      if (!frame) frame = requestAnimationFrame(render);
    };
    resize();
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("resize", resize);
    window.addEventListener("blur", clear);
    document.documentElement.addEventListener("pointerleave", clear);
    motion.addEventListener("change", clear);
    pointer.addEventListener("change", clear);
    return () => {
      clear();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("resize", resize);
      window.removeEventListener("blur", clear);
      document.documentElement.removeEventListener("pointerleave", clear);
      motion.removeEventListener("change", clear);
      pointer.removeEventListener("change", clear);
    };
  }, []);

  return <canvas ref={canvasRef} className="pointer-fx" aria-hidden="true" />;
}
