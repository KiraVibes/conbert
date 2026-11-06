import { create } from 'zustand';
import { ConversionError } from '@conbert/core';
import { detectFileType } from '@/lib/detect-type';
import { createId } from '@/lib/id';
import { countPages, turn, type PageRef, type PdfSource } from './pdf-ops';

/** A file that couldn't be added, with the reason (three-part error key). */
export interface RejectedFile {
  name: string;
  messageKey: string;
  details?: string;
}

interface PdfState {
  sources: PdfSource[];
  pages: PageRef[];
  selected: Set<string>;
  rejected: RejectedFile[];
  loading: number;
  addFiles: (files: File[]) => Promise<void>;
  move: (id: string, to: number) => void;
  rotate: (ids: readonly string[], by: 90 | -90) => void;
  remove: (ids: readonly string[]) => void;
  toggle: (id: string) => void;
  selectAll: (on: boolean) => void;
  dismissRejected: () => void;
  clear: () => void;
}

const KINDS: Record<string, PdfSource['kind']> = { pdf: 'pdf', jpg: 'jpg', png: 'png' };

export const usePdfTool = create<PdfState>()((set, get) => ({
  sources: [],
  pages: [],
  selected: new Set(),
  rejected: [],
  loading: 0,

  async addFiles(files) {
    set((s) => ({ loading: s.loading + files.length }));
    // One after another, so pages keep the order the files were given in.
    for (const file of files) {
      try {
        const type = await detectFileType(file);
        const kind = KINDS[type.ext];
        if (!kind) {
          set((s) => ({
            rejected: [...s.rejected, { name: file.name, messageKey: 'errors.pdfWrongType' }],
          }));
          continue;
        }
        const source: PdfSource = {
          id: createId(),
          name: file.name,
          kind,
          bytes: new Uint8Array(await file.arrayBuffer()),
        };
        const count = await countPages(source);
        const pages = Array.from({ length: count }, (_, index) => ({
          id: createId(),
          sourceId: source.id,
          index,
          rotation: 0 as const,
        }));
        set((s) => ({ sources: [...s.sources, source], pages: [...s.pages, ...pages] }));
      } catch (error) {
        const rejected: RejectedFile =
          error instanceof ConversionError
            ? {
                name: file.name,
                messageKey: error.messageKey,
                ...(error.details && { details: error.details }),
              }
            : { name: file.name, messageKey: 'errors.pdfBroken', details: String(error) };
        set((s) => ({ rejected: [...s.rejected, rejected] }));
      } finally {
        set((s) => ({ loading: s.loading - 1 }));
      }
    }
  },

  move(id, to) {
    set((s) => {
      const from = s.pages.findIndex((p) => p.id === id);
      const page = s.pages[from];
      if (from < 0 || !page) return s;
      const target = Math.max(0, Math.min(s.pages.length - 1, to));
      const pages = s.pages.filter((p) => p.id !== id);
      pages.splice(target, 0, page);
      return { pages };
    });
  },

  rotate(ids, by) {
    const set_ = new Set(ids);
    set((s) => ({
      pages: s.pages.map((p) => (set_.has(p.id) ? { ...p, rotation: turn(p.rotation, by) } : p)),
    }));
  },

  remove(ids) {
    const gone = new Set(ids);
    set((s) => {
      const pages = s.pages.filter((p) => !gone.has(p.id));
      // Files without pages left are forgotten (frees their memory).
      const used = new Set(pages.map((p) => p.sourceId));
      return {
        pages,
        sources: s.sources.filter((src) => used.has(src.id)),
        selected: new Set([...s.selected].filter((id) => !gone.has(id))),
      };
    });
  },

  toggle(id) {
    const selected = new Set(get().selected);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    set({ selected });
  },

  selectAll(on) {
    set((s) => ({ selected: on ? new Set(s.pages.map((p) => p.id)) : new Set() }));
  },

  dismissRejected() {
    set({ rejected: [] });
  },

  clear() {
    set({ sources: [], pages: [], selected: new Set(), rejected: [] });
  },
}));
