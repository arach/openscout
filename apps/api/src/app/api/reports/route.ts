import { NextRequest, NextResponse } from "next/server";
import { listOpenScoutReports } from "@/lib/reports";
import { isReportsAdminAuthorized } from "@/lib/reports-auth";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!isReportsAdminAuthorized(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const reports = await listOpenScoutReports();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const stats = {
      total: reports.length,
      withErrors: reports.filter((report) => Boolean(report.contextInfo.lastError)).length,
      today: reports.filter((report) => new Date(report.createdAt) >= today).length,
    };

    return NextResponse.json({ reports, stats });
  } catch (error) {
    console.error("Failed to list OpenScout reports:", error);
    return NextResponse.json({ error: "Failed to list reports" }, { status: 500 });
  }
}
