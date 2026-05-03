import {
  DEFAULT_SCOUT_WEB_PORTAL_HOST,
  resolveConfiguredScoutWebHostname,
  resolveBrokerPort,
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
  brokerUpstream: string;
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
  brokerPort?: number;
  webPort?: number;
} = {}): OpenScoutLocalEdgeConfig {
  const portalHost = resolveScoutWebNamedHostname(input.portalHost ?? DEFAULT_SCOUT_WEB_PORTAL_HOST);
  const nodeHost = resolveScoutWebNamedHostname(input.nodeHost ?? resolveConfiguredScoutWebHostname());
  const wildcardHost = `*.${portalHost}`;
  const scheme = input.scheme ?? "both";
  const upstream = `127.0.0.1:${input.webPort ?? resolveWebPort()}`;
  const brokerUpstream = `127.0.0.1:${input.brokerPort ?? resolveBrokerPort()}`;
  return {
    portalHost,
    nodeHost,
    wildcardHost,
    scheme,
    brokerUpstream,
    routes: uniqRoutes([
      { host: portalHost, upstream },
      { host: wildcardHost, upstream },
    ]),
  };
}

export function renderOpenScoutStartPage(config: OpenScoutLocalEdgeConfig): string {
  const pageConfig = JSON.stringify({
    startPath: "/__openscout/web/start",
  });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Start Scout</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0f1720;
      color: #f5f7fb;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 32px;
      background:
        radial-gradient(ellipse at 15% 30%, rgba(91, 141, 239, 0.16) 0%, transparent 50%),
        radial-gradient(ellipse at 85% 70%, rgba(74, 222, 128, 0.06) 0%, transparent 40%),
        #111827;
    }
    main {
      width: min(400px, 100%);
      padding: 28px 30px 26px;
      border: 1px solid rgba(255, 255, 255, 0.09);
      border-radius: 10px;
      background: rgba(15, 23, 32, 0.9);
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 20px 60px rgba(0, 0, 0, 0.45);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 18px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      color: rgba(74, 222, 128, 0.8);
    }
    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.2; }
    }
    .badge-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #4ade80;
      flex-shrink: 0;
      animation: blink 2.4s ease-in-out infinite;
    }
    h1 {
      font-size: 22px;
      font-weight: 700;
      line-height: 1.2;
      margin-bottom: 8px;
      color: #f5f7fb;
    }
    p {
      font-size: 14px;
      color: rgba(245, 247, 251, 0.5);
      line-height: 1.55;
      margin-bottom: 22px;
    }
    button {
      width: 100%;
      min-height: 44px;
      border: 0;
      border-radius: 7px;
      background: #f4d35e;
      color: #17202a;
      font: inherit;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.1s, opacity 0.1s;
    }
    button:hover:not(:disabled) { background: #f7dc74; }
    button:active:not(:disabled) { background: #e8c44a; }
    button:disabled { cursor: progress; opacity: 0.6; }
    .progress {
      height: 2px;
      margin-top: 14px;
      border-radius: 2px;
      background: rgba(255, 255, 255, 0.06);
      overflow: hidden;
    }
    @keyframes sweep {
      0%   { transform: translateX(-100%); }
      100% { transform: translateX(500%); }
    }
    .progress-bar {
      height: 100%;
      width: 20%;
      border-radius: 2px;
      background: rgba(244, 211, 94, 0.7);
      transform: translateX(-100%);
    }
    .progress-bar.running {
      animation: sweep 1.5s ease-in-out infinite;
    }
    output {
      display: block;
      min-height: 16px;
      margin-top: 10px;
      color: rgba(245, 247, 251, 0.38);
      font-family: ui-monospace, "SF Mono", Menlo, "Cascadia Code", monospace;
      font-size: 12px;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <main>
    <div class="badge"><span class="badge-dot"></span>Broker online</div>
    <h1>Start Scout</h1>
    <p>The web app is not running yet. Click to start it on this machine.</p>
    <button id="start" type="button">Start Scout</button>
    <div class="progress"><div class="progress-bar" id="bar"></div></div>
    <output id="status" role="status"></output>
  </main>
  <script>
    const config = ${pageConfig};
    const button = document.getElementById('start');
    const bar = document.getElementById('bar');
    const status = document.getElementById('status');
    const targetPath = window.location.pathname + window.location.search + window.location.hash;
    const healthUrl = new URL('/api/health', window.location.origin);
    const startUrl = new URL(config.startPath, window.location.origin);

    function setStatus(message) {
      status.textContent = message;
    }

    function setWaiting(on) {
      bar.classList.toggle('running', on);
    }

    async function waitForWeb() {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        try {
          const response = await fetch(healthUrl, { headers: { accept: 'application/json' }, cache: 'no-store' });
          if (response.ok) {
            const body = await response.json();
            if (body && body.ok === true) {
              window.location.replace(targetPath || '/');
              return true;
            }
          }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      return false;
    }

    button.addEventListener('click', async () => {
      button.disabled = true;
      setWaiting(true);
      setStatus('Starting Scout web...');
      try {
        const response = await fetch(startUrl, {
          method: 'POST',
          headers: { accept: 'application/json' },
        });
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          throw new Error('Scout broker is not reachable yet.');
        }
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body.error) {
          throw new Error(body.error || 'Scout web did not start.');
        }
        setStatus('Waiting for the web app...');
        const ready = await waitForWeb();
        if (!ready) {
          setWaiting(false);
          setStatus('Scout web did not become ready. Try again in a moment.');
          button.disabled = false;
        }
      } catch (error) {
        setWaiting(false);
        setStatus(error instanceof Error ? error.message : String(error));
        button.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

export function renderOpenScoutCaddyfile(config: OpenScoutLocalEdgeConfig): string {
  const schemes = config.scheme === "both" ? ["http", "https"] as const : [config.scheme] as const;
  const startPage = renderOpenScoutStartPage(config);
  const blocks = schemes
    .flatMap((scheme) =>
      config.routes.map((route) => {
        const host = scheme === "http" ? `http://${route.host}` : route.host;
        return `${host} {\n`
          + (scheme === "https" ? `  tls internal\n` : "")
          + `  handle /__openscout/web/start {\n`
          + `    rewrite * /v1/web/start\n`
          + `    reverse_proxy ${config.brokerUpstream}\n`
          + `  }\n`
          + `  handle /__openscout/web/status {\n`
          + `    rewrite * /v1/web/status\n`
          + `    reverse_proxy ${config.brokerUpstream}\n`
          + `  }\n`
          + `  handle {\n`
          + `    reverse_proxy ${route.upstream} {\n`
          + `      lb_try_duration 1s\n`
          + `      lb_try_interval 250ms\n`
          + `    }\n`
          + `  }\n`
          + `  handle_errors {\n`
          + `    header Content-Type "text/html; charset=utf-8"\n`
          + `    respond <<HTML\n`
          + `${startPage}\n`
          + `HTML 200\n`
          + `  }\n`
          + `}`;
      }),
    )
    .join("\n\n");
  return `${blocks}\n`;
}
