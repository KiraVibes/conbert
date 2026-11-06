import { useTranslation } from 'react-i18next';
import { hasMetadataEdits } from '@conbert/core';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { FileItem } from '@/features/convert/files-store';
import { useSettings } from '@/features/settings/settings-store';
import { MetadataPanel } from './MetadataPanel';

/**
 * The settings of a file card. In expert mode there is a second tab with the
 * file's metadata; in simple mode only the settings show.
 */
export function CardTabs({
  item,
  targetExt,
  disabled,
  children,
}: {
  item: FileItem;
  targetExt: string;
  disabled?: boolean | undefined;
  /** The settings (quality etc.). */
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const expertMode = useSettings((s) => s.expertMode);
  if (!expertMode) return <>{children}</>;
  return (
    <Tabs defaultValue="settings" className="gap-3">
      <TabsList>
        <TabsTrigger value="settings">{t('metadata.tabs.settings')}</TabsTrigger>
        <TabsTrigger value="metadata">
          {t('metadata.tabs.metadata')}
          {hasMetadataEdits(item.metadata) && (
            <span className="size-1.5 rounded-full bg-primary" aria-label={t('metadata.changed')} />
          )}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="settings">{children ?? null}</TabsContent>
      <TabsContent value="metadata">
        <MetadataPanel item={item} targetExt={targetExt} disabled={disabled} />
      </TabsContent>
    </Tabs>
  );
}
