const editActions = [
  { label: 'Отменить', role: 'undo', flag: 'canUndo' },
  { label: 'Повторить', role: 'redo', flag: 'canRedo' },
  { type: 'separator' },
  { label: 'Вырезать', role: 'cut', flag: 'canCut' },
  { label: 'Копировать', role: 'copy', flag: 'canCopy' },
  { label: 'Вставить', role: 'paste', flag: 'canPaste' },
  { label: 'Удалить', role: 'delete', flag: 'canDelete' },
  { type: 'separator' },
  { label: 'Выбрать всё', role: 'selectAll', flag: 'canSelectAll' },
];

export function desktopApplicationEditMenu() {
  return editActions.map(({ flag: _flag, ...item }) => ({ ...item }));
}

export function desktopEditContextMenuTemplate(params) {
  if (!params?.isEditable) return [];
  const editFlags = params.editFlags || {};
  return editActions.map(({ flag, ...item }) => (
    item.type === 'separator' ? { ...item } : { ...item, enabled: editFlags[flag] === true }
  ));
}
