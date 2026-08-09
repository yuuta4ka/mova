import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { messages } from '../data';
import { MessageComposer, MessageItem } from './Product';

describe('product components', () => {
  it('toggles a reaction and updates count', async () => {
    const user = userEvent.setup();
    render(<MessageItem message={messages[0]} />);
    const reaction = screen.getByRole('button', { name: '👋 4' });
    await user.click(reaction);
    expect(screen.getByRole('button', { name: '👋 5' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('clears the composer after submit', async () => {
    const user = userEvent.setup();
    render(<MessageComposer channel="общий" />);
    const composer = screen.getByRole('textbox', { name: 'Сообщение в канал общий' });
    await user.type(composer, 'Привет!');
    await user.click(screen.getByRole('button', { name: 'Отправить' }));
    expect(composer).toHaveValue('');
  });
});
