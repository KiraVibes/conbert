import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { usageSchema } from '@conbert/schemas';
import { HelpTip } from '@/components/HelpTip';
import { Progress } from '@/components/ui/progress';
import { apiGet } from '@/lib/api';
import { formatBytes } from '@/lib/format-bytes';

/** "On the server: 1.2 GB of 5 GB" – what the user keeps there right now. */
export function StorageUsage() {
  const { t, i18n } = useTranslation();
  const usage = useQuery({
    queryKey: ['my-usage'],
    queryFn: () => apiGet('/api/me/usage', usageSchema),
  });
  if (!usage.data) return null;
  const { usedBytes, quotaBytes } = usage.data;
  const used = formatBytes(usedBytes, i18n.language);
  return (
    <div className="mb-4 max-w-sm space-y-1" data-testid="storage-usage">
      <p className="flex items-center gap-1.5 text-sm">
        {quotaBytes === null
          ? t('quota.usedNoLimit', { used })
          : t('quota.used', { used, quota: formatBytes(quotaBytes, i18n.language) })}
        <HelpTip helpKey="quota.help" labelKey="quota.title" />
      </p>
      {quotaBytes !== null && (
        <Progress
          value={Math.min(100, (usedBytes / quotaBytes) * 100)}
          className="h-2"
          aria-label={t('quota.title')}
        />
      )}
    </div>
  );
}
