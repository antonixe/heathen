# Design System

## Direction

Velocity Desk is a modern SaaS dashboard for one analyst monitoring YouTube release velocity. The interface uses soft card surfaces, subtle layered shadows, rounded corners, generous whitespace, and a single indigo brand accent over a neutral gray ramp. It ships light and dark themes and treats both as first-class: every color flows through one token set, so all surfaces — including charts, sparklines, and the heatmap — re-theme automatically.

Data remains the hero: numeric evidence is set in Geist Mono with tabular figures, semantic state colors are reserved for meaning, and the register of tracked releases stays the primary object on screen.

## Theming

- Tokens are defined once in `src/index.css`: `:root` holds the light palette, `.dark` the dark palette, over identical custom-property names (OKLCH).
- `public/theme-init.js` (an external classic script — the CSP forbids inline scripts) applies the saved theme before first paint. The preference lives in `localStorage` under `velocityDesk.theme` (`'light' | 'dark'`, absent = follow system).
- `src/hooks/useTheme.js` exposes `{ theme, resolved, setTheme }`; the command bar has a quick light/dark toggle and Settings → Appearance offers the three-way Light / Dark / System control.
- `color-scheme` is set per theme so native controls and scrollbars match.

## Color

- **Brand:** `--primary` is indigo (oklch 0.55 0.19 275 light / 0.70 0.15 275 dark). It marks the primary action, active navigation, focus rings, polling accents, sparklines, and heatmap intensity.
- **Neutrals:** near-white canvas with white cards in light; deep slate canvas with raised slate cards in dark (`--background`, `--card`, `--muted`, `--accent`, `--border`).
- **Semantic:** green `--success` (healthy acceleration, positive completion), amber `--warning` (stale, paused, quota), red `--destructive` (failures, unavailable content, missed targets, irreversible actions). Soft washes (`--success-soft`, `--warning-soft`, `--danger-soft`) tint row and card backgrounds; in dark theme they are dark-tinted equivalents.
- Semantic color is never decorative and never works alone; every colored treatment pairs with explicit text.
- **Charts:** `--chart-1..5` (indigo, green, amber, red, neutral) plus core tokens; Recharts, sparkline, and heatmap styling reference CSS variables only.

## Typography

Geist Variable for interface text; Geist Mono for counts, velocities, timestamps, IDs, quota, and table values (`.metric` applies tabular lining figures). Product headings stay between 14 and 24px; hierarchy comes from weight, size, and spacing.

## Shape, elevation, motion

- Radius scale from `--radius: 0.5rem`: controls and inputs 6px (`md`), cards and fields 8px (`lg`), boards and dialogs 12px (`xl`); meters and badges may be full pills.
- Shadows: `--shadow-xs/sm/md/lg` — low-alpha layered shadows in light, heavier in dark. Cards use xs/sm; overlays use lg (`--shadow-panel` aliases it).
- Motion: 120–180ms color/opacity/shadow transitions with `--ease-out`; polling may animate one small progress track; `prefers-reduced-motion` disables all animation globally.

## Layout

- Desktop: a 68px icon sidebar (`--sidebar-*` tokens) and a card command bar with search, quota, theme toggle, and the indigo "Track release" CTA.
- The rundown: a masthead with four KPI stat cards (Tracked, Fresh, Session gain, Attention), a card-contained register with a segmented filter control, an uppercase micro column header, bordered rows with hover states, and per-row trend sparklines at `lg`.
- Release detail is a full view swap (not a dialog): themed topbar, identity masthead with stat cards, an accent-bordered deadline rail, a context sidebar, and segmented evidence tabs (Overview, Milestones, Notes, History) built on Radix Tabs.
- Breakpoints follow Tailwind `md` (768) and `lg` (1024) for structure; 420/540px survive only as content breakpoints. No page-level horizontal overflow from 320px up; only intrinsically two-dimensional surfaces (heatmap, history table) scroll inside bounded regions. Overlays go full-screen below `md`; touch targets are at least 44px there.

## State model

Release rows keep explicit states — sampling, tracking, polling, surging, stale, observation gap, paused, quota, error, unavailable — signalled by a 3px inset edge plus soft background tint (indigo for polling, green surge, amber stale/paused/quota, red error/unavailable) always paired with a text label. Loading, empty, filtered-empty, and overlay states use distinct copy and recovery actions inside card-styled empty panels.

## Actions and recovery

Low-risk edits happen inline. Irreversible release deletion uses a staged confirmation inside the affected row. Clearing the database requires typing CLEAR. Imports are validated, previewed, and preceded by an automatic backup download. Confirmation friction scales with consequence.

## Accessibility

- A skip link ("Skip to release rundown") is the first focusable element.
- All tab bars expose `role="tablist"` with `aria-controls`/`aria-labelledby` panel wiring (Radix supplies it in the detail view; manual ids elsewhere).
- Opening a release focuses the detail topbar; closing restores focus to the opener or the rundown main.
- `:focus-visible` rings use `--ring` (indigo); `forced-colors: active` restores borders where color alone would signal state; reduced motion is honored globally.

## Components

shadcn/radix primitives (Button, Dialog, Sheet, Tabs, Badge, Alert, Card, Input, Select, Switch, Table, Tooltip, ScrollArea, Progress, Skeleton, Separator) styled through the token set. Custom surfaces (release rows, KPI cards, heatmap, sparkline, quota meter) live in `src/index.css` and `src/operator-surfaces.css` — both inside `@layer components`, so utility classes can always override them and token changes propagate everywhere.
