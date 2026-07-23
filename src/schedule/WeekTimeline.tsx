import { CaretLeft, CaretRight, Plus } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import type { Alarm } from "../types";
import {
  addDays,
  alarmsForDate,
  formatWeekRange,
  startOfWeek,
  toLocalDateKey,
  WEEKDAY_LABELS,
  weekDates,
} from "./week-schedule";

interface WeekTimelineProps {
  alarms: Alarm[];
  loading: boolean;
  onCreate: (date: Date) => void;
  onEdit: (alarm: Alarm) => void;
}

function scheduleRepeatLabel(alarm: Alarm): string {
  if (alarm.repeatMode === "daily") return "每天";
  if (alarm.repeatMode === "weekdays") return "工作日";
  if (alarm.repeatMode === "custom") return "每周重复";
  return "单次提醒";
}

export function WeekTimeline({ alarms, loading, onCreate, onEdit }: WeekTimelineProps) {
  const today = useMemo(() => new Date(), []);
  const todayKey = toLocalDateKey(today);
  const [weekAnchor, setWeekAnchor] = useState(() => startOfWeek(today));
  const [selectedDate, setSelectedDate] = useState(() => today);
  const dates = useMemo(() => weekDates(weekAnchor), [weekAnchor]);
  const selectedKey = toLocalDateKey(selectedDate);
  const selectedAlarms = useMemo(
    () => alarmsForDate(alarms, selectedDate),
    [alarms, selectedDate],
  );

  useEffect(() => {
    const firstKey = toLocalDateKey(dates[0]);
    const lastKey = toLocalDateKey(dates[6]);
    if (selectedKey < firstKey || selectedKey > lastKey) setSelectedDate(dates[0]);
  }, [dates, selectedKey]);

  const moveWeek = (amount: number) => {
    const nextAnchor = addDays(weekAnchor, amount * 7);
    setWeekAnchor(nextAnchor);
    setSelectedDate(nextAnchor);
  };

  const returnToToday = () => {
    setWeekAnchor(startOfWeek(today));
    setSelectedDate(today);
  };

  return (
    <div className="week-timeline">
      <div className="week-toolbar">
        <div>
          <strong>{formatWeekRange(dates)}</strong>
          <span>{alarms.filter((alarm) => alarm.enabled && dates.some((date) => alarmsForDate([alarm], date).length > 0)).length} 项提醒</span>
        </div>
        <div className="week-navigation" aria-label="切换周">
          <button type="button" onClick={() => moveWeek(-1)} aria-label="上一周"><CaretLeft size={15} weight="bold" /></button>
          <button className="today-button" type="button" onClick={returnToToday}>今天</button>
          <button type="button" onClick={() => moveWeek(1)} aria-label="下一周"><CaretRight size={15} weight="bold" /></button>
        </div>
      </div>

      <div className="week-days" aria-label="一周日程">
        {dates.map((date) => {
          const key = toLocalDateKey(date);
          const dayAlarms = alarmsForDate(alarms, date);
          const enabledCount = dayAlarms.filter((alarm) => alarm.enabled).length;
          return (
            <button
              type="button"
              key={key}
              className={`${selectedKey === key ? "is-selected" : ""} ${todayKey === key ? "is-today" : ""}`}
              onClick={() => setSelectedDate(date)}
              aria-label={`周${WEEKDAY_LABELS[date.getDay()]} ${date.getMonth() + 1}月${date.getDate()}日，${enabledCount}项提醒`}
            >
              <span>周{WEEKDAY_LABELS[date.getDay()]}</span>
              <strong>{date.getDate()}</strong>
              <i className={enabledCount > 0 ? "has-events" : ""}>{enabledCount || ""}</i>
            </button>
          );
        })}
      </div>

      <div className="day-schedule-heading">
        <div>
          <strong>{selectedDate.getMonth() + 1}月{selectedDate.getDate()}日 · 周{WEEKDAY_LABELS[selectedDate.getDay()]}</strong>
          <span>{selectedAlarms.length ? `${selectedAlarms.length} 个日程` : "今天还没有安排"}</span>
        </div>
        <button type="button" onClick={() => onCreate(selectedDate)}><Plus size={15} weight="bold" />添加</button>
      </div>

      {loading ? (
        <div className="timeline-loading"><span /><span /><span /></div>
      ) : selectedAlarms.length === 0 ? (
        <button className="timeline-empty" type="button" onClick={() => onCreate(selectedDate)}>
          <span><Plus size={18} /></span>
          <strong>添加这一天的第一个日程</strong>
        </button>
      ) : (
        <div className="timeline-events">
          {selectedAlarms.map((alarm, index) => (
            <button
              type="button"
              key={alarm.id}
              className={`timeline-event ${alarm.enabled ? "" : "is-disabled"}`}
              onClick={() => onEdit(alarm)}
            >
              <time>{alarm.time}</time>
              <span className="timeline-rail" aria-hidden="true"><i />{index < selectedAlarms.length - 1 && <b />}</span>
              <span className="timeline-event-copy">
                <strong>{alarm.title}</strong>
                <small>{scheduleRepeatLabel(alarm)}{alarm.enabled ? "" : " · 已关闭"}</small>
              </span>
              <em>{alarm.enabled ? "提醒" : "关闭"}</em>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
