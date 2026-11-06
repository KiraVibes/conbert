import { WORKFLOW_TRICKS } from '@conbert/core';
import type { WorkflowStepInput } from '@conbert/schemas';

/** Translation function as react-i18next hands it out. */
type T = (key: string, values?: Record<string, unknown>) => string;

/** One sentence in plain language per step ("Wandle alle Bilder in WebP um"). */
export function describeStep(
  step: WorkflowStepInput,
  t: T,
  targetName: (id: string) => string,
  channelName: (id: string) => string,
): string {
  switch (step.kind) {
    case 'filter': {
      const parts: string[] = [];
      if (step.rule.category?.length) {
        parts.push(step.rule.category.map((c) => t(`workflows.categories.${c}`)).join(', '));
      }
      if (step.rule.ext?.length) parts.push(step.rule.ext.map((e) => e.toUpperCase()).join(', '));
      if (step.rule.minWidth)
        parts.push(t('workflows.describe.minWidth', { width: step.rule.minWidth }));
      if (step.rule.maxSizeMb)
        parts.push(t('workflows.describe.maxSize', { size: step.rule.maxSizeMb }));
      return parts.length > 0
        ? t('workflows.describe.filter', { what: parts.join(' · ') })
        : t('workflows.describe.filterAll');
    }
    case 'convert':
      return t('workflows.describe.convert', { format: step.outputExt.toUpperCase() });
    case 'compress':
      return t('workflows.describe.compress', { level: t(`workflows.compress.${step.preset}`) });
    case 'edit':
      if (step.action === 'resize') {
        return t('workflows.describe.resize', {
          width: (step.params?.['maxWidth'] as number | undefined) ?? '–',
          height: (step.params?.['maxHeight'] as number | undefined) ?? '–',
        });
      }
      if (step.action === 'crop') {
        const ratio = String(step.params?.['ratio'] ?? '1:1');
        return t(
          step.params?.['focus'] === 'attention'
            ? 'workflows.describe.cropAttention'
            : 'workflows.describe.crop',
          { ratio },
        );
      }
      if (step.action === 'rotate') {
        return t('workflows.describe.rotate', {
          degrees: (step.params?.['degrees'] as number | undefined) ?? 90,
        });
      }
      if (step.action === 'rename') {
        return t('workflows.describe.rename', {
          pattern: (step.params?.['pattern'] as string | undefined) ?? '{name}',
        });
      }
      return t('workflows.describe.stripMetadata');
    case 'ocr':
      return t('workflows.describe.ocr');
    case 'save':
      return step.targetIds.length > 0
        ? t('workflows.describe.save', { names: step.targetIds.map(targetName).join(', ') })
        : t('workflows.describe.saveNone');
    case 'notify':
      return step.channelIds.length > 0
        ? t('workflows.describe.notify', { names: step.channelIds.map(channelName).join(', ') })
        : t('workflows.describe.notifyNone');
    case 'workshop':
      return (WORKFLOW_TRICKS as readonly string[]).includes(step.trick)
        ? t(`workflows.describe.tricks.${step.trick}`)
        : t('workflows.describe.workshop');
  }
}
