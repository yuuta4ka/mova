import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { Avatar, Button, ConfirmDialog, Dropdown, IconButton, Input, Modal, StatusIndicator, Tabs, ToastProvider, useToast } from './Primitives';

afterEach(() => vi.useRealTimers());

function ModalHarness({ onClosed }: { onClosed?: () => void }) {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Открыть</button><Modal open={open} title="Проверка" onClose={() => { setOpen(false); onClosed?.(); }}>Содержимое</Modal></>;
}

function ToastHarness() {
  const { push } = useToast();
  return <button onClick={() => push('Сохранено', 'success')}>Показать</button>;
}

describe('interactive primitives', () => {
  it.each([
    ['online', 'В сети'],
    ['idle', 'Неактивен'],
    ['dnd', 'Не беспокоить'],
    ['offline', 'Не в сети'],
    ['invisible', 'Невидимый'],
  ] as const)('renders %s presence through the shared status indicator', (status, label) => {
    const { container } = render(<StatusIndicator status={status} />);
    expect(screen.getByRole('img', { name: label })).toHaveClass('mova-status-indicator', `mova-status-indicator--${status}`);
    expect(container.querySelectorAll('.mova-status-indicator')).toHaveLength(1);
  });

  it('uses StatusIndicator inside avatars', () => {
    render(<Avatar name="Юта" status="idle" />);
    expect(screen.getByRole('img', { name: 'Неактивен' })).toHaveClass('mova-status-indicator--idle');
  });

  it('disables a loading button and exposes busy state', () => {
    render(<Button loading>Сохранить</Button>);
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
  });

  it('does not submit forms from ordinary action buttons', () => {
    render(<form><Button>Действие</Button><IconButton label="Иконка">i</IconButton></form>);
    expect(screen.getByRole('button', { name: 'Действие' })).toHaveAttribute('type', 'button');
    expect(screen.getByRole('button', { name: 'Иконка' })).toHaveAttribute('type', 'button');
  });

  it('opens dropdown, selects an item and closes it', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Dropdown label="Действия" items={[{ id: 'invite', label: 'Пригласить' }]} onSelect={onSelect} />);
    await user.click(screen.getByRole('button', { name: /Действия/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Пригласить' }));
    expect(onSelect).toHaveBeenCalledWith('invite');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes modal with Escape and restores focus', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<><button>До окна</button><Modal open title="Проверка" onClose={onClose}>Содержимое</Modal></>);
    expect(screen.getByRole('button', { name: 'Закрыть' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('changes tabs and reports selected state', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs value="all" onChange={onChange} items={[{ id: 'all', label: 'Все' }, { id: 'online', label: 'В сети' }]} />);
    expect(screen.getByRole('tab', { name: 'Все' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: 'В сети' }));
    expect(onChange).toHaveBeenCalledWith('online');
  });

  it('keeps a closing modal mounted for the exit lifecycle and restores focus', () => {
    vi.useFakeTimers();
    render(<ModalHarness />);
    const trigger = screen.getByRole('button', { name: 'Открыть' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('.mova-dialog-surface.is-closing')).toBeInTheDocument();
    expect(trigger).toHaveFocus();
    act(() => vi.advanceTimersByTime(190));
    expect(document.querySelector('.mova-dialog-surface')).not.toBeInTheDocument();
  });

  it('closes only from the modal background, not from its surface', () => {
    render(<ModalHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));
    fireEvent.pointerDown(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.pointerDown(document.querySelector('.mova-modal-backdrop')!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes a popover outside and supports arrow-key navigation', () => {
    vi.useFakeTimers();
    render(<Dropdown label="Действия" items={[{ id: 'one', label: 'Первое' }, { id: 'two', label: 'Второе' }]} />);
    const trigger = screen.getByRole('button', { name: /Действия/ });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    act(() => vi.runOnlyPendingTimers());
    expect(screen.getByRole('menuitem', { name: 'Первое' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Первое' }), { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Второе' })).toHaveFocus();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(document.querySelector('.mova-popover-surface.is-closing')).toBeInTheDocument();
  });

  it('uses one focus shell and leaves the inner input borderless', () => {
    const { container } = render(<Input label="Имя" />);
    const input = screen.getByRole('textbox', { name: 'Имя' });
    const shell = container.querySelector('.mova-control-shell');
    expect(shell).toContainElement(input);
    expect(shell?.querySelectorAll('input')).toHaveLength(1);
    expect(input.parentElement).toHaveClass('mova-control-shell');
  });

  it('makes cancel the safe initial action in a dangerous confirmation', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<ConfirmDialog open title="Удалить чат?" description="Это действие нельзя отменить" onCancel={onCancel} onConfirm={onConfirm} />);
    expect(screen.getByRole('button', { name: 'Отмена' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('deduplicates a repeated toast and dismisses it explicitly', () => {
    render(<ToastProvider><ToastHarness /></ToastProvider>);
    const trigger = screen.getByRole('button', { name: 'Показать' });
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.getAllByText('Сохранено')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть уведомление' }));
    expect(document.querySelector('.mova-toast.is-closing')).toBeInTheDocument();
  });
});
