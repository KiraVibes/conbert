import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { Dropzone } from './Dropzone';

/** Which hidden inputs got "clicked" (= which pickers the browser was asked to open). */
function spyOnPickers() {
  const opened: string[] = [];
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
    this: HTMLInputElement,
  ) {
    opened.push(this.hasAttribute('webkitdirectory') ? 'folder' : 'files');
    // Like a real click: the event bubbles up through the drop zone.
    this.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  return opened;
}

describe('Dropzone', () => {
  afterEach(() => vi.restoreAllMocks());

  it('"Ordner auswählen" opens only the folder picker', () => {
    const opened = spyOnPickers();
    renderWithProviders(<Dropzone onFiles={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ordner auswählen' }));
    expect(opened).toEqual(['folder']);
  });

  it('"Dateien auswählen" and a click on the zone open only the file picker', () => {
    const opened = spyOnPickers();
    renderWithProviders(<Dropzone onFiles={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dateien auswählen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dateien hinzufügen' }));
    expect(opened).toEqual(['files', 'files']);
  });
});
