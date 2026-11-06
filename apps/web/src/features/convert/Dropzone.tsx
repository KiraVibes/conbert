import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpenIcon, UploadIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { OpenFromStorageButton } from '@/features/storage/StorageButtons';
import { collectFiles } from '@/lib/collect-files';
import { cn } from '@/lib/utils';

interface DropzoneProps {
  onFiles: (files: File[]) => void;
  /** Smaller variant once files are present. */
  compact?: boolean;
}

/** Big drop area: drag & drop (also folders), click to choose, or Ctrl+V. */
export function Dropzone({ onFiles, compact = false }: DropzoneProps) {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const emit = useCallback(
    (files: File[]) => {
      if (files.length > 0) onFiles(files);
    },
    [onFiles],
  );

  // Paste files from anywhere on the page (Ctrl+V), unless typing in a field.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      if (!event.clipboardData) return;
      void collectFiles(event.clipboardData).then((files) => {
        if (files.length > 0) {
          event.preventDefault();
          emit(files);
        }
      });
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [emit]);

  const onInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    emit(Array.from(event.target.files ?? []));
    event.target.value = '';
  };

  return (
    <div
      data-tour="dropzone"
      role="button"
      tabIndex={0}
      aria-label={t('dropzone.label')}
      data-dragging={dragging || undefined}
      onClick={() => fileInput.current?.click()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          fileInput.current?.click();
        }
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        void collectFiles(event.dataTransfer).then(emit);
      }}
      className={cn(
        'group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed text-center transition-colors',
        'hover:border-primary/50 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        dragging && 'border-primary bg-primary/5',
        compact ? 'px-4 py-6' : 'px-6 py-16',
      )}
    >
      <UploadIcon
        aria-hidden="true"
        className={cn('text-muted-foreground', compact ? 'size-6' : 'size-10')}
      />
      <div className="space-y-1">
        <p className={cn('font-medium', !compact && 'text-lg')}>
          {dragging ? t('dropzone.release') : t('dropzone.title')}
        </p>
        {!compact && <p className="text-sm text-muted-foreground">{t('dropzone.hint')}</p>}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            fileInput.current?.click();
          }}
        >
          {t('dropzone.chooseFiles')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={(event) => {
            event.stopPropagation();
            folderInput.current?.click();
          }}
        >
          <FolderOpenIcon aria-hidden="true" />
          {t('dropzone.chooseFolder')}
        </Button>
        <OpenFromStorageButton onFiles={onFiles} />
      </div>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        data-testid="file-input"
        onChange={onInputChange}
        onClick={(event) => event.stopPropagation()}
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        hidden
        // Non-standard but supported by all current browsers.
        {...{ webkitdirectory: '' }}
        onChange={onInputChange}
        // The inputs sit inside the drop zone: without this, their click bubbles up
        // and the zone opens the plain file picker on top (Chrome then shows that one).
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}
