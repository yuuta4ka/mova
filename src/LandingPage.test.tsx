import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LandingPage } from './LandingPage';

describe('Mova landing page', () => {
  it('explains the project and offers verified desktop downloads and web access', () => {
    render(<LandingPage />);

    expect(screen.getByRole('heading', { name: /Mova.*Мессенджер, сделанный по вечерам/i })).toBeVisible();
    expect(screen.getByRole('heading', { name: /Зачем ещё один мессенджер/i })).toBeVisible();
    expect(screen.getByRole('heading', { name: /От маленького чата до полноценной Mova/i })).toBeVisible();
    expect(screen.getByRole('heading', { name: /Сделано с AI/i })).toBeVisible();
    expect(screen.getByAltText(/Фрагмент настоящего интерфейса Mova/i)).toHaveAttribute('src', '/mova-interface.png');
    expect(screen.getByAltText(/Мая выглядывает/i)).toHaveAttribute('src', '/mova-character-peek.png');
    expect(screen.queryByText(/для атмосферы/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Windows/i })[0]).toHaveAttribute(
      'href',
      'https://github.com/yuuta4ka/mova/releases/download/v0.1.9/Mova.Setup.0.1.9.exe',
    );
    expect(screen.getAllByRole('link', { name: /Открыть Mova/i })[0]).toHaveAttribute('href', '/app');
    expect(screen.getByRole('link', { name: /macOS/i })).toHaveAttribute(
      'href',
      'https://github.com/yuuta4ka/mova/releases/download/v0.1.9/Mova-0.1.9-arm64.dmg',
    );
    expect(screen.getByAltText(/Диалог в Mova/i)).toHaveAttribute('src', '/mova-interface.png');
    expect(screen.getByAltText(/Активный голосовой звонок/i)).toHaveAttribute('src', '/mova-call.png');
    expect(screen.getByRole('link', { name: /Поддержать проект/i })).toHaveAttribute(
      'href',
      'https://donatex.gg/donate/yuuta',
    );
    expect(screen.getByRole('heading', { name: /Нашли баг или есть идея/i })).toBeVisible();
    expect(screen.getByText('@yuuta4ka', { selector: '.mova-landing-support__username' })).toBeVisible();
    expect(screen.queryByRole('link', { name: /@yuuta4ka/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /пролистали сайт до самого конца/i })).toBeVisible();
    expect(document.querySelector('.mova-landing-footer__word')).toHaveTextContent('Mova');
  });

  it('opens and closes the secret video', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    render(<LandingPage />);

    fireEvent.click(screen.getByRole('button', { name: /Открыть секретное видео/i }));

    expect(play).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { name: /Секретное видео/i })).toBeVisible();
    expect(Array.from(document.querySelectorAll('video source')).map((source) => source.getAttribute('src'))).toEqual([
      '/mova-secret-mobile-v2.mp4',
      '/mova-secret.mp4',
    ]);

    fireEvent.click(screen.getByRole('button', { name: /Закрыть видео/i }));
    expect(pause).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: /Секретное видео/i })).not.toBeInTheDocument();
    play.mockRestore();
    pause.mockRestore();
  });
});
