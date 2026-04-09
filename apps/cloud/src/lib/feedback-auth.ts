export function getFeedbackAdminToken(): string | null {
  const token = process.env.OPENSCOUT_FEEDBACK_ADMIN_TOKEN?.trim()
    || process.env.OPENSCOUT_REPORTS_ADMIN_TOKEN?.trim();
  return token && token.length > 0 ? token : null;
}

export function isFeedbackAdminAuthorized(token: string | null | undefined): boolean {
  const expected = getFeedbackAdminToken();
  if (!expected) {
    return true;
  }
  return token === expected;
}
