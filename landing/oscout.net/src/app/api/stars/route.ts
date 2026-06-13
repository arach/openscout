// Server-side proxy for GitHub stargazer count.
// Hits api.github.com from the server (our IP, our quota) at most once per
// revalidation window — visitors hit our same-origin endpoint and never
// touch the GitHub API directly.

export const revalidate = 86400; // 1 day

export async function GET() {
  try {
    const res = await fetch(
      "https://api.github.com/repos/arach/openscout",
      {
        headers: { "User-Agent": "openscout-landing" },
        next: { revalidate: 86400 },
      },
    );
    if (!res.ok) {
      return Response.json({ stars: null }, { status: 200 });
    }
    const data: { stargazers_count?: number } = await res.json();
    return Response.json({ stars: data.stargazers_count ?? null });
  } catch {
    return Response.json({ stars: null }, { status: 200 });
  }
}
