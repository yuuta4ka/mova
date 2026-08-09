import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';

describe('Mova application flows', () => {
  it('switches to personal chats, selects a dialog and sends a message', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Чаты' }));
    await user.click(screen.getByRole('button', { name: /Аня Тихая/ }));

    const composer = screen.getByRole('textbox', { name: 'Сообщение для Аня Тихая' });
    await user.type(composer, 'Проверка личного чата');
    await user.click(screen.getByRole('button', { name: 'Отправить' }));

    expect(screen.getByText('Проверка личного чата')).toBeVisible();
    expect(composer).toHaveValue('');
  });

  it('filters the chat list by person name', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Чаты' }));
    await user.type(screen.getByRole('textbox', { name: 'Поиск по чатам' }), 'Макс');
    expect(screen.getByRole('button', { name: /Макс Волков/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Аня Тихая/ })).not.toBeInTheDocument();
  });
});
