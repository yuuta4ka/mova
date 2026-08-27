import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DesktopHotkeySettingsPanel } from './DesktopHotkeySettings';
import type { DesktopHotkeySettings } from '../DesktopTitlebar';
import '../settings.css';

const meta = {
  title: 'Mova/Desktop/Горячие клавиши',
  parameters: { layout: 'centered' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Windows: Story = {
  render: function Render() {
    const [settings, setSettings] = useState<DesktopHotkeySettings>({
      toggleMicrophone: 'CommandOrControl+Shift+M',
      toggleHeadphones: 'CommandOrControl+Shift+D',
    });
    return <div style={{ width: 'min(720px, calc(100vw - 48px))', minHeight: 520, padding: 24, color: '#f3f3f5', background: '#1a1c23', borderRadius: 22 }}><DesktopHotkeySettingsPanel settings={settings} platform="win32" onChange={setSettings} /></div>;
  },
};
