import { useEffect, useState } from 'react';

export type DesktopShellApi = {
  platform: string;
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  setCallStatus?: (status: { active: boolean; speaking: boolean; muted: boolean; deafened: boolean }) => void;
  showNotification?: (notification: { kind: 'message' | 'call'; title: string; body: string; conversationId: string }) => void;
  onNotificationClick?: (callback: (notification: { kind: 'message' | 'call'; conversationId: string }) => void) => () => void;
  onSharePickerRequest?: (callback: (payload: DesktopSharePickerRequest) => void) => () => void;
  chooseShareSource?: (requestId: string, sourceId: string) => void;
  cancelSharePicker?: (requestId: string) => void;
  getAutoLaunch?: () => Promise<boolean>;
  setAutoLaunch?: (enabled: boolean) => Promise<boolean>;
  getSystemIdleTime?: () => Promise<number>;
  getGameActivity?: () => Promise<DesktopGameActivity | null>;
  onGameActivityChange?: (callback: (activity: DesktopGameActivity | null) => void) => () => void;
  isMaximized: () => Promise<boolean>;
  onMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
};

export type DesktopGameActivity = {
  name: string;
  startedAt: string;
};

export type DesktopShareSourceKind = 'window' | 'screen' | 'device';
export type DesktopShareSource = {
  id: string;
  name: string;
  kind: DesktopShareSourceKind;
  displayId: string;
  thumbnail: string;
  appIcon: string;
};
export type DesktopSharePickerRequest = {
  requestId: string;
  sources: DesktopShareSource[];
  tabs: DesktopShareSourceKind[];
};

declare global {
  interface Window {
    movaDesktopShell?: DesktopShellApi;
  }
}

export function DesktopTitlebar() {
  const shell = window.movaDesktopShell;
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!shell || shell.platform !== 'win32') return;
    let active = true;
    void shell.isMaximized().then((value) => active && setMaximized(value));
    const dispose = shell.onMaximizedChange(setMaximized);
    return () => {
      active = false;
      dispose();
    };
  }, [shell]);

  if (!shell || shell.platform !== 'win32') return null;
  return (
    <header className="mova-desktop-titlebar" data-maximized={maximized ? 'true' : 'false'} onDoubleClick={(event) => {
      if ((event.target as Element).closest('.mova-desktop-titlebar__controls')) return;
      shell.toggleMaximize();
    }}>
      <div className="mova-desktop-titlebar__identity" aria-hidden="true">
        <img src="/icon-192.png" alt="" />
        <strong>Mova</strong>
      </div>
      <div className="mova-desktop-titlebar__controls">
        <button type="button" aria-label="Свернуть" onClick={shell.minimize}>
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 8.5h8" /></svg>
        </button>
        <button type="button" aria-label={maximized ? 'Восстановить окно' : 'Развернуть окно'} onClick={shell.toggleMaximize}>
          {maximized
            ? <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 4.5v-2h6v6h-2M2.5 4.5h5v5h-5z" /></svg>
            : <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5h7v7h-7z" /></svg>}
        </button>
        <button type="button" className="is-close" aria-label="Закрыть" onClick={shell.close}>
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m2.5 2.5 7 7m0-7-7 7" /></svg>
        </button>
      </div>
    </header>
  );
}
