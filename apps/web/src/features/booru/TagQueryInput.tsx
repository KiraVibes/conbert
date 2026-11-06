import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TagCategory } from '@conbert/core';
import type { TagSuggestion } from '@conbert/schemas';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { autocomplete } from './booru-api';

const CATEGORY_COLORS: Record<TagCategory, string> = {
  general: 'text-sky-700 dark:text-sky-300',
  artist: 'text-rose-700 dark:text-rose-300',
  copyright: 'text-violet-700 dark:text-violet-300',
  character: 'text-emerald-700 dark:text-emerald-300',
  species: 'text-amber-700 dark:text-amber-300',
  meta: 'text-orange-700 dark:text-orange-300',
};

/** The word the cursor is in: start, end and text (without a leading "-"). */
function currentToken(text: string, cursor: number) {
  const start = text.lastIndexOf(' ', cursor - 1) + 1;
  const endSpace = text.indexOf(' ', cursor);
  const end = endSpace === -1 ? text.length : endSpace;
  const raw = text.slice(start, end);
  const negate = raw.startsWith('-');
  return { start, end, negate, word: negate ? raw.slice(1) : raw };
}

interface TagQueryInputProps {
  id: string;
  siteId: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
}

/** Text field for the search syntax with tag suggestions from the site (counts, categories). */
export function TagQueryInput({
  id,
  siteId,
  value,
  onChange,
  onSubmit,
  placeholder,
}: TagQueryInputProps) {
  const { t, i18n } = useTranslation();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  /** Suggestions belong to the word they were asked for (stale ones are never shown). */
  const [found, setFound] = useState<{ word: string; tags: TagSuggestion[] }>({
    word: '',
    tags: [],
  });
  const [active, setActive] = useState(-1);
  const [cursor, setCursor] = useState(0);
  const token = currentToken(value, cursor);
  const word = token.word.includes(':') || token.word.includes('*') ? '' : token.word;

  useEffect(() => {
    if (word.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      autocomplete(siteId, word, controller.signal)
        .then((tags) => {
          setFound({ word, tags });
          setActive(-1);
        })
        .catch(() => setFound({ word, tags: [] }));
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [siteId, word]);
  /** Closed (Escape, search, leaving the field) for this word – a late answer doesn't reopen it. */
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const suggestions =
    found.word === word && word.length >= 2 && closedFor !== word ? found.tags : [];
  const setSuggestions = (tags: TagSuggestion[]) => {
    if (tags.length === 0) setClosedFor(word);
    else setFound({ word, tags });
  };

  const choose = (tag: TagSuggestion) => {
    const insert = `${token.negate ? '-' : ''}${tag.name} `;
    const next = value.slice(0, token.start) + insert + value.slice(token.end).replace(/^\s+/, '');
    onChange(next);
    setSuggestions([]);
    const position = token.start + insert.length;
    requestAnimationFrame(() => {
      inputRef.current?.setSelectionRange(position, position);
      setCursor(position);
    });
  };

  const open = suggestions.length > 0;
  const number = new Intl.NumberFormat(i18n.language);
  return (
    <div className="relative min-w-0 flex-1">
      <Input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setCursor(e.target.selectionStart ?? e.target.value.length);
        }}
        onSelect={(e) => setCursor(e.currentTarget.selectionStart ?? value.length)}
        onBlur={() => setTimeout(() => setSuggestions([]), 150)}
        onKeyDown={(e) => {
          if (open && e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => (a + 1) % suggestions.length);
          } else if (open && e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => (a <= 0 ? suggestions.length - 1 : a - 1));
          } else if (open && (e.key === 'Enter' || e.key === 'Tab') && active >= 0) {
            e.preventDefault();
            const tag = suggestions[active];
            if (tag) choose(tag);
          } else if (e.key === 'Escape') {
            setSuggestions([]);
          } else if (e.key === 'Enter' && onSubmit) {
            e.preventDefault();
            setSuggestions([]);
            onSubmit();
          }
        }}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('booru.search.suggestions')}
          className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {suggestions.map((tag, index) => (
            <li
              key={tag.name}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1 text-sm',
                index === active && 'bg-accent',
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(tag);
              }}
            >
              <span className={cn('truncate font-medium', CATEGORY_COLORS[tag.category])}>
                {tag.name}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {t(`booru.categories.${tag.category}`)} · {number.format(tag.count)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
