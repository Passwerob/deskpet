import { invoke } from "@tauri-apps/api/core";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { emit, emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import type {
  Alarm,
  AlarmTriggeredPayload,
  PetAction,
  PetReactionPayload,
  TodoItem,
} from "../types";
import {
  DEFAULT_PET_SKIN,
  getDefaultPetName,
  isPetSkinId,
  type PetSkinId,
} from "../pet/pet-skins";

const isTauri = () => "__TAURI_INTERNALS__" in window;
const STORAGE_KEY = "zhuochong-alarms";
const PET_SKIN_STORAGE_KEY = "zhuochong-pet-skin";
const ACTIVE_PET_SKINS_STORAGE_KEY = "zhuochong-active-pet-skins";
const PET_NAMES_STORAGE_KEY = "zhuochong-pet-names";
const TODO_STORAGE_KEY = "zhuochong-todos";
export const PET_NAME_MAX_LENGTH = 12;
let notificationPermissionRequest: Promise<boolean> | null = null;

export type PetNames = Record<PetSkinId, string>;

export interface PetNameChangedPayload {
  skin: PetSkinId;
  name: string;
}

const fallbackAlarms = (): Alarm[] => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Alarm[];
  } catch {
    return [];
  }
};

export function ensureNotificationPermission(): Promise<boolean> {
  if (!isTauri()) return Promise.resolve(true);
  if (!notificationPermissionRequest) {
    notificationPermissionRequest = (async () => {
      if (await isPermissionGranted()) return true;
      return (await requestPermission()) === "granted";
    })().catch(() => false);
  }
  return notificationPermissionRequest;
}

export async function listAlarms(): Promise<Alarm[]> {
  if (isTauri()) return invoke<Alarm[]>("list_alarms");
  return fallbackAlarms();
}

export async function saveAlarm(alarm: Alarm): Promise<Alarm[]> {
  if (isTauri()) return invoke<Alarm[]>("save_alarm", { alarm });
  const alarms = fallbackAlarms();
  const index = alarms.findIndex((item) => item.id === alarm.id);
  if (index >= 0) alarms[index] = alarm;
  else alarms.push(alarm);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(alarms));
  return alarms;
}

export async function deleteAlarm(id: string): Promise<Alarm[]> {
  if (isTauri()) return invoke<Alarm[]>("delete_alarm", { id });
  const alarms = fallbackAlarms().filter((item) => item.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(alarms));
  return alarms;
}

function fallbackTodos(): TodoItem[] {
  const raw = localStorage.getItem(TODO_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed as TodoItem[] : [];
  } catch {
    return [];
  }
}

export async function listTodos(): Promise<TodoItem[]> {
  return fallbackTodos();
}

export async function saveTodo(todo: TodoItem): Promise<TodoItem[]> {
  const todos = fallbackTodos();
  const index = todos.findIndex((item) => item.id === todo.id);
  if (index >= 0) todos[index] = todo;
  else todos.push(todo);
  localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(todos));
  return todos;
}

export async function deleteTodo(id: string): Promise<TodoItem[]> {
  const todos = fallbackTodos().filter((item) => item.id !== id);
  localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(todos));
  return todos;
}

export async function snoozeAlarm(id: string, minutes: number): Promise<void> {
  if (isTauri()) await invoke("snooze_alarm", { id, minutes });
}

export async function stopAlarm(id: string): Promise<void> {
  if (isTauri()) await invoke("stop_alarm", { id });
  window.dispatchEvent(new CustomEvent("alarm-stopped", { detail: { id } }));
}

export async function triggerTestAlarm(): Promise<void> {
  if (isTauri()) await invoke("trigger_test_alarm");
  else {
    window.dispatchEvent(
      new CustomEvent("alarm-triggered", {
        detail: { id: "preview", title: "测试提醒" },
      }),
    );
  }
}

