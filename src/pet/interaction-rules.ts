import type { PetAction } from "../types";

export const PET_INTERACTION_TIMING = {
  clickSequenceMs: 700,
  tripleClickCooldownMs: 520,
  dragStopMs: 140,
  dragClickResetMs: 300,
  dragDirectionThresholdPx: 8,
} as const;

export type ClickInteraction =
  | { kind: "action"; action: Exclude<PetAction, "alarm"> }
  | { kind: "settings" };

export function resolveClickInteraction(clickCount: number): ClickInteraction | null {
  if (clickCount >= 3) return { kind: "action", action: "rollOver" };
  if (clickCount === 2) return { kind: "settings" };
  if (clickCount === 1) return { kind: "action", action: "wave" };
  return null;
}
