import type { PetAction } from "../types";

export type PetCareAction = "pet" | "feed" | "play" | "rest";

export interface PetStats {
  affection: number;
  fullness: number;
  energy: number;
  lastUpdated: number;
}

export interface PetCareResult {
  stats: PetStats;
  action: Exclude<PetAction, "alarm">;
  message: string;
}

const STORAGE_KEY = "zhuochong-pet-stats-v1";
const DEFAULT_STATS: PetStats = {
  affection: 36,
  fullness: 72,
  energy: 78,
  lastUpdated: Date.now(),
};

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

function withElapsedDecay(stats: PetStats): PetStats {
  const now = Date.now();
  const hours = Math.max(0, (now - stats.lastUpdated) / 3_600_000);
  return {
    affection: clamp(stats.affection - hours * 0.18),
    fullness: clamp(stats.fullness - hours * 2.4),
    energy: clamp(stats.energy - hours * 0.8),
    lastUpdated: now,
  };
}

function savePetStats(stats: PetStats) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
}

export function loadPetStats(): PetStats {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    savePetStats(DEFAULT_STATS);
    return { ...DEFAULT_STATS };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PetStats>;
    const stats = withElapsedDecay({
      affection: clamp(parsed.affection ?? DEFAULT_STATS.affection),
      fullness: clamp(parsed.fullness ?? DEFAULT_STATS.fullness),
      energy: clamp(parsed.energy ?? DEFAULT_STATS.energy),
      lastUpdated: Number(parsed.lastUpdated) || Date.now(),
    });
    savePetStats(stats);
    return stats;
  } catch {
    savePetStats(DEFAULT_STATS);
    return { ...DEFAULT_STATS };
  }
}

export function applyPetCare(kind: PetCareAction): PetCareResult {
  const current = loadPetStats();
  const result: PetCareResult = (() => {
    switch (kind) {
      case "feed":
        return {
          stats: { ...current, fullness: clamp(current.fullness + 18), affection: clamp(current.affection + 1) },
          action: "waiting",
          message: current.fullness > 88 ? "已经吃得圆滚滚啦" : "好香！谢谢你～",
        };
      case "play":
        return current.energy < 16
          ? { stats: current, action: "waiting", message: "有点累了，先休息一下吧" }
          : {
              stats: {
                ...current,
                affection: clamp(current.affection + 6),
                fullness: clamp(current.fullness - 4),
                energy: clamp(current.energy - 13),
              },
              action: "rollOver",
              message: "看我翻一圈！",
            };
      case "rest":
        return {
          stats: { ...current, energy: clamp(current.energy + 22) },
          action: "idle",
          message: "趴一会儿，马上满血",
        };
      case "pet":
      default:
        return {
          stats: { ...current, affection: clamp(current.affection + 4) },
          action: "wave",
          message: "再摸摸我～",
        };
    }
  })();
  result.stats.lastUpdated = Date.now();
  savePetStats(result.stats);
  return result;
}
