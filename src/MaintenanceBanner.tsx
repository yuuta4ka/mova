import { useEffect, useState, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { api } from './lib/api';

export const maintenancePollInterval = 3_000;

export function MaintenanceBanner() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      try {
        const state = await api.maintenance();
        if (!disposed) setActive(state.active);
      } catch {
        // Keep the last server-confirmed state when deployment temporarily interrupts requests.
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), maintenancePollInterval);
    const refreshNow = () => void refresh();
    window.addEventListener('online', refreshNow);
    window.addEventListener('focus', refreshNow);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener('online', refreshNow);
      window.removeEventListener('focus', refreshNow);
    };
  }, []);

  return (
    <div className="mova-maintenance-slot" data-visible={active ? 'true' : 'false'} aria-hidden={!active}>
      <div className="mova-maintenance-banner" role={active ? 'status' : undefined} aria-live="polite">
        <TriangleAlert size={18} aria-hidden="true" />
        <span>
          <strong>Идёт обновление Mova</strong>
          <small>Сервис может временно работать нестабильно. Сообщения, отправленные во время обновления, могут не сохраниться.</small>
        </span>
      </div>
    </div>
  );
}

export function MaintenanceFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mova-maintenance-frame">
      <MaintenanceBanner />
      <div className="mova-maintenance-content">{children}</div>
    </div>
  );
}
