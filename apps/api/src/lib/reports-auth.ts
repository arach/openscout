export function getReportsAdminToken(): string | null {
  const token = process.env.OPENSCOUT_REPORTS_ADMIN_TOKEN?.trim();
  return token && token.length > 0 ? token : null;
}

export function isReportsAdminAuthorized(token: string | null | undefined): boolean {
  const expected = getReportsAdminToken();
  if (!expected) {
    return true;
  }
  return token === expected;
}
