import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { MessageAttachment } from '../lib/api';
import { PhotoSendDialog } from './PhotoSendDialog';
import '../common-ui.css';
import '../composer.css';
import '../photo-send.css';

const previewPhotos: MessageAttachment[] = [
  { name: 'Интерфейс Mova.png', type: 'image/png', size: 340_000, url: '/mova-interface.png' },
  { name: 'Звонок Mova.png', type: 'image/png', size: 240_000, url: '/mova-call.png' },
  { name: 'Mova.png', type: 'image/png', size: 190_000, url: '/og.png' },
];

const meta = {
  title: 'Mova/Чат/Отправка фотографий',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const AlbumPreview: Story = {
  name: 'Предпросмотр альбома',
  render: function Render() {
    const [photos, setPhotos] = useState(previewPhotos);
    const [caption, setCaption] = useState('Новый интерфейс Mova');
    return (
      <div style={{ minHeight: '100vh', background: '#343136' }}>
        <PhotoSendDialog
          photos={photos}
          caption={caption}
          onCaptionChange={setCaption}
          onAdd={() => undefined}
          onRemove={(index) => setPhotos((items) => items.filter((_, itemIndex) => itemIndex !== index))}
          onClose={() => undefined}
          onSend={() => undefined}
        />
      </div>
    );
  },
};
