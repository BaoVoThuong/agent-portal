"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

export type AnchoredMenuCloseOptions = {
  restoreFocus?: boolean;
};

type AnchoredMenuPlacement = "default" | "above-right";

// Shared menu controller for both inline menus and portal-rendered dropdowns.
// Portal callers get fixed coordinates and viewport flipping; all callers get
// outside-click / Escape / scroll / resize handling.
export function useAnchoredMenu({
  estimatedHeight = 300,
  placement = "default",
}: {
  estimatedHeight?: number;
  placement?: AnchoredMenuPlacement;
} = {}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});

  const focusTrigger = useCallback(() => {
    triggerRef.current?.focus({ preventScroll: true });
  }, []);

  const closeMenu = useCallback(
    ({ restoreFocus = false }: AnchoredMenuCloseOptions = {}) => {
      setIsOpen(false);
      if (restoreFocus) focusTrigger();
    },
    [focusTrigger]
  );

  const closeMenuForTab = useCallback(() => {
    setIsOpen(false);
    focusTrigger();
  }, [focusTrigger]);

  const openMenu = useCallback(() => {
    const el = triggerRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      const maxHeight = estimatedHeight;
      const estWidth = 320;
      if (placement === "above-right") {
        const canOpenRight = rect.right + estWidth + 8 <= window.innerWidth;
        const left = canOpenRight
          ? { left: rect.right + 8 }
          : { right: Math.max(8, window.innerWidth - rect.left + 8) };
        setMenuStyle({
          position: "fixed",
          minWidth: rect.width,
          maxHeight,
          ...left,
          // Keep the compose textarea visible below the picker, like Slack.
          bottom: window.innerHeight - rect.top + 72,
        });
        setIsOpen(true);
        return;
      }
      const spaceBelow = window.innerHeight - rect.bottom;
      const flipUp = spaceBelow < maxHeight && rect.top > spaceBelow;
      // Not enough room to grow rightward → anchor the menu's right edge to the
      // trigger so it opens leftward and stays inside the viewport.
      const overflowRight = rect.left + estWidth > window.innerWidth - 8;
      setMenuStyle({
        position: "fixed",
        minWidth: rect.width,
        maxHeight,
        ...(overflowRight
          ? { right: Math.max(8, window.innerWidth - rect.right) }
          : { left: rect.left }),
        ...(flipUp
          ? { bottom: window.innerHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
      });
    }
    setIsOpen(true);
  }, [estimatedHeight, placement]);

  const toggle = useCallback(() => {
    if (isOpen) setIsOpen(false);
    else openMenu();
  }, [isOpen, openMenu]);

  useEffect(() => {
    if (!isOpen) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (
        target instanceof Node &&
        (triggerRef.current?.contains(target) || menuRef.current?.contains(target))
      ) {
        return;
      }
      setIsOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu({ restoreFocus: true });
      }
    }
    // Closes the menu when the page/an ancestor scrolls out from under the
    // trigger (so a stale-positioned menu doesn't linger). Must NOT fire for
    // scrolling inside the menu's own content (e.g. a long options list) —
    // otherwise the menu closes itself the instant a user tries to scroll it.
    function onScrollOrResize(event: Event) {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) {
        return;
      }
      setIsOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [closeMenu, isOpen]);

  return {
    isOpen,
    setIsOpen,
    openMenu,
    toggle,
    triggerRef,
    menuRef,
    menuStyle,
    closeMenu,
    closeMenuForTab,
  };
}
