import { NextRequest, NextResponse } from "next/server";
import { getOpenScoutReport } from "@/lib/reports";
import { isReportsAdminAuthorized } from "@/lib/reports-auth";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const token = request.nextUrl.searchParams.get("token");
  if (!isReportsAdminAuthorized(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const report = await getOpenScoutReport(id);
    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    return NextResponse.json({ report });
  } catch (error) {
    console.error("Failed to read OpenScout report:", error);
    return NextResponse.json({ error: "Failed to load report" }, { status: 500 });
  }
}
