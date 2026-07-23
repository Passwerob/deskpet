import {
  FRAME_HEIGHT,
  FRAME_WIDTH,
  getAnimations,
  type AnimationSpec,
} from "./pet-manifest";
import type { PetAction } from "../types";
import type { PetSkinId } from "./pet-skins";

type PlayableAction = Exclude<PetAction, "alarm">;

const CANVAS_WIDTH = 208;
const CANVAS_HEIGHT = 220;

interface MotionTransform {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

interface SpriteAnimatorCallbacks {
  onActionStarted?: (action: PlayableAction, durationMs: number) => void;
  onActionEnded?: (action: PlayableAction) => void;
}

/**
 * Canvas renderer for the interpolated action strips.
 *
 * A single canvas is intentional: fading two transparent sprite layers leaves
 * both silhouettes visible during large pose changes. Drawing one decoded
 * frame atomically removes that ghosting and lets Chromium double-buffer the
 * transparent surface for us.
 */
export class SpriteAnimator {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private atlases = new Map<PlayableAction, HTMLImageElement>();
  private readyActions = new Set<PlayableAction>();
  private animationSpecs = getAnimations("dog");
  private skin: PetSkinId = "dog";
  private loadVersion = 0;
  private action: PlayableAction = "idle";
  private spec: AnimationSpec = this.animationSpecs.idle;
  private frame = 0;
  private actionStartedAt = 0;
  private raf = 0;
  private destroyed = false;
  private finished = false;
  private reduceMotion = false;
  private onComplete?: () => void;
  private callbacks: SpriteAnimatorCallbacks;
  private rollDirection: -1 | 1 = 1;

  constructor(
    canvas: HTMLCanvasElement,
    skin: PetSkinId = "dog",
    callbacks: SpriteAnimatorCallbacks = {},
  ) {
    this.canvas = canvas;
    const context = canvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });
    if (!context) throw new Error("Canvas 2D is unavailable");
    this.context = context;
    this.callbacks = callbacks;
    this.reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.actionStartedAt = performance.now();
    this.configureCanvas();
    this.skin = skin;
    this.animationSpecs = getAnimations(skin);
    this.spec = this.animationSpecs.idle;
    this.loadAssets();

