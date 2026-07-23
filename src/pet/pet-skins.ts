export type PetSkinId = "dog" | "cream-dog" | "corgi-tuantuan";

export interface PetSkin {
  id: PetSkinId;
  name: string;
  description: string;
}

export const PET_SKINS: PetSkin[] = [
  { id: "dog", name: "豆包", description: "活泼的约克夏" },
  { id: "cream-dog", name: "奶糖", description: "奶油色垂耳小狗" },
  { id: "corgi-tuantuan", name: "团团", description: "爱翻肚皮的黄白柯基" },
];

export const DEFAULT_PET_SKIN: PetSkinId = "dog";

export function getDefaultPetName(skin: PetSkinId): string {
  return PET_SKINS.find((item) => item.id === skin)?.name ?? "小狗";
}

export function isPetSkinId(value: unknown): value is PetSkinId {
  return value === "dog" || value === "cream-dog" || value === "corgi-tuantuan";
}
