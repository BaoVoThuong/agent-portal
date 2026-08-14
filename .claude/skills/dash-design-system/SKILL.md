---
name: dash-design-system
description: >
  Design tokens, theming and the 23 UI primitives for dashboards in Next.js — the
  tokens.css custom-property palette, the data-theme light/dark and data-density contract,
  type scale, radius, app shell, .row grid and breakpoints, and the primitive catalogue
  (metric tile, card, section title, eyebrow, narrative, coverage banner, chip, segmented
  control, tabs, expander, data table, page header, BLUF card, callout, status pill, number
  table, distribution bar, formula strip, compare card, definition affordances, section banner, heat-shaded cell, insight renderer).
  This is the
  ONLY source of colour in the product — install tokens.css before writing any dashboard
  markup and before any chart, because the charts resolve these same variables at runtime
  and render broken chrome without them.
  TRIGGERS: dash design system, dash tokens, tokens.css, data-theme, data-density, design
  token, CSS custom property, dashboard dark mode, dashboard palette, frozen entity colour,
  accent vs brand, metric tile, KPI tile, glance tile, chip, badge, segmented control,
  expander, coverage banner, BLUF card, status pill, number table, .tnum, tabular numbers,
  app shell, sidebar nav, .row grid, dashboard breakpoint, dashboard styling, new primitive,
  series colours, chart palette, chart has no colours.
---

# Dashboard — Design System

The visual contract every page in the system shares. Every value below is ported verbatim
from a production analytics dashboard, where it has been validated in light and dark.
Follow it exactly and a new Next.js page is indistinguishable from an existing one.


**Sibling skills:** charts → `dash-charts` · data shapes → `dash-data-contract` ·
page composition → `dash-page-patterns`.

---

## 1. Setup — do this first

Copy `references/tokens.css` into `app/styles/tokens.css` and import it once in the root
layout, **before** any other stylesheet. Then set the theme attributes on `<html>`:

```tsx
// app/layout.tsx
import "./styles/tokens.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" data-density="compact">
      <body>{children}</body>
    </html>
  );
}
```

Fonts: **Inter** (UI + headings) and **JetBrains Mono** (code, IDs, table keys).
Use `next/font/google`; bind them to `--font` and `--mono`.

```tsx
import { Inter, JetBrains_Mono } from "next/font/google";
const inter = Inter({ subsets: ["latin"], weight: ["400","500","600","700"], variable: "--font-inter" });
const mono  = JetBrains_Mono({ subsets: ["latin"], weight: ["400","500"], variable: "--font-mono" });
// then in tokens.css:  --font: var(--font-inter), -apple-system, …;
```

Base font size is **15px**, not 16. Set it on `html`.

Then the two stylesheets that build on it, imported **in this order**:

```tsx
import "./styles/tokens.css";      // this skill — colour, radius, spacing, density, shell, grid
import "./styles/primitives.css";  // this skill — references/primitives.md, the 23 components
import "./styles/page.css";        // dash-page-patterns — references/page-css.css, page composition
```

Nothing in this system asks you to transcribe CSS by hand. If a class is referenced and
missing, it is in one of those three files.

---

## 2. The three hard rules

These are the rules the source codebase enforces in comments and in code. Breaking any
one of them is what makes a page look "off" even when every hex is right.

### Rule 1 — Never hardcode a colour in a component

Every colour comes from a CSS variable. This is not a style preference: **the charts read
the same variables at runtime via `getComputedStyle`**, so a hardcoded hex in markup
silently desynchronises the page from its charts on theme switch.

```css
/* ✅ */  .thing { color: var(--text); border: 1px solid var(--border); }
/* ❌ */  .thing { color: #111827; border: 1px solid #E5E7EB; }
```

### Rule 2 — Semantic colours are switchable; identity colours are frozen

`--accent` is a themeable brand accent (section rules, active tab, nav highlight, links).
The **entity identity colours** (`--entity-a` … `--entity-g`) are **frozen** — each slot
belongs to one named thing in your product, and that thing must render the same hue on
every chart, table, legend and dot across the whole product.

> From the source: `/* component colors — FIXED, never recolored by accent */`

Two things to do on day one:

