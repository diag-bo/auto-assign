---
target: Lương PT payroll table
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\NguyenThanhLong\\Downloads\\auto-assign-repo\\.claude\\worktrees\\admin-payroll-ui-issues-98ff90\\dashboard\\src\\components\\pay-team-panel.tsx"
target_fingerprint: "sha256:0b3fa03ac4ab750dc421285e1c0dd13c659b3aa62136bc174b480a046bb8dd5f"
target_path: "C:\\Users\\NguyenThanhLong\\Downloads\\auto-assign-repo\\.claude\\worktrees\\admin-payroll-ui-issues-98ff90\\dashboard\\src\\components\\pay-team-panel.tsx"
timestamp: 2026-11-16T03-39-16Z
slug: dashboard-src-components-pay-team-panel-tsx
---
Method: dual-agent (A: design review · B: detector + browser)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Loading/import/pending clear; which sub-view is open and whether the period is ready for payroll is not |
| 2 | Match System / Real World | 3 | Payroll vocabulary is right; "Tháng 11/2026" = 15/10–14/11 lives on a separate grey line |
| 3 | User Control and Freedom | 2 | "‹ Bảng lương" can return to the wrong sub-view (confirmed bug); Sửa nhanh approvals have no undo |
| 4 | Consistency and Standards | 2 | Three different mode switches; uppercase vs sentence-case headers; ISO vs dd/mm dates; rose used for both alarms and "Lễ ×3" |
| 5 | Error Prevention | 2 | "Chỉ hiện 0 tài xế" is a dead filter; bulk "Duyệt n ngày" moves money with no confirmation |
| 6 | Recognition Rather Than Recall | 2 | Ca / Chấm công / Chuyến / Tính giờ compared in the head; definitions only in title tooltips |
| 7 | Flexibility and Efficiency | 2 | No sort, no "next flagged driver", one driver open at a time, Vào trễ has no filter |
| 8 | Aesthetic and Minimalist Design | 2 | Scattered toolbar, sparse full-width table, always-on fine print, "BO 9h00" on every row |
| 9 | Error Recovery | 3 | Clear Vietnamese errors; import names unmatched accounts |
| 10 | Help and Documentation | 2 | Rule explained only as an 11px wall or hover tooltips |
| **Total** | | **23/40** | **Acceptable** |

## Design Specificity Verdict

LLM: content is unmistakably Diag payroll (Không ca, Nghi vấn, BO Runner, Lịch ca, 15th–14th period); the form is a stock admin template (five equal KPI tiles, full-width slate table, fine-print footer). The corrections timeline is the one authored decision tool; the day table, where the same comparison happens ~30 times per driver, falls back to four text columns of time ranges.

Deterministic scan: CLI detector 0 findings across pay-team-panel, pay-no-shift-panel, pay-corrections-panel (Tailwind classes invisible to static scan). Browser overlay: 23 findings — undersized-ui-text 15 (10px "PT" chip, one per row = one pattern), low-contrast 4 (day-table header 4.3:1; weekday "T5"/"CN" text-slate-400 2.4–2.6:1 on white/amber/rose rows), tiny-text 2 (11px footer, late note), line-length 1 (footer ~179 chars/line), body-text-viewport-edge 1 (false positive: local Supabase-not-configured error). Mobile 375px: toolbar buttons clipped off-screen, search overlaps CSV, summary money values truncated ("222.784"), table scroll area 67px tall.

## Priority Issues

[P1] Three view toggles, wrong way back — Cập nhật công (toolbar), Sửa nhanh (amber banner), Xem danh sách (rose banner) each swap the main area via separate booleans; Cập nhật công does not clear the other two, so Sửa nhanh → Cập nhật công → "‹ Bảng lương" lands on Sửa nhanh. Fix: one view state, a tab row Bảng lương · Không ca (n) · Nghi vấn (n) · Cập nhật công (n); banners link into tabs. Command: layout.

[P1] Day table makes the supervisor do the arithmetic — Ca shows 15:00–21:30 while Tính giờ shows 06:00–21:30, explained only by "BO 9h00" in green on every row. Fix: Ca from parts ("06:00–15:00 BO · 15:00–21:30"); highlight only the Tính giờ end that falls outside Ca/Chấm công; state BO once on the driver row; add a total row. Command: distill.

[P1] Done looks like a warning; no ready state — amber banner stays with a "Chỉ hiện 0 tài xế" filter when all Không ca days are handled; no positive "ready for payroll" signal. Fix: neutral line + hide filter at 0; emerald "Sẵn sàng chạy lương" when coverage.ready and nothing open. Command: harden.

[P2] Column layout fights reading across — name at x≈40, Nghi vấn at x≈1970; day table ~700px wide with ~570px empty; toolbar spread by justify-between. Fix: cap width, move flag columns next to the name (or one "Cần xử lý" chips column), group toolbar. Command: layout.

[P2] Contrast, tiny text, colour-only flags — weekday 2.6:1, day header 4.3:1, 11px uppercase headers with Vietnamese accents, definitions in title only, row tints as sole flag. Fix: slate-500/600 minimum, sentence-case text-xs headers, left border on flagged rows, visible legend. Command: audit, typeset.

## Persona Red Flags

Alex (power user): no sort by flags, no keyboard path to next flagged driver, expand only via 24px chevron, toolbar actions ~1900px apart.
Sam (accessibility): contrast failures above; 11px text; tooltip-only definitions; tint-only row flags; rose for holidays reads as alarm.
Payroll supervisor (before the 25th): no per-driver resolved state; Vào trễ can never be resolved so its column never reaches zero; list sorted by money not by open work; red blocking banner is the smallest text on the page.

## Minor Observations

- Pay period line belongs beside the month picker.
- Empty state says "làm ngoài ca" when the Nghi vấn filter is active; onlyLate actually filters suspect days.
- Sticky offset top-[76px] is hard-coded; breaks if a driver row wraps.
- Km has decimals in day rows, whole numbers in the driver row.
- 31/10 pays 9h03 with 0 trips and no flag.
- Footer: stale "Tải CSV để lấy số chính xác", ISO dates; collapse into a details "Cách tính lương".
- Mobile layout clips toolbar and money tiles (desk tool, low priority).

## Questions to Consider

- Should the first screen before the 25th be the to-do list, with the payroll table second?
- The corrections timeline already solves "compare four windows" — why not a thin timeline bar per day row?
- Should Vào trễ get a ruling (like Nghi vấn) or become a day note only?
- Is đ/km thực a payroll question or a Hiệu Suất question?
