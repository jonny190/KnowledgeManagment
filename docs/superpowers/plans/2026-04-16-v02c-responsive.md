# v0.2-C Mobile / Responsive UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the entire web app usable at viewport widths down to 360px by turning the three permanent side panels into off-canvas drawers, exposing a touch-friendly 3-dot menu on every file-tree row, tuning CodeMirror for iOS Safari, and adding a Playwright project that exercises the flows at a 390x844 viewport.

**Architecture:** Two new primitives in `apps/web/src/components/` (`Drawer.tsx` and `MobileTopBar.tsx`) plus one hook (`apps/web/src/hooks/usePointerType.ts`) carry the responsive pattern. The note page and vault home wire these primitives in so the file tree, backlinks, and AI chat become drawers below the `md` (768px) breakpoint. `FileTreeItem` grows a popover menu that replaces right-click + drag on touch devices; that menu's "Move" action opens a new `MovePicker.tsx` modal. CodeMirror changes ship as two extensions added to the existing array inside `packages/editor/src/NoteEditor.tsx`. `NoteShareDialog` and `MovePicker` adopt the same responsive modal pattern. A new Playwright project `chromium-mobile` runs one spec file `responsive.spec.ts` covering signup, note-page drawers, the 3-dot menu, and the share dialog.

**Tech Stack:** Next.js 14 App Router, React 18, Tailwind (already configured in apps/web), CodeMirror 6 (`@codemirror/view`, `@codemirror/state`), Vitest 2 (`node` env by default; component tests use `// @vitest-environment jsdom`), `@testing-library/react`, Playwright 1.47 (viewport override via `projects[].use.viewport`).

---

## File Structure

**Create:**

- `apps/web/src/components/Drawer.tsx`
- `apps/web/src/components/Drawer.test.tsx`
- `apps/web/src/components/MobileTopBar.tsx`
- `apps/web/src/components/MobileTopBar.test.tsx`
- `apps/web/src/components/MovePicker.tsx`
- `apps/web/src/components/FileTreeItemMenu.tsx`
- `apps/web/src/hooks/usePointerType.ts`
- `apps/web/src/hooks/usePointerType.test.ts`
- `apps/web/playwright/responsive.spec.ts`
- `guides/mobile.md`

**Modify:**

- `apps/web/src/app/layout.tsx` (add `export const viewport`)
- `apps/web/src/app/globals.css` (add `.cm-tooltip-autocomplete` max-width rule)
- `apps/web/src/app/(app)/vault/[vaultId]/note/[noteId]/page.tsx` (replace fixed-width sidebars with drawers, collapse header on mobile, mount `MobileTopBar`)
- `apps/web/src/app/(app)/vault/[vaultId]/page.tsx` (file tree becomes main column below `md`, tags sidebar moves to a left drawer)
- `apps/web/src/components/FileTree.tsx` (add a `moveInto` handler passed into `FileTreeItem`; expose a `folders` list computed from the tree for `MovePicker`)
- `apps/web/src/components/FileTreeItem.tsx` (add the 3-dot button, pointer-aware visibility, wire `FileTreeItemMenu`, drop `window.prompt` action chooser on right-click in favour of opening the same menu)
- `apps/web/src/components/NoteShareDialog.tsx` (responsive container, wrapping URL, stacked add-share row)
- `apps/web/src/components/AiChatPanel.tsx` (remove its self-hosted open/close state; become a pure content component; expose `AiChatPanel({ vaultId, noteId, onApplyAtCursor, registerCommandRunner })` that always renders its body, with its open/close controlled by the parent drawer)
- `apps/web/src/components/BacklinksPanel.tsx` (strip any fixed width so it fits inside a drawer)
- `packages/editor/src/NoteEditor.tsx` (extend the existing extensions array with the two mobile tweaks)
- `apps/web/playwright.config.ts` (add `chromium-mobile` project entry)
- `apps/web/vitest.config.ts` (add `@testing-library/jest-dom` match pattern is not required; leave include list as-is — jsdom is opted in per-file)
- `apps/web/package.json` (add devDependencies: `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`)
- `docs/architecture.md` (new "Responsive layout" subsection)

---

### Task 1: Viewport meta export

**Files:**
- Modify: `apps/web/src/app/layout.tsx`

- [ ] **Step 1: Add `viewport` export to the root layout**

Replace the current `layout.tsx` with:

```tsx
import "./globals.css";
import "@/styles/theme.css";
import type { ReactNode } from "react";
import type { Viewport } from "next";
import { Providers } from "./providers";

export const metadata = {
  title: "Knowledge Management",
  description: "Web-based knowledge management platform",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('km:theme');if(!t||t==='system')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <Providers>
          <header className="border-b p-2 flex gap-3 text-sm">
            <a href="/workspaces" className="underline">Workspaces</a>
            <a href="/api/auth/signout" className="underline">Sign out</a>
          </header>
          {children}
        </Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @km/web typecheck`
Expected: PASS (no new errors).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/layout.tsx
git commit -m "feat(web): export viewport meta from root layout"
```

---

### Task 2: Add jsdom + testing-library dev dependencies

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Add four devDependencies**

Add these entries to the `devDependencies` block of `apps/web/package.json` (alphabetical insertion):

```json
"@testing-library/jest-dom": "6.5.0",
"@testing-library/react": "16.0.1",
"@testing-library/user-event": "14.5.2",
"jsdom": "25.0.1",
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: resolves without errors; `node_modules/@testing-library/react` exists.

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore(web): add jsdom + testing-library for component tests"
```

---

### Task 3: `usePointerType` hook (TDD)

**Files:**
- Create: `apps/web/src/hooks/usePointerType.ts`
- Create: `apps/web/src/hooks/usePointerType.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/hooks/usePointerType.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePointerType } from "./usePointerType";

