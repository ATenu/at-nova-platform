import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, signInAs } from '@/test/renderWithProviders';
import { setTokenProvider } from '@/auth/tokenBridge';
import { session } from '@/auth/session';
import { AgentRegistryPage } from './AgentRegistryPage';

describe('AgentRegistryPage', () => {
  // The page is gated behind an authenticated router guard in production; when
  // rendered in isolation we wire the (lazy) mock token provider up front so the
  // initial list query carries auth regardless of effect ordering.
  beforeEach(() => {
    setTokenProvider({ getToken: () => session.getToken(), onUnauthorized: () => undefined });
  });
  it('lists registered agents with their source', async () => {
    signInAs('admin@test.com');
    renderWithProviders(<AgentRegistryPage />);

    expect(await screen.findByText('SQL Analyst', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('at-sql-analyser')).toBeInTheDocument();
    // Self-registered agents are read-only here (no manage actions).
    expect(screen.queryByRole('button', { name: /Disable/ })).not.toBeInTheDocument();
  });

  it('exposes the onboard action only with write-agents', async () => {
    signInAs('admin@test.com');
    renderWithProviders(<AgentRegistryPage />);
    expect(await screen.findByRole('button', { name: /Onboard agent/ })).toBeInTheDocument();
  });

  it('validates the onboard form before calling the API', async () => {
    const user = userEvent.setup();
    signInAs('admin@test.com');
    renderWithProviders(<AgentRegistryPage />);

    await user.click(await screen.findByRole('button', { name: /Onboard agent/ }));
    const dialog = await screen.findByRole('dialog');
    // Submit empty: client-side validation blocks the request.
    await user.click(within(dialog).getByRole('button', { name: /Onboard agent/ }));
    expect(await within(dialog).findByText(/valid URL/i)).toBeInTheDocument();
  });

  it('onboards a new agent by host URL and shows it in the table', async () => {
    const user = userEvent.setup();
    signInAs('admin@test.com');
    renderWithProviders(<AgentRegistryPage />);

    await user.click(await screen.findByRole('button', { name: /Onboard agent/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Host URL'), 'https://new-agent.internal:8443');
    await user.type(within(dialog).getByLabelText('Token audience'), 'nova-agent-new');
    await user.type(within(dialog).getByLabelText(/^Name/), 'at-new-agent');
    await user.type(within(dialog).getByLabelText(/Display name/), 'Brand New Agent');
    await user.click(within(dialog).getByRole('button', { name: /Onboard agent/ }));

    // New admin agent appears in the table (with manage actions enabled).
    expect(await screen.findByText('Brand New Agent', {}, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('surfaces a friendly error when the host is unreachable', async () => {
    const user = userEvent.setup();
    signInAs('admin@test.com');
    renderWithProviders(<AgentRegistryPage />);

    await user.click(await screen.findByRole('button', { name: /Onboard agent/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Host URL'), 'https://unreachable.internal:8443');
    await user.type(within(dialog).getByLabelText('Token audience'), 'nova-agent-x');
    await user.click(within(dialog).getByRole('button', { name: /Onboard agent/ }));

    expect(await screen.findByText(/could not be retrieved/i)).toBeInTheDocument();
  });
});
