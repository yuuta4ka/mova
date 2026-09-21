import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectDesktopPlatform, LandingPage } from './LandingPage';

const windowsHref = 'https://github.com/yuuta4ka/mova/releases/download/v0.1.15/Mova.Setup.0.1.15.exe';
const macHref = 'https://github.com/yuuta4ka/mova/releases/download/v0.1.15/Mova-0.1.15-arm64.dmg';
const initialMaxTouchPoints = Object.getOwnPropertyDescriptor(window.navigator, 'maxTouchPoints');

function mockNavigator(userAgent: string, platform: string, maxTouchPoints = 0) {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue(platform);
  Object.defineProperty(window.navigator, 'maxTouchPoints', { configurable: true, value: maxTouchPoints });
}

afterEach(() => {
  vi.restoreAllMocks();
  if (initialMaxTouchPoints) {
    Object.defineProperty(window.navigator, 'maxTouchPoints', initialMaxTouchPoints);
  } else {
    delete (window.navigator as unknown as { maxTouchPoints?: number }).maxTouchPoints;
  }
});

describe('Mova landing page', () => {
  it('puts the working product first and keeps all manual download options available', () => {
    mockNavigator('Mozilla/5.0 (X11; Linux x86_64)', 'Linux x86_64');
    render(<LandingPage />);

    expect(screen.getByRole('heading', { name: /Общайтесь.*Созванивайтесь.*Делитесь экраном/i })).toBeVisible();
    expect(screen.getByRole('heading', { name: /Всё нужное для разговора/i })).toBeVisible();
    expect(screen.getByRole('heading', { name: /Небольшая идея стала рабочей Mova/i })).toBeVisible();
    expect(document.querySelector('.mova-landing')).not.toHaveTextContent(/нейросет|vibecod|codex|\bAI\b/i);

    expect(screen.getByAltText(/Настоящий интерфейс диалога в Mova/i)).toHaveAttribute('src', '/mova-interface.png');
    expect(screen.getByAltText(/Настоящий интерфейс голосового звонка/i)).toHaveAttribute('src', '/mova-call.png');
    expect(screen.getByAltText(/Мая — персонаж проекта Mova/i)).toHaveAttribute('src', '/mova-character-peek.png');
    expect(screen.getAllByRole('link', { name: /Открыть Mova/i })[0]).toHaveAttribute('href', '/app');

    const platformChooser = screen.getAllByRole('button', { name: /Выбрать версию/i })[0];
    fireEvent.click(platformChooser);
    expect(platformChooser.closest('.mova-platform-download')?.querySelector('details')).toHaveAttribute('open');
    expect(screen.getAllByText('Другие платформы').length).toBeGreaterThan(0);
    expect(document.querySelector(`a[href="${windowsHref}"]`)).toBeInTheDocument();
    expect(document.querySelector(`a[href="${macHref}"]`)).toBeInTheDocument();
    expect(document.querySelector('[data-detected-platform="other"]')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: /Поддержать проект/i })).toHaveAttribute('href', 'https://donatex.gg/donate/yuuta');
    expect(screen.getByText('@yuuta4ka')).toBeVisible();
    expect(document.querySelector('.mova-landing-footer__word')).toHaveTextContent('Mova');
  });

  it.each([
    {
      label: 'Windows',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      navigatorPlatform: 'Win32',
      detectedPlatform: 'windows',
      href: windowsHref,
    },
    {
      label: 'macOS',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      navigatorPlatform: 'MacIntel',
      detectedPlatform: 'macos',
      href: macHref,
    },
  ])('automatically offers the $label installer', ({ label, userAgent, navigatorPlatform, detectedPlatform, href }) => {
    mockNavigator(userAgent, navigatorPlatform);
    render(<LandingPage />);

    const primaryDownloads = screen.getAllByRole('link', { name: new RegExp(`Скачать для ${label}`, 'i') });
    expect(primaryDownloads[0]).toHaveAttribute('href', href);
    expect(document.querySelector(`[data-detected-platform="${detectedPlatform}"]`)).toBeInTheDocument();
    expect(screen.getAllByText('Другие платформы').length).toBeGreaterThan(0);
  });

  it('does not treat mobile and unsupported systems as a desktop platform', () => {
    expect(detectDesktopPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32')).toBe('windows');
    expect(detectDesktopPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel')).toBe('macos');
    expect(detectDesktopPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'iPhone')).toBe('other');
    expect(detectDesktopPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5)).toBe('other');
    expect(detectDesktopPlatform('Mozilla/5.0 (X11; Linux x86_64)', 'Linux x86_64')).toBe('other');
  });

  it('opens and closes the secret video', () => {
    mockNavigator('Mozilla/5.0 (X11; Linux x86_64)', 'Linux x86_64');
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
  });
});
