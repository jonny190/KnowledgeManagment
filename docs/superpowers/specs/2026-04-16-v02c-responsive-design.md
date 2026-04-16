# v0.2-C Mobile / Responsive UI

**Date:** 2026-04-16
**Status:** Approved design, ready for implementation planning
**Builds on:** v0.2.2 (Foundation + Phase 2-5 + email + AI write tools + per-note ACLs)

## Context

The current UI is desktop-first. Sidebars (file tree, AI chat panel, backlinks) are permanent fixed-width columns; context menus rely on right-click; the file tree uses HTML5 drag-and-drop. On a phone the layout simply breaks: the editor area is squeezed to nothing, two right-side panels overlap, and key actions (rename, move, delete) are unreachable. v0.2-C ships a "doesn't look broken" responsive pass: collapsible drawers, a small mobile top bar, and touch-friendly menus. Editing on phone is utilitarian but works; reading is comfortable.

## Goals

- All pages render usably at viewport widths down to 360px.
- File tree, AI chat panel, and backlinks panel become off-canvas drawers below the `md` breakpoint, opened from a small mobile top bar.
- Tree items expose a 3-dot menu replacing right-click + drag for touch users.
- CodeMirror tweaks prevent iOS auto-zoom and keyboard layout jumps.
- `NoteShareDialog` becomes responsive.
- A new Playwright project exercises the major flows at iPhone-14-Pro viewport.

Out of scope:

- Touch-friendly diagram editing (drawio and bpmn-js are clumsy on touch; documented as known limitation).
- Native app shells.
- Bottom-tab navigation.
- Keyboard shortcuts on mobile.
- Visual redesign of any component beyond layout adjustments.

## Stack additions

| Concern | Choice |
|---|---|
| Breakpoint | `md` (768px). Below = mobile, at/above = desktop. |
| Drawer pattern | Off-canvas, `transform: translate-x` transitions, backdrop overlay |
| Touch menu | 3-dot button per tree item, popover with full action set |
| Pointer detection | `usePointerType()` based on `matchMedia("(hover: hover)")` |
| Editor mobile config | CodeMirror theme + content attributes; no new packages |
| Test viewport | Playwright `projects` entry `chromium-mobile`, 390 x 844 |

## Layout primitives

Two new components in `apps/web/src/components/`:

- **`MobileTopBar.tsx`** - visible only `md:hidden`. Renders the page title or note title in the centre and up to three icon buttons on the right (file tree, AI chat, backlinks). Each button toggles its drawer. Note pages render all three; vault home renders just the file tree icon; standalone settings or auth pages omit the bar entirely.

- **`Drawer.tsx`** - generic off-canvas component:
  ```ts
  interface DrawerProps {
    open: boolean;
    onClose: () => void;
    side: "left" | "right";
    title?: string;
    children: ReactNode;
  }
  ```
  Behaviour: full-width on phone, half-width on tablet (`sm:max-w-md`). Closes on backdrop click, Escape key, or route change (via `usePathname` listener). Locks `document.body.style.overflow = "hidden"` while open and restores on close.

A small client-side hook in `apps/web/src/hooks/usePointerType.ts`:

```ts
export function usePointerType(): "touch" | "mouse";
```

Returns `"mouse"` when `matchMedia("(hover: hover)").matches`, else `"touch"`. SSR-safe (returns `"mouse"` on the server then re-renders if needed).

## Per-page changes

**Note page** (`apps/web/src/app/(app)/vault/[vaultId]/note/[noteId]/page.tsx`):

- Header collapses on mobile: title truncates to single line; "Share" becomes icon-only with screen-reader text; Live indicator + ActiveUsers stack vertically.
- Below `md`: editor takes full width. File tree, backlinks, and AI chat panels move into three drawers.
- Two right drawers (backlinks, chat) are mutually exclusive: opening one closes the other.

**Vault home** (`apps/web/src/app/(app)/vault/[vaultId]/page.tsx`):

- File tree becomes the main column on mobile. Tags sidebar moves to a left drawer accessed from the top bar.

**Workspaces / Members / Settings pages**: verify forms and tables wrap. Tables overflow with `overflow-x-auto`.

**Public viewer** (`/public/n/[slug]`): already minimal. Add `viewport-fit=cover` and ensure the markdown content uses a fluid `max-w-prose mx-auto` container.

