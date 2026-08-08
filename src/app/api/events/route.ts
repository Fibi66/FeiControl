import { NextRequest, NextResponse } from "next/server";
import {
  createEvent,
  updateEvent,
  deleteEvent,
  getEvents,
  getEvent,
} from "@/lib/calendar-db";

export const dynamic = "force-dynamic";

// GET /api/events - 获取事件列表
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;
    const includeCompleted = searchParams.get("includeCompleted") === "true";

    const events = getEvents({
      startDate,
      endDate,
      includeCompleted,
    });

    return NextResponse.json({
      events,
      total: events.length,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching events:", error);
    return NextResponse.json(
      { error: "Failed to fetch events" },
      { status: 500 }
    );
  }
}

// POST /api/events - 创建新事件
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.title || !body.start) {
      return NextResponse.json(
        { error: "Missing required fields: title, start" },
        { status: 400 }
      );
    }

    const event = createEvent({
      title: body.title,
      description: body.description,
      start: body.start,
      end: body.end,
      allDay: body.allDay ?? false,
      color: body.color,
    });

    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    console.error("Error creating event:", error);
    return NextResponse.json(
      { error: "Failed to create event" },
      { status: 500 }
    );
  }
}
