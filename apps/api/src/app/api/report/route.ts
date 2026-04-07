import { NextRequest, NextResponse } from "next/server";
import {
  getOpenScoutReportAdminUrl,
  normalizeOpenScoutReport,
  storeOpenScoutReport,
} from "@/lib/reports";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const report = normalizeOpenScoutReport(body);

    if (!report) {
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400, headers: { "Access-Control-Allow-Origin": "*" } },
      );
    }

    await storeOpenScoutReport(report);

    return NextResponse.json({
      success: true,
      id: report.id,
      key: report.id.slice(0, 8),
      adminUrl: getOpenScoutReportAdminUrl(report.id),
    }, {
      status: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } catch (error) {
    console.error("OpenScout report submission error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to submit report",
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
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
