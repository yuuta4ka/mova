import { describe, expect, it } from 'vitest';
import { availableSharePickerTabs, buildSharePickerSources } from './share-picker-model.mjs';

const image = (value, empty = false) => ({
  isEmpty: () => empty,
  toDataURL: () => value,
});

describe('desktop share picker source model', () => {
  it('separates window and whole-screen sources and preserves their previews', () => {
    const sources = buildSharePickerSources([
      { id: 'window:41:0', name: 'Mova', thumbnail: image('data:image/png;base64,window'), appIcon: image('data:image/png;base64,icon') },
      { id: 'screen:0:0', name: 'Основной экран', display_id: '69733248', thumbnail: image('data:image/png;base64,screen') },
    ]);

    expect(sources).toEqual([
      expect.objectContaining({ id: 'window:41:0', name: 'Mova', kind: 'window', thumbnail: 'data:image/png;base64,window', appIcon: 'data:image/png;base64,icon' }),
      expect.objectContaining({ id: 'screen:0:0', name: 'Основной экран', kind: 'screen', displayId: '69733248', thumbnail: 'data:image/png;base64,screen' }),
    ]);
    expect(availableSharePickerTabs(sources)).toEqual(['window', 'screen']);
  });

  it('keeps multiple monitors as separate selectable screen cards', () => {
    const sources = buildSharePickerSources([
      { id: 'screen:0:0', name: 'Экран 1', display_id: '1', thumbnail: image('data:one') },
      { id: 'screen:1:0', name: 'Экран 2', display_id: '2', thumbnail: image('data:two') },
    ]);

    expect(sources.map(({ id, displayId }) => ({ id, displayId }))).toEqual([
      { id: 'screen:0:0', displayId: '1' },
      { id: 'screen:1:0', displayId: '2' },
    ]);
    expect(availableSharePickerTabs(sources)).toEqual(['screen']);
  });

  it('shows a device tab only when that source type is actually available', () => {
    const withoutDevices = buildSharePickerSources([{ id: 'window:1:0', name: 'Окно', thumbnail: image('', true) }]);
    const withDevices = buildSharePickerSources([...withoutDevices, { id: 'device:camera:1', name: 'Камера', thumbnail: image('data:camera') }]);

    expect(availableSharePickerTabs(withoutDevices)).toEqual(['window']);
    expect(availableSharePickerTabs(withDevices)).toEqual(['window', 'device']);
  });

  it('drops unsupported source identifiers instead of exposing them to the picker', () => {
    expect(buildSharePickerSources([{ id: 'unknown:1', name: 'Неизвестно', thumbnail: image('data:unknown') }])).toEqual([]);
  });

  it('creates fresh picker payloads for repeat openings without retaining previews', () => {
    const raw = [{ id: 'window:2:0', name: 'Редактор', thumbnail: image('data:first') }];
    const first = buildSharePickerSources(raw);
    const second = buildSharePickerSources(raw);

    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second[0]).not.toBe(first[0]);
  });
});