1. **Rename the slots to your entities** (`--entity-compute`, `--entity-storage`, …) and
   rename the matching keys in `ENTITY_ORDER` in the same commit — `dash-charts` derives the
   variable name from the key. Keep the seven hexes: they are validated pairwise-distinct on
   both light and dark surfaces.
2. **Pin the order.** The order is part of the contract, not a detail: it fixes bottom-up
   position in stacks, clockwise-from-12 in donuts, and left-to-right in waterfalls, so one
   entity never moves slot between two charts on the same page.

A second entity family gets its **own prefixed block** (`--channel-*`, `--tier-*`) — never
reuse one family's slots for another, or the same hue comes to mean two things.

### Rule 3 — Delta polarity is per-metric, not global

A number going up is not automatically good. The system carries an `inverse` flag per
metric:

- `inverse: true` (**cost semantics**, the default in the source): up = **red**, down = **green**
- `inverse: false` (**volume/quality semantics**): up = **green**, down = **red**

```css
.metric .dlt.up            { color: var(--bad); }   /* cost up = bad */
.metric .dlt.down          { color: var(--good); }
.metric .dlt.up.normal     { color: var(--good); }  /* volume up = good */
.metric .dlt.down.normal   { color: var(--bad); }
```

Arrows: `▲` for up, `▼` for down, `▬` for flat. Never rely on colour alone.

---

## 3. Token reference

Full values live in `references/tokens.css`. The shape of the system:

### Surfaces & text — four-step depth, three-step ink

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F9FAFB` | `#0B0F19` | Page background |
| `--card` | `#F3F4F6` | `#1E2640` | Recessed fill: table headers, tooltips, inset strips |
| `--surface` | `#FFFFFF` | `#141A2E` | Raised fill: cards, tiles, popovers |
| `--border` / `--grid` | `#E5E7EB` | `#2A3354` | Hairlines and chart gridlines (same value, two names) |
| `--text` | `#111827` | `#E2E8F0` | Primary ink |
| `--muted` | `#4B5563` | `#94A3B8` | Labels, axis ticks, secondary ink |
| `--subtle` | `#6B7280` | `#7C8AA5` | Captions, footnotes, tertiary ink |

Give every raised element `background: var(--surface)` + `border: 1px solid var(--border)`.
**Do not put `box-shadow` on a card, tile or table.** Use `--shadow-sm` only on the glance
hero and floating layers.

### Status & brand

| Token | Light | Dark | Meaning |
|---|---|---|---|
| `--good` | `#1E8E3E` | `#34D399` | Pass, improving, favourable |
| `--bad` | `#D93025` | `#F87171` | Fail, breach, unfavourable |
| `--brand` | `#059669` | `#10B981` | Emerald — the product primary |
| `--accent` | `#F59E0B` | `#F59E0B` | Amber — UI accent, **constant across themes** |
| `--accent-soft` | `rgba(245,158,11,0.12)` | same | Accent wash for active states |
| `--warn-bg / -fg / -rule` | `#FEF7E0` / `#5F4B00` / `#F9AB00` | `#2A2410` / `#F6D27A` / `#B7791F` | Caveat banner |

Accent alternatives that ship in the source (pick one at build time, do not offer a picker):
amber `#F59E0B` · emerald `#059669` · blue `#3B82F6` · violet `#8B5CF6`.

### Radius, density, type

```
--r-sm 4px · --r 8px · --r-lg 12px
```

Set `data-density="compact"` on `<html>`. **Never set `data-density` on a subtree** — the five
variables below are read by descendants that assume one value per document.

| Var | compact | regular | comfy |
|---|---|---|---|
| `--pad-block` | 1.4rem | 2.25rem | 2.75rem |
| `--pad-x` | 1.6rem | 2.25rem | 2.75rem |
| `--gap` | 0.5rem | 0.85rem | 1.15rem |
| `--tile-pad` | .85rem 1rem | 1.1rem 1.2rem | 1.35rem 1.4rem |
| `--metric-val` | 1.85rem | 2rem | 2.1rem |

Type scale (rem, all Inter unless noted):

