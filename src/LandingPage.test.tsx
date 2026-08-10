import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LandingPage } from './LandingPage';

describe('Mova landing page', () => {
  it('offers desktop downloads and access to the web app', () => {
    render(<LandingPage />);

    expect(screen.getByRole('heading', { name: /Общайтесь.*Созванивайтесь.*Оставайтесь рядом/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /Скачать для Windows/i })).toHaveAttribute(
      'href',
      'https://github.com/yuuta4ka/mova/releases/latest/download/Mova-Setup-0.1.0.exe',
    );
    expect(screen.getAllByRole('link', { name: /Открыть.*Mova|Открыть веб-версию/i })[0]).toHaveAttribute('href', '/app');
    expect(screen.getByRole('link', { name: /macOS/i })).toHaveAttribute(
      'href',
      'https://github.com/yuuta4ka/mova/releases/latest/download/Mova-0.1.0-arm64.dmg',
    );
  });
});
