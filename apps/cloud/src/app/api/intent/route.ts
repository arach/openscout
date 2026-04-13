import { NextRequest, NextResponse } from "next/server";
import { isFeedbackAdminAuthorized } from "@/lib/feedback-auth";
import {
  listOpenScoutIntentCaptures,
  normalizeOpenScoutIntentCaptureSubmission,
  upsertOpenScoutIntentCapture,
} from "@/lib/intent-capture";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!isFeedbackAdminAuthorized(token)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: corsHeaders() },
    );
  }

  try {
    const captures = await listOpenScoutIntentCaptures();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const stats = {
      total: captures.length,
      today: captures.filter((capture) => new Date(capture.updatedAt) >= today).length,
      withIntent: captures.filter((capture) => Boolean(capture.intent)).length,
      withInterest: captures.filter((capture) => Boolean(capture.interest)).length,
    };

    return NextResponse.json({ captures, stats }, { headers: corsHeaders() });
  } catch (error) {
    console.error("Failed to list OpenScout intent captures:", error);
    return NextResponse.json(
      { error: "Failed to list captures" },
      { status: 500, headers: corsHeaders() },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const submission = normalizeOpenScoutIntentCaptureSubmission(body);

    if (!submission) {
      return NextResponse.json(
        { success: false, error: "A valid email address is required" },
        { status: 400, headers: corsHeaders() },
      );
    }

    if (submission.honeypot) {
      return NextResponse.json(
        { success: true, ignored: true },
        { headers: corsHeaders() },
      );
    }

    const { capture, existing } = await upsertOpenScoutIntentCapture(submission);

    return NextResponse.json(
      {
        success: true,
        id: capture.id,
        email: capture.email,
        existing,
        updatedAt: capture.updatedAt,
      },
      { headers: corsHeaders() },
    );
  } catch (error) {
    console.error("OpenScout intent capture error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to capture intent",
      },
      { status: 500, headers: corsHeaders() },
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders(),
  });
}
