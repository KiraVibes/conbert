import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { lazy } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { ModeSelector } from '@/features/convert/ModeSelector';
import { ErrorMessage } from './ErrorMessage';
import { HelpTip } from './HelpTip';
import { LazyView } from './LazyView';

describe('HelpTip', () => {
  it('opens the help and effect text on click', async () => {
    renderWithProviders(
      <HelpTip
        helpKey="settings.expertMode.help"
        effectKey="settings.expertMode.effect"
        labelKey="settings.expertMode.label"
      />,
    );
    const button = screen.getByRole('button', { name: 'Erklärung zu „Expertenmodus“ anzeigen' });
    await userEvent.click(button);
    expect(await screen.findByText(/Zeigt alle Einstellmöglichkeiten/)).toBeInTheDocument();
    expect(screen.getByText(/An: mehr Optionen/)).toBeInTheDocument();
  });
});

describe('ErrorMessage', () => {
  it('shows what happened, the cause and what to do', () => {
    renderWithProviders(<ErrorMessage messageKey="errors.network" details="ECONNREFUSED" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Der Server ist nicht erreichbar.');
    expect(alert).toHaveTextContent('Mögliche Ursache');
    expect(alert).toHaveTextContent('Was du tun kannst');
  });

  it('hides technical details until asked', async () => {
    renderWithProviders(<ErrorMessage messageKey="errors.network" details="ECONNREFUSED" />);
    const details = screen.getByText('ECONNREFUSED');
    expect(details).not.toBeVisible();
    await userEvent.click(screen.getByText('Technische Details anzeigen'));
    expect(details).toBeVisible();
  });

  it('renders action buttons', () => {
    renderWithProviders(
      <ErrorMessage messageKey="errors.internal" actions={<button>Nochmal</button>} />,
    );
    expect(screen.getByRole('button', { name: 'Nochmal' })).toBeInTheDocument();
  });
});

describe('ModeSelector', () => {
  it('explains the selected mode and reports changes', async () => {
    const onChange = vi.fn();
    renderWithProviders(<ModeSelector value="auto" onChange={onChange} />);
    expect(screen.getByText(/Conbert entscheidet für dich/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /Auf diesem Gerät/ }));
    expect(onChange).toHaveBeenCalledWith('local');
  });

  it('can hide the explanation', () => {
    renderWithProviders(<ModeSelector value="auto" onChange={() => {}} compact />);
    expect(screen.queryByText(/Conbert entscheidet für dich/)).not.toBeInTheDocument();
  });
});

describe('LazyView', () => {
  it('shows the view once its code has arrived', async () => {
    const View = lazy(() => Promise.resolve({ default: () => <p>Fertig geladen</p> }));
    renderWithProviders(
      <LazyView>
        <View />
      </LazyView>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Ansicht wird geladen');
    expect(await screen.findByText('Fertig geladen')).toBeInTheDocument();
  });

  it('explains a view that could not be loaded and offers a reload', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Broken = lazy(() =>
      Promise.reject(new Error('Failed to fetch dynamically imported module')),
    );
    renderWithProviders(
      <LazyView>
        <Broken />
      </LazyView>,
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Diese Ansicht konnte nicht geladen werden.');
    expect(screen.getByRole('button', { name: 'Seite neu laden' })).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
