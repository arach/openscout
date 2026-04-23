"use client";

import { Monitor, Moon, SunMedium } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  SITE_THEME_COOKIE,
  SITE_THEME_QUERY_PARAM,
  type SiteThemePreference,
  defaultSiteThemeForHost,
  normalizeThemePreference,
} from "@/lib/site-theme";

const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const themeOptions: Array<{
  icon: typeof Monitor;
  label: string;
  value: SiteThemePreference;
}> = [
  { icon: Monitor, label: "Auto", value: "auto" },
  { icon: SunMedium, label: "Light", value: "light" },
  { icon: Moon, label: "Dark", value: "dark" },
];

function writeThemePreference(
  preference: SiteThemePreference,
  defaultTheme: "light" | "dark",
) {
  const resolvedTheme = preference === "auto" ? defaultTheme : preference;
  document.cookie = `${SITE_THEME_COOKIE}=${preference}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`;
  document.documentElement.dataset.siteThemePreference = preference;
  document.documentElement.dataset.siteTheme = resolvedTheme;
}

function readThemePreferenceFromCookie() {
  const match = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${SITE_THEME_COOKIE}=`));

  return normalizeThemePreference(
    match ? decodeURIComponent(match.slice(SITE_THEME_COOKIE.length + 1)) : null,
  );
}

export function SiteThemeToggle() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [defaultTheme, setDefaultTheme] = useState<"light" | "dark">("light");
  const [preference, setPreference] = useState<SiteThemePreference>("auto");

  useEffect(() => {
    const host = window.location.host;
    const nextDefaultTheme = defaultSiteThemeForHost(host);
    const nextPreference = document.documentElement.dataset.siteThemePreference
      ? normalizeThemePreference(document.documentElement.dataset.siteThemePreference)
      : readThemePreferenceFromCookie();
    const params = new URLSearchParams(window.location.search);
    const rawTheme = params.get(SITE_THEME_QUERY_PARAM);

    setDefaultTheme(nextDefaultTheme);

    if (rawTheme) {
      const nextPreference = normalizeThemePreference(rawTheme);
      writeThemePreference(nextPreference, nextDefaultTheme);
      setPreference(nextPreference);
      params.delete(SITE_THEME_QUERY_PARAM);
      const nextSearch = params.toString();
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
      window.history.replaceState({}, "", nextUrl);
      setIsReady(true);
      return;
    }

    writeThemePreference(nextPreference, nextDefaultTheme);
    setPreference(nextPreference);
    setIsReady(true);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function handlePreferenceChange(nextPreference: SiteThemePreference) {
    writeThemePreference(nextPreference, defaultTheme);
    setPreference(nextPreference);
    setIsOpen(false);
  }

  const currentOption =
    themeOptions.find((option) => option.value === preference) ?? themeOptions[0];
  const CurrentIcon = currentOption.icon;

  if (!isReady) {
    return null;
  }

  return (
    <div className="site-theme-toggle" ref={rootRef}>
      <button
        type="button"
        className="site-theme-toggle__button"
        aria-label={`Theme: ${currentOption.label}`}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        title={`Theme: ${currentOption.label}`}
        onClick={() => setIsOpen((open) => !open)}
      >
        <CurrentIcon className="h-4 w-4" strokeWidth={1.8} />
      </button>
      {isOpen ? (
        <div className="site-theme-toggle__menu" aria-label="Theme" role="menu">
          <div className="site-theme-toggle__label">Theme</div>
          {themeOptions.map(({ icon: Icon, label, value }) => {
            const active = preference === value;

            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => handlePreferenceChange(value)}
                className={`site-theme-toggle__option ${active ? "is-active" : ""}`}
                title={label}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
