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
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { Check, ChevronDown, LoaderCircle, Search, X } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  leadingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, leadingIcon, children, disabled, className = '', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`mova-button mova-button--${variant} mova-button--${size} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
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
  { label, size = 'md', children, className = '', ...props },
  ref,
) {
  return (
    <button ref={ref} className={`mova-icon-button mova-icon-button--${size} ${className}`} aria-label={label} {...props}>
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
      <span className={`mova-field__control ${error ? 'is-error' : ''}`}>
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
      <textarea ref={ref} id={inputId} className="mova-textarea" {...props} />
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

export function Avatar({ name, src, color = '#9D7BFF', size = 'md', initialsLength = 2, status, speaking }: AvatarProps) {
  const initials = name.trim().split(/\s+/).map((part) => part[0]).join('').slice(0, initialsLength).toUpperCase();
  return (
    <span className={`mova-avatar mova-avatar--${size} ${speaking ? 'is-speaking' : ''}`} style={{ backgroundColor: color }} aria-label={name}>
      {src ? <img src={src} alt="" /> : initials}
      {status && <span className={`mova-status mova-status--${status}`} aria-label={status} />}
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
  return (
    <span className={`mova-tooltip mova-tooltip--${side}`}>
      {children}
      <span role="tooltip" className="mova-tooltip__content">{label}</span>
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
export function Dropdown({ label, items, onSelect }: { label: string; items: DropdownItem[]; onSelect?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className="mova-dropdown" ref={root}>
      <Button variant="secondary" onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open}>
        {label}<ChevronDown size={16} aria-hidden />
      </Button>
      {open && <div className="mova-dropdown__menu" role="menu">
        {items.map((item) => <button type="button" role="menuitem" key={item.id} className={item.destructive ? 'is-danger' : ''} onClick={() => { onSelect?.(item.id); setOpen(false); }}>{item.label}</button>)}
      </div>}
    </div>
  );
}

export function Modal({ open, title, children, onClose, footer }: { open: boolean; title: string; children: ReactNode; onClose: () => void; footer?: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="mova-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="mova-modal" role="dialog" aria-modal="true" aria-labelledby="mova-modal-title">
        <header><h2 id="mova-modal-title">{title}</h2><IconButton ref={closeRef} label="Закрыть" onClick={onClose}><X size={19} /></IconButton></header>
        <div className="mova-modal__body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </section>
    </div>
  );
}

interface ToastItem { id: number; message: string; tone?: 'success' | 'danger' }
const ToastContext = createContext<{ push: (message: string, tone?: ToastItem['tone']) => void }>({ push: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const push = (message: string, tone?: ToastItem['tone']) => {
    const id = Date.now();
    setToasts((items) => [...items, { id, message, tone }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 3200);
  };
  return <ToastContext.Provider value={{ push }}>{children}<div className="mova-toasts" aria-live="polite">{toasts.map((toast) => <div key={toast.id} className={`mova-toast ${toast.tone ? `mova-toast--${toast.tone}` : ''}`}><Check size={17} />{toast.message}</div>)}</div></ToastContext.Provider>;
}

export const useToast = () => useContext(ToastContext);

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="mova-visually-hidden">{Children.toArray(children).map((child) => isValidElement(child) ? cloneElement(child) : child)}</span>;
}
