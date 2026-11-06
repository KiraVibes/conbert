import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PDFDocument } from 'pdf-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { PdfView } from './PdfView';
import { usePdfTool } from './pdf-store';

// pdf.js can't draw in jsdom; the tiles show their spinner instead.
vi.mock('./page-thumbs', () => ({ usePageThumb: () => null }));

const ocr = vi.hoisted(() => ({
  available: false,
  convert: vi.fn(),
}));
vi.mock('./use-ocr-engine', () => ({
  useOcrEngine: () =>
    ocr.available
      ? {
          id: 'ocrmypdf',
          name: 'OCR',
          descriptionKey: 'engines.ocrmypdf.description',
          category: 'pdf',
          runtime: 'server',
          formats: [{ ext: 'pdf', canRead: true, canWrite: true }],
          options: [],
          supportsCompression: false,
          priority: 1,
          status: 'ready',
        }
      : null,
}));
vi.mock('@/engines/server-convert', () => ({ convertOnServer: ocr.convert }));

async function pdfFile(name: string, pages: number): Promise<File> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200 + i, 300]);
  return new File([(await doc.save()).slice()], name, { type: 'application/pdf' });
}

describe('PdfView', () => {
  beforeEach(() => {
    usePdfTool.getState().clear();
    URL.createObjectURL = vi.fn(() => 'blob:pdf');
    URL.revokeObjectURL = vi.fn();
  });

  it('adds pages, explains wrong files and splits into single pages', async () => {
    renderWithProviders(<PdfView />);
    await userEvent.upload(screen.getByTestId('file-input'), [
      await pdfFile('report.pdf', 3),
      new File(['hello'], 'notes.txt', { type: 'text/plain' }),
    ]);
    await waitFor(() => expect(screen.getAllByTestId('pdf-page')).toHaveLength(3));
    expect(screen.getByText('„notes.txt“ wurde nicht hinzugefügt:')).toBeInTheDocument();
    expect(screen.getByText('3 Seiten aus 1 Datei(en)')).toBeInTheDocument();

    // Remove page 2, move the last page to the front, turn it.
    await userEvent.click(
      screen.getByRole('button', { name: /Seite 2 \(„report.pdf“, Seite 2\) entfernen/ }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: /Seite 2 \(„report.pdf“, Seite 3\) eins nach vorn/ }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: /Seite 1 \(„report.pdf“, Seite 3\) nach rechts drehen/ }),
    );
    const { pages } = usePdfTool.getState();
    expect(pages.map((p) => [p.index, p.rotation])).toEqual([
      [2, 90],
      [0, 0],
    ]);

    await userEvent.click(screen.getByLabelText('Jede Seite als eigenes PDF'));
    await userEvent.click(screen.getByRole('button', { name: 'PDF erstellen' }));
    const result = await screen.findByTestId('pdf-result');
    expect(within(result).getByText(/Fertig: 2 PDFs/)).toBeInTheDocument();
    expect(within(result).getByRole('button', { name: /Alle als ZIP/ })).toBeInTheDocument();
  });

  it('checks the page ranges before splitting', async () => {
    renderWithProviders(<PdfView />);
    await userEvent.upload(screen.getByTestId('file-input'), [await pdfFile('a.pdf', 4)]);
    await waitFor(() => expect(screen.getAllByTestId('pdf-page')).toHaveLength(4));
    await userEvent.click(screen.getByLabelText('Nach Bereichen aufteilen'));
    await userEvent.type(screen.getByLabelText('Bereiche'), '1-9');
    expect(screen.getByText(/Seiten zwischen 1 und 4/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'PDF erstellen' })).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('Bereiche'));
    await userEvent.type(screen.getByLabelText('Bereiche'), '1-2, 3-');
    await userEvent.click(screen.getByRole('button', { name: 'PDF erstellen' }));
    expect(await screen.findByText(/Fertig: 2 PDFs/)).toBeInTheDocument();
  });

  it('sends the finished PDF to the server for text recognition', async () => {
    ocr.available = true;
    ocr.convert.mockResolvedValue(new Blob(['%PDF-searchable'], { type: 'application/pdf' }));
    renderWithProviders(<PdfView />);
    await userEvent.upload(screen.getByTestId('file-input'), [await pdfFile('scan.pdf', 2)]);
    await waitFor(() => expect(screen.getAllByTestId('pdf-page')).toHaveLength(2));
    await userEvent.click(screen.getByLabelText('Text erkennbar machen (OCR)'));
    await userEvent.click(screen.getByRole('button', { name: 'PDF erstellen' }));
    expect(await screen.findByText(/Fertig: „scan-bearbeitet.pdf“/)).toBeInTheDocument();
    expect(ocr.convert).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'ocr', outputExt: 'pdf', fileName: 'scan-bearbeitet.pdf' }),
    );
  });

  it('explains when text recognition is not available', async () => {
    ocr.available = false;
    renderWithProviders(<PdfView />);
    await userEvent.upload(screen.getByTestId('file-input'), [await pdfFile('a.pdf', 1)]);
    await waitFor(() => expect(screen.getAllByTestId('pdf-page')).toHaveLength(1));
    expect(screen.getByLabelText('Text erkennbar machen (OCR)')).toBeDisabled();
    expect(screen.getByText(/Nicht verfügbar/)).toBeInTheDocument();
  });
});
