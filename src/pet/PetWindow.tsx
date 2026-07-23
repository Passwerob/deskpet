import { useEffect, useRef, useState } from "react";
import { BellRinging, ClockCounterClockwise, X } from "@phosphor-icons/react";
import {
  getPetName,
  onAlarmStopped,
  onAlarmTriggered,
  onPetAction,
  onPetReaction,
  onPetNameChanged,
  onPetWindowMoved,
  showSettings,
  snoozeAlarm,
  startPetDrag,
  startPetRollMovement,
  stopAlarm,
  setCurrentPetWindowTitle,
} from "../lib/bridge";
import type { AlarmTriggeredPayload, PetAction } from "../types";
import { applyPetCare } from "./pet-game";
import { SpriteAnimator } from "./SpriteAnimator";
import {
  PET_INTERACTION_TIMING,
  resolveClickInteraction,
} from "./interaction-rules";
import type { PetSkinId } from "./pet-skins";

function playChime() {
  const AudioContextClass = window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const start = context.currentTime;
  [0, 0.22, 0.44].forEach((offset, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = [659, 784, 988][index];
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.18, start + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.18);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + 0.2);
  });
  window.setTimeout(() => void context.close(), 1100);
}

export function PetWindow({ skin }: { skin: PetSkinId }) {
  const spriteCanvas = useRef<HTMLCanvasElement>(null);
  const animator = useRef<SpriteAnimator | null>(null);
  const dragMoved = useRef(false);
  const dragDistanceX = useRef(0);
  const dragSessionActive = useRef(false);
  const clickCount = useRef(0);
  const clickTimer = useRef(0);
  const reactionTimer = useRef(0);
  const hoverTimer = useRef(0);
  const suppressClicksUntil = useRef(0);
  const [ringing, setRinging] = useState<AlarmTriggeredPayload | null>(null);
  const [reaction, setReaction] = useState<string | null>(null);
  const [petName, setPetNameState] = useState(() => getPetName(skin));

  const showReaction = (message: string) => {
    window.clearTimeout(reactionTimer.current);
    setReaction(message);
    reactionTimer.current = window.setTimeout(() => setReaction(null), 2200);
  };

  useEffect(() => {
    const initialName = getPetName(skin);
    setPetNameState(initialName);
    void setCurrentPetWindowTitle(initialName);
    let cleanup: (() => void) | undefined;
    void onPetNameChanged((payload) => {
      if (payload.skin !== skin) return;
      setPetNameState(payload.name);
      void setCurrentPetWindowTitle(payload.name);
      showReaction(`记住啦，我叫${payload.name}！`);
    }).then((unlisten) => {
      cleanup = unlisten;
    });
    return () => cleanup?.();
  }, [skin]);

  useEffect(() => {
    if (!spriteCanvas.current) return;
    let randomTimer = 0;
    let dragStopTimer = 0;
    let dragClickResetTimer = 0;
    let releaseRollGuardTimer = 0;
    let lastWindowX: number | null = null;
    let alarmIsRinging = false;
    let rollMovementActive = false;
    let stopRollMovement: () => void = () => undefined;
    const engine = new SpriteAnimator(spriteCanvas.current, skin, {
      onActionStarted: (action, durationMs) => {
        if (action !== "rollOver") return;
        window.clearTimeout(releaseRollGuardTimer);
        rollMovementActive = true;
        stopRollMovement();
        stopRollMovement = startPetRollMovement(durationMs, (direction) => {
          animator.current?.setRollDirection(direction);
        });
      },
      onActionEnded: (action) => {
        if (action !== "rollOver") return;
        stopRollMovement();
        stopRollMovement = () => undefined;
        window.clearTimeout(releaseRollGuardTimer);
        releaseRollGuardTimer = window.setTimeout(() => {
          rollMovementActive = false;
          lastWindowX = null;
        }, 180);
      },
    });
    animator.current = engine;
    const scheduleAmbient = () => {
      randomTimer = window.setTimeout(() => {
        if (!alarmIsRinging && engine.currentAction === "idle") {
          const actions: PetAction[] = ["wave", "jump", "rollOver", "thinking", "focus"];
          const action = actions[Math.floor(Math.random() * actions.length)];
          engine.play(action as Exclude<PetAction, "alarm">, () => engine.play("idle"));
        }
        scheduleAmbient();
      }, 9000 + Math.random() * 8000);
    };
    scheduleAmbient();

    const cleanups: Array<() => void> = [];
    void onPetAction((action) => {
      if (action === "alarm") return;
      engine.play(action, () => engine.play("idle"));
    }).then((cleanup) => cleanups.push(cleanup));
    void onPetReaction((payload) => {
      if (alarmIsRinging) return;
      showReaction(payload.message);
      engine.play(payload.action, () => engine.play("idle"));
    }).then((cleanup) => cleanups.push(cleanup));
    void onAlarmTriggered((payload) => {
      window.clearTimeout(clickTimer.current);
      window.clearTimeout(reactionTimer.current);
      window.clearTimeout(hoverTimer.current);
      clickCount.current = 0;
      alarmIsRinging = true;
      setRinging(payload);
      if (skin === "dog") playChime();
      engine.play("jump", () => engine.play("waiting"));
    }).then((cleanup) => cleanups.push(cleanup));
    void onAlarmStopped(() => {
      alarmIsRinging = false;
      setRinging(null);
      engine.play("idle");
    }).then((cleanup) => cleanups.push(cleanup));
    void onPetWindowMoved(({ x }) => {
      if (rollMovementActive) {
        lastWindowX = x;
        return;
      }
      if (lastWindowX === null) {
        lastWindowX = x;
        return;
      }

      const deltaX = x - lastWindowX;
      lastWindowX = x;
      if (alarmIsRinging || deltaX === 0) return;

      dragDistanceX.current += deltaX;
      if (
        !dragSessionActive.current &&
        Math.abs(dragDistanceX.current) < PET_INTERACTION_TIMING.dragDirectionThresholdPx
      ) return;

      window.clearTimeout(clickTimer.current);
      clickCount.current = 0;
      dragSessionActive.current = true;
      dragMoved.current = true;
      window.clearTimeout(dragClickResetTimer);
      const direction = deltaX < 0 ? "walkLeft" : "walkRight";
      if (engine.currentAction !== direction) engine.play(direction);

      window.clearTimeout(dragStopTimer);
      dragStopTimer = window.setTimeout(() => {
        if (!alarmIsRinging) engine.play("idle");
        dragClickResetTimer = window.setTimeout(() => {
          dragMoved.current = false;
          dragDistanceX.current = 0;
          dragSessionActive.current = false;
        }, PET_INTERACTION_TIMING.dragClickResetMs);
      }, PET_INTERACTION_TIMING.dragStopMs);
    }).then((cleanup) => cleanups.push(cleanup));

    return () => {
      window.clearTimeout(randomTimer);
      window.clearTimeout(dragStopTimer);
      window.clearTimeout(dragClickResetTimer);
      window.clearTimeout(releaseRollGuardTimer);
      window.clearTimeout(clickTimer.current);
      stopRollMovement();
      cleanups.forEach((cleanup) => cleanup());
      engine.destroy();
      animator.current = null;
    };
  }, [skin]);

  const handlePetClick = () => {
    if (dragMoved.current) {
      dragMoved.current = false;
      dragDistanceX.current = 0;
      dragSessionActive.current = false;
      return;
    }
    if (ringing || performance.now() < suppressClicksUntil.current) return;

    clickCount.current += 1;
    window.clearTimeout(clickTimer.current);

    const runInteraction = () => {
      const count = clickCount.current;
      const interaction = resolveClickInteraction(count);
      clickCount.current = 0;
      if (!interaction) return;
      if (interaction.kind === "settings") {
        void showSettings();
        return;
      }
      if (count === 1) {
        const result = applyPetCare("pet");
        showReaction(result.message);
        animator.current?.play(result.action, () => animator.current?.play("idle"));
        return;
      }
      if (count >= 3) showReaction("看我慢慢翻一圈！");
      animator.current?.play(interaction.action, () => animator.current?.play("idle"));
    };

    if (clickCount.current >= 3) {
      suppressClicksUntil.current = performance.now() +
        PET_INTERACTION_TIMING.tripleClickCooldownMs;
      runInteraction();
      return;
    }

    clickTimer.current = window.setTimeout(
      runInteraction,
      PET_INTERACTION_TIMING.clickSequenceMs,
    );
  };

  const handlePetPointerDown = () => {
    window.clearTimeout(hoverTimer.current);
    dragMoved.current = false;
    dragDistanceX.current = 0;
    dragSessionActive.current = false;
    void startPetDrag();
  };

  const handlePointerEnter = () => {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      if (ringing || animator.current?.currentAction !== "idle") return;
      showReaction("在看什么呀？");
      animator.current?.play("thinking", () => animator.current?.play("idle"));
    }, 1200);
  };

  const handlePointerLeave = () => window.clearTimeout(hoverTimer.current);

  return (
    <main className="pet-window" onContextMenu={(event) => event.preventDefault()}>
      {ringing && (
        <section className="alarm-bubble" aria-live="assertive">
          <BellRinging size={18} weight="fill" />
          <strong>{ringing.title}</strong>
          <div className="alarm-bubble-actions">
            <button
              type="button"
              onClick={() => {
                void snoozeAlarm(ringing.id, 5);
                setRinging(null);
                animator.current?.play("idle");
              }}
            >
              <ClockCounterClockwise size={16} />5 分钟
            </button>
            <button
              type="button"
              onClick={() => {
                void stopAlarm(ringing.id);
                setRinging(null);
                animator.current?.play("idle");
              }}
              aria-label="停止提醒"
            >
              <X size={16} />
            </button>
          </div>
        </section>
      )}
      {!ringing && reaction && (
        <div className="reaction-bubble" aria-live="polite">{reaction}</div>
      )}
      <button
        className="pet-stage"
        type="button"
        aria-label={`${petName}桌宠，双击打开设置`}
        onPointerDown={handlePetPointerDown}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onClick={handlePetClick}
      >
        <canvas ref={spriteCanvas} className="sprite-canvas" />
      </button>
    </main>
  );
}