| Role | Size | Weight | Notes |
|---|---|---|---|
| Page title `h1` | 1.7 | 700 | `letter-spacing: -0.02em` |
| Section head `h2` | 1.3 | 700 | `-0.02em` |
| Section title chip | 1.12 | 600 | 3px `--accent` left border |
| Body / nav | 0.9 | 500 | |
| Metric value | `var(--metric-val)` | 600 | `.tnum` — always tabular |
| Metric label | 0.82 | 500 | `--muted` |
| Eyebrow | 0.72 | 700 | uppercase, `letter-spacing: .07em`, `--muted` |
| Caption / footnote | 0.72–0.76 | 400 | `--subtle` |
| Table body | 0.86 | 400 | |
| Chip / badge | 0.78 | 600 | |

**Add `.tnum` to every metric value, numeric table cell, delta and axis-adjacent figure.**
Without it, digits change width between renders and a column of numbers stops being scannable.

---

## 4. Light / dark contract

Light is the base declaration on `:root`; dark **overrides only what changes** under
`[data-theme="dark"]`. Never define a colour whose only declaration is inside the dark
block — that leaves light undefined.

```css
:root { --text: #111827; /* …full light palette… */ }
[data-theme="dark"] { --text: #E2E8F0; /* …only the deltas… */ }
```

Switch themes by writing `document.documentElement.dataset.theme`. **Do not thread a theme
value through props or re-render components to change colour** — CSS handles the page, and
charts re-read the variables (see `dash-charts`, "Theme rebuild").

If you support "system", resolve it to a concrete `light`/`dark` value before writing the
attribute; downstream code should never see the string `system`.

---

## 5. App shell

```
┌──────────┬────────────────────────────────────────┐
│ sidebar  │  main                                   │
│ 290px    │   └ block  (max-width 1400px, centred,  │
│ sticky   │            padded --pad-block/--pad-x)  │
│ 100vh    │                                         │
└──────────┴────────────────────────────────────────┘
```

- Sidebar: `290px` fixed, `--sidebar-bg`, right hairline, sticky full height, own scroll
- Main content: `max-width: 1400px`, centred, `padding: var(--pad-block) var(--pad-x) 3rem`
- Nav item: 16px icon + label, `--r` radius; active = `--accent-soft` fill + `inset 2px 0 0 var(--accent)` left bar + weight 600
- Nav group label: eyebrow style, `--subtle`

In Next.js the sidebar is a real layout with `<Link>`. The source opens nav links in a new
tab only because it was sandboxed in an iframe — **do not carry that over**.

### Grid

One utility family covers nearly all layout:

```css
.row   { display: grid; gap: var(--gap); }
.row-2 { grid-template-columns: 1fr 1fr; }
.row-3 { grid-template-columns: repeat(3, 1fr); }
.row-4 { grid-template-columns: repeat(4, 1fr); }
.row-5 { grid-template-columns: repeat(5, 1fr); }
```

Choose the column count from the item count, capped at 4 for KPI rows (5 only for the
glance hero). Trailing cells stay **empty** — never stretch a card to fill a row.

### Responsive

Three breakpoints, applied to grids only:

```css
@media (max-width: 1180px) { .glance-grid { grid-template-columns: repeat(3, 1fr); } }
@media (max-width:  820px) { .row-5,.row-4,.row-3,.row-2 { grid-template-columns: 1fr 1fr; } }
@media (max-width:  560px) { .row-5,.row-4,.row-3,.row-2 { grid-template-columns: 1fr; } }
```

Wrap any table wider than its card in a div with `overflow: auto; max-height: 440px`, and set
`position: sticky; top: 0` on `thead th`. The page body must never scroll horizontally.

---

## 6. Primitives

Twenty-three components cover ~95% of every page. **Check this table before writing any new
CSS** — the primitive almost always exists. Full markup + CSS in `references/primitives.md`.

**Core (1–12)**

