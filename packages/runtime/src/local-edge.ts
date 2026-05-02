import {
  DEFAULT_SCOUT_WEB_PORTAL_HOST,
  resolveConfiguredScoutWebHostname,
  resolveScoutWebNamedHostname,
  resolveWebPort,
} from "./local-config.js";

export type OpenScoutLocalEdgeRoute = {
  host: string;
  upstream: string;
};

export type OpenScoutLocalEdgeScheme = "http" | "https" | "both";

export type OpenScoutLocalEdgeConfig = {
  portalHost: string;
  nodeHost: string;
  wildcardHost: string;
  scheme: OpenScoutLocalEdgeScheme;
  routes: OpenScoutLocalEdgeRoute[];
};

function uniqRoutes(routes: OpenScoutLocalEdgeRoute[]): OpenScoutLocalEdgeRoute[] {
  const seen = new Set<string>();
  const out: OpenScoutLocalEdgeRoute[] = [];
  for (const route of routes) {
    const key = `${route.host.toLowerCase()} ${route.upstream}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(route);
  }
  return out;
}

export function resolveOpenScoutLocalEdgeConfig(input: {
  portalHost?: string;
  nodeHost?: string;
  scheme?: OpenScoutLocalEdgeScheme;
  webPort?: number;
} = {}): OpenScoutLocalEdgeConfig {
  const portalHost = resolveScoutWebNamedHostname(input.portalHost ?? DEFAULT_SCOUT_WEB_PORTAL_HOST);
  const nodeHost = resolveScoutWebNamedHostname(input.nodeHost ?? resolveConfiguredScoutWebHostname());
  const wildcardHost = `*.${portalHost}`;
  const scheme = input.scheme ?? "both";
  const upstream = `127.0.0.1:${input.webPort ?? resolveWebPort()}`;
  return {
    portalHost,
    nodeHost,
    wildcardHost,
    scheme,
    routes: uniqRoutes([
      { host: portalHost, upstream },
      { host: wildcardHost, upstream },
    ]),
  };
}

export function renderOpenScoutCaddyfile(config: OpenScoutLocalEdgeConfig): string {
  const schemes = config.scheme === "both" ? ["http", "https"] as const : [config.scheme] as const;
  const blocks = schemes
    .flatMap((scheme) =>
      config.routes.map((route) => {
        const host = scheme === "http" ? `http://${route.host}` : route.host;
        return `${host} {\n`
          + (scheme === "https" ? `  tls internal\n` : "")
          + `  reverse_proxy ${route.upstream}\n`
          + `}`;
      }),
    )
    .join("\n\n");
  return `${blocks}\n`;
}
