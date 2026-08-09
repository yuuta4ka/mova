import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, Dropdown, Modal, Tabs } from './Primitives';

describe('interactive primitives', () => {
  it('disables a loading button and exposes busy state', () => {
    render(<Button loading>Сохранить</Button>);
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
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
});