export async function sendPetAction(action: PetAction): Promise<void> {
  if (isTauri()) await emit("pet-action", { action });
  else window.dispatchEvent(new CustomEvent("pet-action", { detail: { action } }));
}

export async function sendPetReaction(payload: PetReactionPayload): Promise<void> {
  if (isTauri()) await emit("pet-reaction", payload);
  else window.dispatchEvent(new CustomEvent("pet-reaction", { detail: payload }));
}

export function getSelectedPetSkin(): PetSkinId {
  const stored = localStorage.getItem(PET_SKIN_STORAGE_KEY);
  return isPetSkinId(stored) ? stored : DEFAULT_PET_SKIN;
}

function readPetNameOverrides(): Partial<PetNames> {
  const raw = localStorage.getItem(PET_NAMES_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(([skin, name]) => (
        isPetSkinId(skin) && typeof name === "string" && name.trim().length > 0
      )),
    ) as Partial<PetNames>;
  } catch {
    return {};
  }
}

export function getPetNames(): PetNames {
  const overrides = readPetNameOverrides();
  return {
    dog: overrides.dog ?? getDefaultPetName("dog"),
    "cream-dog": overrides["cream-dog"] ?? getDefaultPetName("cream-dog"),
    "corgi-tuantuan": overrides["corgi-tuantuan"] ?? getDefaultPetName("corgi-tuantuan"),
  };
}

export function getPetName(skin: PetSkinId): string {
  return getPetNames()[skin];
}

function normalizePetName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, PET_NAME_MAX_LENGTH);
}

export async function setPetName(skin: PetSkinId, name: string): Promise<string> {
  const normalized = normalizePetName(name);
  const resolvedName = normalized || getDefaultPetName(skin);
  const overrides = readPetNameOverrides();
  if (!normalized || normalized === getDefaultPetName(skin)) delete overrides[skin];
  else overrides[skin] = normalized;
  localStorage.setItem(PET_NAMES_STORAGE_KEY, JSON.stringify(overrides));

  const payload: PetNameChangedPayload = { skin, name: resolvedName };
  if (isTauri()) await emit("pet-name-changed", payload);
  else window.dispatchEvent(new CustomEvent("pet-name-changed", { detail: payload }));
  return resolvedName;
}

export async function onPetNameChanged(
  handler: (payload: PetNameChangedPayload) => void,
): Promise<UnlistenFn> {
  if (isTauri()) {
    return listen<PetNameChangedPayload>("pet-name-changed", (event) => {
      if (isPetSkinId(event.payload.skin)) handler(event.payload);
    });
  }
  const listener = (event: Event) => {
    const payload = (event as CustomEvent<PetNameChangedPayload>).detail;
    if (isPetSkinId(payload.skin)) handler(payload);
  };
  window.addEventListener("pet-name-changed", listener);
  return () => window.removeEventListener("pet-name-changed", listener);
}

export async function setCurrentPetWindowTitle(name: string): Promise<void> {
  const title = `dog · ${name}`;
  document.title = title;
  if (isTauri()) await getCurrentWindow().setTitle(title);
}

export async function selectPetSkin(skin: PetSkinId): Promise<void> {
  localStorage.setItem(PET_SKIN_STORAGE_KEY, skin);
  if (isTauri()) await emitTo("pet", "pet-skin-changed", { skin });
  else window.dispatchEvent(new CustomEvent("pet-skin-changed", { detail: { skin } }));
}

export function getActivePetSkins(): PetSkinId[] {
  const raw = localStorage.getItem(ACTIVE_PET_SKINS_STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return [...new Set(parsed.filter(isPetSkinId))];
    } catch {
      // Fall through to the legacy single-skin preference.
    }
  }
  return ["dog", "cream-dog", "corgi-tuantuan"];
}

