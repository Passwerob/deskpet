import type { Alarm } from "../types";

export const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"] as const;

export function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function startOfWeek(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const mondayOffset = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - mondayOffset);
  return result;
}

export function addDays(date: Date, amount: number): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + amount);
  return result;
}

export function weekDates(anchor: Date): Date[] {
  const monday = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

export function alarmOccursOnDate(alarm: Alarm, date: Date): boolean {
  const weekday = date.getDay();
  switch (alarm.repeatMode) {
    case "daily":
      return true;
    case "weekdays":
      return weekday >= 1 && weekday <= 5;
    case "custom":
      return alarm.days.includes(weekday);
    case "once":
    default:
      return alarm.date === toLocalDateKey(date);
  }
}

export function alarmsForDate(alarms: Alarm[], date: Date): Alarm[] {
  return alarms
    .filter((alarm) => alarmOccursOnDate(alarm, date))
    .sort((left, right) => left.time.localeCompare(right.time));
}

export function formatWeekRange(dates: Date[]): string {
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (!first || !last) return "";
  if (first.getFullYear() !== last.getFullYear()) {
    return `${first.getFullYear()}年${first.getMonth() + 1}月${first.getDate()}日至${last.getFullYear()}年${last.getMonth() + 1}月${last.getDate()}日`;
  }
  if (first.getMonth() !== last.getMonth()) {
    return `${first.getFullYear()}年${first.getMonth() + 1}月${first.getDate()}日至${last.getMonth() + 1}月${last.getDate()}日`;
  }
  return `${first.getFullYear()}年${first.getMonth() + 1}月${first.getDate()}日至${last.getDate()}日`;
}
