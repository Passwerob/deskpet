import { useEffect, useMemo, useState } from "react";
import {
  BellRinging,
  CalendarDots,
  CalendarBlank,
  Check,
  CheckSquare,
  Clock,
  Dog,
  ListBullets,
  MoonStars,
  PencilSimple,
  Plus,
  Trash,
} from "@phosphor-icons/react";
import {
  deleteAlarm,
  deleteTodo,
  ensureNotificationPermission,
  getActivePetSkins,
  getPetNames,
  getSelectedPetSkin,
  listAlarms,
  listTodos,
  onActivePetSkinsChanged,
  onAlarmTriggered,
  onPetNameChanged,
  PET_NAME_MAX_LENGTH,
  saveAlarm,
  saveTodo,
  setActivePetSkins,
  setPetName,
  sendPetAction,
  sendPetReaction,
  triggerTestAlarm,
} from "./lib/bridge";
import {
  applyPetCare,
  loadPetStats,
  type PetCareAction,
  type PetStats,
} from "./pet/pet-game";
import { PET_SKINS, type PetSkinId } from "./pet/pet-skins";
import { WeekTimeline } from "./schedule/WeekTimeline";
import { toLocalDateKey } from "./schedule/week-schedule";
import { TodoPanel } from "./todos/TodoPanel";
import type { Alarm as AlarmModel, PetAction, RepeatMode, TodoItem } from "./types";

const WEEKDAYS = [
  { value: 1, label: "一" },
  { value: 2, label: "二" },
  { value: 3, label: "三" },
  { value: 4, label: "四" },
  { value: 5, label: "五" },
  { value: 6, label: "六" },
  { value: 0, label: "日" },
];

const ACTIONS: Array<{ action: PetAction; label: string }> = [
  { action: "idle", label: "待机" },
  { action: "walkLeft", label: "向左" },
  { action: "walkRight", label: "向右" },
  { action: "wave", label: "挥手" },
  { action: "jump", label: "跳跃" },
  { action: "rollOver", label: "翻滚" },
  { action: "waiting", label: "等待" },
  { action: "thinking", label: "思考" },
  { action: "focus", label: "检查" },
];

function createDraft(date = new Date(Date.now() + 5 * 60_000)): AlarmModel {
  const now = new Date(Date.now() + 5 * 60_000);
  return {
    id: crypto.randomUUID(),
    title: "提醒我一下",
    enabled: true,
    time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
    date: toLocalDateKey(date),
    repeatMode: "once",
    days: [],
    snoozeMinutes: 5,
  };
}

function repeatLabel(alarm: AlarmModel) {
  if (alarm.repeatMode === "daily") return "每天";
  if (alarm.repeatMode === "weekdays") return "工作日";
  if (alarm.repeatMode === "custom") {
    return WEEKDAYS.filter((day) => alarm.days.includes(day.value))
      .map((day) => `周${day.label}`)
      .join("、");
  }
  return alarm.date ?? "单次";
}