export async function onActivePetSkinsChanged(
  handler: (skins: PetSkinId[]) => void,
): Promise<UnlistenFn> {
  if (isTauri()) {
    return listen<{ skins: unknown[] }>("pet-visibility-changed", (event) => {
      handler([...new Set(event.payload.skins.filter(isPetSkinId))]);
    });
  }
  const listener = (event: Event) => {
    const skins = (event as CustomEvent<{ skins: unknown[] }>).detail.skins;
    handler([...new Set(skins.filter(isPetSkinId))]);
  };
  window.addEventListener("pet-visibility-changed", listener);
  return () => window.removeEventListener("pet-visibility-changed", listener);
}

export async function setActivePetSkins(skins: PetSkinId[]): Promise<void> {
  const uniqueSkins = [...new Set(skins)];
  localStorage.setItem(ACTIVE_PET_SKINS_STORAGE_KEY, JSON.stringify(uniqueSkins));
  if (!isTauri()) return;
  await Promise.all([
    invoke("set_pet_visible", { skin: "dog", visible: uniqueSkins.includes("dog") }),
    invoke("set_pet_visible", { skin: "cream-dog", visible: uniqueSkins.includes("cream-dog") }),
    invoke("set_pet_visible", { skin: "corgi-tuantuan", visible: uniqueSkins.includes("corgi-tuantuan") }),
  ]);
}

export async function onPetSkinChanged(
  handler: (skin: PetSkinId) => void,
): Promise<UnlistenFn> {
  if (isTauri()) {
    return listen<{ skin: PetSkinId }>("pet-skin-changed", (event) => {
      if (isPetSkinId(event.payload.skin)) handler(event.payload.skin);
    });
  }
  const listener = (event: Event) => {
    const skin = (event as CustomEvent<{ skin: unknown }>).detail.skin;
    if (isPetSkinId(skin)) handler(skin);
  };
  window.addEventListener("pet-skin-changed", listener);
  return () => window.removeEventListener("pet-skin-changed", listener);
}

export async function showSettings(): Promise<void> {
  if (!isTauri()) return;
  const settings = await WebviewWindow.getByLabel("settings");
  await settings?.show();
  await settings?.setFocus();
}

export async function startPetDrag(): Promise<void> {
  if (isTauri()) await getCurrentWindow().startDragging();
}

export type PetRollDirection = -1 | 1;

const ROLL_TRANSLATION_PHASES = [
  { time: 0, position: 0 },
  { time: 0.18, position: 0 },
  { time: 0.34, position: 0.18 },
  { time: 0.52, position: 0.49 },
  { time: 0.69, position: 0.8 },
  { time: 0.84, position: 1 },
  { time: 1, position: 1 },
] as const;

export function getPetRollTranslationProgress(progress: number): number {
  const normalized = Math.min(1, Math.max(0, progress));
  for (let index = 1; index < ROLL_TRANSLATION_PHASES.length; index += 1) {
    const previous = ROLL_TRANSLATION_PHASES[index - 1];
    const next = ROLL_TRANSLATION_PHASES[index];
    if (normalized > next.time) continue;
    const local = (normalized - previous.time) / (next.time - previous.time);
    const eased = local * local * (3 - 2 * local);
    return previous.position + (next.position - previous.position) * eased;
  }
  return 1;
}

