import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, signInAs } from '@/test/renderWithProviders';
import { setTokenProvider } from '@/auth/tokenBridge';
import { session } from '@/auth/session';
import { CapabilitiesPage } from './CapabilitiesPage';

describe('CapabilitiesPage', () => {
  beforeEach(() => {
    setTokenProvider({ getToken: () => session.getToken(), onUnauthorized: () => undefined });
  });

  it('lists capabilities with their required permissions and usable roles', async () => {
    signInAs('admin@test.com');
    renderWithProviders(<CapabilitiesPage />);

    expect(await screen.findByText('sales.report.customer', {}, { timeout: 5000 })).toBeInTheDocument();
    const row = screen.getByText('sales.report.customer').closest('tr') as HTMLElement;
    // Required permissions surface as badges…
    expect(within(row).getByText('Read sales')).toBeInTheDocument();
    expect(within(row).getByText('Read customers')).toBeInTheDocument();
    // …and the roles holding all of them are listed as "usable by".
    expect(within(row).getByText('Sales User')).toBeInTheDocument();
  });

  it('exposes write actions only with write-permissions', async () => {
    signInAs('admin@test.com');
    renderWithProviders(<CapabilitiesPage />);
    expect(await screen.findByRole('button', { name: /New capability/ })).toBeInTheDocument();
  });

  it('validates that at least one permission is selected before creating', async () => {
    const user = userEvent.setup();
    signInAs('admin@test.com');
    renderWithProviders(<CapabilitiesPage />);

    await user.click(await screen.findByRole('button', { name: /New capability/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Capability id'), 'reports.draft.read');
    await user.click(within(dialog).getByRole('button', { name: /Create capability/ }));
    expect(await within(dialog).findByText(/at least one permission/i)).toBeInTheDocument();
  });

  it('creates a capability and shows it in the catalog', async () => {
    const user = userEvent.setup();
    signInAs('admin@test.com');
    renderWithProviders(<CapabilitiesPage />);

    await user.click(await screen.findByRole('button', { name: /New capability/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Capability id'), 'reports.export.custom');
    await user.click(within(dialog).getByLabelText('Write actions'));
    await user.click(within(dialog).getByRole('button', { name: /Create capability/ }));

    expect(await screen.findByText('reports.export.custom', {}, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('locks identity fields when editing an existing capability', async () => {
    const user = userEvent.setup();
    signInAs('admin@test.com');
    renderWithProviders(<CapabilitiesPage />);

    await user.click(await screen.findByRole('button', { name: /Edit sales\.create/, }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Capability id')).toBeDisabled();
  });
});
