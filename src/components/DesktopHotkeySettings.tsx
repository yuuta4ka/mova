import { useEffect, useState } from 'react';
import { Headphones, Info, Keyboard, Mic, Trash2 } from 'lucide-react';
import type { DesktopHotkeyAction, DesktopHotkeySettings } from '../DesktopTitlebar';
import { desktopHotkeyActionLabels, desktopHotkeySettingKey, formatDesktopHotkey, hotkeyAcceleratorFromEvent } from '../lib/desktopHotkeys';

const actions: DesktopHotkeyAction[] = ['toggle-microphone', 'toggle-headphones'];

export function DesktopHotkeySettingsPanel({ settings, platform, onChange }: {
  settings: DesktopHotkeySettings;
  platform: string;
  onChange: (settings: DesktopHotkeySettings) => void;
}) {
  const [recording, setRecording] = useState<DesktopHotkeyAction | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!recording) return;
    const capture = (event: KeyboardEvent) => {
      if (event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
      const key = desktopHotkeySettingKey[recording];
      const accelerator = hotkeyAcceleratorFromEvent(event, platform);
      if (!accelerator) {
        if (!['Control', 'Meta', 'Alt', 'AltGraph', 'Shift'].includes(event.key)) setError('Эту клавишу нельзя зарегистрировать как системный хоткей.');
        return;
      }
      const conflict = actions.find((action) => action !== recording && settings[desktopHotkeySettingKey[action]].toLowerCase() === accelerator.toLowerCase());
      if (conflict) {
        setError(`Это сочетание уже назначено действию «${desktopHotkeyActionLabels[conflict]}».`);
        return;
      }
      onChange({ ...settings, [key]: accelerator });
      setRecording(null);
      setError('');
    };
    window.addEventListener('keydown', capture, true);
    return () => window.removeEventListener('keydown', capture, true);
  }, [onChange, platform, recording, settings]);

  return (
    <div className="mova-hotkey-settings">
      <div className="mova-hotkey-settings__note" role="note">
        <Info size={19} aria-hidden="true" />
        <span><strong>Хоткеи временно приостановлены</strong><small>Пока открыт этот раздел, сочетания не выполняют действия — их можно безопасно переназначать.</small></span>
      </div>
      <section>
        <header>
          <span><Keyboard size={19} aria-hidden="true" /><strong>Пользовательские горячие клавиши</strong></span>
          <small>Назначьте одну клавишу или сочетание. Хоткеи работают во время звонка, даже если Mova свёрнута или находится в фоне.</small>
        </header>
        <div className="mova-hotkey-list">
          {actions.map((action) => {
            const key = desktopHotkeySettingKey[action];
            const accelerator = settings[key];
            const active = recording === action;
            return (
              <div className={`mova-hotkey-row${active ? ' is-recording' : ''}`} key={action}>
                <span className="mova-hotkey-row__icon" aria-hidden="true">{action === 'toggle-microphone' ? <Mic size={20} /> : <Headphones size={20} />}</span>
                <span className="mova-hotkey-row__copy"><strong>{desktopHotkeyActionLabels[action]}</strong><small>{action === 'toggle-microphone' ? 'Включает или выключает ваш микрофон' : 'Включает или выключает входящий звук и микрофон'}</small></span>
                <button
                  type="button"
                  className="mova-hotkey-recorder"
                  aria-label={`${desktopHotkeyActionLabels[action]}: ${active ? 'нажмите сочетание' : formatDesktopHotkey(accelerator, platform)}`}
                  aria-pressed={active}
                  onClick={() => { setRecording(active ? null : action); setError(''); }}
                >
                  {active ? 'Нажмите сочетание…' : formatDesktopHotkey(accelerator, platform)}
                </button>
                <button type="button" className="mova-hotkey-clear" aria-label={`Удалить сочетание «${desktopHotkeyActionLabels[action]}»`} disabled={!accelerator} onClick={() => { onChange({ ...settings, [key]: '' }); setRecording(null); setError(''); }}>
                  <Trash2 size={18} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
        {error && <div className="mova-hotkey-settings__error" role="alert">{error}</div>}
      </section>
    </div>
  );
}
