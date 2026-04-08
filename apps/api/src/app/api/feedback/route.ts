import { NextRequest, NextResponse } from "next/server";
import {
  getOpenScoutFeedbackAdminUrl,
  listOpenScoutFeedbackReports,
  normalizeOpenScoutFeedbackReport,
  storeOpenScoutFeedbackReport,
} from "@/lib/feedback";
import { isFeedbackAdminAuthorized } from "@/lib/feedback-auth";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!isFeedbackAdminAuthorized(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const reports = await listOpenScoutFeedbackReports();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const stats = {
      total: reports.length,
      withErrors: reports.filter((report) => Boolean(report.contextInfo.lastError)).length,
      today: reports.filter((report) => new Date(report.createdAt) >= today).length,
    };

    return NextResponse.json({ reports, stats });
  } catch (error) {
    console.error("Failed to list OpenScout feedback reports:", error);
    return NextResponse.json({ error: "Failed to list feedback reports" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const report = normalizeOpenScoutFeedbackReport(body);

    if (!report) {
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400, headers: { "Access-Control-Allow-Origin": "*" } },
      );
    }

    await storeOpenScoutFeedbackReport(report);

    return NextResponse.json({
      success: true,
      id: report.id,
      key: report.id.slice(0, 8),
      adminUrl: getOpenScoutFeedbackAdminUrl(report.id),
    }, {
      status: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } catch (error) {
    console.error("OpenScout feedback submission error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to submit feedback",
      },
      { status: 500, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
