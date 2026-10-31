"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export type StarfieldHandle = { warp: () => void; calm: () => void };
type Star = { x: number; y: number; z: number; pz: number; lime: boolean };

const Starfield = forwardRef<StarfieldHandle>(function Starfield(_, ref) {
  const cv = useRef<HTMLCanvasElement>(null);
  const speed = useRef({ v: 0.25, target: 0.25 });

  useImperativeHandle(ref, () => ({
    warp: () => { speed.current.target = 22; },
    calm: () => { speed.current.target = 0.25; },
  }), []);

  useEffect(() => {
    const c = cv.current!;
    const ctx = c.getContext("2d")!;
    const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let w = 0, h = 0, raf = 0, mx = 0, my = 0;
    let stars: Star[] = [];

    const reset = (s: Star, far = true) => {
      s.x = (Math.random() - 0.5) * w * 2;
      s.y = (Math.random() - 0.5) * h * 2;
      s.z = far ? w : Math.random() * w;
      s.pz = s.z;
      s.lime = Math.random() < 0.08;
    };
    const resize = () => {
      w = c.clientWidth; h = c.clientHeight;
      c.width = w * dpr; c.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round";
      const n = Math.min(700, Math.floor((w * h) / 2600));
      stars = Array.from({ length: n }, () => { const s = {} as Star; reset(s, false); return s; });
    };
    const onMove = (e: PointerEvent) => { mx = e.clientX / w - 0.5; my = e.clientY / h - 0.5; };

    const frame = () => {
      const sp = speed.current;
      sp.v += (sp.target - sp.v) * 0.06;
      ctx.fillStyle = sp.v > 2 ? "rgba(5,6,10,.35)" : "#05060a";
      ctx.fillRect(0, 0, w, h);
      const cx = w / 2 - mx * 40, cy = h / 2 - my * 40;

      for (const s of stars) {
        s.pz = s.z;
        s.z -= sp.v * (RM ? 0 : 4);
        if (s.z < 1) { reset(s); continue; }
        const k = w / 2 / s.z, x = s.x * k + cx, y = s.y * k + cy;
        if (x < 0 || x > w || y < 0 || y > h) { reset(s); continue; }
        const pk = w / 2 / s.pz, px = s.x * pk + cx, py = s.y * pk + cy;
        ctx.strokeStyle = s.lime ? "rgba(196,255,46,.9)" : `rgba(255,255,255,${Math.min(1, 1.2 - s.z / w)})`;
        ctx.lineWidth = Math.max(0.4, (1 - s.z / w) * 2.4);
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
      }
      raf = requestAnimationFrame(frame);
    };

    resize();
    addEventListener("resize", resize);
    addEventListener("pointermove", onMove);
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", resize); removeEventListener("pointermove", onMove); };
  }, []);

  return <canvas ref={cv} className="stars" aria-hidden />;
});

export default Starfield;