export function startPetRollMovement(
  durationMs: number,
  onDirection?: (direction: PetRollDirection) => void,
): () => void {
  if (!isTauri()) return () => undefined;

  const appWindow = getCurrentWindow();
  let cancelled = false;
  let animationFrame = 0;
  let latestPosition: PhysicalPosition | null = null;
  let positionUpdatePending = false;

  const flushPosition = async () => {
    if (cancelled || positionUpdatePending || !latestPosition) return;
    const target = latestPosition;
    latestPosition = null;
    positionUpdatePending = true;
    try {
      await appWindow.setPosition(target);
    } catch {
      // Window movement is decorative; animation playback should continue.
    } finally {
      positionUpdatePending = false;
      if (latestPosition && !cancelled) void flushPosition();
    }
  };

  void (async () => {
    const [start, size, monitor] = await Promise.all([
      appWindow.outerPosition(),
      appWindow.outerSize(),
      currentMonitor(),
    ]);
    if (cancelled || !monitor) return;

    const workLeft = monitor.workArea.position.x;
    const workRight = workLeft + monitor.workArea.size.width;
    const roomLeft = Math.max(0, start.x - workLeft);
    const roomRight = Math.max(0, workRight - (start.x + size.width));
    const workCenter = workLeft + monitor.workArea.size.width / 2;
    const petCenter = start.x + size.width / 2;
    const preferredDirection = petCenter >= workCenter ? -1 : 1;
    const preferredRoom = preferredDirection < 0 ? roomLeft : roomRight;
    const alternateRoom = preferredDirection < 0 ? roomRight : roomLeft;
    const direction: PetRollDirection = preferredRoom >= alternateRoom * 0.45
      ? preferredDirection
      : preferredDirection === -1 ? 1 : -1;
    onDirection?.(direction);
    const available = direction < 0 ? roomLeft : roomRight;
    const requestedDistance = Math.round(92 * monitor.scaleFactor);
    const distance = Math.min(requestedDistance, available);
    const startedAt = performance.now();

    const move = (now: number) => {
      if (cancelled) return;
      const progress = Math.min(1, Math.max(0, (now - startedAt) / durationMs));
      const translated = getPetRollTranslationProgress(progress);
      latestPosition = new PhysicalPosition(
        start.x + direction * Math.round(distance * translated),
        start.y,
      );
      void flushPosition();
      if (progress < 1) animationFrame = requestAnimationFrame(move);
    };

    animationFrame = requestAnimationFrame(move);
  })();

  return () => {
    cancelled = true;
    latestPosition = null;
    cancelAnimationFrame(animationFrame);
  };
}

export async function onPetWindowMoved(
  handler: (position: { x: number; y: number }) => void,
): Promise<UnlistenFn> {
  if (isTauri()) {
    return getCurrentWindow().onMoved(({ payload }) => handler(payload));
  }
  const listener = (event: Event) => handler((event as CustomEvent).detail);
  window.addEventListener("pet-window-moved", listener);
  return () => window.removeEventListener("pet-window-moved", listener);
}

export async function onPetAction(
  handler: (action: PetAction) => void,
): Promise<UnlistenFn> {
  if (isTauri()) {
    return listen<{ action: PetAction }>("pet-action", (event) => handler(event.payload.action));
  }
  const listener = (event: Event) => handler((event as CustomEvent).detail.action);
  window.addEventListener("pet-action", listener);
  return () => window.removeEventListener("pet-action", listener);
}

export async function onPetReaction(
  handler: (payload: PetReactionPayload) => void,
): Promise<UnlistenFn> {
  if (isTauri()) {
    return listen<PetReactionPayload>("pet-reaction", (event) => handler(event.payload));
  }
  const listener = (event: Event) => handler((event as CustomEvent<PetReactionPayload>).detail);
  window.addEventListener("pet-reaction", listener);
  return () => window.removeEventListener("pet-reaction", listener);
}

export async function onAlarmTriggered(
  handler: (payload: AlarmTriggeredPayload) => void,
): Promise<UnlistenFn> {
  if (isTauri()) {
    return listen<AlarmTriggeredPayload>("alarm-triggered", (event) => handler(event.payload));
  }
  const listener = (event: Event) => handler((event as CustomEvent).detail);
  window.addEventListener("alarm-triggered", listener);
  return () => window.removeEventListener("alarm-triggered", listener);
}

export async function onAlarmStopped(handler: (id: string) => void): Promise<UnlistenFn> {
  if (isTauri()) {
    return listen<{ id: string }>("alarm-stopped", (event) => handler(event.payload.id));
  }
  const listener = (event: Event) => handler((event as CustomEvent).detail.id);
  window.addEventListener("alarm-stopped", listener);
  return () => window.removeEventListener("alarm-stopped", listener);
}
