import {
  CloudIcon,
  DatabaseIcon,
  HardDriveIcon,
  NetworkIcon,
  ServerIcon,
  TerminalSquareIcon,
  type LucideIcon,
} from 'lucide-react';
import type { StorageType } from '@conbert/core';

export const STORAGE_ICONS: Record<StorageType, LucideIcon> = {
  smb: NetworkIcon,
  sftp: TerminalSquareIcon,
  ftp: ServerIcon,
  webdav: CloudIcon,
  s3: DatabaseIcon,
  local: HardDriveIcon,
  gdrive: CloudIcon,
  onedrive: CloudIcon,
  dropbox: CloudIcon,
};

/** Remembers that the "goes through your server" hint was shown (see docs/spec/speicherorte.md). */
const PRIVACY_HINT_KEY = 'conbert-storage-privacy-hint';

export function privacyHintSeen(): boolean {
  try {
    return localStorage.getItem(PRIVACY_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function markPrivacyHintSeen(): void {
  try {
    localStorage.setItem(PRIVACY_HINT_KEY, '1');
  } catch {
    // Without storage the hint simply shows again next time.
  }
}
