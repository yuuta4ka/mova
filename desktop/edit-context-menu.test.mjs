import { describe, expect, it } from 'vitest';
import { desktopApplicationEditMenu, desktopEditContextMenuTemplate } from './edit-context-menu.mjs';

describe('desktop edit menus', () => {
  it('does not replace the web context menu outside editable fields', () => {
    expect(desktopEditContextMenuTemplate({ isEditable: false })).toEqual([]);
  });

  it('offers native editing actions and follows Chromium edit capabilities', () => {
    const menu = desktopEditContextMenuTemplate({
      isEditable: true,
      editFlags: {
        canUndo: false,
        canRedo: true,
        canCut: true,
        canCopy: true,
        canPaste: true,
        canDelete: true,
        canSelectAll: true,
      },
    });

    expect(menu.filter((item) => item.type !== 'separator').map(({ label, role, enabled }) => ({ label, role, enabled }))).toEqual([
      { label: 'Отменить', role: 'undo', enabled: false },
      { label: 'Повторить', role: 'redo', enabled: true },
      { label: 'Вырезать', role: 'cut', enabled: true },
      { label: 'Копировать', role: 'copy', enabled: true },
      { label: 'Вставить', role: 'paste', enabled: true },
      { label: 'Удалить', role: 'delete', enabled: true },
      { label: 'Выбрать всё', role: 'selectAll', enabled: true },
    ]);
  });

  it('keeps application menu roles enabled for the focused control', () => {
    expect(desktopApplicationEditMenu().filter((item) => item.type !== 'separator').map((item) => item.role)).toEqual([
      'undo', 'redo', 'cut', 'copy', 'paste', 'delete', 'selectAll',
    ]);
    expect(desktopApplicationEditMenu().some((item) => 'enabled' in item)).toBe(false);
  });
});