    this.raf = requestAnimationFrame(this.tick);
  }

  private loadAssets() {
    const version = ++this.loadVersion;
    this.atlases.clear();
    this.readyActions.clear();
    for (const [action, spec] of Object.entries(this.animationSpecs) as [PlayableAction, AnimationSpec][]) {
      const image = new Image();
      image.decoding = "async";
      image.src = spec.source;
      this.atlases.set(action, image);
      void image.decode().then(() => {
        if (this.destroyed || version !== this.loadVersion) return;
        this.readyActions.add(action);
        if (this.action === action) {
          this.frame = 0;
          this.actionStartedAt = performance.now();
          this.drawFrame(this.frame);
        }
      });
    }
  }

  setSkin(skin: PetSkinId) {
    if (this.destroyed || skin === this.skin) return;
    this.skin = skin;
    this.animationSpecs = getAnimations(skin);
    this.spec = this.animationSpecs[this.action];
    this.frame = 0;
    this.actionStartedAt = performance.now();
    this.finished = false;
    this.loadAssets();
  }

  play(action: PlayableAction, onComplete?: () => void) {
    if (this.destroyed) return;
    if (!this.finished) this.callbacks.onActionEnded?.(this.action);
    this.action = action;
    this.spec = this.animationSpecs[action];
    this.frame = 0;
    this.actionStartedAt = performance.now();
    this.finished = false;
    this.onComplete = onComplete;
    this.callbacks.onActionStarted?.(action, this.spec.frames * this.spec.frameMs);
    if (this.readyActions.has(action)) this.drawFrame(0);
  }

  get currentAction() {
    return this.action;
  }

  setRollDirection(direction: -1 | 1) {
    this.rollDirection = direction;
    if (this.action === "rollOver" && this.readyActions.has("rollOver")) {
      this.drawFrame(this.frame);
    }
  }

  destroy() {
    if (!this.finished) this.callbacks.onActionEnded?.(this.action);
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.onComplete = undefined;
  }

  private configureCanvas() {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(CANVAS_WIDTH * pixelRatio);
    this.canvas.height = Math.round(CANVAS_HEIGHT * pixelRatio);
    this.canvas.style.width = `${CANVAS_WIDTH}px`;
    this.canvas.style.height = `${CANVAS_HEIGHT}px`;
    this.context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    this.context.imageSmoothingEnabled = true;
    this.context.imageSmoothingQuality = "high";
  }

  private tick = (now: number) => {
    if (this.destroyed) return;

    if (this.readyActions.has(this.action) && !this.reduceMotion && !this.finished) {
      this.advanceToTime(now);
    }

    if (this.readyActions.has(this.action) && !this.reduceMotion) {
      this.drawFrame(this.frame, now);
    }

    this.raf = requestAnimationFrame(this.tick);
  };

  private advanceToTime(now: number) {
    const durationMs = this.spec.frames * this.spec.frameMs;
    const elapsed = Math.max(0, now - this.actionStartedAt);
    if (!this.spec.loop && elapsed >= durationMs) {
      this.frame = this.spec.frames - 1;
      this.finished = true;
      this.callbacks.onActionEnded?.(this.action);
      const complete = this.onComplete;
      this.onComplete = undefined;
      complete?.();
      return;
    }

    const timeline = this.spec.loop ? elapsed % durationMs : elapsed;
    this.frame = Math.min(this.spec.frames - 1, Math.floor(timeline / this.spec.frameMs));
  }

  private getMotion(now: number): MotionTransform {
    const cycleMs = this.spec.frames * this.spec.frameMs;
    const elapsed = Math.max(0, now - this.actionStartedAt);
    const phase = this.spec.loop
      ? (elapsed % cycleMs) / cycleMs
      : Math.min(1, elapsed / cycleMs);
    const cycle = Math.sin(phase * Math.PI * 2);
    const step = Math.abs(Math.sin(phase * Math.PI * 4));
    const arc = Math.sin(phase * Math.PI);

    switch (this.action) {
      case "walkRight":
      case "walkLeft":
        return { x: 0, y: -1.35 * step, rotation: 0, scaleX: 1, scaleY: 1 };
      case "wave":
        return { x: 0, y: -0.7 * arc, rotation: 0.004 * cycle, scaleX: 1, scaleY: 1 };
      case "jump":
        return { x: 0, y: -5.5 * arc, rotation: 0, scaleX: 1, scaleY: 1 };
      case "rollOver":
        return {
          x: 0,
          y: -1.6 * arc,
          rotation: 0.015 * cycle,
          scaleX: 1 + 0.006 * arc,
          scaleY: 1 - 0.006 * arc,
        };
      case "waiting":
        return { x: 0, y: -0.55 * cycle, rotation: 0, scaleX: 1, scaleY: 1 };
      case "thinking":
        return { x: 0, y: -0.3 * cycle, rotation: 0.007 * cycle, scaleX: 1, scaleY: 1 };
      case "focus":
        return { x: 0, y: -0.35 * cycle, rotation: 0, scaleX: 1.002, scaleY: 1 + 0.003 * cycle };
      case "idle":
      default:
        return { x: 0, y: -0.45 * cycle, rotation: 0, scaleX: 1.001, scaleY: 1 + 0.0025 * cycle };
    }
  }

  private drawFrame(frame: number, now = performance.now()) {
    const atlas = this.atlases.get(this.action);
    if (!atlas || !this.readyActions.has(this.action)) return;

    const columns = this.spec.columns ?? this.spec.frames;
    const sourceX = (frame % columns) * FRAME_WIDTH;
    const sourceY = Math.floor(frame / columns) * FRAME_HEIGHT;
    const motion = this.getMotion(now);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    // Clear the full physical backing store before every draw. The motion is
    // applied inside the canvas, so the transparent WebView never composites a
    // moving DOM layer or retains pixels outside the new silhouette.
    this.context.save();
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    this.context.translate(CANVAS_WIDTH / 2 + motion.x, CANVAS_HEIGHT + motion.y);
    this.context.rotate(motion.rotation);
    const directionScale = this.action === "rollOver" ? this.rollDirection : 1;
    this.context.scale(motion.scaleX * directionScale, motion.scaleY);
    this.context.globalCompositeOperation = "source-over";
    this.context.globalAlpha = 1;
    this.context.drawImage(
      atlas,
      sourceX,
      sourceY,
      FRAME_WIDTH,
      FRAME_HEIGHT,
      -FRAME_WIDTH / 2,
      -FRAME_HEIGHT,
      FRAME_WIDTH,
      FRAME_HEIGHT,
    );
    this.context.restore();
  }
}