export function App() {
  const [alarms, setAlarms] = useState<AlarmModel[]>([]);
  const [draft, setDraft] = useState<AlarmModel>(() => createDraft());
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("桌宠正在陪着你");
  const [loading, setLoading] = useState(true);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [todosLoading, setTodosLoading] = useState(true);
  const [petSkin, setPetSkin] = useState<PetSkinId>(() => getSelectedPetSkin());
  const [activePetSkins, setVisiblePetSkins] = useState<PetSkinId[]>(() => getActivePetSkins());
  const [petNames, setPetNames] = useState(() => getPetNames());
  const [petNameDrafts, setPetNameDrafts] = useState(() => getPetNames());
  const [petStats, setPetStats] = useState<PetStats>(() => loadPetStats());
  const [panelView, setPanelView] = useState<"week" | "list" | "todos">("week");

  useEffect(() => {
    void ensureNotificationPermission().then((granted) => {
      if (!granted) setMessage("请在系统设置中允许通知，闹钟才能在后台提醒你");
    });
    void listAlarms()
      .then(setAlarms)
      .finally(() => setLoading(false));
    let cleanup: (() => void) | undefined;
    void onAlarmTriggered((payload) => {
      setMessage(`${payload.title}，时间到了`);
    }).then((unlisten) => {
      cleanup = unlisten;
    });
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void onPetNameChanged(({ skin, name }) => {
      setPetNames((current) => ({ ...current, [skin]: name }));
      setPetNameDrafts((current) => ({ ...current, [skin]: name }));
    }).then((unlisten) => {
      cleanup = unlisten;
    });
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    void listTodos()
      .then(setTodos)
      .finally(() => setTodosLoading(false));
  }, []);

  useEffect(() => {
    void setActivePetSkins(activePetSkins);
    let cleanup: (() => void) | undefined;
    void onActivePetSkinsChanged((skins) => {
      setVisiblePetSkins(skins);
      void setActivePetSkins(skins);
    }).then((unlisten) => {
      cleanup = unlisten;
    });
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    const refreshStats = () => setPetStats(loadPetStats());
    const timer = window.setInterval(refreshStats, 15_000);
    window.addEventListener("focus", refreshStats);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshStats);
    };
  }, []);

  const nextAlarm = useMemo(() => {
    return alarms
      .filter((alarm) => alarm.enabled)
      .sort((a, b) => a.time.localeCompare(b.time))[0];
  }, [alarms]);

  const beginNew = () => {
    setDraft(createDraft());
    setEditing(true);
  };

  const beginNewForDate = (date: Date) => {
    setDraft(createDraft(date));
    setEditing(true);
  };

  const beginEdit = (alarm: AlarmModel) => {
    setDraft({ ...alarm, days: [...alarm.days] });
    setEditing(true);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.title.trim()) {
      setMessage("请填写提醒名称");
      return;
    }
    if (draft.repeatMode === "custom" && draft.days.length === 0) {
      setMessage("请选择至少一天");
      return;
    }
    const updated = await saveAlarm({ ...draft, title: draft.title.trim() });
    setAlarms(updated);
    setEditing(false);
    setMessage("闹钟已保存");
    void sendPetAction("wave");
  };

  const toggleAlarm = async (alarm: AlarmModel) => {
    const updated = await saveAlarm({ ...alarm, enabled: !alarm.enabled });
    setAlarms(updated);
  };

  const handleTodoSave = async (todo: TodoItem) => {
    const existed = todos.some((item) => item.id === todo.id);
    setTodos(await saveTodo(todo));
    if (!existed) {
      setMessage("待办已添加");
      void sendPetAction("wave");
    } else if (todo.completed) {
      const reaction = "完成一项，做得不错";
      setMessage(reaction);
      void sendPetReaction({ action: "jump", message: reaction });
    } else {
      setMessage("待办已恢复");
    }
  };

  const handleTodoDelete = async (todo: TodoItem) => {
    setTodos(await deleteTodo(todo.id));
    setMessage(`已删除“${todo.title}”`);
  };

  const togglePetSkin = (skin: PetSkinId) => {
    const isVisible = activePetSkins.includes(skin);
    const nextSkins = isVisible
      ? activePetSkins.filter((item) => item !== skin)
      : [...activePetSkins, skin];
    setPetSkin(skin);
    setVisiblePetSkins(nextSkins);
    const name = petNames[skin];
    setMessage(isVisible ? `${name}已回到小窝` : `${name}已来到桌面`);
    void setActivePetSkins(nextSkins);
  };

  const renamePet = async (event: React.FormEvent, skin: PetSkinId) => {
    event.preventDefault();
    const name = await setPetName(skin, petNameDrafts[skin]);
    setPetNames((current) => ({ ...current, [skin]: name }));
    setPetNameDrafts((current) => ({ ...current, [skin]: name }));
    setMessage(`好啦，以后就叫它“${name}”`);
  };

  const careForPet = (kind: PetCareAction) => {
    const result = applyPetCare(kind);
    setPetStats(result.stats);
    setMessage(result.message);
    void sendPetReaction({ action: result.action, message: result.message });
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-icon"><Dog size={22} weight="fill" /></span>
          <div>
            <h1>桌宠</h1>
            <p>{message}</p>
          </div>
        </div>
        <button className="primary-button" type="button" onClick={beginNew}>
          <Plus size={18} weight="bold" />新建闹钟
        </button>
      </header>

      <div className="workspace">
        <aside className="pet-control-panel">
          <div className="pet-preview-wrap">
            <div className="preview-halo" />
            <div
              className="pet-preview"
              aria-label={`${petNames[petSkin]}桌宠预览`}
              style={{ backgroundImage: `url("/pets/${petSkin}/spritesheet.webp")` }}
            />
            <div className="skin-picker" aria-label="管理桌宠形象">
              {PET_SKINS.map((skin) => (
                <button
                  key={skin.id}
                  type="button"
                  className={`${activePetSkins.includes(skin.id) ? "is-active" : ""} ${petSkin === skin.id ? "is-previewed" : ""}`}
                  onClick={() => togglePetSkin(skin.id)}
                  title={`${activePetSkins.includes(skin.id) ? "收回" : "召唤"}${petNames[skin.id]} · ${skin.description}`}
                  aria-pressed={activePetSkins.includes(skin.id)}
                >
                  <span /><b>{petNames[skin.id]}</b>
                </button>
              ))}
            </div>
            <div className="pet-roster-summary">
              {activePetSkins.length > 0 ? `${activePetSkins.length} 只小狗正在桌面陪你` : "点击上方名字召唤小狗"}
            </div>
          </div>
          <section className="pet-name-panel" aria-labelledby="pet-name-title">
            <div className="pet-name-heading">
              <span><PencilSimple size={15} /></span>
              <div>
                <strong id="pet-name-title">宠物昵称</strong>
                <small>每只小狗独立保存</small>
              </div>
            </div>
            <div className="pet-name-list">
              {PET_SKINS.map((skin) => (
                <form key={skin.id} onSubmit={(event) => void renamePet(event, skin.id)}>
                  <label htmlFor={`pet-name-${skin.id}`}>{skin.name}</label>
                  <input
                    id={`pet-name-${skin.id}`}
                    value={petNameDrafts[skin.id]}
                    maxLength={PET_NAME_MAX_LENGTH}
                    onChange={(event) => setPetNameDrafts((current) => ({
                      ...current,
                      [skin.id]: event.target.value,
                    }))}
                    aria-label={`给${skin.name}重命名`}
                  />
                  <button type="submit" title={`保存${skin.name}的新昵称`} aria-label={`保存${skin.name}的新昵称`}>
                    <Check size={14} weight="bold" />
                  </button>
                </form>
              ))}
            </div>
            <p>最多 {PET_NAME_MAX_LENGTH} 个字；留空保存可恢复默认名</p>
          </section>
          <div className="next-alarm">
            <span><Clock size={17} />下一次提醒</span>
            <strong>{nextAlarm ? nextAlarm.time : "暂无"}</strong>
            <p>{nextAlarm ? nextAlarm.title : "创建一个闹钟开始使用"}</p>
          </div>
          <div className="action-grid" aria-label="动作预览">
            {ACTIONS.map(({ action, label }) => (
              <button key={action} type="button" onClick={() => void sendPetAction(action)}>
                {label}
              </button>
            ))}
          </div>
          <button className="test-button" type="button" onClick={() => void triggerTestAlarm()}>
            <BellRinging size={18} />测试提醒
          </button>
        </aside>

        <section className="alarms-panel" aria-labelledby="panel-title">
          <section className="pet-care-panel" aria-labelledby="pet-care-title">
            <div className="pet-care-heading">
              <div>
                <h2 id="pet-care-title">互动乐园</h2>
                <p>陪伴越多，小狗和你越亲近</p>
              </div>
              <span>Lv.{Math.max(1, Math.ceil(petStats.affection / 20))}</span>
            </div>
            <div className="pet-stats">
              {([
                ["亲密", petStats.affection, "affection"],
                ["饱腹", petStats.fullness, "fullness"],
                ["精力", petStats.energy, "energy"],
              ] as const).map(([label, value, kind]) => (
                <div className="pet-stat" key={kind}>
                  <span>{label}</span>
                  <div><i className={kind} style={{ width: `${value}%` }} /></div>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <div className="care-actions">
              <button type="button" onClick={() => careForPet("pet")}><span>🤍</span>摸摸</button>
              <button type="button" onClick={() => careForPet("feed")}><span>🦴</span>喂食</button>
              <button type="button" onClick={() => careForPet("play")}><span>🎾</span>玩耍</button>
              <button type="button" onClick={() => careForPet("rest")}><span>🌙</span>休息</button>
            </div>
          </section>

          <div className="section-heading schedule-heading">
            <div>
              <h2 id="panel-title">{panelView === "week" ? "本周日程" : panelView === "list" ? "全部提醒" : "待办事项"}</h2>
              <p>{panelView === "week" ? "日程与提醒已自动同步" : panelView === "list" ? "关闭窗口后仍会留在托盘运行" : "记下任务，完成时小狗会为你庆祝"}</p>
            </div>
            <div className="panel-view-switch" aria-label="切换日程视图">
              <button type="button" className={panelView === "week" ? "is-active" : ""} onClick={() => setPanelView("week")}>
                <CalendarBlank size={15} />周计划
              </button>
              <button type="button" className={panelView === "list" ? "is-active" : ""} onClick={() => setPanelView("list")}>
                <ListBullets size={15} />列表
              </button>
              <button type="button" className={panelView === "todos" ? "is-active" : ""} onClick={() => setPanelView("todos")}>
                <CheckSquare size={15} />待办
              </button>
            </div>
          </div>

          {panelView === "todos" ? (
            <TodoPanel
              todos={todos}
              loading={todosLoading}
              onSave={handleTodoSave}
              onDelete={handleTodoDelete}
            />
          ) : panelView === "week" ? (
            <WeekTimeline alarms={alarms} loading={loading} onCreate={beginNewForDate} onEdit={beginEdit} />
          ) : loading ? (
            <div className="loading-state" aria-label="正在加载闹钟">
              <span /><span /><span />
            </div>
          ) : alarms.length === 0 ? (
            <div className="empty-state">
              <MoonStars size={34} />
              <h3>还没有闹钟</h3>
              <p>设置一个时间，到点后桌宠会提醒你。</p>
              <button type="button" onClick={beginNew}><Plus size={17} />创建闹钟</button>
            </div>
          ) : (
            <div className="alarm-list">
              {alarms.map((alarm) => (
                <article className={`alarm-row ${alarm.enabled ? "" : "is-disabled"}`} key={alarm.id}>
                  <button className="alarm-main" type="button" onClick={() => beginEdit(alarm)}>
                    <time>{alarm.time}</time>
                    <span>
                      <strong>{alarm.title}</strong>
                      <small><CalendarDots size={15} />{repeatLabel(alarm)}</small>
                    </span>
                  </button>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={alarm.enabled}
                      onChange={() => void toggleAlarm(alarm)}
                      aria-label={`${alarm.title}${alarm.enabled ? "关闭" : "开启"}`}
                    />
                    <span />
                  </label>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      {editing && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setEditing(false)}>
          <form className="alarm-editor" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
            <div className="editor-heading">
              <div>
                <h2>{alarms.some((item) => item.id === draft.id) ? "编辑闹钟" : "新建闹钟"}</h2>
                <p>桌宠会在设定时间提醒你</p>
              </div>
              <button type="button" onClick={() => setEditing(false)} aria-label="关闭编辑器">×</button>
            </div>

            <label className="field-block">
              <span>提醒名称</span>
              <input
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                placeholder="例如：起来走一走"
              />
            </label>

            <div className="field-grid">
              <label className="field-block">
                <span>时间</span>
                <input
                  type="time"
                  value={draft.time}
                  onChange={(event) => setDraft({ ...draft, time: event.target.value })}
                  required
                />
              </label>
              {draft.repeatMode === "once" && (
                <label className="field-block">
                  <span>日期</span>
                  <input
                    type="date"
                    value={draft.date ?? ""}
                    onChange={(event) => setDraft({ ...draft, date: event.target.value })}
                    required
                  />
                </label>
              )}
            </div>

            <fieldset className="repeat-field">
              <legend>重复</legend>
              <div className="segmented-control">
                {([
                  ["once", "单次"],
                  ["daily", "每天"],
                  ["weekdays", "工作日"],
                  ["custom", "自定义"],
                ] as Array<[RepeatMode, string]>).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={draft.repeatMode === value ? "is-active" : ""}
                    onClick={() => setDraft({ ...draft, repeatMode: value })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>

            {draft.repeatMode === "custom" && (
              <div className="weekday-picker" aria-label="选择重复星期">
                {WEEKDAYS.map((day) => {
                  const selected = draft.days.includes(day.value);
                  return (
                    <button
                      key={day.value}
                      type="button"
                      className={selected ? "is-selected" : ""}
                      onClick={() => setDraft({
                        ...draft,
                        days: selected
                          ? draft.days.filter((value) => value !== day.value)
                          : [...draft.days, day.value],
                      })}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="editor-actions">
              {alarms.some((item) => item.id === draft.id) && (
                <button
                  className="danger-button"
                  type="button"
                  onClick={async () => {
                    setAlarms(await deleteAlarm(draft.id));
                    setEditing(false);
                    setMessage("闹钟已删除");
                  }}
                >
                  <Trash size={17} />删除
                </button>
              )}
              <span />
              <button className="secondary-button" type="button" onClick={() => setEditing(false)}>取消</button>
              <button className="primary-button" type="submit"><Check size={17} weight="bold" />保存</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
