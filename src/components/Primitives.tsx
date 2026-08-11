import {
  Children,
  cloneElement,
  createContext,
  forwardRef,
  isValidElement,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
  type CSSProperties,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { Check, ChevronDown, Info, LoaderCircle, Search, TriangleAlert, X } from 'lucide-react';

const surfaceExitMs = 190;

export function useAnimatedPresence(open: boolean, duration = surfaceExitMs) {
  const [mounted, setMounted] = useState(open);
  const [state, setState] = useState<'open' | 'closing'>(open ? 'open' : 'closing');
  useEffect(() => {
    if (open) {
      setMounted(true);
      setState('open');
      return;
    }
    if (!mounted) return;
    setState('closing');
    const exitDuration = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 1 : duration;
    const timer = window.setTimeout(() => setMounted(false), exitDuration);
    return () => window.clearTimeout(timer);
  }, [duration, mounted, open]);
  return { mounted, state };
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  leadingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, leadingIcon, children, disabled, className = '', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`mova-button mova-button--${variant} mova-button--${size} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      type={type}
      {...props}
    >
      {loading ? <LoaderCircle className="mova-spin" size={17} aria-hidden /> : leadingIcon}
      <span>{children}</span>
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: 'sm' | 'md';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = 'md', children, className = '', type = 'button', ...props },
  ref,
) {
  return (
    <button ref={ref} type={type} className={`mova-icon-button mova-icon-button--${size} ${className}`} aria-label={label} {...props}>
      {children}
    </button>
  );
});

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  leading?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, FieldProps>(function Input(
  { label, hint, error, leading, className = '', id, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const helpId = `${inputId}-help`;
  return (
    <label className={`mova-field ${className}`} htmlFor={inputId}>
      {label && <span className="mova-field__label">{label}</span>}
      <span className={`mova-field__control mova-control-shell ${error ? 'is-error' : ''}`}>
        {leading}
        <input ref={ref} id={inputId} aria-invalid={Boolean(error)} aria-describedby={hint || error ? helpId : undefined} {...props} />
      </span>
      {(hint || error) && <span id={helpId} className={`mova-field__help ${error ? 'is-error' : ''}`}>{error ?? hint}</span>}
    </label>
  );
});

export const SearchField = forwardRef<HTMLInputElement, Omit<FieldProps, 'leading' | 'type'>>(function SearchField(props, ref) {
  return <Input ref={ref} type="search" leading={<Search size={17} aria-hidden />} {...props} />;
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, id, className = '', ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <label className={`mova-field ${className}`} htmlFor={inputId}>
      {label && <span className="mova-field__label">{label}</span>}
      <span className="mova-field__control mova-control-shell mova-field__control--textarea">
        <textarea ref={ref} id={inputId} className="mova-textarea" {...props} />
      </span>
      {hint && <span className="mova-field__help">{hint}</span>}
    </label>
  );
});

export interface AvatarProps {
  name: string;
  src?: string;
  color?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  initialsLength?: 1 | 2;
  status?: 'online' | 'idle' | 'busy' | 'offline' | 'dnd' | 'invisible';
  speaking?: boolean;
}

export type PresenceStatus = NonNullable<AvatarProps['status']>;

const presenceLabels: Record<PresenceStatus, string> = {
  online: 'В сети',
  idle: 'Отошёл',
  busy: 'Не беспокоить',
  dnd: 'Не беспокоить',
  offline: 'Не в сети',
  invisible: 'Невидимый',
};

export function StatusIndicator({ status, inline = false, className = '' }: { status: PresenceStatus; inline?: boolean; className?: string }) {
  const visualStatus = status === 'busy' ? 'dnd' : status;
  const label = presenceLabels[status];
  return <span className={`mova-status-indicator mova-status-indicator--${visualStatus}${inline ? ' is-inline' : ''} ${className}`.trim()} role="img" aria-label={label} title={label} />;
}

export function Avatar({ name, src, color = '#9D7BFF', size = 'md', initialsLength = 2, status, speaking }: AvatarProps) {
  const initials = name.trim().split(/\s+/).map((part) => Array.from(part)[0] || '').slice(0, initialsLength).join('').toUpperCase();
  return (
    <span className={`mova-avatar mova-avatar--${size} ${src ? 'has-image' : ''} ${speaking ? 'is-speaking' : ''}`} style={{ backgroundColor: color }} aria-label={name}>
      {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : initials}
      {status && <StatusIndicator status={status} />}
    </span>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'mint' | 'violet' | 'danger' }) {
  return <span className={`mova-badge mova-badge--${tone}`}>{children}</span>;
}

export function Divider({ label }: { label?: string }) {
  return <div className="mova-divider" role="separator"><span>{label}</span></div>;
}

export function Tooltip({ label, children, side = 'top' }: { label: string; children: ReactElement; side?: 'top' | 'right' | 'bottom' }) {
  const id = useId();
  return (
    <span className={`mova-tooltip mova-tooltip--${side}`}>
      {cloneElement(children, { 'aria-describedby': id } as Record<string, string>)}
      <span id={id} role="tooltip" className="mova-tooltip__content">{label}</span>
    </span>
  );
}

export interface TabItem { id: string; label: string; count?: number }
export function Tabs({ items, value, onChange }: { items: TabItem[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="mova-tabs" role="tablist">
      {items.map((item) => (
        <button key={item.id} type="button" role="tab" aria-selected={value === item.id} onClick={() => onChange(item.id)}>
          {item.label}{item.count !== undefined && <Badge>{item.count}</Badge>}
        </button>
      ))}
    </div>
  );
}

export interface DropdownItem { id: string; label: string; destructive?: boolean }
export function PopoverSurface({ open, className = '', role = 'menu', ariaLabel, style, children }: { open: boolean; className?: string; role?: 'menu' | 'listbox'; ariaLabel?: string; style?: CSSProperties; children: ReactNode }) {
  const presence = useAnimatedPresence(open);
  const cachedChildren = useRef(children);
  const cachedStyle = useRef(style);
  if (open) {
    cachedChildren.current = children;
    cachedStyle.current = style;
  }
  if (!presence.mounted) return null;
  return (
    <div
      className={`mova-popover-surface ${className} ${presence.state === 'closing' ? 'is-closing' : ''}`.trim()}
      role={presence.state === 'open' ? role : undefined}
      aria-label={ariaLabel}
      aria-hidden={presence.state === 'closing' || undefined}
      style={cachedStyle.current}
    >
      {cachedChildren.current}
    </div>
  );
}

export function Dropdown({ label, items, onSelect }: { label: string; items: DropdownItem[]; onSelect?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusItem = (index: number) => {
    const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    buttons[(index + buttons.length) % buttons.length]?.focus();
  };
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  return (
    <div className="mova-dropdown" ref={root}>
      <Button ref={trigger} variant="secondary" onClick={() => setOpen((value) => !value)} onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setOpen(true);
          window.setTimeout(() => focusItem(0));
        }
      }} aria-haspopup="menu" aria-expanded={open}>
        {label}<ChevronDown size={16} aria-hidden />
      </Button>
      <PopoverSurface open={open} className="mova-dropdown__menu">
        <div ref={menu} onKeyDown={(event) => {
          const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            focusItem(index + (event.key === 'ArrowDown' ? 1 : -1));
          } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            focusItem(event.key === 'Home' ? 0 : buttons.length - 1);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
            trigger.current?.focus();
          }
        }}>
          {items.map((item) => <button type="button" role="menuitem" key={item.id} className={item.destructive ? 'is-danger' : ''} onClick={() => { onSelect?.(item.id); setOpen(false); }}>{item.label}</button>)}
        </div>
      </PopoverSurface>
    </div>
  );
}

const focusableSelector = 'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function DialogSurface({ open, onClose, className = '', labelledBy, describedBy, initialFocus = 'close', closeOnBackdrop = true, children }: { open: boolean; onClose: () => void; className?: string; labelledBy: string; describedBy?: string; initialFocus?: 'close' | 'first' | 'cancel'; closeOnBackdrop?: boolean; children: ReactNode }) {
  const presence = useAnimatedPresence(open);
  const dialog = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open || !presence.mounted) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    const preferred = initialFocus === 'cancel' ? '[data-dialog-cancel]' : initialFocus === 'close' ? '[data-dialog-close]' : '[data-dialog-initial]';
    (dialog.current?.querySelector<HTMLElement>(preferred) ?? dialog.current?.querySelector<HTMLElement>(focusableSelector))?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []).filter((item) => !item.hasAttribute('disabled'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previousFocus.current?.focus();
    };
  }, [initialFocus, open, presence.mounted]);
  if (!presence.mounted) return null;
  return (
    <div className={`mova-modal-backdrop mova-real-modal-backdrop ${presence.state === 'closing' ? 'is-closing' : ''}`} role="presentation" onPointerDown={(event) => { if (closeOnBackdrop && event.target === event.currentTarget) onClose(); }}>
      <section ref={dialog} className={`mova-dialog-surface ${className} ${presence.state === 'closing' ? 'is-closing' : ''}`.trim()} role={presence.state === 'open' ? 'dialog' : undefined} aria-hidden={presence.state === 'closing' || undefined} aria-modal={presence.state === 'open' ? 'true' : undefined} aria-labelledby={labelledBy} aria-describedby={describedBy}>
        {children}
      </section>
    </div>
  );
}

export function Modal({ open, title, children, onClose, footer, size = 'regular' }: { open: boolean; title: string; children: ReactNode; onClose: () => void; footer?: ReactNode; size?: 'small' | 'regular' | 'wide' }) {
  const titleId = useId();
  return (
    <DialogSurface open={open} onClose={onClose} className={`mova-modal mova-modal--${size}`} labelledBy={titleId}>
      <header><h2 id={titleId}>{title}</h2><IconButton data-dialog-close label="Закрыть" onClick={onClose}><X size={19} /></IconButton></header>
      <div className="mova-modal__body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </DialogSurface>
  );
}

export function ConfirmDialog({ open, title, description, confirmLabel = 'Удалить', cancelLabel = 'Отмена', onConfirm, onCancel }: { open: boolean; title: string; description: string; confirmLabel?: string; cancelLabel?: string; onConfirm: () => void; onCancel: () => void }) {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <DialogSurface open={open} onClose={onCancel} className="mova-modal mova-confirm-dialog" labelledBy={titleId} describedBy={descriptionId} initialFocus="cancel">
      <header><h2 id={titleId}>{title}</h2><IconButton data-dialog-close label="Закрыть" onClick={onCancel}><X size={19} /></IconButton></header>
      <div className="mova-modal__body"><p id={descriptionId}>{description}</p></div>
      <footer><Button data-dialog-cancel variant="secondary" onClick={onCancel}>{cancelLabel}</Button><Button variant="danger" onClick={onConfirm}>{confirmLabel}</Button></footer>
    </DialogSurface>
  );
}

interface ToastItem { id: number; message: string; tone: 'success' | 'danger' | 'info'; state: 'open' | 'closing' }
const ToastContext = createContext<{ push: (message: string, tone?: ToastItem['tone']) => void }>({ push: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const timers = useRef(new Map<number, number>());
  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    setToasts((items) => items.map((item) => item.id === id ? { ...item, state: 'closing' } : item));
    timers.current.set(id, window.setTimeout(() => {
      setToasts((items) => items.filter((item) => item.id !== id));
      timers.current.delete(id);
    }, surfaceExitMs));
  }, []);
  const schedule = useCallback((id: number) => {
    const current = timers.current.get(id);
    if (current) window.clearTimeout(current);
    timers.current.set(id, window.setTimeout(() => dismiss(id), 3600));
  }, [dismiss]);
  const push = useCallback((message: string, tone: ToastItem['tone'] = 'info') => {
    let targetId = 0;
    setToasts((items) => {
      const repeated = items.find((item) => item.message === message && item.tone === tone);
      if (repeated) {
        targetId = repeated.id;
        return items.map((item) => item.id === repeated.id ? { ...item, state: 'open' } : item);
      }
      targetId = ++idRef.current;
      return [...items, { id: targetId, message, tone, state: 'open' }];
    });
    window.setTimeout(() => schedule(targetId));
  }, [schedule]);
  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);
  return <ToastContext.Provider value={{ push }}>{children}<div className="mova-toasts" aria-live="polite">{toasts.map((toast) => {
    const Icon = toast.tone === 'success' ? Check : toast.tone === 'danger' ? TriangleAlert : Info;
    return <div key={toast.id} className={`mova-toast mova-toast--${toast.tone} ${toast.state === 'closing' ? 'is-closing' : ''}`} role={toast.tone === 'danger' ? 'alert' : 'status'}><Icon size={17} aria-hidden /><span>{toast.message}</span><IconButton label="Закрыть уведомление" size="sm" onClick={() => dismiss(toast.id)}><X size={14} /></IconButton></div>;
  })}</div></ToastContext.Provider>;
}

export const useToast = () => useContext(ToastContext);

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="mova-visually-hidden">{Children.toArray(children).map((child) => isValidElement(child) ? cloneElement(child) : child)}</span>;
}
