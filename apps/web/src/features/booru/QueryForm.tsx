import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { XIcon } from 'lucide-react';
import {
  SEARCH_MEDIA,
  SEARCH_ORDERS,
  buildQuery,
  normalizeTag,
  parseQuery,
  type SearchForm,
  type SearchMedia,
  type SearchOrder,
} from '@conbert/core';
import { HelpTip } from '@/components/HelpTip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TagQueryInput } from './TagQueryInput';

interface QueryFormProps {
  siteId: string;
  query: string;
  onChange: (query: string) => void;
}

const numberOrNull = (text: string) => {
  const n = Math.round(Number(text));
  return text.trim() === '' || !Number.isFinite(n) ? null : n;
};

/** The beginner view of the search: the syntax is written for you. */
export function QueryForm({ siteId, query, onChange }: QueryFormProps) {
  const { t } = useTranslation();
  const form = parseQuery(query);
  const set = (patch: Partial<SearchForm>) => onChange(buildQuery({ ...form, ...patch }));

  return (
    <div className="grid gap-4 rounded-lg border p-3 sm:grid-cols-2">
      <TagList
        id="booru-include"
        siteId={siteId}
        labelKey="booru.form.include"
        helpKey="booru.form.includeHelp"
        tags={form.include}
        onChange={(include) => set({ include })}
      />
      <TagList
        id="booru-exclude"
        siteId={siteId}
        labelKey="booru.form.exclude"
        helpKey="booru.form.excludeHelp"
        tags={form.exclude}
        onChange={(exclude) => set({ exclude })}
      />
      <NumberField
        id="booru-score"
        labelKey="booru.form.minScore"
        helpKey="booru.form.minScoreHelp"
        value={form.minScore}
        onChange={(minScore) => set({ minScore })}
      />
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          id="booru-width"
          labelKey="booru.form.minWidth"
          helpKey="booru.form.minSizeHelp"
          value={form.minWidth}
          onChange={(minWidth) => set({ minWidth })}
        />
        <NumberField
          id="booru-height"
          labelKey="booru.form.minHeight"
          helpKey="booru.form.minSizeHelp"
          value={form.minHeight}
          onChange={(minHeight) => set({ minHeight })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="booru-from">{t('booru.form.dateFrom')}</Label>
          <Input
            id="booru-from"
            type="date"
            value={form.dateFrom ?? ''}
            onChange={(e) => set({ dateFrom: e.target.value || null })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="booru-to">{t('booru.form.dateTo')}</Label>
          <Input
            id="booru-to"
            type="date"
            value={form.dateTo ?? ''}
            onChange={(e) => set({ dateTo: e.target.value || null })}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="booru-order" className="flex items-center gap-1.5">
            {t('booru.form.order')}
            <HelpTip helpKey="booru.form.orderHelp" labelKey="booru.form.order" />
          </Label>
          <Select value={form.order} onValueChange={(v) => set({ order: v as SearchOrder })}>
            <SelectTrigger id="booru-order" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEARCH_ORDERS.map((o) => (
                <SelectItem key={o} value={o}>
                  {t(`booru.order.${o}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="booru-media">{t('booru.form.media')}</Label>
          <Select value={form.media} onValueChange={(v) => set({ media: v as SearchMedia })}>
            <SelectTrigger id="booru-media" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEARCH_MEDIA.map((m) => (
                <SelectItem key={m} value={m}>
                  {t(`booru.media.${m}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {form.extra.length > 0 && (
        <p className="text-xs text-muted-foreground sm:col-span-2">
          {t('booru.form.extra', { syntax: form.extra.join(' ') })}
        </p>
      )}
    </div>
  );
}

function NumberField({
  id,
  labelKey,
  helpKey,
  value,
  onChange,
}: {
  id: string;
  labelKey: string;
  helpKey: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="flex items-center gap-1.5">
        {t(labelKey)}
        <HelpTip helpKey={helpKey} labelKey={labelKey} />
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        value={value ?? ''}
        onChange={(e) => onChange(numberOrNull(e.target.value))}
      />
    </div>
  );
}

/** Tags as removable chips plus a field with suggestions. */
function TagList({
  id,
  siteId,
  labelKey,
  helpKey,
  tags,
  onChange,
}: {
  id: string;
  siteId: string;
  labelKey: string;
  helpKey: string;
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const commit = (text: string) => {
    const added = text
      .split(/\s+/)
      .map((w) => normalizeTag(w.replace(/^-/, '')))
      .filter((w) => w !== '' && !w.includes(':'));
    if (added.length > 0) onChange([...new Set([...tags, ...added])]);
    setDraft('');
  };
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="flex items-center gap-1.5">
        {t(labelKey)}
        <HelpTip helpKey={helpKey} labelKey={labelKey} />
      </Label>
      <div className="flex gap-2">
        <TagQueryInput
          id={id}
          siteId={siteId}
          value={draft}
          onChange={(v) => (v.endsWith(' ') ? commit(v) : setDraft(v))}
          onSubmit={() => commit(draft)}
          placeholder={t('booru.form.tagPlaceholder')}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => commit(draft)}
          disabled={!draft.trim()}
        >
          {t('booru.form.add')}
        </Button>
      </div>
      {tags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li
              key={tag}
              className="flex items-center gap-1 rounded-full bg-muted py-0.5 pr-1 pl-2 text-xs"
            >
              {tag}
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-background"
                aria-label={t('booru.form.removeTag', { tag })}
                onClick={() => onChange(tags.filter((x) => x !== tag))}
              >
                <XIcon className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
