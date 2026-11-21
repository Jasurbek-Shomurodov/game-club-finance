'use client';

import { createPortal } from 'react-dom';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconButton, type IconButtonProps } from './IconButton';
import { isTopModal, useModalLayer } from './Modal';
import { popoverMotion, usePresence } from './motion';

export interface ActionMenuItem {
  /** Needed only when two items share a label. */
  key?: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** `danger` for an action that deletes or cancels. */
  tone?: 'danger';
}

/** Gap kept between the menu and the control, and between the menu and the viewport edge. */
const GAP = 4;
const EDGE = 8;

export type MenuKeyAction = { type: 'focus'; index: number } | { type: 'close' };

/**
 * What a key does inside an open menu. `current` is the focused item's index
 * (-1 when none is), `enabled` the indexes that can take focus. Arrows wrap,
 * Home/End jump, Escape and Tab close (focus goes back to the button). Null
 * for a key the menu leaves alone.
 */
export function menuKeyAction(key: string, current: number, enabled: readonly number[]): MenuKeyAction | null {
  if (key === 'Escape' || key === 'Tab') return { type: 'close' };
  if (enabled.length === 0) return null;
  const position = enabled.indexOf(current);
  switch (key) {
    case 'ArrowDown':
      return { type: 'focus', index: enabled[(position + 1) % enabled.length] };
    case 'ArrowUp':
      return { type: 'focus', index: enabled[position <= 0 ? enabled.length - 1 : position - 1] };
    case 'Home':
      return { type: 'focus', index: enabled[0] };
    case 'End':
      return { type: 'focus', index: enabled[enabled.length - 1] };
    default:
      return null;
  }
}

/**
 * Where a menu of `menu` size opens for a control at `anchor`, in viewport
 * coordinates: under the control and lined up with its `align` edge, flipped
 * above when there is no room below, and always inside the viewport.
 */
export function menuPosition(
  anchor: { top: number; bottom: number; left: number; right: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  align: 'start' | 'end' = 'end',
) {
  const wanted = align === 'end' ? anchor.right - menu.width : anchor.left;
  const left = Math.max(EDGE, Math.min(wanted, viewport.width - menu.width - EDGE));
  const below = anchor.bottom + GAP;
  const above = below + menu.height > viewport.height - EDGE && anchor.top - GAP - menu.height >= EDGE;
  const top = above ? anchor.top - GAP - menu.height : Math.max(EDGE, Math.min(below, viewport.height - menu.height - EDGE));
  return { top, left, above };
}

/** The open list itself; `ActionMenu` positions it and owns the keyboard. */
export function ActionMenuList({ items, label, id, onSelect, listRef, className }: {
  items: readonly ActionMenuItem[];
  /** Accessible name: the label of the button that opened it. */
  label: string;
  id?: string;
  onSelect: (item: ActionMenuItem) => void;
  listRef?: Ref<HTMLDivElement>;
  className?: string;
}) {
  return (
    <div
      ref={listRef}
      id={id}
      role="menu"
      aria-label={label}
      aria-orientation="vertical"
      className={cn(
        'min-w-44 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-gray-200 bg-surface p-1 shadow-pop outline-none',
        className,
      )}
    >
      {items.map((item) => (
        <button
          key={item.key ?? item.label}
          type="button"
          role="menuitem"
          tabIndex={-1}
          disabled={item.disabled}
          onClick={() => onSelect(item)}
          className={cn(
            'flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors motion-reduce:transition-none',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-40',
            item.tone === 'danger'
              ? 'text-danger-600 hover:enabled:bg-danger-50 focus:bg-danger-50 focus-visible:ring-danger-500'
              : 'text-gray-700 hover:enabled:bg-gray-100 hover:enabled:text-gray-950 focus:bg-gray-100 focus:text-gray-950 focus-visible:ring-primary-500',
          )}
        >
          {item.icon && <span aria-hidden="true" className="flex shrink-0 items-center">{item.icon}</span>}
          <span className="min-w-0 break-words">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

export interface ActionMenuProps {
  /** Accessible name of the button, e.g. "More actions for Coca-Cola". */
  label: string;
  items: readonly ActionMenuItem[];
  /** Which edge of the button the menu lines up with. */
  align?: 'start' | 'end';
  /** Replaces the three dots. */
  icon?: ReactNode;
  variant?: IconButtonProps['variant'];
  size?: IconButtonProps['size'];
  disabled?: boolean;
  className?: string;
}

/**
 * The overflow ("more actions") button of a row or a card: an `IconButton`
 * that opens a small menu. Use it when a row has more actions than fit as
 * icons. Arrow keys, Home and End move between items; Escape, Tab, a click
 * outside, scrolling or resizing close it. It joins the dialog stack, so
 * Escape closes the menu and not the dialog it was opened in.
 */
export function ActionMenu({ label, items, align = 'end', icon, variant = 'ghost', size = 'md', disabled = false, className }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const layerId = useModalLayer(open);
  const { mounted, visible } = usePresence(open);

  // Placed before paint, straight on the element: it is measured once per opening.
  useLayoutEffect(() => {
    const button = buttonRef.current;
    const list = listRef.current;
    if (!open || !button || !list) return;
    const place = menuPosition(
      button.getBoundingClientRect(),
      { width: list.offsetWidth, height: list.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      align,
    );
    list.style.top = `${place.top}px`;
    list.style.left = `${place.left}px`;
    list.style.transformOrigin = `${place.above ? 'bottom' : 'top'} ${align === 'end' ? 'right' : 'left'}`;
    list.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus({ preventScroll: true });
  }, [align, open]);

  useEffect(() => {
    if (!open) return;
    const menuItems = () => Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    function onKeyDown(event: KeyboardEvent) {
      if (!isTopModal(layerId)) return;
      const elements = menuItems();
      const enabled = elements.flatMap((element, index) => (element.disabled ? [] : [index]));
      const action = menuKeyAction(event.key, elements.indexOf(document.activeElement as HTMLButtonElement), enabled);
      if (!action) return;
      event.preventDefault();
      if (action.type === 'focus') {
        elements[action.index]?.focus({ preventScroll: true });
        return;
      }
      // The menu lives at the end of the page; focus goes back to where it was opened.
      setOpen(false);
      buttonRef.current?.focus({ preventScroll: true });
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (listRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    // The menu is fixed to where the button was; once that moves, it closes.
    function onScroll(event: Event) {
      if (listRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }
    const onResize = () => setOpen(false);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [layerId, open]);

  return (
    <>
      <IconButton
        ref={buttonRef}
        label={label}
        icon={icon ?? <MoreHorizontal size={size === 'sm' ? 16 : 18} aria-hidden="true" />}
        variant={variant}
        size={size}
        disabled={disabled}
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' || open) return;
          event.preventDefault();
          setOpen(true);
        }}
      />
      {mounted && createPortal(
        <ActionMenuList
          listRef={listRef}
          id={menuId}
          label={label}
          items={items}
          onSelect={(item) => {
            setOpen(false);
            buttonRef.current?.focus({ preventScroll: true });
            item.onSelect();
          }}
          className={cn('fixed z-[80] max-h-[calc(100dvh-1rem)]', popoverMotion(visible), !open && 'pointer-events-none')}
        />,
        document.body,
      )}
    </>
  );
}
