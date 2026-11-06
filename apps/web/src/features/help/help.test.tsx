import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { findMissingKeys } from '@conbert/i18n';
import { renderWithProviders } from '@/test/render';
import { useSettings } from '@/features/settings/settings-store';
import { useSettingsReady } from '@/features/settings/use-settings-sync';
import { HelpView } from './HelpView';
import { Tour } from './Tour';
import { TOUR_STEPS, tourI18nKeys, useTour } from './tour-store';

describe('tour texts', () => {
  it('every step has a title and a body in German and English', () => {
    expect(findMissingKeys(tourI18nKeys())).toEqual([]);
  });
});

describe('Tour', () => {
  beforeEach(() => {
    window.location.hash = '';
    useTour.setState({ active: false, step: 0 });
    useSettings.setState({ tourSeen: false });
    useSettingsReady.setState({ ready: false });
  });

  it('starts once the settings are known and remembers when it was skipped', async () => {
    renderWithProviders(<Tour />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() => useSettingsReady.setState({ ready: true }));
    const dialog = await screen.findByRole('dialog', { name: 'Willkommen bei Conbert!' });
    const [skip] = within(dialog).getAllByRole('button', { name: 'Rundgang beenden' });
    if (skip) await userEvent.click(skip);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(useSettings.getState().tourSeen).toBe(true);
  });

  it('does not start again for someone who has seen it', () => {
    useSettings.setState({ tourSeen: true });
    useSettingsReady.setState({ ready: true });
    renderWithProviders(<Tour />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('walks through all steps with the keyboard and closes on Escape', async () => {
    useSettings.setState({ tourSeen: true });
    renderWithProviders(<Tour />);
    act(() => useTour.getState().start());
    expect(await screen.findByText(`Schritt 1 von ${TOUR_STEPS.length}`)).toBeInTheDocument();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('dialog', { name: 'Dateien hier hineinziehen' })).toBeInTheDocument();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('dialog', { name: 'Willkommen bei Conbert!' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('HelpView', () => {
  it('filters the glossary', async () => {
    renderWithProviders(<HelpView />);
    expect(screen.getByText('Bitrate')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Begriff suchen' }), 'Codec');
    expect(screen.getByText('Codec')).toBeInTheDocument();
    expect(screen.queryByText('Polygon')).not.toBeInTheDocument();
    await userEvent.clear(screen.getByRole('searchbox'));
    await userEvent.type(screen.getByRole('searchbox'), 'xyzxyz');
    expect(screen.getByText(/Kein Begriff gefunden/)).toBeInTheDocument();
  });

  it('opens the article of the area the "?" link came from', () => {
    window.location.hash = '#/help/pdf';
    renderWithProviders(<HelpView />);
    const article = document.getElementById('help-area-pdf');
    expect(article).toHaveAttribute('open');
    expect(document.getElementById('help-area-convert')).not.toHaveAttribute('open');
  });

  it('links the setup guides', () => {
    renderWithProviders(<HelpView />);
    expect(screen.getByRole('link', { name: /Installation mit Docker/ })).toHaveAttribute(
      'href',
      '/docs/installation.md',
    );
  });
});
