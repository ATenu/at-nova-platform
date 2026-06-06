import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders, signInAs } from '@/test/renderWithProviders';
import { Sidebar } from './Sidebar';

function renderSidebar() {
  return renderWithProviders(<Sidebar open onNavigate={() => undefined} />);
}

describe('Sidebar role visibility', () => {
  it('shows all admin and domain screens for admin@test.com', async () => {
    signInAs('admin@test.com');
    renderSidebar();

    expect(await screen.findByRole('link', { name: /Users/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Roles & Permissions/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Agent Registry/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Customers/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Sales/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /SOPs/ })).toBeInTheDocument();
  });

  it('shows sales screens but hides admin for salesman@test.com', async () => {
    signInAs('salesman@test.com');
    renderSidebar();

    expect(await screen.findByRole('link', { name: /Sales/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Customers/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Products/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Users/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Roles & Permissions/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Agent Registry/ })).not.toBeInTheDocument();
  });

  it('shows only SOPs (plus Dashboard/Chat) for compliance@test.com', async () => {
    signInAs('compliance@test.com');
    renderSidebar();

    expect(await screen.findByRole('link', { name: /SOPs/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /Customers/ })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('link', { name: /Sales/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Users/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Dashboard/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Agent Chat/ })).toBeInTheDocument();
  });

  it('shows issues for crm@test.com but hides admin users', async () => {
    signInAs('crm@test.com');
    renderSidebar();

    expect(await screen.findByRole('link', { name: /Issues/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Customers/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Users/ })).not.toBeInTheDocument();
  });
});
