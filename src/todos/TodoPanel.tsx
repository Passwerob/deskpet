import { useMemo, useState } from "react";
import {
  CalendarBlank,
  Check,
  CheckCircle,
  Circle,
  Flag,
  Plus,
  Trash,
} from "@phosphor-icons/react";
import type { TodoItem, TodoPriority } from "../types";

type TodoFilter = "active" | "all" | "completed";

interface TodoPanelProps {
  todos: TodoItem[];
  loading: boolean;
  onSave: (todo: TodoItem) => Promise<void>;
  onDelete: (todo: TodoItem) => Promise<void>;
}

const PRIORITIES: Array<{ value: TodoPriority; label: string }> = [
  { value: "normal", label: "普通" },
  { value: "high", label: "优先" },
  { value: "low", label: "稍后" },
];

const PRIORITY_ORDER: Record<TodoPriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

function dueLabel(dueDate?: string | null): string {
  if (!dueDate) return "无截止日期";
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (dueDate === todayKey) return "今天截止";
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const tomorrowKey = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  if (dueDate === tomorrowKey) return "明天截止";
  return `${Number(dueDate.slice(5, 7))}月${Number(dueDate.slice(8, 10))}日`;
}

function isOverdue(todo: TodoItem): boolean {
  if (!todo.dueDate || todo.completed) return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return todo.dueDate < today;
}

export function TodoPanel({ todos, loading, onSave, onDelete }: TodoPanelProps) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<TodoPriority>("normal");
  const [filter, setFilter] = useState<TodoFilter>("active");

  const activeCount = todos.filter((todo) => !todo.completed).length;
  const completedCount = todos.length - activeCount;
  const visibleTodos = useMemo(() => {
    return todos
      .filter((todo) => filter === "all" || (filter === "completed" ? todo.completed : !todo.completed))
      .sort((left, right) => {
        if (left.completed !== right.completed) return Number(left.completed) - Number(right.completed);
        const priorityDifference = PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
        if (priorityDifference !== 0) return priorityDifference;
        if (left.dueDate && right.dueDate) return left.dueDate.localeCompare(right.dueDate);
        if (left.dueDate) return -1;
        if (right.dueDate) return 1;
        return right.createdAt.localeCompare(left.createdAt);
      });
  }, [filter, todos]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) return;
    await onSave({
      id: crypto.randomUUID(),
      title: nextTitle,
      completed: false,
      priority,
      dueDate: dueDate || null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    });
    setTitle("");
    setDueDate("");
    setPriority("normal");
    setFilter("active");
  };

  return (
    <div className="todo-panel">
      <form className="todo-composer" onSubmit={submit}>
        <label className="todo-title-field">
          <span>待办内容</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：整理本周资料"
            maxLength={80}
          />
        </label>
        <label className="todo-date-field">
          <span>截止日期</span>
          <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </label>
        <label className="todo-priority-field">
          <span>优先级</span>
          <select value={priority} onChange={(event) => setPriority(event.target.value as TodoPriority)}>
            {PRIORITIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <button className="todo-add-button" type="submit" disabled={!title.trim()}>
          <Plus size={17} weight="bold" />添加
        </button>
      </form>

      <div className="todo-toolbar">
        <div className="todo-summary">
          <strong>{activeCount}</strong> 项待完成
          {completedCount > 0 && <span>{completedCount} 项已完成</span>}
        </div>
        <div className="todo-filters" aria-label="筛选待办事项">
          {([[
            "active", "待完成",
          ], ["all", "全部"], ["completed", "已完成"]] as Array<[TodoFilter, string]>).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={filter === value ? "is-active" : ""}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="todo-loading" aria-label="正在加载待办事项"><span /><span /><span /></div>
      ) : visibleTodos.length === 0 ? (
        <div className="todo-empty">
          <CheckCircle size={36} weight="duotone" />
          <strong>{filter === "completed" ? "还没有已完成事项" : filter === "all" ? "还没有待办事项" : "现在没有未完成事项"}</strong>
          <span>{filter === "active" ? "可以放心休息一下，或添加下一件事。" : "在上方输入内容即可开始。"}</span>
        </div>
      ) : (
        <div className="todo-list">
          {visibleTodos.map((todo) => (
            <article className={`todo-row ${todo.completed ? "is-completed" : ""}`} key={todo.id}>
              <button
                className="todo-check"
                type="button"
                onClick={() => onSave({
                  ...todo,
                  completed: !todo.completed,
                  completedAt: todo.completed ? null : new Date().toISOString(),
                })}
                aria-label={`${todo.completed ? "恢复" : "完成"}${todo.title}`}
              >
                {todo.completed ? <Check size={15} weight="bold" /> : <Circle size={20} />}
              </button>
              <div className="todo-copy">
                <strong>{todo.title}</strong>
                <span>
                  <CalendarBlank size={14} />
                  <em className={isOverdue(todo) ? "is-overdue" : ""}>{isOverdue(todo) ? "已逾期" : dueLabel(todo.dueDate)}</em>
                  <Flag size={13} weight={todo.priority === "high" ? "fill" : "regular"} />
                  {PRIORITIES.find((item) => item.value === todo.priority)?.label}
                </span>
              </div>
              <button className="todo-delete" type="button" onClick={() => onDelete(todo)} aria-label={`删除${todo.title}`}>
                <Trash size={16} />
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
