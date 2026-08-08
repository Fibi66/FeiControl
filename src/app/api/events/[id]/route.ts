import { NextRequest, NextResponse } from "next/server";
import { updateEvent, deleteEvent, getEvent } from "@/lib/calendar-db";

export const dynamic = "force-dynamic";

// GET /api/events/[id] - 获取单个事件
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const event = getEvent(params.id);

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    return NextResponse.json({ event });
  } catch (error) {
    console.error("Error fetching event:", error);
    return NextResponse.json(
      { error: "Failed to fetch event" },
      { status: 500 }
    );
  }
}

// PUT /api/events/[id] - 更新事件
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();

    const success = updateEvent(params.id, {
      title: body.title,
      description: body.description,
      start: body.start,
      end: body.end,
      allDay: body.allDay,
      color: body.color,
      completed: body.completed,
    });

    if (!success) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const event = getEvent(params.id);
    return NextResponse.json({ event });
  } catch (error) {
    console.error("Error updating event:", error);
    return NextResponse.json(
      { error: "Failed to update event" },
      { status: 500 }
    );
  }
}

// DELETE /api/events/[id] - 删除事件
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const success = deleteEvent(params.id);

    if (!success) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting event:", error);
    return NextResponse.json(
      { error: "Failed to delete event" },
      { status: 500 }
    );
  }
}