function mockMatchMedia(hoverMatches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(hover: hover)" ? hoverMatches : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("usePointerType", () => {
  it("returns 'mouse' when (hover: hover) matches", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => usePointerType());
    expect(result.current).toBe("mouse");
  });

  it("returns 'touch' when (hover: hover) does not match", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => usePointerType());
    expect(result.current).toBe("touch");
  });

  it("is SSR-safe: returns 'mouse' when window is undefined", () => {
    // Simulate SSR by checking the module-level guard used by the hook.
    // The hook's initial state defaults to 'mouse' when matchMedia is unavailable.
    const original = window.matchMedia;
    // @ts-expect-error force undefined
    delete window.matchMedia;
    const { result } = renderHook(() => usePointerType());
    expect(result.current).toBe("mouse");
    window.matchMedia = original;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @km/web test src/hooks/usePointerType.test.ts`
Expected: FAIL with "Cannot find module './usePointerType'".

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/hooks/usePointerType.ts`:

```ts
import { useEffect, useState } from "react";

export type PointerType = "touch" | "mouse";

function detect(): PointerType {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "mouse";
  }
  return window.matchMedia("(hover: hover)").matches ? "mouse" : "touch";
}

export function usePointerType(): PointerType {
  const [type, setType] = useState<PointerType>("mouse");
  useEffect(() => {
    setType(detect());
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mq = window.matchMedia("(hover: hover)");
    const handler = () => setType(mq.matches ? "mouse" : "touch");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return type;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @km/web test src/hooks/usePointerType.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/usePointerType.ts apps/web/src/hooks/usePointerType.test.ts
git commit -m "feat(web): add usePointerType hook with matchMedia"
```

---

### Task 4: `Drawer` component (TDD)

**Files:**
- Create: `apps/web/src/components/Drawer.tsx`
- Create: `apps/web/src/components/Drawer.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/components/Drawer.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Drawer } from "./Drawer";

// Mock next/navigation's usePathname because Drawer closes on route change.
let mockPathname = "/a";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

beforeEach(() => {
  mockPathname = "/a";
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

describe("Drawer", () => {
  it("renders children when open", () => {
    render(
      <Drawer open onClose={() => {}} side="left">
        <p>hello</p>
      </Drawer>,
    );
    expect(screen.getByText("hello")).toBeDefined();
  });

  it("does not render children when closed", () => {
    render(
      <Drawer open={false} onClose={() => {}} side="left">
        <p>hello</p>
      </Drawer>,
    );
    expect(screen.queryByText("hello")).toBeNull();
  });

  it("calls onClose on backdrop click", () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose} side="right">
        <p>body</p>
      </Drawer>,
    );
    fireEvent.click(screen.getByTestId("drawer-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape key", () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose} side="left">
        <p>body</p>
      </Drawer>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("locks body scroll while open and restores on close", () => {
    const { rerender } = render(
      <Drawer open onClose={() => {}} side="left">
        <p>body</p>
      </Drawer>,
    );
    expect(document.body.style.overflow).toBe("hidden");
    rerender(
      <Drawer open={false} onClose={() => {}} side="left">
        <p>body</p>
      </Drawer>,
    );
    expect(document.body.style.overflow).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @km/web test src/components/Drawer.test.tsx`
Expected: FAIL with "Cannot find module './Drawer'".

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/components/Drawer.tsx`:

```tsx
"use client";
import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side: "left" | "right";
  title?: string;
  children: ReactNode;
}

export function Drawer({ open, onClose, side, title, children }: DrawerProps) {
  const pathname = usePathname();

  // Close on route change.
  useEffect(() => {
    if (open) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Escape key dismiss.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Body scroll lock.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const sideClass =
    side === "left"
      ? "left-0 top-0 bottom-0 border-r"
      : "right-0 top-0 bottom-0 border-l";

  return (
    <div className="fixed inset-0 z-40">
      <div
        data-testid="drawer-backdrop"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-label={title ?? "Drawer"}
        className={`absolute ${sideClass} w-full sm:max-w-md bg-white dark:bg-slate-900 shadow-xl flex flex-col`}
      >
        {title ? (
          <header className="flex items-center justify-between border-b p-3">
            <h2 className="text-sm font-medium">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close drawer"
              className="text-sm underline"
            >
              Close
            </button>
          </header>
        ) : null}
        <div className="flex-1 overflow-auto">{children}</div>
      </aside>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @km/web test src/components/Drawer.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/Drawer.tsx apps/web/src/components/Drawer.test.tsx
git commit -m "feat(web): add Drawer primitive with ESC, backdrop, scroll lock"
```

---

### Task 5: `MobileTopBar` component (TDD)

**Files:**
- Create: `apps/web/src/components/MobileTopBar.tsx`
- Create: `apps/web/src/components/MobileTopBar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/MobileTopBar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { MobileTopBar } from "./MobileTopBar";

afterEach(cleanup);

describe("MobileTopBar", () => {
  it("renders title in the centre", () => {
    render(<MobileTopBar title="My Note" buttons={[]} />);
    expect(screen.getByText("My Note")).toBeDefined();
  });

  it("renders each button and fires onClick", () => {
    const onFiles = vi.fn();
    const onChat = vi.fn();
    render(
      <MobileTopBar
        title="x"
        buttons={[
          { key: "files", label: "Files", onClick: onFiles },
          { key: "chat", label: "AI", onClick: onChat },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onChat).toHaveBeenCalledTimes(1);
  });

  it("is hidden at md+ via md:hidden class on the root", () => {
    const { container } = render(<MobileTopBar title="x" buttons={[]} />);
    expect(container.firstElementChild?.className).toContain("md:hidden");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @km/web test src/components/MobileTopBar.test.tsx`
Expected: FAIL with "Cannot find module './MobileTopBar'".

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/components/MobileTopBar.tsx`:

```tsx
"use client";
import type { ReactNode } from "react";

export interface MobileTopBarButton {
  key: string;
  label: string;
  icon?: ReactNode;
  onClick: () => void;
}

export interface MobileTopBarProps {
  title: string;
  buttons: MobileTopBarButton[];
}

export function MobileTopBar({ title, buttons }: MobileTopBarProps) {
  return (
    <div className="md:hidden sticky top-0 z-30 flex items-center justify-between gap-2 border-b bg-white dark:bg-slate-900 p-2">
      <div className="w-24 shrink-0" />
      <h1 className="flex-1 truncate text-center text-sm font-medium">{title}</h1>
      <div className="flex w-24 shrink-0 justify-end gap-1">
        {buttons.map((b) => (
          <button
            key={b.key}
            type="button"
            onClick={b.onClick}
            aria-label={b.label}
            className="rounded px-2 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {b.icon ?? b.label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @km/web test src/components/MobileTopBar.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/MobileTopBar.tsx apps/web/src/components/MobileTopBar.test.tsx
git commit -m "feat(web): add MobileTopBar component"
```

---

### Task 6: CodeMirror mobile tweaks

**Files:**
- Modify: `packages/editor/src/NoteEditor.tsx`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Extend the editor extensions array**

Open `packages/editor/src/NoteEditor.tsx`. Inside the `extensions: [...]` array in `EditorState.create`, insert the following two entries immediately before `EditorView.lineWrapping`:

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

- [ ] **Step 2: Add CodeMirror autocomplete tooltip clamp**

Append to `apps/web/src/app/globals.css`:

```css
.cm-tooltip-autocomplete {
  max-width: calc(100vw - 24px);
}
```

- [ ] **Step 3: Typecheck + build editor**

Run: `pnpm --filter @km/editor build` (if a build script exists) then `pnpm --filter @km/web typecheck`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/NoteEditor.tsx apps/web/src/app/globals.css
git commit -m "feat(editor): mobile-friendly CodeMirror theme + attributes"
```

---

### Task 7: `MovePicker` modal

**Files:**
- Create: `apps/web/src/components/MovePicker.tsx`

- [ ] **Step 1: Implement the picker**

Create `apps/web/src/components/MovePicker.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";

export interface MovePickerFolder {
  id: string;
  name: string;
  path: string;
}

export interface MovePickerProps {
  open: boolean;
  vaultId: string;
  itemLabel: string;
  onCancel: () => void;
  onPick: (targetFolderId: string) => void;
}

interface TreeNode {
  id: string;
  name: string;
  path: string;
  children: TreeNode[];
}

function flatten(node: TreeNode, depth: number, acc: MovePickerFolder[]) {
  acc.push({ id: node.id, name: node.name || "(root)", path: node.path });
  for (const c of node.children) flatten(c, depth + 1, acc);
}

export function MovePicker({ open, vaultId, itemLabel, onCancel, onPick }: MovePickerProps) {
  const [folders, setFolders] = useState<MovePickerFolder[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`/api/vaults/${vaultId}/tree`)
      .then((r) => r.json())
      .then((body: { root: TreeNode }) => {
        if (cancelled || !body.root) return;
        const acc: MovePickerFolder[] = [];
        flatten(body.root, 0, acc);
        setFolders(acc);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, vaultId]);

  if (!open) return null;
  return (
    <div role="dialog" aria-label="Move" className="fixed inset-0 z-50 flex items-start justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-md mx-4 my-8 rounded bg-white dark:bg-slate-900 shadow-xl">
        <header className="flex items-center justify-between border-b p-3">
          <h2 className="text-sm font-medium">Move {itemLabel}</h2>
          <button type="button" onClick={onCancel} className="text-sm underline">Cancel</button>
        </header>
        <ul className="max-h-[60vh] overflow-auto p-2">
          {folders.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => onPick(f.id)}
                className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <span className="font-medium">{f.name}</span>
                {f.path ? <span className="ml-2 text-xs text-slate-500">{f.path}</span> : null}
              </button>
            </li>
          ))}
          {folders.length === 0 ? (
            <li className="p-3 text-sm text-slate-500">No folders.</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @km/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/MovePicker.tsx
git commit -m "feat(web): add MovePicker modal for touch folder selection"
```

---

### Task 8: `FileTreeItemMenu` popover

**Files:**
- Create: `apps/web/src/components/FileTreeItemMenu.tsx`

- [ ] **Step 1: Implement the popover**

Create `apps/web/src/components/FileTreeItemMenu.tsx`:

```tsx
"use client";
import { useEffect, useRef, type RefObject } from "react";

export interface FileTreeItemMenuProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement>;
  kind: "folder" | "note" | "drawio" | "bpmn";
  onRename?: () => void;
  onDelete?: () => void;
  onMove?: () => void;
  onNewNote?: () => void;
  onNewFolder?: () => void;
  onNewDrawio?: () => void;
  onNewBpmn?: () => void;
}

export function FileTreeItemMenu(p: FileTreeItemMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!p.open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(t) && p.anchorRef.current && !p.anchorRef.current.contains(t)) {
        p.onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") p.onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [p.open, p.onClose, p.anchorRef]);

  if (!p.open) return null;

  const items: Array<{ label: string; handler?: () => void }> = [];
  if (p.kind === "folder") {
    items.push(
      { label: "New note", handler: p.onNewNote },
      { label: "New folder", handler: p.onNewFolder },
      { label: "New diagram", handler: p.onNewDrawio },
      { label: "New process (BPMN)", handler: p.onNewBpmn },
      { label: "Rename", handler: p.onRename },
      { label: "Move", handler: p.onMove },
      { label: "Delete", handler: p.onDelete },
    );
  } else {
    items.push(
      { label: "Rename", handler: p.onRename },
      { label: "Move", handler: p.onMove },
      { label: "Delete", handler: p.onDelete },
    );
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      className="absolute right-0 top-full z-20 mt-1 min-w-[10rem] rounded border bg-white dark:bg-slate-900 shadow-lg"
    >
      <ul className="py-1">
        {items
          .filter((i) => typeof i.handler === "function")
          .map((i) => (
            <li key={i.label}>
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  i.handler?.();
                  p.onClose();
                }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {i.label}
              </button>
            </li>
          ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @km/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/FileTreeItemMenu.tsx
git commit -m "feat(web): add FileTreeItemMenu popover"
```

---

### Task 9: Wire 3-dot menu + move action into `FileTreeItem`

**Files:**
- Modify: `apps/web/src/components/FileTreeItem.tsx`
- Modify: `apps/web/src/components/FileTree.tsx`

- [ ] **Step 1: Extend `FileTree.tsx` with a `moveInto` handler and `MovePicker` state**

Replace the contents of `apps/web/src/components/FileTree.tsx` with:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileTreeItem, TreeNode, TreeItem } from "./FileTreeItem";
import { MovePicker } from "./MovePicker";

type PendingMove =
  | { kind: "folder"; id: string; label: string }
  | { kind: "note"; id: string; label: string }
  | null;

export function FileTree({ vaultId }: { vaultId: string }) {
  const router = useRouter();
  const [root, setRoot] = useState<TreeNode | null>(null);
  const [items, setItems] = useState<TreeItem[]>([]);
  const [pendingMove, setPendingMove] = useState<PendingMove>(null);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/vaults/${vaultId}/tree`);
    const data = await res.json();
    setRoot(data.root);
    if (Array.isArray(data.items)) {
      setItems(data.items as TreeItem[]);
    } else if (Array.isArray(data.notes)) {
      setItems(
        (data.notes as Array<{ id: string; title: string; folderId: string | null }>).map(
          (n) => ({ id: n.id, title: n.title, kind: "note" as const, folderId: n.folderId }),
        ),
      );
    }
  }, [vaultId]);

  useEffect(() => { reload(); }, [reload]);

  async function createFolder(parentId: string) {
    const name = window.prompt("Folder name?");
    if (!name) return;
    await fetch("/api/folders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vaultId, parentId, name }),
    });
    await reload();
  }

  async function createNote(folderId: string) {
    const title = window.prompt("Note title?");
    if (!title) return;
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vaultId, folderId, title }),
    });
    const data = await res.json();
    await reload();
    if (data.note) router.push(`/vault/${vaultId}/note/${data.note.id}`);
  }

  async function createDrawio(folderId: string) {
    const title = window.prompt("Diagram title?", "Untitled diagram");
    if (!title) return;
    const res = await fetch("/api/diagrams", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vaultId, folderId, kind: "DRAWIO", title }),
    });
    const data = await res.json();
    await reload();
    if (data.id) router.push(`/vault/${vaultId}/diagram/${data.id}`);
  }

  async function createBpmn(folderId: string) {
    const title = window.prompt("Process title?", "Untitled process");
    if (!title) return;
    const res = await fetch("/api/diagrams", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vaultId, folderId, kind: "BPMN", title }),
    });
    const data = await res.json();
    await reload();
    if (data.id) router.push(`/vault/${vaultId}/diagram/${data.id}`);
  }

  async function renameFolder(id: string, current: string) {
    const name = window.prompt("Rename folder", current);
    if (!name || name === current) return;
    await fetch(`/api/folders/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await reload();
  }

  async function deleteFolder(id: string) {
    if (!window.confirm("Delete this folder and all contents?")) return;
    await fetch(`/api/folders/${id}`, { method: "DELETE" });
    await reload();
  }

  async function dropInto(targetFolderId: string, kind: "folder" | "note", id: string) {
    if (kind === "folder") {
      await fetch(`/api/folders/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parentId: targetFolderId }),
      });
    } else {
      await fetch(`/api/notes/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folderId: targetFolderId }),
      });
    }
    await reload();
  }

  function requestMove(kind: "folder" | "note", id: string, label: string) {
    setPendingMove({ kind, id, label });
  }

  async function confirmMove(targetFolderId: string) {
    if (!pendingMove) return;
    await dropInto(targetFolderId, pendingMove.kind, pendingMove.id);
    setPendingMove(null);
  }

  if (!root) return <div>Loading tree...</div>;
  return (
    <>
      <ul>
        <FileTreeItem
          vaultId={vaultId}
          node={root}
          items={items}
          onCreateFolder={createFolder}
          onCreateNote={createNote}
          onCreateDrawio={createDrawio}
          onCreateBpmn={createBpmn}
          onRenameFolder={renameFolder}
          onDeleteFolder={deleteFolder}
          onDropInto={dropInto}
          onRequestMove={requestMove}
        />
      </ul>
      <MovePicker
        open={pendingMove !== null}
        vaultId={vaultId}
        itemLabel={pendingMove?.label ?? ""}
        onCancel={() => setPendingMove(null)}
        onPick={confirmMove}
      />
    </>
  );
}
```

- [ ] **Step 2: Extend `FileTreeItem.tsx` with the 3-dot button and menu**

Replace the contents of `apps/web/src/components/FileTreeItem.tsx` with:

```tsx
"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { FileTreeItemMenu } from "./FileTreeItemMenu";
import { usePointerType } from "@/hooks/usePointerType";

export interface TreeItem {
  id: string;
  title: string;
  kind: "note" | "drawio" | "bpmn";
  folderId: string | null;
}

export interface TreeNode {
  id: string;
  name: string;
  path: string;
  children: TreeNode[];
  notes: Array<{ id: string; title: string; slug: string }>;
}

function itemIcon(kind: "note" | "drawio" | "bpmn"): string {
  if (kind === "drawio") return "[D]";
  if (kind === "bpmn") return "[B]";
  return "[N]";
}

function itemHref(vaultId: string, item: TreeItem): string {
  if (item.kind === "note") return `/vault/${vaultId}/note/${item.id}`;
  return `/vault/${vaultId}/diagram/${item.id}`;
}

interface Props {
  vaultId: string;
  node: TreeNode;
  items?: TreeItem[];
  onCreateFolder: (parentId: string) => void;
  onCreateNote: (folderId: string) => void;
  onCreateDrawio: (folderId: string) => void;
  onCreateBpmn: (folderId: string) => void;
  onRenameFolder: (id: string, currentName: string) => void;
  onDeleteFolder: (id: string) => void;
  onDropInto: (targetFolderId: string, kind: "folder" | "note", id: string) => void;
  onRequestMove: (kind: "folder" | "note", id: string, label: string) => void;
}

function ThreeDotButton({
  alwaysVisible,
  onClick,
  buttonRef,
  label,
}: {
  alwaysVisible: boolean;
  onClick: () => void;
  buttonRef: React.RefObject<HTMLButtonElement>;
  label: string;
}) {
  const baseClass =
    "ml-auto rounded px-1 text-sm leading-none hover:bg-slate-100 dark:hover:bg-slate-800";
  const visibilityClass = alwaysVisible
    ? ""
    : "opacity-0 group-hover:opacity-100 focus-within:opacity-100";
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={`Actions for ${label}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`${baseClass} ${visibilityClass}`}
    >
      ...
    </button>
  );
}

