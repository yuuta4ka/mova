import { Children, isValidElement, useEffect, useId, useRef, useState, type SelectHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

/** Keyboard-accessible single selection with the popup outside clipped modal content. */
export function SelectField(props: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> & {onValueChange: (value: string) => void}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 280 });
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const id = useId();
  const options = Children.toArray(props.children).filter(isValidElement).map(child => (child as ReactElement<{ value: string | number; children: ReactNode; disabled?: boolean }>).props);
  const selected = options.findIndex(option => String(option.value) === String(props.value));
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => { if (!trigger.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) setOpen(false); };
    const closeOnScroll = (event: Event) => { if (!popup.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('resize', closeOnScroll);
    document.addEventListener('scroll', closeOnScroll, true);
    return () => { document.removeEventListener('pointerdown', closeOutside); window.removeEventListener('resize', closeOnScroll); document.removeEventListener('scroll', closeOnScroll, true); };
  }, [open]);
  useEffect(() => { const list = popup.current; const option = list?.children[active] as HTMLElement | undefined; if (list && option) { if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop; else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight; } }, [active, open]);
  function show() {
    if (!options.length) return;
    const rect = trigger.current!.getBoundingClientRect();
    const height = Math.min(280, options.length * 40 + 12);
    const above = window.innerHeight - rect.bottom < height + 12 && rect.top > height + 72;
    setPosition({ left: rect.left, top: above ? rect.top - height - 6 : rect.bottom + 6, width: rect.width, maxHeight: above ? height : Math.min(height, window.innerHeight - rect.bottom - 14) });
    setActive(Math.max(0, selected)); setOpen(true);
  }
  function choose(index: number) {
    if (!options[index] || options[index].disabled) return;
    props.onValueChange(String(options[index].value));
    setOpen(false); trigger.current?.focus();
  }
  return <><button ref={trigger} id={props.id} type="button" className={`mova-select ${props.className || ''}`} disabled={props.disabled || !options.length} role="combobox" aria-label={props['aria-label']} aria-labelledby={props['aria-labelledby']} aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="listbox" aria-activedescendant={open ? `${id}-${active}` : undefined}
    onClick={() => open ? setOpen(false) : show()} onKeyDown={event => {
      if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      else if (event.key === 'Tab') setOpen(false);
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); if (!open) { show(); return; }
        const direction = event.key === 'ArrowUp' ? -1 : 1;
        let next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (active + direction + options.length) % options.length;
        for (let count = 0; count < options.length && options[next]?.disabled; count++) next = (next + direction + options.length) % options.length;
        setActive(next);
      } else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey) { const found = options.findIndex(option => !option.disabled && String(option.children).toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase())); if (found >= 0) { event.preventDefault(); if (!open) show(); setActive(found); } } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open ? choose(active) : show(); }
    }}><span>{options[selected]?.children || options[0]?.children}</span><ChevronDown size={17} /></button>
    {open && createPortal(<div ref={popup} id={id} role="listbox" aria-label={props['aria-label']} className="mova-select-options" style={position} onPointerDown={event => event.preventDefault()}>
      {options.map((option, index) => <div id={`${id}-${index}`} key={String(option.value)} role="option" aria-selected={index === selected} aria-disabled={option.disabled || undefined} className={`${index === active ? 'is-focused' : ''} ${index === selected ? 'is-selected' : ''}`} onMouseMove={() => setActive(index)} onClick={() => choose(index)}><span>{option.children}</span>{index === selected && <Check size={17} />}</div>)}
    </div>, document.body)}
  </>;
}
