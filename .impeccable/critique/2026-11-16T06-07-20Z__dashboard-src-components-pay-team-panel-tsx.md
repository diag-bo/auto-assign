---
target: Lương PT payroll table
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\NguyenThanhLong\\Downloads\\auto-assign-repo\\.claude\\worktrees\\admin-payroll-ui-issues-98ff90\\dashboard\\src\\components\\pay-team-panel.tsx"
target_fingerprint: "sha256:44404526eb34ed3ce7868ffed0aa40a2827a72482b69cec81287632f89f3e598"
target_path: "C:\\Users\\NguyenThanhLong\\Downloads\\auto-assign-repo\\.claude\\worktrees\\admin-payroll-ui-issues-98ff90\\dashboard\\src\\components\\pay-team-panel.tsx"
timestamp: 2026-11-16T06-07-20Z
slug: dashboard-src-components-pay-team-panel-tsx
---
Method: dual-agent (A: design review · B: detector + browser)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Whether payroll's shift file was imported is never shown; pending corrections labelled "Chưa đủ dữ liệu"; month change shows the previous month's tiles until load ends |
| 2 | Match System / Real World | 3 | Vocabulary right; status names the wrong cause; banner "Sửa nhanh" opens a tab called "Không ca" |
| 3 | User Control and Freedom | 3 | Hoàn tác on Nghi vấn and Không duyệt; "Nhập ca từ file" overwrites a month with no preview/undo |
| 4 | Consistency and Standards | 2 | Four date formats; decision buttons 21/32/44px across sibling tabs; approve slate-900 vs emerald; two name renderers |
| 5 | Error Prevention | 2 | ready ignores shifts_imported (route.ts:376); import and bulk "Không duyệt" unconfirmed |
| 6 | Recognition Rather Than Recall | 3 | Hour/km split and mark reasons hover-only; legend folded at the bottom |
| 7 | Flexibility and Efficiency | 2 | No sorting; filters hidden in banners; no jump from a Nghi vấn/Không ca row to that driver's days |
| 8 | Aesthetic and Minimalist Design | 2 | Open counts repeated in badges, banners and columns; ~255px of banners above the table |
| 9 | Error Recovery | 3 | Clear Vietnamese errors per row and per file |
| 10 | Help and Documentation | 3 | Thorough "Cách tính lương"; opening it squeezes the table to 239px |
| **Total** | | **25/40** | **Acceptable** |

## Design Specificity Verdict

LLM: logic now clearly authored for this job — PaidSpan marks only the odd paid edge, BO window in Ca, footer carries payroll figures, Cập nhật công timeline is the best work in the tab. Visual layer is generic Tailwind slate that has accreted a banner per fix.

Deterministic scan: CLI 0 findings. Browser overlay 16 (was 23): undersized-ui-text ×15 = the shared 10px "PT" chip; body-text-viewport-edge ×1 = local Supabase banner (false positive). Không ca tab: nothing inside the panel; overused-font (Inter) page-wide. Contrast now passes everywhere measured (headers 6.9–7.3, weekday 6.9–7.6, tiles 7.6, legend 10.4, badges 5.03 amber / 4.53 rose) except the driver index number on the expanded (slate-100) row, 4.35. Mobile: no overflow, money tiles fit; table scroll area 58px tall under the stacked banners.

## Priority Issues

[P1] "Sẵn sàng chạy lương" can show on unimported shifts — shifts_imported is returned but never displayed and ready ignores it (verified). Fix: status line says "Chưa nhập ca từ file phòng lương" with the import button; exclude from green; show "Đã nhập ca" beside the button. Command: harden.

[P1] One status checklist instead of status line + two banners + badges — red "Chưa đủ dữ liệu" when only corrections are pending; the running period is red all month; banners repeat badge counts. Fix: one checklist row (missing days · file imported · Không ca · Nghi vấn · Cập nhật công), each a link that ticks when done; red only for missing data/unpriced trips; filters become toolbar chips. Command: distill.

[P1] Vào trễ coloured like a to-do — rose semibold in the to-do group and rose row tint like Nghi vấn, though deliberately unresolvable; amber carries three meanings. Fix: Vào trễ in slate right of the divider, no row tint; rose only for Nghi vấn; neutral Cập nhật công badge. Command: colorize.

[P2] The three decision lists don't match — button heights, primary colours, date formats, name renderers; Nghi vấn "Cắt giờ" shows no current paid window or money effect. Fix: one decision-row pattern; Nghi vấn gets the "Đang tính … → Cắt còn …" line; dates link to the driver's day table. Command: polish.

[P2] State and safety gaps — month change keeps last month's figures on screen (verified: load() keeps data until the reply); import writes immediately; bulk Không duyệt unconfirmed. Fix: clear/dim while loading; parse → summary → confirm for the import; confirm bulk decline. Command: harden.

## Persona Red Flags

Alex: no sorting, no keyboard path to next flagged driver, 21px Nghi vấn buttons, identical Ca text repeated 26 times.
Sam: hour/km split, mark reasons, tile hints and column definitions hover-only; tabs lack aria-controls/arrow keys; chevron and banner links lack own focus style; timeline text 11px; little room at 200% zoom.
Payroll supervisor: cannot tell whether payroll's file is in; red all month; green "ready" possible on MISA shifts; cuts Nghi vấn hours blind.

## Minor Observations

- Table capped at max-w-6xl while tiles/banners and sub-lists run full width — right edges don't align.
- Tổng chi has the same weight as "83 Tài xế PT".
- Row index number: no use on a money-sorted list, and 4.35:1 on the open row.
- Corrections legend shows on an empty list; main table loading is a bare spinner.
- Import note is one long undismissable sentence.
- onScroll sets state on every scroll event.
- PT chip 10px (shared component).

## Questions to Consider

- If the tab badges count what's open, what do the amber and rose banners still do that a filter chip couldn't?
- Is "ready" a computed fact or a human sign-off the panel should record?
- Nghi vấn asks for the same arithmetic the corrections timeline removed — why not the same timeline?
