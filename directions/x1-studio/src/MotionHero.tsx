import { useEffect, useRef } from 'react';

// Direction X1's hero: slow glows drifting on a plain 2D canvas (no animation library, which keeps
// the page inside its JavaScript budget). It is decorative, so the canvas is hidden from assistive
// technology. It only moves while it can be seen: it stops when the tab is hidden or the hero is
// scrolled away, and under `prefers-reduced-motion` it draws one still frame and never animates.
//
// The island is kept alive across page navigations (`transition:persist="hero"` in ProductPage), so
// the animation carries on from one product to the next instead of restarting. `data-instance`
// (a random id, set once on mount) lets a test prove it was the same canvas; `data-motion` says
// whether it is `running`, `paused` or `still`.

type Glow = { color: string; size: number; speed: number; phaseX: number; phaseY: number; reachX: number; reachY: number };

/** The moment drawn as the still frame. */
const STILL_AT_SECONDS = 4;
const GLOWS: readonly Glow[] = [
  { color: '--x1-glow-1', size: 0.62, speed: 0.11, phaseX: 0.0, phaseY: 1.3, reachX: 0.32, reachY: 0.22 },
  { color: '--x1-glow-2', size: 0.5, speed: 0.08, phaseX: 2.1, phaseY: 0.4, reachX: 0.36, reachY: 0.26 },
  { color: '--x1-glow-3', size: 0.42, speed: 0.14, phaseX: 4.0, phaseY: 2.6, reachX: 0.28, reachY: 0.3 },
];
const GLOW_STRENGTH = 0.32;

function randomId(): string {
  const words = crypto.getRandomValues(new Uint32Array(2));
  return [...words].map((word) => word.toString(16).padStart(8, '0')).join('');
}

function paint(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, seconds: number): void {
  const { width, height } = canvas;
  const style = getComputedStyle(canvas);
  context.globalCompositeOperation = 'source-over';
  context.clearRect(0, 0, width, height);
  context.globalCompositeOperation = 'lighter';
  for (const glow of GLOWS) {
    const x = width * (0.5 + glow.reachX * Math.sin(seconds * glow.speed * 2 * Math.PI + glow.phaseX));
    const y = height * (0.5 + glow.reachY * Math.cos(seconds * glow.speed * 2 * Math.PI + glow.phaseY));
    const radius = Math.max(width, height) * glow.size;
    const rgb = style.getPropertyValue(glow.color).trim() || '255 255 255';
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgb(${rgb} / ${String(GLOW_STRENGTH)})`);
    gradient.addColorStop(1, `rgb(${rgb} / 0)`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  }
}

export function MotionHero() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (canvas === null || context === null || context === undefined) return undefined;

    // Set once. The effect does not run again when the island is carried to the next page.
    canvas.dataset['instance'] ??= randomId();

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let onScreen = true;
    let seconds = STILL_AT_SECONDS;
    let lastFrame: number | null = null;
    let frame = 0;

    const fit = () => {
      const scale = Math.min(window.devicePixelRatio, 2);
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * scale));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * scale));
      paint(canvas, context, seconds);
    };

    const tick = (now: number) => {
      if (lastFrame !== null) seconds += (now - lastFrame) / 1000;
      lastFrame = now;
      paint(canvas, context, seconds);
      frame = requestAnimationFrame(tick);
    };

    const sync = () => {
      cancelAnimationFrame(frame);
      lastFrame = null;
      if (reduced.matches) {
        canvas.dataset['motion'] = 'still';
        seconds = STILL_AT_SECONDS;
        paint(canvas, context, seconds);
      } else if (document.hidden || !onScreen) {
        canvas.dataset['motion'] = 'paused';
      } else {
        canvas.dataset['motion'] = 'running';
        frame = requestAnimationFrame(tick);
      }
    };

    const resize = new ResizeObserver(fit);
    resize.observe(canvas);
    const visibility = new IntersectionObserver((entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting);
      sync();
    });
    visibility.observe(canvas);
    document.addEventListener('visibilitychange', sync);
    reduced.addEventListener('change', sync);
    fit();
    sync();

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      visibility.disconnect();
      document.removeEventListener('visibilitychange', sync);
      reduced.removeEventListener('change', sync);
    };
  }, []);

  return <canvas ref={canvasRef} className="x1-hero__canvas" aria-hidden="true" />;
}
