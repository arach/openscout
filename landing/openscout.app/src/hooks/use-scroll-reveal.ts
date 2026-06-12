"use client";

import { useEffect, useRef } from "react";

/**
 * Attaches an IntersectionObserver that adds `.visible` to `.reveal` children
 * once they enter the viewport. Pass a `revisionKey` to re-scan when content
 * swaps (e.g. toggling between copy variants).
 */
export function useScrollReveal<T extends HTMLElement = HTMLElement>(
  revisionKey: string | number = 0,
) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const targets = root.querySelectorAll(".reveal:not(.visible)");
    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
    );

    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [revisionKey]);

  return ref;
}
