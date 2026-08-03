# Scout Native Look-and-Feel Pass

## Objective

Implement a focused visual-polish pass for the Scout Messages/channel experience as it appears inside the native macOS Scout app. The acceptance surface is the native Scout window, not a standalone localhost browser tab.

Use this reference capture as the baseline:

`/Users/arach/Library/Application Support/Talkie/Screenshots/Talkie Capture - 2026-08-02 22.43.22 - Window Scout - 2560x1557 - 7d904798.png`

This is an implementation task, not a design memo. Explore two or three inexpensive treatments through screenshot loops, keep the strongest coherent treatment, and remove abandoned variants.

## Work preservation

- Inspect `git status` and the existing diffs before editing.
- The checkout is intentionally dirty, including existing work in `ConversationScreen.tsx`, `conversation-model.ts`, `conversation-screen.css`, `MessageEmbeds.tsx`, server image handling, and unrelated packages. Preserve it all.
- Do not stash, reset, discard, or overwrite existing changes.
- Keep the implementation narrowly scoped to the native Messages/channel presentation. Do not touch unrelated dirty files.
- Do not commit or push. Return the finished working-tree changes for review.

## Design direction

Keep Scout recognizably Scout: dark, precise, local-first, technical, and restrained. Improve compression and hierarchy rather than introducing a new visual identity.

Priorities, in order:

1. Make the conversation the focal surface. Improve body-text contrast and reading rhythm; reserve mono typography for metadata, identifiers, telemetry, and code.
2. Use the large desktop canvas intentionally. Avoid a narrow reading lane clinging to the left edge of a wide empty center pane. Test centered and modestly wider message treatments at the reference window size.
3. Establish clearer plane hierarchy between navigation, conversation list, message canvas, and inspector using restrained tonal separation. Reduce low-value hairlines and nested boxes.
4. Simplify the channel header. The full channel title must remain legible. Compress participant/runtime treatment; cap visible participants and move secondary model/runtime detail into tooltips or the inspector where appropriate.
5. Make the right side behave visually like a macOS inspector: compact overview first, selected detail second. Avoid several equally prominent nested agent cards.
6. Improve selected, unread, working, and needs-attention states so color has one clear semantic job. Keep the green accent sparse.
7. If the existing data model supports it without guessing, collapse repeated identical outbound kickoff/dispatch messages into one compact orchestration event such as `Sent to 6 agents`, with recipients/status available on expansion. If semantic grouping is not reliable, leave behavior unchanged and improve only the visual repetition.
8. Preserve keyboard navigation, accessibility, resizing, message actions, routing, and current behavior.

## Native acceptance loop

1. Inspect the existing implementation and current dirty diff before choosing files.
2. Capture the current native Scout window at a comparable size.
3. Try two or three coherent treatments using real code, capturing the native window after each meaningful milestone.
4. Keep the strongest treatment and remove experimental leftovers.
5. For a sufficiently large update, rebuild and relaunch with the canonical suite command: `bun run scout:up --no-ios`.
6. Verify the actual native Scout window after relaunch. A browser capture may help diagnose shared web content but is not final acceptance.
7. Run the narrowest relevant checks and tests, including `bun run --cwd packages/web check` if the web-backed message surface changes.

## Return

Report:

- the treatment chosen and why;
- screenshots from the native Scout window;
- files changed;
- checks run and exact results;
- any existing dirty files deliberately left untouched;
- any follow-up visual ideas intentionally deferred.
