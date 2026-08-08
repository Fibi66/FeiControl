"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, CheckSquare, Square, ChevronLeft, ChevronRight, Plus, Pencil, Trash2 } from "lucide-react";
import { EventModal, EventFormData } from "@/components/EventModal";

interface CalendarEvent {
  id?: string;
  key: string;
  date: string;
  time: string;
  title: string;
  description?: string;
  allDay: boolean;
  start: string;
  end?: string;
  color?: string;
}

interface Task {
  id: string;
  title: string;
  completed: boolean;
  indent: number;
}

interface TasksData {
  tasks: Task[];
  pending: number;
  completed: number;
  configured?: boolean;
  message?: string;
}

type EventCompletionState = Record<string, boolean>;

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const EVENT_COMPLETION_STORAGE_KEY = "mission-control-calendar-event-completions";

function getPSTNow() {
  const now = new Date();
  const pstStr = now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const [y, m, d] = pstStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function getWeekDays(offset: number): { dates: string[]; label: string } {
  const now = getPSTNow();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday + offset * 7);

  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    );
  }

  const sun = new Date(monday);
  sun.setDate(monday.getDate() + 6);
  const label = `${monday.getMonth() + 1}/${monday.getDate()} – ${sun.getMonth() + 1}/${sun.getDate()}`;

  return { dates, label };
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${parseInt(m)}/${parseInt(d)}`;
}

function getEventKey(event: Omit<CalendarEvent, "key">): string {
  return `${event.date}|${event.time}|${event.allDay ? "1" : "0"}|${event.title}`;
}

function extractDisplayTitle(fullTitle: string): string {
  // Strip URLs
  let cleaned = fullTitle.replace(/https?:\/\/\S+/gi, "").trim();
  // Split on common separators and take the first meaningful part
  const separators = /\s*[|·–—]\s*/;
  const firstPart = cleaned.split(separators)[0].trim();
  if (firstPart.length < 3) cleaned = cleaned.length > 40 ? cleaned.slice(0, 40) + "…" : cleaned;
  else cleaned = firstPart;
  // Final cleanup: collapse whitespace
  return cleaned.replace(/\s+/g, " ").trim() || fullTitle.slice(0, 30);
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const error = (payload as Record<string, unknown>).error;
    if (typeof error === "string" && error.trim()) {
      return error;
    }
  }

  return fallback;
}

function normalizeTasksData(payload: unknown): TasksData {
  if (!payload || typeof payload !== "object") {
    return { tasks: [], pending: 0, completed: 0 };
  }

  const record = payload as Record<string, unknown>;
  const rawTasks = Array.isArray(record.tasks) ? record.tasks : [];
  const tasks = rawTasks
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const taskRecord = item as Record<string, unknown>;
      const id = typeof taskRecord.id === "string" ? taskRecord.id : "";
      const title = typeof taskRecord.title === "string" ? taskRecord.title : "";

      if (!id || !title) {
        return null;
      }

      return {
        id,
        title,
        completed: taskRecord.completed === true,
        indent: typeof taskRecord.indent === "number" ? taskRecord.indent : 0,
      };
    })
    .filter((task): task is Task => task !== null);

  return {
    tasks,
    pending:
      typeof record.pending === "number"
        ? record.pending
        : tasks.filter((task) => !task.completed).length,
    completed:
      typeof record.completed === "number"
        ? record.completed
        : tasks.filter((task) => task.completed).length,
    configured: typeof record.configured === "boolean" ? record.configured : undefined,
    message: typeof record.message === "string" ? record.message : undefined,
  };
}

function normalizeCalendarData(payload: unknown): {
  events: CalendarEvent[];
  today: string;
  completions: EventCompletionState;
} {
  if (!payload || typeof payload !== "object") {
    return { events: [], today: "", completions: {} };
  }

  const record = payload as Record<string, unknown>;
  const rawEvents = Array.isArray(record.events) ? record.events : [];
  const events = rawEvents
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const eventRecord = item as Record<string, unknown>;
      const date = typeof eventRecord.date === "string" ? eventRecord.date : "";
      const time = typeof eventRecord.time === "string" ? eventRecord.time : "";
      const title = typeof eventRecord.title === "string" ? eventRecord.title : "";
      const allDay = eventRecord.allDay === true;

      if (!date || !time || !title) {
        return null;
      }

      const key =
        typeof eventRecord.key === "string" && eventRecord.key.trim()
          ? eventRecord.key
          : getEventKey({ date, time, title, allDay });

      return {
        key,
        date,
        time,
        title,
        allDay,
      };
    })
    .filter((event): event is CalendarEvent => event !== null);

  return {
    events,
    today: typeof record.today === "string" ? record.today : "",
    completions: normalizeEventCompletionState(record.completions),
  };
}

function normalizeEventCompletionState(payload: unknown): EventCompletionState {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const nextState: EventCompletionState = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (typeof value === "boolean" && value) {
      nextState[key] = true;
    }
  }

  return nextState;
}

export default function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [todayStr, setTodayStr] = useState("");
  const [tasks, setTasks] = useState<TasksData | null>(null);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [calendarError, setCalendarError] = useState("");
  const [tasksError, setTasksError] = useState("");
  const [eventCompletionError, setEventCompletionError] = useState("");
  const [eventCompletions, setEventCompletions] = useState<EventCompletionState>({});
  const [togglingEventKeys, setTogglingEventKeys] = useState<Record<string, boolean>>({});
  const [togglingTaskIds, setTogglingTaskIds] = useState<Record<string, boolean>>({});
  
  // Event editing state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const week = useMemo(() => getWeekDays(weekOffset), [weekOffset]);

  const maybeMigrateLegacyEventCompletions = useCallback(async (serverState: EventCompletionState) => {
    if (typeof window === "undefined") {
      return serverState;
    }

    try {
      const stored = window.localStorage.getItem(EVENT_COMPLETION_STORAGE_KEY);
      if (!stored) {
        setEventCompletionError("");
        return serverState;
      }

      const legacyState = normalizeEventCompletionState(JSON.parse(stored) as unknown);
      if (Object.keys(legacyState).length === 0) {
        window.localStorage.removeItem(EVENT_COMPLETION_STORAGE_KEY);
        setEventCompletionError("");
        return serverState;
      }

      const needsMigration = Object.keys(legacyState).some((key) => !serverState[key]);
      if (!needsMigration) {
        window.localStorage.removeItem(EVENT_COMPLETION_STORAGE_KEY);
        setEventCompletionError("");
        return serverState;
      }

      const response = await fetch("/api/calendar", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ completions: legacyState }),
      });
      const payload = await response.json().catch((): unknown => null);

      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Unable to migrate legacy event completion state"));
      }

      const mergedState = normalizeEventCompletionState(
        payload && typeof payload === "object"
          ? (payload as Record<string, unknown>).completions
          : null
      );

      window.localStorage.removeItem(EVENT_COMPLETION_STORAGE_KEY);
      setEventCompletionError("");
      return mergedState;
    } catch (error) {
      console.error("Failed to migrate legacy event completion state:", error);
      setEventCompletionError(
        error instanceof Error ? error.message : "Unable to migrate legacy event completion state"
      );
      return serverState;
    }
  }, []);

  const fetchData = useCallback(async (offset: number) => {
    setLoading(true);
    setCalendarError("");
    setTasksError("");

    const currentWeek = getWeekDays(offset);

    try {
      // Fetch both Google Calendar (khal) and local SQLite events
      const [calRes, dbEventsRes, taskRes] = await Promise.all([
        fetch(`/api/calendar?from=${currentWeek.dates[0]}&to=${currentWeek.dates[6]}`),
        fetch(`/api/events?startDate=${currentWeek.dates[0]}&endDate=${currentWeek.dates[6]}`),
        fetch("/api/tasks"),
      ]);
      const [calendarPayload, dbEventsPayload, taskPayload] = await Promise.all([
        calRes.json().catch((): unknown => null),
        dbEventsRes.json().catch((): unknown => null),
        taskRes.json().catch((): unknown => null),
      ]);

      if (calRes.ok) {
        const calendarData = normalizeCalendarData(calendarPayload);
        let allEvents = calendarData.events;

        // Merge with SQLite events
        if (dbEventsRes.ok && dbEventsPayload && Array.isArray(dbEventsPayload.events)) {
          const dbEvents = dbEventsPayload.events.map((ev: any) => {
            const startDate = new Date(ev.start);
            const dateStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}-${String(startDate.getDate()).padStart(2, "0")}`;
            const timeStr = ev.allDay 
              ? "All Day" 
              : `${String(startDate.getHours()).padStart(2, "0")}:${String(startDate.getMinutes()).padStart(2, "0")}`;
            
            return {
              id: ev.id,
              key: ev.id, // Use DB id as key for local events
              date: dateStr,
              time: timeStr,
              title: ev.title,
              description: ev.description || undefined,
              allDay: ev.allDay,
              start: ev.start,
              end: ev.end || undefined,
              color: ev.color || undefined,
            };
          });
          allEvents = [...allEvents, ...dbEvents];
        }

        setEvents(allEvents);
        setTodayStr(calendarData.today);
        setEventCompletions(
          await maybeMigrateLegacyEventCompletions(calendarData.completions)
        );
      } else {
        setEvents([]);
        setTodayStr("");
        setCalendarError(getErrorMessage(calendarPayload, "Unable to fetch calendar events"));
      }

      if (taskRes.ok) {
        setTasks(normalizeTasksData(taskPayload));
      } else {
        setTasksError(getErrorMessage(taskPayload, "Unable to fetch Google Tasks"));
        setTasks((current) => current ?? { tasks: [], pending: 0, completed: 0 });
      }
    } catch (error) {
      console.error("Failed to fetch calendar page data:", error);
      setEvents([]);
      setTodayStr("");
      setCalendarError("Failed to load calendar events");
      setTasksError("Failed to load Google Tasks");
      setTasks((current) => current ?? { tasks: [], pending: 0, completed: 0 });
    } finally {
      setLoading(false);
    }
  }, [maybeMigrateLegacyEventCompletions]);

  const toggleTask = useCallback(async (task: Task, nextCompleted: boolean) => {
    if (tasks?.configured === false) return;

    setTasksError("");
    setTogglingTaskIds((current) => ({ ...current, [task.id]: true }));

    try {
      const response = await fetch("/api/tasks", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ taskId: task.id, completed: nextCompleted }),
      });
      const payload = await response.json().catch((): unknown => null);

      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Unable to sync Google Tasks"));
      }

      setTasks(normalizeTasksData(payload));
    } catch (error) {
      console.error("Failed to toggle Google Task:", error);
      setTasksError(error instanceof Error ? error.message : "Unable to sync Google Tasks");
    } finally {
      setTogglingTaskIds((current) => {
        const nextState = { ...current };
        delete nextState[task.id];
        return nextState;
      });
    }
  }, [tasks?.configured]);

  const toggleEventCompletion = useCallback(async (event: CalendarEvent) => {
    const eventKey = event.key;
    const nextCompleted = !Boolean(eventCompletions[eventKey]);

    setEventCompletionError("");
    setTogglingEventKeys((current) => ({ ...current, [eventKey]: true }));
    setEventCompletions((current) => {
      const nextState = { ...current };

      if (nextCompleted) {
        nextState[eventKey] = true;
      } else {
        delete nextState[eventKey];
      }

      return nextState;
    });

    try {
      const response = await fetch("/api/calendar", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key: eventKey, completed: nextCompleted }),
      });
      const payload = await response.json().catch((): unknown => null);

      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Unable to save event completion state"));
      }

      const nextState = normalizeEventCompletionState(
        payload && typeof payload === "object"
          ? (payload as Record<string, unknown>).completions
          : null
      );
      setEventCompletions(nextState);
    } catch (error) {
      console.error("Failed to update event completion:", error);
      setEventCompletions((current) => {
        const nextState = { ...current };

        if (nextCompleted) {
          delete nextState[eventKey];
        } else {
          nextState[eventKey] = true;
        }

        return nextState;
      });
      setEventCompletionError(
        error instanceof Error ? error.message : "Unable to save event completion state"
      );
    } finally {
      setTogglingEventKeys((current) => {
        const nextState = { ...current };
        delete nextState[eventKey];
        return nextState;
      });
    }
  }, [eventCompletions]);

  // Create new event
  const handleCreateEvent = useCallback((date: string) => {
    const [year, month, day] = date.split("-").map(Number);
    setSelectedDate(new Date(year, month - 1, day));
    setEditingEvent(null);
    setIsModalOpen(true);
  }, []);

  // Edit existing event
  const handleEditEvent = useCallback((event: CalendarEvent, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingEvent(event);
    setSelectedDate(null);
    setIsModalOpen(true);
  }, []);

  // Delete event
  const handleDeleteEvent = useCallback(async (eventId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this event?")) return;

    try {
      const response = await fetch(`/api/events/${eventId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete event");
      }

      // Refresh calendar data
      await fetchData(weekOffset);
    } catch (error) {
      console.error("Failed to delete event:", error);
      setCalendarError("Failed to delete event");
    }
  }, [fetchData, weekOffset]);

  // Save event (create or update)
  const handleSaveEvent = useCallback(async (formData: EventFormData) => {
    try {
      const isEditing = Boolean(formData.id);
      const url = isEditing ? `/api/events/${formData.id}` : "/api/events";
      const method = isEditing ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error(`Failed to ${isEditing ? "update" : "create"} event`);
      }

      // Close modal and refresh calendar
      setIsModalOpen(false);
      setEditingEvent(null);
      setSelectedDate(null);
      await fetchData(weekOffset);
    } catch (error) {
      console.error("Failed to save event:", error);
      setCalendarError(`Failed to ${formData.id ? "update" : "create"} event`);
    }
  }, [fetchData, weekOffset]);

  useEffect(() => {
    void fetchData(weekOffset);
  }, [weekOffset, fetchData]);

  const eventsByDate = useMemo(() => {
    const grouped: Record<string, CalendarEvent[]> = {};

    for (const event of events) {
      if (!grouped[event.date]) {
        grouped[event.date] = [];
      }
      grouped[event.date].push(event);
    }

    for (const date of Object.keys(grouped)) {
      grouped[date].sort((a, b) => {
        if (a.allDay && !b.allDay) return -1;
        if (!a.allDay && b.allDay) return 1;
        return a.time.localeCompare(b.time);
      });
    }

    return grouped;
  }, [events]);

  const pendingTasks = useMemo(
    () => tasks?.tasks.filter((task) => !task.completed) ?? [],
    [tasks]
  );
  const completedTasks = useMemo(
    () => tasks?.tasks.filter((task) => task.completed) ?? [],
    [tasks]
  );

  const renderTaskRow = (task: Task, nextCompleted: boolean) => {
    const isCompleted = task.completed;
    const isToggling = Boolean(togglingTaskIds[task.id]);
    const isNotConfigured = tasks?.configured === false;

    return (
      <button
        type="button"
        key={task.id}
        onClick={() => {
          void toggleTask(task, nextCompleted);
        }}
        disabled={isToggling || isNotConfigured}
        title={isCompleted ? "Click to mark as incomplete" : "Click to mark as completed"}
        aria-label={isCompleted ? `Mark ${task.title} as incomplete` : `Mark ${task.title} as completed`}
        className="flex items-center gap-3 rounded-lg text-left transition-all duration-200 ease-out hover:scale-[1.02] hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20 hover:brightness-110 disabled:cursor-not-allowed"
        style={{
          backgroundColor: "var(--card-elevated)",
          border: "1px solid var(--border)",
          marginLeft: `${task.indent * 20}px`,
          opacity: isToggling ? 0.7 : isCompleted ? 0.55 : 1,
          padding: isCompleted ? "0.625rem 0.75rem" : "0.75rem",
          width: task.indent > 0 ? `calc(100% - ${task.indent * 20}px)` : "100%",
        }}
      >
        {isToggling ? (
          <RefreshCw className="w-4 h-4 flex-shrink-0 animate-spin" style={{ color: "var(--text-muted)" }} />
        ) : isCompleted ? (
          <CheckSquare className="w-4 h-4 flex-shrink-0" style={{ color: "var(--positive)" }} />
        ) : (
          <Square className="w-4 h-4 flex-shrink-0" style={{ color: "var(--accent)" }} />
        )}
        <span className={`text-sm ${isCompleted ? "line-through" : ""}`} style={{ color: isCompleted ? "var(--text-muted)" : "var(--text-primary)" }}>
          {task.title}
        </span>
      </button>
    );
  };

  return (
    <div className="p-4 md:p-8 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1
            className="text-2xl md:text-3xl font-bold"
            style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)", letterSpacing: "-1px" }}
          >
            📅 Calendar
          </h1>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            Google Calendar · Google Tasks
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "10px", padding: "2px" }}>
            <button
              onClick={() => setWeekOffset((offset) => offset - 1)}
              className="p-2 rounded-lg transition-all hover:opacity-80"
              style={{ color: "var(--text-primary)" }}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setWeekOffset(0)}
              className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
              style={{
                backgroundColor: weekOffset === 0 ? "var(--accent)" : "transparent",
                color: "var(--text-primary)",
              }}
            >
              This Week
            </button>
            <button
              onClick={() => setWeekOffset((offset) => offset + 1)}
              className="p-2 rounded-lg transition-all hover:opacity-80"
              style={{ color: "var(--text-primary)" }}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <button
            onClick={() => {
              void fetchData(weekOffset);
            }}
            disabled={loading}
            className="p-2 rounded-lg transition-all"
            style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", color: "var(--text-primary)", opacity: loading ? 0.5 : 1 }}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Week label */}
      <div className="mb-4 text-sm font-mono" style={{ color: "var(--text-muted)" }}>
        {week.label}
      </div>

      {(calendarError || eventCompletionError) && (
        <div className="mb-4 space-y-1">
          {calendarError && (
            <p className="text-xs" style={{ color: "#FF453A" }}>
              {calendarError}
            </p>
          )}
          {eventCompletionError && (
            <p className="text-xs" style={{ color: "#FF9F0A" }}>
              {eventCompletionError}
            </p>
          )}
        </div>
      )}

      {/* ===== 7-Day Grid ===== */}
      <div className="grid grid-cols-7 gap-2 mb-8">
        {week.dates.map((date, i) => {
          const isToday = date === todayStr;
          const dayEvents = eventsByDate[date] || [];
          const hasEvents = dayEvents.length > 0;

          return (
            <div
              key={date}
              className="rounded-xl flex flex-col min-h-[200px] overflow-hidden transition-all"
              style={{
                backgroundColor: "var(--card)",
                border: isToday ? "2px solid #34C759" : "1px solid var(--border)",
                boxShadow: isToday ? "0 0 12px rgba(52,199,89,0.15)" : "none",
              }}
            >
              {/* Day header */}
              <div
                className="px-3 py-2 text-center"
                style={{
                  backgroundColor: isToday ? "rgba(52,199,89,0.12)" : "var(--card-elevated)",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div className="text-base font-medium" style={{ color: isToday ? "#34C759" : "var(--text-muted)" }}>
                  {DAY_LABELS[i]}
                </div>
                <div
                  className="text-2xl font-bold"
                  style={{ color: isToday ? "#34C759" : "var(--text-primary)", fontFamily: "var(--font-heading)" }}
                >
                  {shortDate(date)}
                </div>
                {/* Add Event Button */}
                <button
                  onClick={() => handleCreateEvent(date)}
                  className="mt-2 w-full px-2 py-1 rounded-md text-xs font-medium transition-all hover:scale-105"
                  style={{
                    backgroundColor: "var(--accent)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border)",
                  }}
                  title="Add new event"
                >
                  <Plus className="w-3 h-3 inline mr-1" />
                  Add Event
                </button>
              </div>

              {/* Events */}
              <div className="flex-1 p-2 space-y-1.5">
                {loading ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="w-3 h-3 rounded-full animate-pulse" style={{ backgroundColor: "var(--border)" }} />
                  </div>
                ) : hasEvents ? (
                  dayEvents.map((event) => {
                    const eventKey = event.key;
                    const isEventCompleted = Boolean(eventCompletions[eventKey]);
                    const isEventToggling = Boolean(togglingEventKeys[eventKey]);

                    return (
                      <div
                        key={eventKey}
                        className={`group relative p-2 rounded-lg text-xs transition-all duration-200 ease-out hover:scale-[1.06] hover:shadow-xl hover:shadow-black/10 hover:-translate-y-1 hover:brightness-110 ${
                          isEventToggling ? "cursor-not-allowed" : "cursor-pointer"
                        }`}
                        style={{
                          backgroundColor: event.color || (isToday ? "rgba(52,199,89,0.08)" : "var(--card-elevated)"),
                          border: `1px solid ${isToday ? "rgba(52,199,89,0.2)" : "var(--border)"}`,
                          opacity: isEventToggling ? 0.6 : isEventCompleted ? 0.72 : 1,
                          ...(isToday ? { boxShadow: "0 0 8px rgba(52,199,89,0.25)" } : {}),
                        }}
                      >
                        {/* Action buttons - show on hover */}
                        <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                          <button
                            onClick={(e) => event.id && handleEditEvent(event, e)}
                            className="p-1 rounded bg-gray-800/90 hover:bg-gray-700 transition-colors"
                            title="Edit event"
                          >
                            <Pencil className="w-3 h-3" style={{ color: "#3b82f6" }} />
                          </button>
                          <button
                            onClick={(e) => event.id && handleDeleteEvent(event.id, e)}
                            className="p-1 rounded bg-gray-800/90 hover:bg-gray-700 transition-colors"
                            title="Delete event"
                          >
                            <Trash2 className="w-3 h-3" style={{ color: "#ef4444" }} />
                          </button>
                        </div>

                        <div
                          onClick={() => {
                            if (!isEventToggling) {
                              void toggleEventCompletion(event);
                            }
                          }}
                          className="flex items-start gap-2"
                        >
                          <button
                            type="button"
                            title={isEventCompleted ? "Click to mark as incomplete" : "Click to mark as completed"}
                            aria-label={isEventCompleted ? `Mark ${event.title} as incomplete` : `Mark ${event.title} as completed`}
                            className="mt-0.5 rounded-md transition-all hover:opacity-80 pointer-events-none"
                            style={{
                              background: "none",
                              border: "none",
                              color: isEventCompleted ? "var(--positive)" : "var(--text-muted)",
                              cursor: "pointer",
                              padding: 0,
                            }}
                          >
                            {isEventToggling ? (
                              <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : isEventCompleted ? (
                              <CheckSquare className="w-4 h-4" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </button>
                          <div className="min-w-0 flex-1">
                            <div
                              className="font-mono font-semibold mb-0.5"
                              style={{
                                color: isToday ? "#34C759" : "var(--accent)",
                                fontSize: "12px",
                                opacity: isEventCompleted ? 0.7 : 1,
                              }}
                            >
                              {event.time}
                            </div>
                            <div
                              className={`font-medium leading-snug ${isEventCompleted ? "line-through" : ""}`}
                              style={{ color: isEventCompleted ? "var(--text-muted)" : "var(--text-primary)", fontSize: "13px" }}
                              title={event.title}
                            >
                              {extractDisplayTitle(event.title)}
                            </div>
                            {event.description && (
                              <div
                                className="mt-1 text-xs opacity-70"
                                style={{ color: "var(--text-muted)" }}
                              >
                                {event.description.slice(0, 50)}{event.description.length > 50 ? "..." : ""}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <span className="text-xs" style={{ color: "var(--text-muted)", opacity: 0.4 }}>—</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ===== Google Tasks ===== */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-3">
            <div className="accent-line" />
            <h2
              className="text-lg font-bold"
              style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
            >
              ✅ Google Tasks
            </h2>
          </div>
          {tasks && tasks.configured !== false && (
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              Pending {tasks.pending} / Total {tasks.tasks.length}
            </span>
          )}
        </div>
        <div className="p-5">
          {tasksError && (
            <p className="mb-3 text-xs" style={{ color: "#FF453A" }}>
              {tasksError}
            </p>
          )}

          {loading ? (
            <p style={{ color: "var(--text-muted)" }}>Loading...</p>
          ) : tasks && tasks.configured === false ? (
            <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>
              Google Tasks integration available. Configure <code style={{ fontSize: "13px", padding: "1px 4px", borderRadius: "4px", backgroundColor: "var(--surface-elevated)" }}>GOOGLE_TASKS_SCRIPT</code> in <code style={{ fontSize: "13px", padding: "1px 4px", borderRadius: "4px", backgroundColor: "var(--surface-elevated)" }}>.env.local</code> to connect.
            </p>
          ) : tasks && tasks.tasks.length > 0 ? (
            <div className="space-y-3">
              {pendingTasks.length > 0 ? (
                <div className="space-y-2">{pendingTasks.map((task) => renderTaskRow(task, true))}</div>
              ) : completedTasks.length > 0 ? (
                <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>🎉 All tasks completed!</p>
              ) : null}

              {completedTasks.length > 0 && (
                <details className="mt-3" open={pendingTasks.length === 0}>
                  <summary className="text-xs cursor-pointer" style={{ color: "var(--text-muted)" }}>
                    Completed ({completedTasks.length})
                  </summary>
                  <div className="space-y-2 mt-2">
                    {completedTasks.map((task) => renderTaskRow(task, false))}
                  </div>
                </details>
              )}
            </div>
          ) : tasks ? (
            <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>No Google Tasks</p>
          ) : (
            <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>
              {tasksError || "No task data available"}
            </p>
          )}
        </div>
      </div>

      {/* Event Modal */}
      <EventModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingEvent(null);
          setSelectedDate(null);
        }}
        onSave={handleSaveEvent}
        initialData={
          editingEvent
            ? {
                id: editingEvent.id,
                title: editingEvent.title,
                description: editingEvent.description || "",
                start: editingEvent.start,
                end: editingEvent.end || "",
                allDay: editingEvent.allDay,
                color: editingEvent.color || "#10b981",
              }
            : undefined
        }
        selectedDate={selectedDate || undefined}
      />
    </div>
  );
}
