import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MaintenanceBanner } from './MaintenanceBanner';
import { api } from './lib/api';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('deployment maintenance banner', () => {
  it('shows while server maintenance is active', async () => {
    vi.spyOn(api, 'maintenance').mockResolvedValue({ active: true, deploymentId: 'deploy-1' });
    render(<MaintenanceBanner />);

    expect(await screen.findByRole('status')).toHaveTextContent('Идёт обновление Mova');
  });

  it('remains visible after a reload because state is fetched from the server again', async () => {
    const maintenance = vi.spyOn(api, 'maintenance').mockResolvedValue({ active: true, deploymentId: 'deploy-1' });
    const firstPage = render(<MaintenanceBanner />);
    expect(await screen.findByRole('status')).toBeInTheDocument();

    firstPage.unmount();
    render(<MaintenanceBanner />);

    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(maintenance).toHaveBeenCalledTimes(2);
  });

  it('hides after the deployment hook confirms readiness and turns maintenance off', async () => {
    vi.spyOn(api, 'maintenance').mockResolvedValueOnce({ active: true, deploymentId: 'deploy-1' }).mockResolvedValue({ active: false });
    render(<MaintenanceBanner />);
    expect(await screen.findByRole('status')).toBeInTheDocument();

    act(() => window.dispatchEvent(new Event('focus')));

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('stays visible when readiness polling fails during deployment', async () => {
    vi.spyOn(api, 'maintenance').mockResolvedValueOnce({ active: true, deploymentId: 'deploy-1' }).mockRejectedValue(new Error('backend unavailable'));
    render(<MaintenanceBanner />);
    expect(await screen.findByRole('status')).toBeInTheDocument();

    act(() => window.dispatchEvent(new Event('focus')));

    await waitFor(() => expect(api.maintenance).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
