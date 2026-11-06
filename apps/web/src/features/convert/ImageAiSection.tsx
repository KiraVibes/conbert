import { useState } from 'react';
import { ChevronDownIcon, WandSparklesIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getFormat, normalizeExt, readImageAi } from '@conbert/core';
import { HelpTip } from '@/components/HelpTip';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useFiles, type FileItem } from './files-store';

/**
 * "Verbessern": remove the background, upscale – on the server (AI). The
 * choices are stored as options, so they reach the server, the history and
 * survive a new target format.
 */
export function ImageAiSection({
  item: given,
  disabled,
}: {
  item: FileItem;
  disabled?: boolean | undefined;
}) {
  const { t } = useTranslation();
  const item = useFiles((s) => s.files.find((f) => f.id === given.id)) ?? given;
  const setImageAi = useFiles((s) => s.setImageAi);
  const setTarget = useFiles((s) => s.setTarget);
  const ai = readImageAi(item.options);
  const [open, setOpen] = useState(ai !== null);
  const id = `ai-${item.id}`;
  const target = item.targetExt ? getFormat(normalizeExt(item.targetExt)) : undefined;
  // A cut-out needs a format with transparency, or the background turns white.
  const noTransparency =
    ai?.removeBackground === true && target !== undefined && target.supportsTransparency !== true;

  const summary = ai
    ? [
        ai.removeBackground ? t('imageAi.summaryBackground') : null,
        ai.upscale > 1 ? t('imageAi.summaryUpscale', { factor: ai.upscale }) : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <div className="rounded-lg border" data-testid="image-ai-section">
      <div className="flex flex-wrap items-center gap-2 p-2">
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          onClick={() => setOpen((o) => !o)}
        >
          <WandSparklesIcon aria-hidden="true" />
          {t('imageAi.title')}
          <ChevronDownIcon
            aria-hidden="true"
            className={open ? 'rotate-180 transition-transform' : 'transition-transform'}
          />
        </Button>
        <span className={`text-sm ${summary ? '' : 'text-muted-foreground'}`}>
          {summary ?? t('imageAi.teaser')}
        </span>
      </div>
      {open && (
        <div id={`${id}-panel`} className="space-y-4 border-t p-3">
          <p className="text-sm text-muted-foreground">{t('imageAi.intro')}</p>

          <div className="flex items-center gap-2">
            <Switch
              id={`${id}-bg`}
              checked={ai?.removeBackground === true}
              disabled={disabled}
              onCheckedChange={(removeBackground) => {
                setImageAi(item.id, { removeBackground });
                // Without a target yet: PNG keeps the transparency.
                if (removeBackground && !item.targetExt) setTarget(item.id, 'png');
              }}
            />
            <Label htmlFor={`${id}-bg`}>{t('imageAi.background.label')}</Label>
            <HelpTip
              helpKey="imageAi.background.help"
              effectKey="imageAi.background.effect"
              labelKey="imageAi.background.label"
            />
          </div>
          {noTransparency && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-sm">
              <span>
                {t('imageAi.background.noTransparency', {
                  format: target ? t(target.nameKey) : '',
                })}
              </span>
              <Button size="sm" variant="outline" onClick={() => setTarget(item.id, 'png')}>
                {t('imageAi.background.usePng')}
              </Button>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Label id={`${id}-up`}>{t('imageAi.upscale.label')}</Label>
              <HelpTip
                helpKey="imageAi.upscale.help"
                effectKey="imageAi.upscale.effect"
                labelKey="imageAi.upscale.label"
              />
            </div>
            <ToggleGroup
              type="single"
              variant="outline"
              value={String(ai?.upscale ?? 1)}
              disabled={disabled}
              onValueChange={(v) => v && setImageAi(item.id, { upscale: Number(v) as 1 | 2 | 4 })}
              aria-labelledby={`${id}-up`}
            >
              <ToggleGroupItem value="1">{t('imageAi.upscale.off')}</ToggleGroupItem>
              <ToggleGroupItem value="2">2×</ToggleGroupItem>
              <ToggleGroupItem value="4">4×</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <p className="text-xs text-muted-foreground">{t('imageAi.serverNote')}</p>
        </div>
      )}
    </div>
  );
}
