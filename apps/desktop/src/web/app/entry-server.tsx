import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";

import App from "@/app";
import "@/styles.css";

function locationPathFromRequestUrl(url: string): string {
  try {
    return new URL(url, "http://scout.desktop").pathname;
  } catch {
    return url.startsWith("/") ? url.split("?")[0] ?? "/" : "/";
  }
}

export async function render(requestUrl: string) {
  const location = locationPathFromRequestUrl(requestUrl);
  return {
    head: "",
    html: renderToString(
      <StaticRouter location={location}>
        <App />
      </StaticRouter>,
    ),
    initialState: null,
  };
}
