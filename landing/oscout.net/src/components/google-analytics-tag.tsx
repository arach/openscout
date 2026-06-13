"use client";

import { useEffect, useState } from "react";
import { GoogleAnalytics } from "@next/third-parties/google";
import {
  ENABLE_GOOGLE_ANALYTICS,
  GA_MEASUREMENT_ID,
  isAnalyticsHostAllowed,
} from "@/lib/analytics-config";

export function GoogleAnalyticsTag() {
  const [enabledForHost, setEnabledForHost] = useState(false);

  useEffect(() => {
    setEnabledForHost(isAnalyticsHostAllowed(window.location.hostname));
  }, []);

  if (!ENABLE_GOOGLE_ANALYTICS || !enabledForHost) {
    return null;
  }

  return <GoogleAnalytics gaId={GA_MEASUREMENT_ID} />;
}
