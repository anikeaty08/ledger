"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Counts a number up the first time it comes into view: a ledger tally being totaled, not a
 * decorative odometer. If the target changes later (live data arriving after first paint), it tallies
 * from the current value to the new one. Under prefers-reduced-motion it jumps straight to the value.
 */
export function useCountUp(target: number, durationMs = 900): { ref: React.RefObject<HTMLSpanElement | null>; value: number } {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(0);
  const valueRef = useRef(0);
  const visibleRef = useRef(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const set = (v: number) => {
      valueRef.current = v;
      setValue(v);
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      set(target);
      return;
    }

    let frame = 0;
    const animate = () => {
      const from = valueRef.current;
      if (from === target) return;
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / durationMs);
        const eased = 1 - Math.pow(1 - t, 3);
        set(Math.round(from + (target - from) * eased));
        if (t < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };

    if (visibleRef.current) {
      animate();
      return () => cancelAnimationFrame(frame);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        visibleRef.current = true;
        observer.disconnect();
        animate();
      },
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [target, durationMs]);

  return { ref, value };
}