export function FileTreeItem(p: Props) {
  const [open, setOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const pointer = usePointerType();
  const folderBtnRef = useRef<HTMLButtonElement | null>(null);

  const folderItems = (p.items ?? []).filter((item) => item.folderId === p.node.id);

  return (
    <li
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const kind = e.dataTransfer.getData("kind") as "folder" | "note";
        const id = e.dataTransfer.getData("id");
        if (id) p.onDropInto(p.node.id, kind, id);
      }}
    >
      <div
        className="group relative flex items-center gap-1"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("kind", "folder");
          e.dataTransfer.setData("id", p.node.id);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuOpen(true);
        }}
      >
        <button onClick={() => setOpen(!open)} className="w-4">{open ? "v" : ">"}</button>
        <span>{p.node.name === "" ? "(root)" : p.node.name}</span>
        <ThreeDotButton
          alwaysVisible={pointer === "touch"}
          buttonRef={folderBtnRef}
          label={p.node.name || "root"}
          onClick={() => setMenuOpen((v) => !v)}
        />
        <FileTreeItemMenu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          anchorRef={folderBtnRef}
          kind="folder"
          onNewNote={() => p.onCreateNote(p.node.id)}
          onNewFolder={() => p.onCreateFolder(p.node.id)}
          onNewDrawio={() => p.onCreateDrawio(p.node.id)}
          onNewBpmn={() => p.onCreateBpmn(p.node.id)}
          onRename={() => p.onRenameFolder(p.node.id, p.node.name)}
          onDelete={() => p.onDeleteFolder(p.node.id)}
          onMove={
            p.node.name === ""
              ? undefined
              : () => p.onRequestMove("folder", p.node.id, p.node.name)
          }
        />
      </div>
      {open && (
        <ul className="pl-4">
          {p.node.children.map((c) => (
            <FileTreeItem key={c.id} {...p} node={c} />
          ))}
          {folderItems.length > 0
            ? folderItems.map((item) => (
                <ItemRow
                  key={item.id}
                  vaultId={p.vaultId}
                  item={item}
                  onRequestMove={p.onRequestMove}
                  pointer={pointer}
                />
              ))
            : p.node.notes.map((n) => (
                <li
                  key={n.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("kind", "note");
                    e.dataTransfer.setData("id", n.id);
                  }}
                >
                  <Link href={`/vault/${p.vaultId}/note/${n.id}`}>{n.title}</Link>
                </li>
              ))}
        </ul>
      )}
    </li>
  );
}

