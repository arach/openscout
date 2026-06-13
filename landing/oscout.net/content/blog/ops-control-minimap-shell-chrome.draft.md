---
title: When the Canvas Became Part of the Shell
subtitle: How design guidance from Hudson turned the Ops Control minimap from a canvas widget into persistent product chrome.
date: 2026-05-01
author: OpenScout
excerpt: The beautiful part started when Codex reached out to Hudson, then turned a minimap request into a stronger product pattern for live agent operations.
---

The best part of the work did not start with a component. It started when Codex reached out to Hudson for design guidance.

Ops Control is not a drawing surface. It is a working view into live agent activity, session state, and operational context—and at scale, the canvas loses the user. The real design question was not where to place a rectangle. It was how to make navigation feel native to the product.

Hudson's guidance shifted the center of gravity. The minimap should not behave like an object floating above the work. It should feel like shell chrome: part of the surrounding frame, stable enough to orient the user, close enough to the canvas to remain useful, and restrained enough to avoid competing with the work itself.

Ops Control already has a canvas at its core—where sessions, agents, and activity can be understood spatially instead of as disconnected rows in a table. The minimap solves the navigation problem that canvas growth creates, but the final design treats it as part of the application frame rather than another canvas node. When the left navigation is open, the minimap docks there, alongside the durable controls that define the workspace. It gives the user a constant sense of the canvas without covering the canvas.

When the navigation is minimized, the minimap becomes floating chrome: still available, still compact, but no longer dependent on the expanded sidebar. Minimizing navigation reclaims space without removing orientation—the user gets more room to work while keeping the spatial tool close at hand.

The quick controls follow the same logic. Fit All, Recenter, and Minimize are not buried in a menu because users hit them constantly. Fit All restores the whole operating picture. Recenter brings attention back to the working area. Minimize clears the minimap without removing it from the product model.

The filtering model reinforces this directly. Ops Control needs to surface active sessions, recent sessions, native sessions, and non-Scout sessions—because the canvas should reflect the real environment, not only the subset that fits a single ideal path. Active and recent sessions answer what is happening now and what just mattered; native and non-Scout sessions ensure that work born outside Scout does not disappear from view. Operational tools become less trustworthy when they hide inconvenient reality. Those four filter types give users control over density without changing what Ops Control fundamentally is—and they make the minimap's job harder to ignore: if the canvas can represent the full system, the shell needs to keep users oriented across all of it.

That is why docking the minimap in the left nav when available, and letting it float when minimized, preserves that relationship across layouts.

This is the kind of detail that can look small in a diff. A panel moves. A few controls appear. A minimized state gets another branch. But a canvas without orientation becomes a place where users get lost, and a minimap trapped inside the canvas becomes another thing to manage. Codex did not execute a narrow instruction—it asked Hudson for design direction, absorbed the framing, and implemented a piece of operational chrome that supports real workflows: scanning active and recent sessions, including native and non-Scout work, fitting the whole canvas, recentering when attention drifts, and staying available whether the nav is open or minimized.

