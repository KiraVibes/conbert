import { useState } from 'react';
import { Loader2Icon, Trash2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

/** "Liste leeren": removes every finished entry of a list at once, after asking. */
export function ClearListButton({
  count,
  textKey,
  onConfirm,
}: {
  /** Finished entries that would go; without any, there is no button. */
  count: number;
  /** What happens to the files (i18n, with {{count}}). */
  textKey: string;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  if (count === 0) return null;
  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={busy}>
          {busy ? (
            <Loader2Icon className="animate-spin" aria-hidden="true" />
          ) : (
            <Trash2Icon aria-hidden="true" />
          )}
          {t('clearList.button')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('clearList.title', { count })}</AlertDialogTitle>
          <AlertDialogDescription>{t(textKey, { count })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('clearList.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={() => void run()}>{t('clearList.confirm')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
