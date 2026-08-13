import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AppWindow, Monitor, Radio, X } from 'lucide-react';
import type { DesktopSharePickerRequest, DesktopShareSourceKind } from './DesktopTitlebar';

const tabMeta: Record<DesktopShareSourceKind, { label: string; icon: typeof AppWindow }> = {
  window: { label: 'Приложения', icon: AppWindow },
  screen: { label: 'Весь экран', icon: Monitor },
  device: { label: 'Устройства', icon: Radio },
};

export function DesktopSharePicker() {
  const shell = window.movaDesktopShell;
  const [request, setRequest] = useState<DesktopSharePickerRequest | null>(null);
  const [activeTab, setActiveTab] = useState<DesktopShareSourceKind>('window');
  const [selectedId, setSelectedId] = useState('');

  useEffect(() => {
    if (!shell?.onSharePickerRequest) return;
    return shell.onSharePickerRequest((payload) => {
      const tabs = Array.isArray(payload?.tabs) ? payload.tabs.filter((kind) => kind in tabMeta) : [];
      const sources = Array.isArray(payload?.sources) ? payload.sources.filter((source) => source && typeof source.id === 'string' && tabs.includes(source.kind)) : [];
      const tab = tabs[0] || 'window';
      setRequest({ requestId: String(payload?.requestId || ''), tabs, sources });
      setActiveTab(tab);
      setSelectedId(sources.find((source) => source.kind === tab)?.id || '');
    });
  }, [shell]);

  useEffect(() => {
    if (!request) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      shell?.cancelSharePicker?.(request.requestId);
      setRequest(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [request, shell]);

  const visibleSources = useMemo(() => request?.sources.filter((source) => source.kind === activeTab) || [], [activeTab, request]);
  if (!request) return null;

  const cancel = () => {
    shell?.cancelSharePicker?.(request.requestId);
    setRequest(null);
  };
  const choose = (sourceId = selectedId) => {
    if (!request.sources.some((source) => source.id === sourceId && source.kind === activeTab)) return;
    shell?.chooseShareSource?.(request.requestId, sourceId);
    setRequest(null);
  };
  const selectTab = (kind: DesktopShareSourceKind) => {
    setActiveTab(kind);
    setSelectedId(request.sources.find((source) => source.kind === kind)?.id || '');
  };

  return createPortal(
    <div className="mova-desktop-share-picker" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && cancel()}>
      <section className="mova-desktop-share-picker__dialog" role="dialog" aria-modal="true" aria-labelledby="desktop-share-picker-title">
        <header>
          <span>
            <strong id="desktop-share-picker-title">Демонстрация экрана</strong>
            <small>Выберите, что увидят участники звонка</small>
          </span>
          <button type="button" aria-label="Закрыть выбор источника" onClick={cancel}><X size={19} /></button>
        </header>
        <nav aria-label="Тип источника">
          {request.tabs.map((kind) => {
            const Icon = tabMeta[kind].icon;
            return <button type="button" className={activeTab === kind ? 'is-active' : ''} aria-current={activeTab === kind ? 'page' : undefined} onClick={() => selectTab(kind)} key={kind}><Icon size={16} /><span>{tabMeta[kind].label}</span></button>;
          })}
        </nav>
        <div className="mova-desktop-share-picker__content">
          {visibleSources.length ? (
            <div className="mova-desktop-share-picker__grid" role="listbox" aria-label="Источники демонстрации">
              {visibleSources.map((source) => (
                <button
                  type="button"
                  className={selectedId === source.id ? 'is-selected' : ''}
                  role="option"
                  aria-selected={selectedId === source.id}
                  title={source.name}
                  onClick={() => setSelectedId(source.id)}
                  onDoubleClick={() => choose(source.id)}
                  key={source.id}
                >
                  <span className={`mova-desktop-share-picker__preview${source.thumbnail ? '' : ' is-empty'}`}>
                    {source.thumbnail ? <img src={source.thumbnail} alt="" /> : <small>Предпросмотр недоступен</small>}
                  </span>
                  <span className="mova-desktop-share-picker__source-title">
                    {source.appIcon ? <img src={source.appIcon} alt="" /> : source.kind === 'screen' ? <Monitor size={16} /> : <AppWindow size={16} />}
                    <span>{source.name}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : <p>Источники этого типа не найдены</p>}
        </div>
        <footer>
          <span><strong>Качество демонстрации</strong><small>Разрешение и FPS применяются из настроек звонка Mova</small></span>
          <button type="button" className="is-cancel" onClick={cancel}>Отмена</button>
          <button type="button" className="is-primary" disabled={!selectedId} onClick={() => choose()}>Начать демонстрацию</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
