import type { PetAction } from "../types";
import type { PetSkinId } from "./pet-skins";

export interface AnimationSpec {
  source: string;
  frames: number;
  frameMs: number;
  loop: boolean;
  columns?: number;
}

export const FRAME_WIDTH = 192;
export const FRAME_HEIGHT = 208;

export function getAnimations(
  skin: PetSkinId,
): Record<Exclude<PetAction, "alarm">, AnimationSpec> {
  const root = `/pets/${skin}/smooth`;
  return {
    idle: {
      source: `${root}/idle.webp`,
      frames: 126,
      columns: 16,
      frameMs: 2100 / 126,
      loop: true,
    },
    walkRight: {
      source: `${root}/walkRight.webp`,
      frames: 64,
      columns: 16,
      frameMs: 16.75,
      loop: true,
    },
    walkLeft: {
      source: `${root}/walkLeft.webp`,
      frames: 64,
      columns: 16,
      frameMs: 16.75,
      loop: true,
    },
    wave: {
      source: `${root}/wave.webp`,
      frames: 49,
      columns: 16,
      frameMs: 820 / 49,
      loop: false,
    },
    jump: {
      source: `${root}/jump.webp`,
      frames: 50,
      columns: 16,
      frameMs: 825 / 50,
      loop: false,
    },
    rollOver: {
      source: `${root}/rollOver.webp`,
      frames: 288,
      columns: 16,
      frameMs: 4800 / 288,
      loop: false,
    },
    waiting: {
      source: `${root}/waiting.webp`,
      frames: 96,
      columns: 16,
      frameMs: 16.6875,
      loop: true,
    },
    thinking: {
      source: `${root}/thinking.webp`,
      frames: skin === "corgi-tuantuan" ? 144 : 99,
      columns: 16,
      frameMs: skin === "corgi-tuantuan" ? 2400 / 144 : 1650 / 99,
      loop: true,
    },
    focus: {
      source: `${root}/focus.webp`,
      frames: 96,
      columns: 16,
      frameMs: 16.6875,
      loop: true,
    },
  };
}