function ItemRow({
  vaultId,
  item,
  onRequestMove,
  pointer,
}: {
  vaultId: string;
  item: TreeItem;
  onRequestMove: (kind: "folder" | "note", id: string, label: string) => void;
  pointer: "touch" | "mouse";
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("kind", "note");
        e.dataTransfer.setData("id", item.id);
      }}
      className="group relative flex items-center gap-1"
    >
      <span style={{ marginRight: "0.25rem", fontSize: "0.75rem" }}>
        {itemIcon(item.kind)}
      </span>
      <Link href={itemHref(vaultId, item)} className="flex-1 truncate">{item.title}</Link>
      <ThreeDotButton
        alwaysVisible={pointer === "touch"}
        buttonRef={btnRef}
        label={item.title}
        onClick={() => setMenuOpen((v) => !v)}
      />
      <FileTreeItemMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchorRef={btnRef}
        kind={item.kind}
        onMove={() => onRequestMove("note", item.id, item.title)}
      />
    </li>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @km/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/FileTree.tsx apps/web/src/components/FileTreeItem.tsx
git commit -m "feat(web): 3-dot menu + Move action on file tree rows"
```

---

### Task 10: Make `AiChatPanel` and `BacklinksPanel` drawer-friendly

**Files:**
- Modify: `apps/web/src/components/AiChatPanel.tsx`
- Modify: `apps/web/src/components/BacklinksPanel.tsx`

- [ ] **Step 1: Remove `AiChatPanel`'s self-hosted open/close state**

Open `apps/web/src/components/AiChatPanel.tsx`. Make the component always render its body by deleting the `const [open, setOpen] = useState(false);` line and the `if (!open) return ...` render branch (if any). Remove any "open" / "close" buttons inside the panel header; the drawer parent owns opening/closing. Change the root element from `<aside>` to `<div className="flex h-full flex-col">` so it fills the drawer body. Keep the `useEffect` that fetches conversations gated on a new `props.active` boolean:

At the top of the component, replace the destructuring with:

```tsx
export interface AiChatPanelProps {
  vaultId: string;
  noteId: string;
  active: boolean;
  onApplyAtCursor?: (text: string) => void;
  registerCommandRunner?: (
    fn: (cmd: { command: string; selection: string; language?: string }) => void,
  ) => void;
}
```

Update the existing `useEffect(() => { if (!open) return; ...` to `useEffect(() => { if (!props.active) return; ...` and remove all other references to `open`/`setOpen`. The final returned JSX root is:

```tsx
return (
  <div className="flex h-full flex-col">
    {/* existing header (drop the "close" button), messages list, and form stay */}
  </div>
);
```

- [ ] **Step 2: Ensure `BacklinksPanel` has no fixed width**

Open `apps/web/src/components/BacklinksPanel.tsx`. Change the root element to render with class `h-full overflow-auto p-3 text-sm` and remove any inline width styles. This keeps it rendering the same list but lets the parent decide width (fixed-width aside on desktop, full drawer on mobile).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @km/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/AiChatPanel.tsx apps/web/src/components/BacklinksPanel.tsx
git commit -m "refactor(web): make chat + backlinks panels drawer-friendly"
```

---

### Task 11: Note page switches to drawers below `md`

**Files:**
- Modify: `apps/web/src/app/(app)/vault/[vaultId]/note/[noteId]/page.tsx`

- [ ] **Step 1: Add drawer state + `MobileTopBar` + responsive layout**

Replace the final `return ( ... )` block of `NotePage` with the following. Imports at the top of the file must include `Drawer`, `MobileTopBar`, `FileTree`:

```tsx
import { Drawer } from "@/components/Drawer";
import { MobileTopBar } from "@/components/MobileTopBar";
import { FileTree } from "@/components/FileTree";
```

And inside the component body add drawer state near the other `useState` calls:

```tsx
const [mobileDrawer, setMobileDrawer] = useState<null | "files" | "backlinks" | "chat">(null);
```

Replace the JSX with:

```tsx
  if (!note) return <div>Loading...</div>;

  return (
    <div className="flex h-screen flex-col md:flex-row">
      <MobileTopBar
        title={note.title}
        buttons={[
          { key: "files", label: "Files", onClick: () => setMobileDrawer("files") },
          { key: "backlinks", label: "Backlinks", onClick: () => setMobileDrawer("backlinks") },
          { key: "chat", label: "AI", onClick: () => setMobileDrawer("chat") },
        ]}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
          <h1 className="min-w-0 flex-1 truncate text-base md:text-lg">{note.title}</h1>
          <div className="flex flex-wrap items-center gap-2 md:gap-3">
            <ActiveUsers awareness={session?.awareness ?? null} />
            <span className="text-xs text-slate-500">
              {session?.status === 'connected' ? 'Live' : session?.status ?? 'Connecting'}
            </span>
            <NoteShareHeader
              noteId={note.id}
              visibility={note.visibility ?? "WORKSPACE"}
              vaultOwnerType={vault?.ownerType ?? "WORKSPACE"}
            />
          </div>
        </header>
        <div className="min-h-0 flex-1">{editor}</div>
      </div>

      <aside className="hidden md:block md:w-72 md:shrink-0 md:border-l">
        <BacklinksPanel noteId={note.id} vaultId={params.vaultId} reloadKey={reloadKey} />
      </aside>
      <aside className="hidden md:block md:w-80 md:shrink-0 md:border-l">
        <AiChatPanel
          vaultId={params.vaultId}
          noteId={params.noteId}
          active
          onApplyAtCursor={onApplyAtCursor}
          registerCommandRunner={(fn) => { commandRunnerRef.current = fn; }}
        />
      </aside>

      <Drawer open={mobileDrawer === "files"} onClose={() => setMobileDrawer(null)} side="left" title="Files">
        <FileTree vaultId={params.vaultId} />
      </Drawer>
      <Drawer
        open={mobileDrawer === "backlinks"}
        onClose={() => setMobileDrawer(null)}
        side="right"
        title="Backlinks"
      >
        <BacklinksPanel noteId={note.id} vaultId={params.vaultId} reloadKey={reloadKey} />
      </Drawer>
      <Drawer
        open={mobileDrawer === "chat"}
        onClose={() => setMobileDrawer(null)}
        side="right"
        title="AI chat"
      >
        <AiChatPanel
          vaultId={params.vaultId}
          noteId={params.noteId}
          active={mobileDrawer === "chat"}
          onApplyAtCursor={onApplyAtCursor}
          registerCommandRunner={(fn) => { commandRunnerRef.current = fn; }}
        />
      </Drawer>

      <CreateNoteDialog
        open={dialogTitle !== null}
        title={dialogTitle ?? ''}
        vaultId={note.vaultId}
        onCancel={() => setDialogTitle(null)}
        onCreated={(id) => {
          setDialogTitle(null);
          router.push(`/vault/${params.vaultId}/note/${id}`);
        }}
      />
    </div>
  );
```

Note that `mobileDrawer === "backlinks"` and `mobileDrawer === "chat"` are mutually exclusive by construction (single state value), which satisfies the spec requirement that the two right-side drawers never open at once.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @km/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(app)/vault/[vaultId]/note/[noteId]/page.tsx"
git commit -m "feat(web): note page drawers + mobile top bar"
```

---

### Task 12: Vault home switches file-tree column to drawer on mobile

**Files:**
- Modify: `apps/web/src/app/(app)/vault/[vaultId]/page.tsx`

- [ ] **Step 1: Adapt the vault shell**

This is an async server component, so the drawer + top bar live in a small inner client component. Replace the file with:

```tsx
import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/session";
import { assertCanAccessVault, AuthzError } from "@/lib/authz";
import { VaultSwitcher } from "@/components/VaultSwitcher";
import { FileTree } from "@/components/FileTree";
import { TagsSidebar } from "@/components/TagsSidebar";
import { VaultHomeShell } from "@/components/VaultHomeShell";

export default async function VaultShell({ params }: { params: { vaultId: string } }) {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");
  try {
    await assertCanAccessVault(userId, params.vaultId, "MEMBER");
  } catch (e) {
    if (e instanceof AuthzError) redirect("/workspaces");
    throw e;
  }
  return (
    <VaultHomeShell vaultId={params.vaultId}>
      <VaultSwitcher currentVaultId={params.vaultId} />
      <FileTree vaultId={params.vaultId} />
      <TagsSidebar />
    </VaultHomeShell>
  );
}
```

- [ ] **Step 2: Create the client shell**

Create `apps/web/src/components/VaultHomeShell.tsx`:

```tsx
"use client";
import { useState, type ReactNode, Children } from "react";
import { Drawer } from "./Drawer";
import { MobileTopBar } from "./MobileTopBar";

export function VaultHomeShell({
  vaultId,
  children,
}: {
  vaultId: string;
  children: ReactNode;
}) {
  // children are expected in this order: [VaultSwitcher, FileTree, TagsSidebar]
  const [switcher, fileTree, tags] = Children.toArray(children);
  const [drawer, setDrawer] = useState<null | "tags">(null);

  return (
    <div className="flex h-screen flex-col md:grid md:grid-cols-[260px_1fr]">
      <MobileTopBar
        title="Vault"
        buttons={[
          { key: "tags", label: "Tags", onClick: () => setDrawer("tags") },
        ]}
      />

      <aside className="hidden md:flex md:flex-col md:gap-3 md:overflow-auto md:border-r md:p-3">
        {switcher}
        {fileTree}
        {tags}
      </aside>

      <div className="md:hidden flex-1 overflow-auto p-3">
        {switcher}
        {fileTree}
      </div>

      <section className="hidden md:block p-6 text-gray-500">Select or create a note.</section>

      <Drawer open={drawer === "tags"} onClose={() => setDrawer(null)} side="left" title="Tags">
        {tags}
      </Drawer>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @km/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(app)/vault/[vaultId]/page.tsx" apps/web/src/components/VaultHomeShell.tsx
git commit -m "feat(web): vault home switches tags to drawer on mobile"
```

---

### Task 13: Responsive `NoteShareDialog`

**Files:**
- Modify: `apps/web/src/components/NoteShareDialog.tsx`

- [ ] **Step 1: Re-skin the modal for small screens**

Replace the `return ( ... )` block of `NoteShareDialog` with:

```tsx
  return (
    <div role="dialog" aria-label="Share note" className="fixed inset-0 z-50 flex items-start justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md mx-4 my-8 rounded bg-white dark:bg-slate-900 p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">Share note</h2>
          <button onClick={onClose} aria-label="Close" className="text-sm underline">Close</button>
        </div>

        <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">People with access</h3>
        <ul className="mb-3 space-y-1">
          {shares.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2">
              <span className="flex-1 truncate">{s.user.name ?? s.user.email}</span>
              <select
                className="rounded border px-1 py-0.5 text-sm"
                value={s.role}
                onChange={(e) => patchRole(s.userId, e.target.value as "VIEW" | "EDIT")}
              >
                <option value="VIEW">View</option>
                <option value="EDIT">Edit</option>
              </select>
              <button className="text-sm underline" onClick={() => removeShare(s.userId)}>Remove</button>
            </li>
          ))}
        </ul>

        <div className="mb-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 rounded border px-2 py-1 text-sm"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "VIEW" | "EDIT")}
            className="rounded border px-1 py-1 text-sm"
          >
            <option value="VIEW">View</option>
            <option value="EDIT">Edit</option>
          </select>
          <button
            onClick={addShare}
            disabled={!email}
            className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            Share
          </button>
        </div>
        {status && <p role="status" className="mb-2 text-sm">{status}</p>}

        {canToggleVisibility && (
          <fieldset className="mb-3">
            <legend className="text-xs font-semibold uppercase text-slate-500">Visibility</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={visibility === "WORKSPACE"} onChange={() => flipVisibility("WORKSPACE")} />
              Everyone in workspace
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={visibility === "PRIVATE"} onChange={() => flipVisibility("PRIVATE")} />
              Only people I share with
            </label>
          </fieldset>
        )}

        <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Public link</h3>
        {links.length === 0 ? (
          <button onClick={createLink} className="rounded border px-3 py-1 text-sm">Create public link</button>
        ) : (
          <ul className="space-y-2">
            {links.map((l) => (
              <li key={l.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                <code className="flex-1 break-all text-xs">
                  {`${typeof window !== "undefined" ? window.location.origin : ""}/public/n/${l.slug}`}
                </code>
                <div className="flex gap-2">
                  <button
                    className="rounded border px-2 py-1 text-xs"
                    onClick={() => navigator.clipboard.writeText(`${window.location.origin}/public/n/${l.slug}`)}
                  >
                    Copy
                  </button>
                  <button className="rounded border px-2 py-1 text-xs" onClick={() => revokeLink(l.id)}>
                    Revoke
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @km/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/NoteShareDialog.tsx
git commit -m "feat(web): responsive NoteShareDialog"
```

---

### Task 14: Playwright `chromium-mobile` project

**Files:**
- Modify: `apps/web/playwright.config.ts`

- [ ] **Step 1: Add the mobile project**

Replace the `projects` array in `apps/web/playwright.config.ts` with:

```ts
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    {
      name: "chromium-mobile",
      use: { browserName: "chromium", viewport: { width: 390, height: 844 } },
      testMatch: /responsive\.spec\.ts$/,
    },
  ],
```

Also add `testIgnore: /responsive\.spec\.ts$/` to the default `chromium` project so it does not double-run:

```ts
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
      testIgnore: /responsive\.spec\.ts$/,
    },
    {
      name: "chromium-mobile",
      use: { browserName: "chromium", viewport: { width: 390, height: 844 } },
      testMatch: /responsive\.spec\.ts$/,
    },
  ],
```

- [ ] **Step 2: Sanity check config loads**

Run: `pnpm --filter @km/web exec playwright test --list --project=chromium-mobile`
Expected: lists 0 tests (the spec file does not exist yet) and exits 0 or with a "no tests found" warning. Ignore non-zero exit from "no tests" if Playwright returns one; the goal is to confirm the config parses.

- [ ] **Step 3: Commit**

```bash
git add apps/web/playwright.config.ts
git commit -m "test(web): add chromium-mobile Playwright project"
```

---

### Task 15: Playwright `responsive.spec.ts`

**Files:**
- Create: `apps/web/playwright/responsive.spec.ts`

- [ ] **Step 1: Write the spec**

Create `apps/web/playwright/responsive.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

const PASSWORD = "password-resp-123";

async function signup(page: import("@playwright/test").Page, email: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL("/", { timeout: 15000 });
}

test.describe("mobile viewport (390x844)", () => {
  test("signup form fits with no horizontal overflow", async ({ page }) => {
    const email = `resp-signup-${Date.now()}@test.local`;
    await page.goto("/signup");
    const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyScrollWidth).toBeLessThanOrEqual(390);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page).toHaveURL("/", { timeout: 15000 });
  });

  test("note page: top bar visible, drawers open and close, editor accepts text", async ({ page }) => {
    test.setTimeout(120000);
    const email = `resp-note-${Date.now()}@test.local`;
    await signup(page, email);

    // Enter the first workspace + vault.
    await page.goto("/workspaces");
    await page.getByRole("link", { name: /workspace|personal/i }).first().click();
    await page.waitForURL(/\/vault\//, { timeout: 15000 });

    // Create a note through the file tree's 3-dot menu (touch flow).
    await page.getByRole("button", { name: /Actions for/ }).first().click();
    await page.getByRole("menuitem", { name: "New note" }).click();
    page.once("dialog", async (d) => d.accept("mobile test note"));
    await page.waitForURL(/\/note\//, { timeout: 15000 });

    // Top bar present.
    await expect(page.getByRole("button", { name: "Files" })).toBeVisible();
    await expect(page.getByRole("button", { name: "AI" })).toBeVisible();

    // Files drawer opens.
    await page.getByRole("button", { name: "Files" }).click();
    await expect(page.getByRole("dialog", { name: "Files" })).toBeVisible();

    // Backdrop dismiss.
    await page.getByTestId("drawer-backdrop").click();
    await expect(page.getByRole("dialog", { name: "Files" })).toHaveCount(0);

    // Editor accepts text.
    await page.getByTestId("note-editor").click();
    await page.keyboard.type("hello from phone");
    await expect(page.locator(".cm-content")).toContainText("hello from phone");
  });

  test("file tree 3-dot menu lists Rename, Delete, Move, New note", async ({ page }) => {
    test.setTimeout(120000);
    const email = `resp-menu-${Date.now()}@test.local`;
    await signup(page, email);
    await page.goto("/workspaces");
    await page.getByRole("link", { name: /workspace|personal/i }).first().click();
    await page.waitForURL(/\/vault\//, { timeout: 15000 });

    await page.getByRole("button", { name: /Actions for/ }).first().click();
    await expect(page.getByRole("menuitem", { name: "New note" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
    // "Move" is hidden on the root folder (per FileTreeItem); verify on a child.
    // The root always exists so new-folder first, then test Move on the child.
    await page.getByRole("menuitem", { name: "New folder" }).click();
    page.once("dialog", async (d) => d.accept("child"));
    await page.waitForTimeout(500);
    // Open the child folder's 3-dot menu.
    const actionButtons = page.getByRole("button", { name: /Actions for child/ });
    await actionButtons.first().click();
    await expect(page.getByRole("menuitem", { name: "Move" })).toBeVisible();
  });

  test("NoteShareDialog fits viewport at 390px with no horizontal scroll", async ({ page }) => {
    test.setTimeout(120000);
    const email = `resp-share-${Date.now()}@test.local`;
    await signup(page, email);
    await page.goto("/workspaces");
    await page.getByRole("link", { name: /workspace|personal/i }).first().click();
    await page.waitForURL(/\/vault\//, { timeout: 15000 });

    // Make a note and open it.
    await page.getByRole("button", { name: /Actions for/ }).first().click();
    await page.getByRole("menuitem", { name: "New note" }).click();
    page.once("dialog", async (d) => d.accept("share me"));
    await page.waitForURL(/\/note\//, { timeout: 15000 });

    await page.getByRole("button", { name: "Share" }).click();
    const dlg = page.getByRole("dialog", { name: "Share note" });
    await expect(dlg).toBeVisible();
    const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyScrollWidth).toBeLessThanOrEqual(390);
  });
});
```

- [ ] **Step 2: Run the mobile spec**

Run: `pnpm --filter @km/web exec playwright test --project=chromium-mobile`
Expected: 4 tests pass. If they fail, fix the smallest issue and rerun before moving on.

- [ ] **Step 3: Commit**

```bash
git add apps/web/playwright/responsive.spec.ts
git commit -m "test(web): responsive Playwright spec at 390x844"
```

---

### Task 16: Wrap settings/members/workspaces tables in horizontal scroll containers

**Files:**
- Modify: `apps/web/src/app/(app)/workspaces/page.tsx` (and any sibling listing pages with a table)
- Modify: `apps/web/src/app/(app)/workspaces/[id]/members/page.tsx` (if present)
- Modify: `apps/web/src/app/(app)/settings/page.tsx` (if present)

- [ ] **Step 1: Locate every `<table>` element under `apps/web/src/app/(app)/`**

Run: `grep -rln "<table" apps/web/src/app` (use the project's preferred grep tool).
Expected: a short list of 1-5 files.

- [ ] **Step 2: For every found `<table>`, wrap it**

For each `<table ...>...</table>` block, wrap it in a horizontal-scroll container so wide tables do not push the viewport at narrow widths:

```tsx
<div className="w-full overflow-x-auto">
  <table className="min-w-full">
    {/* existing rows */}
  </table>
</div>
```

If the table already has a `className`, prepend `min-w-full ` to it. Do not change cell content.

- [ ] **Step 3: Inspect any forms in the same files**

For each `<form>` whose direct children are arranged with `flex` and no responsive direction class, add `flex-col sm:flex-row` so inputs stack on phone. Skip forms that already use `flex-col` or grid.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @km/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app
git commit -m "feat(web): wrap settings tables for horizontal scroll on mobile"
```

---

### Task 17: Public viewer fluid container

**Files:**
- Modify: `apps/web/src/app/public/n/[slug]/page.tsx`

- [ ] **Step 1: Wrap rendered markdown in a fluid container**

Open `apps/web/src/app/public/n/[slug]/page.tsx`. Wrap the rendered markdown output in a `<div className="prose max-w-prose mx-auto px-4 py-6">...</div>` container. If the file already renders a `<main>` or `<article>`, add these classes to it instead of introducing a new wrapper. The viewport meta from Task 1 plus these classes satisfy the `viewport-fit=cover` + fluid-content requirement from the spec.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @km/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/public/n/[slug]/page.tsx"
git commit -m "feat(web): fluid markdown container on public note view"
```

---

### Task 18: Documentation

**Files:**
- Modify: `docs/architecture.md`
- Create: `guides/mobile.md`

- [ ] **Step 1: Append "Responsive layout" subsection to `docs/architecture.md`**

Append this section at the end of `docs/architecture.md`:

```markdown
## Responsive layout

The web app is built desktop-first but collapses cleanly to phone widths.

- Breakpoint: Tailwind's `md` (768px). Below it the UI is "mobile", at or above it is "desktop".
- Primitives: `apps/web/src/components/Drawer.tsx` (generic off-canvas with backdrop, ESC, scroll lock, route-change auto-close) and `apps/web/src/components/MobileTopBar.tsx` (centred title, right-side icon buttons, `md:hidden` only).
- Pointer detection: `apps/web/src/hooks/usePointerType.ts` returns `"mouse"` when `matchMedia("(hover: hover)")` matches, `"touch"` otherwise. It is SSR-safe.
- Note page (`apps/web/src/app/(app)/vault/[vaultId]/note/[noteId]/page.tsx`): on desktop the file tree, backlinks, and AI chat are permanent columns. Below `md` all three move into drawers triggered from the top bar. The two right-side drawers are mutually exclusive by construction.
- File tree: every row has a 3-dot button that opens `FileTreeItemMenu` (Rename, Delete, Move, New note, New folder, New diagram). On desktop the button is hover-only, on touch it is always visible. The existing right-click and HTML5 drag-and-drop remain for desktop.
- Editor: `packages/editor/src/NoteEditor.tsx` sets `fontSize: 16px` (prevents iOS auto-zoom), disables `overflowAnchor` on the scroller (prevents scroll jumps when the keyboard opens), and sets `autocapitalize="sentences"`, `autocorrect="on"`, `spellcheck="true"`.
- Out of scope: touch editing of drawio/bpmn diagrams, native shells, bottom-tab navigation.
```

- [ ] **Step 2: Write the end-user guide**

Create `guides/mobile.md`:

```markdown
# Using the app on a phone

The knowledge management app works on phones and small tablets. You can read notes, write new ones, follow wiki-links, share notes, and chat with the AI assistant.

## What works well on phone

- Reading and editing notes. The editor uses a 16px font so iOS will not auto-zoom when you tap in.
- The file tree, backlinks, and AI chat live in drawers that open from the small bar at the top of every note page.
- Tap the three dots on any item in the file tree to rename, delete, move, or create a new note, folder, or diagram under it.
- Sharing. Open a note, tap Share, and the dialog resizes to fit the screen.

## What is desktop-only

- Editing drawio diagrams and BPMN processes. Viewing is fine on phone, editing needs a bigger screen and a mouse.
- Drag and drop to move items in the file tree. Use the three-dot menu's Move action instead on phone.
- Keyboard shortcuts.

## Tips

- To dismiss any drawer, tap the dark area outside it, or press Escape on a connected keyboard.
- The public link view (`/public/n/...`) is read-only and renders comfortably down to 360px widths.
```

- [ ] **Step 3: Commit**

```bash
git add docs/architecture.md guides/mobile.md
git commit -m "docs: responsive layout + mobile user guide"
```

---

### Task 19: Full verification pass

**Files:** (no new files)

- [ ] **Step 1: Run unit tests**

Run: `pnpm --filter @km/web test`
Expected: all tests pass, including the three new component/hook tests from Tasks 3, 4, 5.

- [ ] **Step 2: Run the default Playwright suite**

Run: `pnpm --filter @km/web exec playwright test --project=chromium`
Expected: pre-existing e2e tests still pass. Nothing should regress because none of the new code removed desktop features.

- [ ] **Step 3: Run the mobile Playwright suite**

Run: `pnpm --filter @km/web exec playwright test --project=chromium-mobile`
Expected: all 4 tests in `responsive.spec.ts` pass.

- [ ] **Step 4: Lint + typecheck at the root**

Run: `pnpm --filter @km/web lint && pnpm --filter @km/web typecheck`
Expected: both exit 0.

- [ ] **Step 5: Commit any follow-up fixes**

If steps 1-4 required edits, commit them now:

```bash
git add -A
git commit -m "fix(web): v0.2-C verification fixes"
```

If everything was clean, skip this step.

---

## Self-Review Notes

Spec coverage verified against the spec:
- Goals (viewports down to 360, drawers below `md`, 3-dot menu, CodeMirror tweaks, responsive `NoteShareDialog`, Playwright mobile project): Tasks 1-15.
- `Drawer` spec interface (`open`, `onClose`, `side`, `title?`, `children`): matches Task 4 exactly.
- `MobileTopBar` (title + up to three icon buttons, `md:hidden`): Task 5.
- `usePointerType()` return type `"touch" | "mouse"`, SSR-safe: Task 3.
- Note page three drawers with mutually-exclusive right side: Task 11 uses a single `mobileDrawer` state.
- File tree 3-dot visibility rule (always on touch, hover/focus on mouse): Task 9 `ThreeDotButton` applies classes accordingly.
- "Move" opens `MovePicker`: Task 7 + Task 9.
- CodeMirror extensions appended, not replaced; autocomplete tooltip clamp in `globals.css`: Task 6.
- Viewport meta via `export const viewport`: Task 1.
- Playwright project + spec: Tasks 14 + 15.
- Settings/members/workspaces tables wrap with `overflow-x-auto`, forms stack on small screens: Task 16.
- Public viewer fluid container: Task 17.
- Docs + guide: Task 18.
- Verification pass: Task 19.

Type consistency across tasks confirmed:
- `Drawer` props (`open`, `onClose`, `side`, `title?`, `children`) used identically in Tasks 4, 11, 12.
- `MobileTopBar` `buttons` shape (`{ key, label, icon?, onClick }`) used identically in Tasks 5, 11, 12.
- `usePointerType` return type imported in Task 9 matches Task 3 signature.
- `FileTreeItem` `onRequestMove(kind, id, label)` signature consistent between `FileTree.tsx` (Task 9 Step 1) and `FileTreeItem.tsx` (Task 9 Step 2).
- `MovePicker` `onPick(targetFolderId: string)` matches its use in `FileTree.tsx` `confirmMove`.
- `AiChatPanel` new `active: boolean` prop is set in both desktop (`active`) and mobile (`active={mobileDrawer === "chat"}`) callsites in Task 11.

No placeholders: every task has exact paths, complete code, exact commands, and expected output.
