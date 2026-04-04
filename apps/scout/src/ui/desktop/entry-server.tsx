import { renderToString } from "react-dom/server";

import App from "@/app";
import "@/styles.css";

export async function render(_url: string) {
  return {
    head: "",
    html: renderToString(<App />),
    initialState: null,
  };
}
