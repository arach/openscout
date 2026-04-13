"use client";

import { sendGAEvent } from "@next/third-parties/google";
import { GA_MEASUREMENT_ID, isAnalyticsHostAllowed } from "@/lib/analytics-config";

type AnalyticsValue = boolean | number | string;
type AnalyticsParams = Record<string, AnalyticsValue | null | undefined>;

declare global {
  interface Window {
    dataLayer?: Object[];
  }
}

function normalizeParams(params: AnalyticsParams = {}) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null),
  ) as Record<string, AnalyticsValue>;
}

function inferLinkType(destination: string) {
  if (destination.startsWith("#")) {
    return "anchor";
  }

  if (destination.startsWith("http")) {
    return "external";
  }

  return "internal";
}

export function isAnalyticsReady() {
  if (!GA_MEASUREMENT_ID || typeof window === "undefined") {
    return false;
  }

  if (!isAnalyticsHostAllowed(window.location.hostname)) {
    return false;
  }

  return Array.isArray(window.dataLayer);
}

export function trackEvent(eventName: string, params?: AnalyticsParams) {
  if (!isAnalyticsReady()) {
    return;
  }

  sendGAEvent("event", eventName, normalizeParams(params));
}

export function trackCtaClick({
  ctaType,
  destination,
  label,
  location,
}: {
  ctaType: string;
  destination: string;
  label: string;
  location: string;
}) {
  trackEvent("cta_click", {
    cta_destination: destination,
    cta_label: label,
    cta_location: location,
    cta_type: ctaType,
    link_type: inferLinkType(destination),
  });
}

export function trackNavigationClick({
  destination,
  label,
  location,
}: {
  destination: string;
  label: string;
  location: string;
}) {
  trackEvent("navigation_click", {
    link_destination: destination,
    link_label: label,
    link_location: location,
    link_type: inferLinkType(destination),
  });
}

export function trackCommandCopy({
  command,
  commandCount = 1,
  location,
}: {
  command: string;
  commandCount?: number;
  location: string;
}) {
  trackEvent("command_copy", {
    command,
    command_count: commandCount,
    location,
  });
}

export function trackImageExpand({
  imageId,
  location,
}: {
  imageId: string;
  location: string;
}) {
  trackEvent("image_expand", {
    image_id: imageId,
    location,
  });
}

export function trackIntentModalOpen(location: string) {
  trackEvent("intent_modal_open", {
    form_location: location,
    form_name: "hero_intent",
  });
}

export function trackLeadGenerated({
  hasInterest,
  intent,
  location,
}: {
  hasInterest: boolean;
  intent: string;
  location: string;
}) {
  trackEvent("generate_lead", {
    form_location: location,
    form_name: "hero_intent",
    has_interest: hasInterest,
    intent_selected: intent || "unspecified",
  });
}

export function trackFormError({
  errorType,
  intent,
  location,
}: {
  errorType: string;
  intent: string;
  location: string;
}) {
  trackEvent("form_submit_error", {
    error_type: errorType,
    form_location: location,
    form_name: "hero_intent",
    intent_selected: intent || "unspecified",
  });
}

export function trackShowcaseSurfaceSelect({
  audience,
  location,
  surface,
}: {
  audience: string;
  location: string;
  surface: string;
}) {
  trackEvent("showcase_surface_select", {
    audience,
    location,
    surface,
  });
}

export function trackShowcaseViewSelect({
  audience,
  location,
  view,
}: {
  audience: string;
  location: string;
  view: string;
}) {
  trackEvent("showcase_view_select", {
    audience,
    location,
    view,
  });
}
