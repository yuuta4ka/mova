import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { ChevronLeft, ChevronRight, Download, Minus, Plus, RotateCcw, X } from 'lucide-react';
import type { AppMessage, MessageAttachment } from '../lib/api';
import { attachmentDownloadSource } from '../lib/fileAttachments';

export const mediaViewerMinZoom = 1;
export const mediaViewerMaxZoom = 4;
const controlsHideDelay = 2_200;
const closeDuration = 210;

export interface MediaViewerItem {
  id: string;
  attachment: MessageAttachment;
}

export const mediaAttachmentSource = (attachment: MessageAttachment) => attachment.url || attachment.dataUrl || '';

export function buildMediaGallery(messages: AppMessage[]): MediaViewerItem[] {
  return messages.flatMap((message) => {
    if (message.kind === 'call' || !message.attachment?.type.startsWith('image/') || !mediaAttachmentSource(message.attachment)) return [];
    return [{ id: message.id, attachment: message.attachment }];
  });
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => Boolean(window.matchMedia?.(query).matches));
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, [query]);
  return matches;
}

const clampZoom = (value: number) => Math.min(mediaViewerMaxZoom, Math.max(mediaViewerMinZoom, value));

export function MediaViewer({ items, activeId, onClose }: { items: MediaViewerItem[]; activeId: string; onClose: () => void }) {
  const initialIndex = Math.max(0, items.findIndex((item) => item.id === activeId));
  const [index, setIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(mediaViewerMinZoom);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [controlsVisible, setControlsVisible] = useState(true);
  const [closing, setClosing] = useState(false);
  const compact = useMediaQuery('(max-width: 700px)');
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const closeButton = useRef<HTMLButtonElement>(null);
  const controlsTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | { kind: 'pan'; startX: number; startY: number; panX: number; panY: number }
    | { kind: 'pinch'; distance: number; zoom: number }
    | { kind: 'swipe'; startX: number; startY: number; startedAt: number; moved: boolean }
    | null
  >(null);
  const lastTapAt = useRef(0);
  const lastPointerType = useRef('mouse');
  const consumedGesture = useRef(false);
  const current = items[index] || items[0];

  const clampPan = useCallback((next: { x: number; y: number }, nextZoom = zoom) => {
    if (nextZoom <= mediaViewerMinZoom) return { x: 0, y: 0 };
    const maxX = (window.innerWidth || 1024) * (nextZoom - 1) * 0.5;
    const maxY = (window.innerHeight || 768) * (nextZoom - 1) * 0.5;
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  }, [zoom]);

  const resetView = useCallback(() => {
    setZoom(mediaViewerMinZoom);
    setPan({ x: 0, y: 0 });
  }, []);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimer.current !== null) window.clearTimeout(controlsTimer.current);
    controlsTimer.current = window.setTimeout(() => setControlsVisible(false), controlsHideDelay);
  }, []);

  const requestClose = useCallback(() => {
    if (closing) return;
    resetView();
    if (reducedMotion) {
      onClose();
      return;
    }
    setClosing(true);
    closeTimer.current = window.setTimeout(onClose, closeDuration);
  }, [closing, onClose, reducedMotion, resetView]);

  const showItem = useCallback((nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= items.length) return;
    setIndex(nextIndex);
    resetView();
    revealControls();
  }, [items.length, resetView, revealControls]);

  const applyZoom = useCallback((next: number) => {
    const value = clampZoom(next);
    setZoom(value);
    setPan((currentPan) => clampPan(currentPan, value));
    revealControls();
  }, [clampPan, revealControls]);

  const toggleZoom = useCallback(() => {
    if (zoom > mediaViewerMinZoom) resetView();
    else applyZoom(2);
  }, [applyZoom, resetView, zoom]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    revealControls();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (controlsTimer.current !== null) window.clearTimeout(controlsTimer.current);
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
      previousFocus?.focus();
    };
  }, [revealControls]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        showItem(index - 1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        showItem(index + 1);
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        applyZoom(zoom + 0.5);
      } else if (event.key === '-') {
        event.preventDefault();
        applyZoom(zoom - 0.5);
      } else if (event.key === '0') {
        event.preventDefault();
        resetView();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [applyZoom, index, requestClose, resetView, showItem, zoom]);

  useEffect(() => {
    const next = items[index + 1];
    if (!next) return;
    const image = new Image();
    image.src = mediaAttachmentSource(next.attachment);
  }, [index, items]);

  const wheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    applyZoom(zoom * Math.exp(-event.deltaY * 0.002));
  };

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    lastPointerType.current = event.pointerType || 'mouse';
    revealControls();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [first, second] = [...pointers.current.values()];
      gesture.current = { kind: 'pinch', distance: Math.hypot(second.x - first.x, second.y - first.y), zoom };
      return;
    }
    gesture.current = zoom > mediaViewerMinZoom
      ? { kind: 'pan', startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y }
      : { kind: 'swipe', startX: event.clientX, startY: event.clientY, startedAt: Date.now(), moved: false };
  };

  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    revealControls();
    if (pointers.current.size >= 2) {
      const [first, second] = [...pointers.current.values()];
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      if (gesture.current?.kind !== 'pinch') gesture.current = { kind: 'pinch', distance, zoom };
      const pinch = gesture.current;
      applyZoom(pinch.zoom * (distance / Math.max(1, pinch.distance)));
      consumedGesture.current = true;
      return;
    }
    if (gesture.current?.kind === 'pan') {
      const next = clampPan({ x: gesture.current.panX + event.clientX - gesture.current.startX, y: gesture.current.panY + event.clientY - gesture.current.startY });
      setPan(next);
      consumedGesture.current = true;
    } else if (gesture.current?.kind === 'swipe') {
      const moved = Math.hypot(event.clientX - gesture.current.startX, event.clientY - gesture.current.startY) > 8;
      if (moved) gesture.current.moved = true;
    }
  };

  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const activeGesture = gesture.current;
    pointers.current.delete(event.pointerId);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (activeGesture?.kind === 'swipe' && event.pointerType === 'touch') {
      const deltaX = event.clientX - activeGesture.startX;
      const deltaY = event.clientY - activeGesture.startY;
      if (Date.now() - activeGesture.startedAt < 700 && Math.abs(deltaX) > 55 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
        showItem(index + (deltaX < 0 ? 1 : -1));
        consumedGesture.current = true;
      } else if (!activeGesture.moved) {
        const now = Date.now();
        if (now - lastTapAt.current < 320) {
          toggleZoom();
          consumedGesture.current = true;
          lastTapAt.current = 0;
        } else lastTapAt.current = now;
      }
    }
    if (pointers.current.size === 0) gesture.current = null;
  };

  if (!current) return null;
  const source = mediaAttachmentSource(current.attachment);
  const canGoPrevious = index > 0;
  const canGoNext = index < items.length - 1;
  const transformed = zoom > mediaViewerMinZoom || pan.x !== 0 || pan.y !== 0;

  return (
    <div
      className={`mova-media-viewer${closing ? ' is-closing' : ''}${controlsVisible ? '' : ' are-controls-hidden'}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Просмотр изображения ${current.attachment.name}`}
      data-layout={compact ? 'mobile' : 'desktop'}
      data-zoom={zoom.toFixed(2)}
      onWheel={wheel}
      onMouseMove={revealControls}
      onMouseDown={(event) => event.target === event.currentTarget && requestClose()}
    >
      <div className="mova-media-viewer__stage" onPointerDown={(event) => {
        lastPointerType.current = event.pointerType || 'mouse';
        if (event.pointerType === 'touch' && !controlsVisible) revealControls();
      }} onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        if (consumedGesture.current) {
          consumedGesture.current = false;
          return;
        }
        if (lastPointerType.current === 'touch' && !controlsVisible) revealControls();
        else requestClose();
      }}>
        <div
          className="mova-media-viewer__surface"
          style={{ transform: `translate3d(${pan.x}px,${pan.y}px,0) scale(${zoom})` }}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
          onDoubleClick={toggleZoom}
          onClick={(event) => event.stopPropagation()}
        >
          <img src={source} alt={current.attachment.name} draggable={false} />
        </div>
      </div>

      <header className="mova-media-viewer__toolbar">
        <span>
          <strong>{current.attachment.name}</strong>
          {items.length > 1 && <small>{index + 1} / {items.length}</small>}
        </span>
        <a href={attachmentDownloadSource(current.attachment)} download={current.attachment.name} aria-label="Скачать изображение" onClick={(event) => event.stopPropagation()}>
          <Download size={18} aria-hidden="true" />
        </a>
        <button ref={closeButton} type="button" aria-label="Закрыть изображение" onClick={requestClose}>
          <X size={19} aria-hidden="true" />
        </button>
      </header>

      {items.length > 1 && (
        <nav className="mova-media-viewer__navigation" aria-label="Навигация по изображениям">
          <button type="button" aria-label="Предыдущее изображение" disabled={!canGoPrevious} onClick={() => showItem(index - 1)}>
            <ChevronLeft size={24} aria-hidden="true" />
          </button>
          <button type="button" aria-label="Следующее изображение" disabled={!canGoNext} onClick={() => showItem(index + 1)}>
            <ChevronRight size={24} aria-hidden="true" />
          </button>
        </nav>
      )}

      <div className="mova-media-viewer__zoom" aria-label="Масштаб изображения">
        <button type="button" aria-label="Уменьшить" disabled={zoom <= mediaViewerMinZoom} onClick={() => applyZoom(zoom - 0.5)}>
          <Minus size={18} aria-hidden="true" />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="Увеличить" disabled={zoom >= mediaViewerMaxZoom} onClick={() => applyZoom(zoom + 0.5)}>
          <Plus size={18} aria-hidden="true" />
        </button>
        {transformed && (
          <button type="button" aria-label="Сбросить масштаб" onClick={resetView}>
            <RotateCcw size={17} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
