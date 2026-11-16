---
target: Dashboard header bar
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\NguyenThanhLong\\Downloads\\auto-assign-repo\\.claude\\worktrees\\admin-payroll-ui-issues-98ff90\\dashboard\\src\\components\\dashboard.tsx"
target_fingerprint: "sha256:5be76c19dea7716f385ef4740574f85f80f289146064fae9c7ed274f53593a10"
target_path: "C:\\Users\\NguyenThanhLong\\Downloads\\auto-assign-repo\\.claude\\worktrees\\admin-payroll-ui-issues-98ff90\\dashboard\\src\\components\\dashboard.tsx"
timestamp: 2026-11-16T06-59-02Z
slug: dashboard-src-components-dashboard-tsx
---
Method: dual-agent (A: design review · B: detector + browser). Scope: the app header bar.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | State is clear (word, knob side, colour), but isRunning starts false so every load flashes red TẮT until the first poll (verified); no pending state on arm; armUntil/armedBy fetched but never shown |
| 2 | Match System / Real World | 3 | BẬT/TẮT and power glyph familiar; "Cập nhật 13:48" doesn't say it is the engine heartbeat |
| 3 | User Control and Freedom | 2 | One click turns the engine off (sticky), no confirm by design and no "Bật lại" undo in the toast |
| 4 | Consistency and Standards | 2 | Main menu and sub-menus styled inversely; red means engine-off, stale heartbeat and items-to-handle; nav uses aria-pressed not aria-current |
| 5 | Error Prevention | 2 | Dangerous switch sits gap-3 from routine Sync; not disabled while its request is in flight |
| 6 | Recognition Rather Than Recall | 2 | No visible label for what the switch controls; pill detail tooltip-only |
| 7 | Flexibility and Efficiency | 2 | No tab shortcuts; Master Setup always lands on Config |
| 8 | Aesthetic and Minimalist Design | 3 | Compact one-line bar; white Sync block and red switch out-shout the content |
| 9 | Error Recovery | 2 | Red stale pill gives no reason or next step without hovering |
| 10 | Help and Documentation | 2 | Only title tooltips |
| **Total** | | **23/40** | **Acceptable** |

## Design Specificity Verdict

LLM: specific to this desk (heartbeat pill, engine switch, per-source sync), one dark strip with three clusters; the new switch is the one decorative, skeuomorphic object, and its saturated red is the loudest thing on the bar.

Deterministic scan: CLI 0 findings in dashboard.tsx. Overlay 4 page findings, none inside the header (local-only Supabase line; slate-400 2.6:1 in the Cần xử lý empty text; white on emerald-600 3.7:1 on "Thêm ngày nghỉ"). Contrast in header: TẮT 4.77, BẬT 5.36, menu 12.0, active 17.8, badge 4.77, pill 8.3. Layout: one line at 1920/1366/1280 and, after lowering the cut-off to 1200px, at 1278 and 1200 with a count badge; phone: menu scrolls sideways with no hint, Master Setup clipped.

## Priority Issues

[P1] Red TẮT is routine — engine auto-disarms nightly (05:30–22:00 window) and every page load flashes red before the first poll; a daytime manual off looks identical; red also means stale heartbeat and items-to-handle. Fix: unknown initial state (neutral), neutral off outside working hours, red only for a manual off in working hours; show "đến 22:00" / "tắt bởi …". Command: colorize, clarify.

[P1] Heartbeat pill grouped with the brand, not the engine — move ServiceStatus beside the switch. Command: layout.

[P1] Focus and hover contrast on the dark bar — focus outline white on the white active item is invisible; switch hover red-500/emerald-600 drops white label to ~3.8:1; pulse ignores reduced motion; pill has no text status for screen readers. Command: harden.

[P2] No in-flight state or undo on the switch — arm() changes nothing until the reply; disarm() flips even if the request failed; toast has no "Bật lại". Command: harden.

[P2] Sync is the loudest control for the rarest job; sub-menus sit below the banners and are styled inversely. Command: quieter, polish.

## Persona Red Flags

Alex: no tab shortcuts; Master Setup resets to Config; sideways-scrolling menu on phone with no hint.
Sam: invisible focus on active tab; hover contrast; colour+pulse-only heartbeat; tooltip-only help; aria-pressed nav.
Supervisor keeping the engine on: red every night and on every load; daytime manual off looks the same; no "until/by whom"; switch next to Sync, no undo.

## Minor Observations

- Badge sits optically high, no sr-only context.
- Sub-menus keep icons at every width; main menu hides them below 2xl.
- Phone pill shows a bare time without "Cập nhật".
- Switch label absolutely positioned in a fixed width — fragile if copy changes.

## Questions to Consider

- If the engine switches itself off at 22:00 nightly, is "off" ever an alarm on its own, or only "off by hand during working hours"?
- Should a dangerous off be a state the whole page wears (a banner), with the control itself quieter?
