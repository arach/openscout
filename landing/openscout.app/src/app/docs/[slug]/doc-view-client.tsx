"use client";

import dynamic from "next/dynamic";
import type { DocView as DocViewType } from "./doc-view";

const DocView = dynamic(
  () => import("./doc-view").then((m) => ({ default: m.DocView })),
  { ssr: false },
) as typeof DocViewType;

export { DocView as DocViewClient };
