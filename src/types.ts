export type RepeatMode = "once" | "daily" | "weekdays" | "custom";

export interface Alarm {
  id: string;
  title: string;
  enabled: boolean;
  time: string;
  date?: string | null;
  repeatMode: RepeatMode;
  days: number[];
  snoozeMinutes: number;
  lastTriggeredKey?: string | null;
  snoozedUntil?: string | null;
}

export type TodoPriority = "low" | "normal" | "high";

export interface TodoItem {
  id: string;
  title: string;
  completed: boolean;
  priority: TodoPriority;
  dueDate?: string | null;
  createdAt: string;
  completedAt?: string | null;
}

export type PetAction =
  | "idle"
  | "walkRight"
  | "walkLeft"
  | "wave"
  | "jump"
  | "rollOver"
  | "waiting"
  | "thinking"
  | "focus"
  | "alarm";

export interface AlarmTriggeredPayload {
  id: string;
  title: string;
}

export interface PetReactionPayload {
  action: Exclude<PetAction, "alarm">;
  message: string;
}
