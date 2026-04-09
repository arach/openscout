import { NextRequest, NextResponse } from "next/server";
import { getOpenScoutFeedbackReport } from "@/lib/feedback";
import { isFeedbackAdminAuthorized } from "@/lib/feedback-auth";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const token = request.nextUrl.searchParams.get("token");
  if (!isFeedbackAdminAuthorized(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const report = await getOpenScoutFeedbackReport(id);
    if (!report) {
      return NextResponse.json({ error: "Feedback not found" }, { status: 404 });
    }

    return NextResponse.json({ report });
  } catch (error) {
    console.error("Failed to read OpenScout feedback report:", error);
    return NextResponse.json({ error: "Failed to load feedback" }, { status: 500 });
  }
}
