import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { ImagePlus, Plus, Send, Smile, X } from 'lucide-react';
import type { MessageAttachment } from '../lib/api';
import { maximumAlbumImages } from '../lib/messageAttachments';
import { DialogSurface, IconButton } from './Primitives';
import { EmojiPicker } from './EmojiPicker';

const photoSource = (photo: MessageAttachment) => photo.url || photo.dataUrl || '';

export function PhotoSendDialog({
  photos,
  caption,
  preparing = false,
  onCaptionChange,
  onAdd,
  onRemove,
  onClose,
  onSend,
}: {
  photos: MessageAttachment[];
  caption: string;
  preparing?: boolean;
  onCaptionChange: (caption: string) => void;
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  onClose: () => void;
  onSend: () => void;
}) {
  const [emojiOpen, setEmojiOpen] = useState(false);
  const addInput = useRef<HTMLInputElement>(null);
  const captionInput = useRef<HTMLTextAreaElement>(null);
  const count = photos.length;
  const canAdd = count < maximumAlbumImages && !preparing;

  useEffect(() => {
    if (!count) setEmojiOpen(false);
  }, [count]);

  const addFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length) onAdd(files);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (count && !preparing) onSend();
  };
  const insertEmoji = (emoji: string) => {
    const input = captionInput.current;
    const start = input?.selectionStart ?? caption.length;
    const end = input?.selectionEnd ?? caption.length;
    const next = `${caption.slice(0, start)}${emoji}${caption.slice(end)}`;
    onCaptionChange(next);
    window.setTimeout(() => {
      captionInput.current?.focus();
      captionInput.current?.setSelectionRange(start + emoji.length, start + emoji.length);
    }, 0);
  };

  return (
    <DialogSurface
      open={count > 0}
      onClose={onClose}
      className="mova-photo-send-dialog"
      labelledBy="mova-photo-send-title"
      closeOnBackdrop={!preparing}
    >
      <form onSubmit={submit}>
        <header>
          <IconButton data-dialog-close label="Закрыть предпросмотр" disabled={preparing} onClick={onClose}><X size={23} /></IconButton>
          <h2 id="mova-photo-send-title">Отправить {count} фото</h2>
          <IconButton label="Добавить фотографии" disabled={!canAdd} onClick={() => addInput.current?.click()}><Plus size={23} /></IconButton>
          <input ref={addInput} type="file" accept="image/*" multiple hidden onChange={addFiles} />
        </header>

        <div className="mova-photo-send-preview" data-count={Math.min(count, 6)}>
          {photos.map((photo, index) => (
            <figure key={`${photo.name}-${photo.size}-${index}`}>
              <img src={photoSource(photo)} alt="" />
              <button type="button" aria-label={`Убрать фотографию ${index + 1}`} disabled={preparing} onClick={() => onRemove(index)}>
                <X size={15} aria-hidden="true" />
              </button>
            </figure>
          ))}
          {preparing && <div className="mova-photo-send-preparing" role="status"><ImagePlus size={24} /><span>Подготавливаем фото…</span></div>}
        </div>

        <footer>
          <IconButton label="Эмодзи" className={emojiOpen ? 'is-active' : ''} aria-haspopup="dialog" aria-expanded={emojiOpen} onClick={() => setEmojiOpen((open) => !open)}>
            <Smile size={23} />
          </IconButton>
          <textarea
            ref={captionInput}
            rows={1}
            maxLength={4000}
            value={caption}
            onChange={(event) => onCaptionChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (!preparing) onSend();
              }
            }}
            placeholder="Добавить подпись…"
            aria-label="Подпись к фотографиям"
          />
          <button className="mova-photo-send-submit" type="submit" aria-label={`Отправить ${count} фото`} disabled={preparing || !count}>
            <Send size={23} aria-hidden="true" />
          </button>
        </footer>
        {emojiOpen && <EmojiPicker onSelect={insertEmoji} onClose={() => setEmojiOpen(false)} />}
      </form>
    </DialogSurface>
  );
}
