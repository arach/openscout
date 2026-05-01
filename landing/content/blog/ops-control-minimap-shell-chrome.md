---
title: When the Canvas Became Part of the Shell
subtitle: How design guidance from Hudson turned the Ops Control minimap from a canvas widget into persistent product chrome.
date: 2026-05-01
author: OpenScout
excerpt: The beautiful part started when Codex reached out to Hudson, then turned a minimap request into a stronger product pattern for live agent operations.
---

The best part of the work did not start with a component.

It started when Codex reached out to Hudson for design guidance.

That moment matters because the problem was not simply "add a minimap." A minimap is easy to imagine as a small overlay in the corner of a canvas: a convenience, a spatial reference, a little rectangle that helps users remember where they are. But Ops Control is not a drawing surface. It is a working view into live agent activity, session state, and operational context. The real design question was not where to place a rectangle. It was how to make orientation feel native to the product.

Hudson's guidance shifted the center of gravity.

The minimap should not behave like an object floating above the work. It should feel like shell chrome: part of the surrounding operating surface, stable enough to orient the user, close enough to the canvas to remain useful, and restrained enough to avoid competing with the work itself.

That distinction shaped the implementation.

Ops Control already has a canvas at its core. It is where sessions, agents, and activity can be understood spatially instead of as disconnected rows in a table. The canvas becomes more useful as it grows, but growth creates its own cost. Users need to keep their bearings. They need to move quickly from local detail to global shape, from the active area to the whole system, without losing context.

The minimap solves that navigation problem, but the final design treats it as part of the application frame rather than another canvas node. When the left navigation is open, the minimap docks there. It belongs with the durable controls that define the workspace. It gives the user a constant sense of the canvas without covering the canvas.

When the navigation is minimized, the minimap changes behavior. It becomes floating chrome: still available, still compact, but no longer dependent on the expanded sidebar. That keeps the core promise intact. Minimizing navigation should reclaim space without removing orientation. The user gets more room to work while keeping the spatial tool close at hand.

The quick controls follow the same logic. Fit All, Recenter, and Minimize are small actions, but they are high-leverage actions. They are not buried in a menu because they are not rare settings. They are recovery and navigation tools.

Fit All gives the user the whole operating picture again. Recenter brings attention back to the working area. Minimize gets the minimap out of the way without making it disappear from the product model. Together, these controls make the minimap feel less like a passive preview and more like a navigation instrument.

The filtering work around the canvas reinforces the same product direction. Ops Control is not only about showing Scout sessions. It needs to account for active sessions, recent sessions, native sessions, and non-Scout sessions. That matters because the operational surface should reflect the real environment, not only the subset that fits a single ideal path.

Active sessions answer one question: what is alive right now?

Recent sessions answer another: what just happened, and what might still matter?

Native sessions acknowledge that not every useful process arrives through the same coordination layer.

Non-Scout sessions are especially important because operational tools become less trustworthy when they hide inconvenient reality. If the user knows work is happening somewhere, the canvas should not pretend otherwise just because that session was not born through Scout. Visibility is part of the product contract.

Those filters give users control over density and relevance. The canvas can show the full system, but it does not force the same view on every moment. A debugging pass, a design review, and a live coordination sweep each ask for different levels of noise. The filter model lets the interface flex without changing what Ops Control fundamentally is.

That is why the minimap belongs in the shell. The canvas is the place where the operational graph lives. The shell is the place where users control how they move through it. Docking the minimap in the left nav when available, and letting it float when minimized, preserves that relationship across layouts.

This is the kind of product detail that can look small in a diff. A panel moves. A few controls appear. A minimized state gets another branch. But these choices change how the whole surface feels.

A canvas without orientation eventually becomes a place where users get lost. A minimap trapped inside the canvas can become another thing to manage. A minimap in the shell becomes a promise: wherever the work grows, the product will keep giving you a way back to the whole.

The appealing part of this work is the collaboration pattern underneath it. Codex did not just execute a narrow instruction. It asked Hudson for design direction, absorbed the framing, and then implemented the feature in a way that matched the product's shape. The result was not an ornamental minimap. It was a piece of operational chrome that supports real workflows: scanning active and recent sessions, including native and non-Scout work, fitting the whole canvas, recentering when attention drifts, and staying available whether the nav is open or minimized.

That is where the beautiful part begins: when implementation reaches beyond mechanics and starts carrying product intent.