| Primitive | Class | Use for |
|---|---|---|
| **Metric tile** | `.metric` | A single KPI: label + big value + delta + sub-line. The workhorse |
| **Card** | `.card` | Container for a chart or table. Surface + border + `--r-lg` |
| **Section title** | `.section-title` | Question-style heading with a 3px left rule |
| **Eyebrow** | `.eyebrow` | Tiny uppercase label above a KPI row or block |
| **Narrative card** | `.narrative` | One auto-generated insight sentence under a section head |
| **Coverage banner** | `.coverage-banner` | Amber caveat strip: data gap, proxy, partial coverage |
| **Chip** | `.chip` (+`.good`/`.bad`/`.info`) | Status pill, count badge, legend swatch+label |
| **Segmented control** | `.seg` | 2–5 exclusive short options (period, view mode, level) |
| **Tabs** | `.tabs` / `.tab` | Primary view switch. Reads as a heading, not body text |
| **Expander** | `.expander` (`<details>`) | Progressive disclosure of deep tables/detail |
| **Data table** | `.df` | A list of records. `.num` right-aligns, `.mono` for IDs |
| **Page header** | `.page-head` | Title + caption left, date picker / status right |

**Analytical (13–20)** — these carry the argument, not just the data

| Primitive | Class | Use for |
|---|---|---|
| **BLUF card** | `.bluf` | The conclusion, first, as bullets — before any chart |
| **Callout** | `.callout` `.note`/`.insight` | Boxed aside. note = how to read it · insight = what it says |
| **Status pill** | `.pill-status` | Vocabulary → tone, tinted from one hue via hex-alpha |
| **Number table** | `.numtbl` | Measure × period matrix with Δ column and Total row |
| **Distribution bar** | `.distbar` | A category mix in one horizontal bar |
| **Formula strip** | `.formula` | When the arithmetic itself is the point |
| **Compare card** | `.cmpcard` | Two entities, one metric, with Δ / CI / significance |
| **Definition affordances** | `.help`, glossary | `?` glyph → chart hint → glossary expander |
| **Section banner** | `.section-banner` | Full-width top-level divider — the alternative to `.section-title` |
| **Heat-shaded cell** | `heatCell()` | Measure × period matrix, each column on its own ramp |
| **Insight renderer** | `.insight` | Renders the `Insight` payload: metric + delta badge + trend rows |

Build these two composites once and import them everywhere:

- **Glance hero** — 5-tile status band at the top of a report page (`dash-page-patterns` §3)
- **Chart card** — card + title + hint + optional right-side control + chart (`dash-page-patterns` §5)

### One conflict to know about

`.section-title` uses `var(--accent)` (amber) for its left rule. Some source pages
deliberately use `var(--brand)` (emerald) instead, to line up with pages that render
outside the themed-accent context. **Pick one per app and hold it** — mixing them across
pages of the same product is the actual defect. This skill's default is `--accent`.

### Icons

Lucide-style: 24×24 viewBox, `fill="none"`, `stroke="currentColor"`, `stroke-width="2"`,
round caps and joins, rendered at 13–16px. Use `lucide-react` in Next.js — it is the same
visual language as the hand-rolled set in the source.

---

## 7. Writing a new component

Before you write CSS, check the table in §6 — the primitive probably exists. If you do
need something new:

1. Compose from tokens only (Rule 1). No new hex, no new px radius, no new font size
   outside the scale in §3.
2. Depth = `--surface` fill + `1px solid var(--border)`, not a shadow.
3. Numbers get `.tnum`. IDs, codes and table keys get `var(--mono)` at `0.9em`.
4. Interactive states: hover shifts background toward `--card`; active/selected uses
   `--accent-soft` + an `inset 2px 0 0 var(--accent)` rail or a 2px bottom border.
5. Transitions are `150ms` on `background` / `color` / `border-color`. Nothing else animates.
6. Add it to `references/primitives.md` so the next page reuses it instead of re-inventing it.

---

## 8. Checklist before shipping a screen

- [ ] Zero literal colours in component files — everything via `var(--…)`
- [ ] Renders correctly with `data-theme="dark"` (check charts too)
- [ ] Every comparable number uses `.tnum`
- [ ] Deltas carry the right `inverse` polarity for their metric
- [ ] Entity colours match the frozen map used elsewhere in the product
- [ ] Grid collapses cleanly at 1180 / 820 / 560px; no horizontal page scroll
- [ ] Wide tables scroll inside their card with a sticky header
- [ ] No drop shadows except the hero / floating layers
