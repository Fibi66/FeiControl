/**
 * SQLite-backed Calendar Events
 * Stores user-created calendar events
 */
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';

const DB_PATH = path.join(process.cwd(), 'data', 'calendar.db');

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  start: string; // ISO 8601 datetime
  end: string | null; // ISO 8601 datetime, null for all-day single-day events
  allDay: boolean;
  color: string | null; // hex color code
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;

  // Ensure data dir
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  _db = new Database(DB_PATH);

  // WAL mode for better concurrency
  _db.pragma('journal_mode = WAL');
  _db.pragma('synchronous = NORMAL');

  // Create table
  _db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      start TEXT NOT NULL,
      end TEXT,
      allDay INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      completed INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_start ON events(start);
    CREATE INDEX IF NOT EXISTS idx_events_completed ON events(completed);
  `);

  return _db;
}

export function createEvent(data: {
  title: string;
  description?: string;
  start: string;
  end?: string;
  allDay?: boolean;
  color?: string;
}): CalendarEvent {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO events (id, title, description, start, end, allDay, color, completed, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    id,
    data.title,
    data.description ?? null,
    data.start,
    data.end ?? null,
    data.allDay ? 1 : 0,
    data.color ?? null,
    now,
    now
  );

  return {
    id,
    title: data.title,
    description: data.description ?? null,
    start: data.start,
    end: data.end ?? null,
    allDay: data.allDay ?? false,
    color: data.color ?? null,
    completed: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateEvent(
  id: string,
  data: {
    title?: string;
    description?: string;
    start?: string;
    end?: string;
    allDay?: boolean;
    color?: string;
    completed?: boolean;
  }
): boolean {
  const db = getDb();
  const now = new Date().toISOString();

  const fields: string[] = [];
  const values: unknown[] = [];

  if (data.title !== undefined) {
    fields.push('title = ?');
    values.push(data.title);
  }
  if (data.description !== undefined) {
    fields.push('description = ?');
    values.push(data.description);
  }
  if (data.start !== undefined) {
    fields.push('start = ?');
    values.push(data.start);
  }
  if (data.end !== undefined) {
    fields.push('end = ?');
    values.push(data.end);
  }
  if (data.allDay !== undefined) {
    fields.push('allDay = ?');
    values.push(data.allDay ? 1 : 0);
  }
  if (data.color !== undefined) {
    fields.push('color = ?');
    values.push(data.color);
  }
  if (data.completed !== undefined) {
    fields.push('completed = ?');
    values.push(data.completed ? 1 : 0);
  }

  if (fields.length === 0) return false;

  fields.push('updatedAt = ?');
  values.push(now);
  values.push(id);

  const result = db.prepare(`UPDATE events SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

export function deleteEvent(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM events WHERE id = ?').run(id);
  return result.changes > 0;
}

export function getEvents(options: {
  startDate?: string;
  endDate?: string;
  includeCompleted?: boolean;
}): CalendarEvent[] {
  const db = getDb();

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.startDate) {
    conditions.push('start >= ?');
    params.push(options.startDate);
  }

  if (options.endDate) {
    // Include events that start before end date or span across it
    conditions.push("(start <= ? OR (end IS NOT NULL AND end >= ?))");
    params.push(options.endDate, options.startDate || options.endDate);
  }

  if (!options.includeCompleted) {
    conditions.push('completed = 0');
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM events ${where} ORDER BY start ASC`).all(...params) as Array<{
    id: string;
    title: string;
    description: string | null;
    start: string;
    end: string | null;
    allDay: number;
    color: string | null;
    completed: number;
    createdAt: string;
    updatedAt: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    start: row.start,
    end: row.end,
    allDay: Boolean(row.allDay),
    color: row.color,
    completed: Boolean(row.completed),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export function getEvent(id: string): CalendarEvent | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as {
    id: string;
    title: string;
    description: string | null;
    start: string;
    end: string | null;
    allDay: number;
    color: string | null;
    completed: number;
    createdAt: string;
    updatedAt: string;
  } | undefined;

  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    start: row.start,
    end: row.end,
    allDay: Boolean(row.allDay),
    color: row.color,
    completed: Boolean(row.completed),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
