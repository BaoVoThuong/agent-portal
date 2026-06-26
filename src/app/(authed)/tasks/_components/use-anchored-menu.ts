"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

// A dropdown menu anchored to a trigger button but rendered in a portal, so it
// is never clipped by an ancestor's overflow (e.g. a scrollable table). Computes
// fixed coordinates on open, flips up when there is little space below, and
// closes on outside-click / Escape / scroll / resize.
export function useAnchoredMenu() {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});

  const openMenu = useCallback(() => {
    const el = triggerRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      const maxHeight = 300;
      const estWidth = 240;
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
  }, []);

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
      if (event.key === "Escape") setIsOpen(false);
    }
    function onScrollOrResize() {
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
  }, [isOpen]);

  return { isOpen, setIsOpen, openMenu, toggle, triggerRef, menuRef, menuStyle };
}
