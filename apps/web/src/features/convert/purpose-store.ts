import { create } from 'zustand';
import type { PurposeId } from '@conbert/core';

/** The purpose picked on the convert page (null = set things up by hand). */
export const usePurpose = create<{ purpose: PurposeId | null }>()(() => ({ purpose: null }));
