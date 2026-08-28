import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ScreenShareDefaults } from '../RealApp';
import { defaultScreenShareSettings, type ScreenShareSettings } from '../lib/screenShareSettings';
import '../settings.css';

const meta = {
  title: 'Mova/Desktop/Настройки демонстрации',
  parameters: { layout: 'centered' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const SystemAudio: Story = {
  name: 'Системный звук',
  render: function Render() {
    const [settings, setSettings] = useState<ScreenShareSettings>(defaultScreenShareSettings);
    const previousShell = window.movaDesktopShell;
    window.movaDesktopShell = previousShell || {
      platform: 'win32',
      minimize: () => undefined,
      toggleMaximize: () => undefined,
      close: () => undefined,
      isMaximized: async () => false,
      onMaximizedChange: () => () => undefined,
    };
    return <div style={{ width: 620, padding: 28, color: '#f3f3f5', background: '#1a1c23', borderRadius: 22 }}><ScreenShareDefaults settings={settings} onChange={setSettings} /></div>;
  },
};
