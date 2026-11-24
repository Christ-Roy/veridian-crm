import { fireEvent, render, screen } from '@testing-library/react';

import { VeridianSuspendedGate } from '@/veridian-suspension/components/VeridianSuspendedGate';

const mockSignOut = jest.fn();
let mockSuspended = false;

jest.mock('@/auth/hooks/useAuth', () => ({
  useAuth: () => ({ signOut: mockSignOut }),
}));

jest.mock('@/workspace/hooks/useIsWorkspaceActivationStatusEqualsTo', () => ({
  useIsWorkspaceActivationStatusEqualsTo: () => mockSuspended,
}));

const renderGate = () =>
  render(
    <VeridianSuspendedGate>
      <div>Contenu du CRM</div>
      <div>Information banner</div>
    </VeridianSuspendedGate>,
  );

describe('VeridianSuspendedGate', () => {
  beforeEach(() => {
    mockSignOut.mockClear();
  });

  it('remplace le contenu par le message et un seul bouton quand l espace est suspendu', () => {
    mockSuspended = true;
    renderGate();

    expect(screen.getByText('Cet espace est suspendu.')).toBeTruthy();
    expect(
      screen.getByText('Vos données sont conservées. Contactez Veridian.'),
    ).toBeTruthy();
    expect(screen.queryByText('Contenu du CRM')).toBeNull();
    expect(screen.queryByText('Information banner')).toBeNull();
    expect(screen.queryByText(/billing|facturation|abonnement/i)).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);

    fireEvent.click(screen.getByText('Se déconnecter'));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('ne rend rien d autre que le contenu quand l espace est actif', () => {
    mockSuspended = false;
    renderGate();

    expect(screen.getByText('Contenu du CRM')).toBeTruthy();
    expect(screen.queryByText('Cet espace est suspendu.')).toBeNull();
    expect(screen.queryByText('Se déconnecter')).toBeNull();
  });
});