## Touch interactions on the file tree

`FileTreeItem.tsx` gains a 3-dot button to the right of each label.

- Visibility:
  - Mobile (touch, no hover): always visible.
  - Desktop (hover-capable): shown on row hover (`opacity-0 group-hover:opacity-100 focus-within:opacity-100`).
- Click: opens a popover (anchored to the button) with: **Rename**, **Delete**, **Move**, **New note**, **New folder**, **New diagram**.
- "Move" opens a new `MovePicker` modal (`apps/web/src/components/MovePicker.tsx`) listing folders in the current vault as a tap-friendly tree; pick one to move the item there.
- The popover closes on outside-click and Escape.

Existing `onContextMenu` (right-click) and HTML5 `draggable` stay for desktop. On touch devices the `draggable` attribute is a no-op in browsers, so no removal needed.

## Editor mobile tweaks

In `packages/editor/src/NoteEditor.tsx` add to the existing extensions array:

```ts
EditorView.theme({
  "&": { fontSize: "16px" },
  ".cm-scroller": { overflowAnchor: "none" },
  ".cm-content": { padding: "12px 14px", caretColor: "currentColor" },
}),
EditorView.contentAttributes.of({
  autocapitalize: "sentences",
  autocorrect: "on",
  spellcheck: "true",
}),
```

Reasons:
- `fontSize: 16px` prevents iOS Safari from auto-zooming on focus.
- `overflowAnchor: none` stops scroll jumps when the on-screen keyboard appears or hides.
- Padding gives finger-sized hit margins.

In `apps/web/src/app/globals.css`:

```css
.cm-tooltip-autocomplete {
  max-width: calc(100vw - 24px);
}
```

Stops the wiki-link autocomplete tooltip from overflowing the viewport on narrow phones.

## NoteShareDialog responsive pass

In `apps/web/src/components/NoteShareDialog.tsx`:

- Modal container: `w-full max-w-md mx-4 my-8` (was a fixed pixel width). Centred but with margin.
- Add-share row stacks below `sm`: `flex-col sm:flex-row gap-2`.
- Public-link slug display wraps on narrow widths: `break-all` on the URL element so it does not force horizontal scroll.

Same pattern applied to `MovePicker` and any other dialog that touches v0.2-C.

## Viewport meta

Add to `apps/web/src/app/layout.tsx`:

```tsx
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};
```

Next.js App Router exports a `Viewport` type from `next` for this purpose.

## Testing

- **Unit (Vitest):**
  - `Drawer.tsx`: open/close, backdrop dismiss, ESC key, body scroll lock toggling.
  - `usePointerType`: returns `"mouse"` when matchMedia matches, `"touch"` otherwise; SSR-safe.
  - `MobileTopBar` smoke renders given prop variants.

- **Integration:** none for v0.2-C. Pure UI.

- **Playwright:** new project `chromium-mobile` in `playwright.config.ts`:
  ```ts
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    {
      name: "chromium-mobile",
      use: { browserName: "chromium", viewport: { width: 390, height: 844 } },
      testMatch: /responsive\.spec\.ts$/,
    },
  ];
  ```
  New spec `apps/web/playwright/responsive.spec.ts` covers:
  - Signup at 390px width: form fits, no horizontal overflow, can submit.
  - Note page at 390px: mobile top bar visible, file-tree drawer opens on tap, closes on backdrop tap, editor accepts text.
  - File tree 3-dot menu opens and lists "Rename", "Delete", "Move", "New note".
  - NoteShareDialog at 390px fits viewport with no horizontal scroll.

## Documentation

- `docs/architecture.md` - new "Responsive layout" subsection describing breakpoints, drawer pattern, and the touch menu approach.
- `guides/mobile.md` - end-user paragraph: app works on phone (read + edit + chat); diagram editors are desktop-only; drag-to-move is desktop-only.

## Open items deferred to implementation

- Exact icon set for the mobile top bar (small SVGs vs emoji vs `lucide-react`). Pick during implementation; emoji works without a new dep.
- Whether to ship `MovePicker` in v0.2-C or stub the Move action with a "use desktop for now" notice. Implementer judgement; spec assumes ship.
- Autocomplete tooltip positioning on the very first character of a wiki-link near the right edge (CodeMirror does not always reposition mid-stream); leave as-is unless trivially fixable.
