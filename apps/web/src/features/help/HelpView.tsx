import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDownIcon, ExternalLinkIcon, SearchIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FAQ_ITEMS, GLOSSARY_TERMS, HELP_AREAS, HELP_GUIDES, guideHref } from '@conbert/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ViewIntro } from '@/components/ViewIntro';
import { useHelpArea, useView } from '@/lib/use-view';
import { useSettings } from '@/features/settings/settings-store';
import { useTour } from './tour-store';

const SECTIONS = ['start', 'areas', 'faq', 'glossary', 'engines', 'guides'] as const;
type Section = (typeof SECTIONS)[number];

/** A question or article that opens on click – native <details>, keyboard friendly. */
function Expandable({
  id,
  title,
  open,
  children,
}: {
  id?: string;
  title: string;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details id={id} open={open} className="group scroll-mt-20 rounded-md border bg-card px-4 py-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <ChevronDownIcon
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </summary>
      <div className="mt-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </details>
  );
}

/** The help page: areas, FAQ, glossary, tools and setup guides. */
export function HelpView() {
  const { t, i18n } = useTranslation();
  const [, navigate] = useView();
  const area = useHelpArea();
  const startTour = useTour((s) => s.start);
  const booruEnabled = useSettings((s) => s.booruEnabled);
  const [query, setQuery] = useState('');
  const sectionRefs = useRef<Partial<Record<Section, HTMLElement | null>>>({});

  // "?" links land on #/help/<area>: open that article and scroll to it.
  useEffect(() => {
    if (!area) return;
    document.getElementById(`help-area-${area}`)?.scrollIntoView({ block: 'start' });
  }, [area]);

  const terms = useMemo(() => {
    const collator = new Intl.Collator(i18n.language);
    const needle = query.trim().toLocaleLowerCase(i18n.language);
    return GLOSSARY_TERMS.map((id) => ({
      id,
      term: t(`helpCenter.glossary.${id}.term`),
      text: t(`helpCenter.glossary.${id}.text`),
    }))
      .filter(
        (g) =>
          !needle ||
          g.term.toLocaleLowerCase(i18n.language).includes(needle) ||
          g.text.toLocaleLowerCase(i18n.language).includes(needle),
      )
      .sort((a, b) => collator.compare(a.term, b.term));
  }, [query, t, i18n.language]);

  const heading = (section: Section) => (
    <h2
      id={`help-${section}`}
      className="mb-3 scroll-mt-20 font-heading text-lg font-semibold"
      ref={(el) => {
        sectionRefs.current[section] = el;
      }}
    >
      {t(`helpCenter.sections.${section}`)}
    </h2>
  );

  return (
    <div className="space-y-8">
      <ViewIntro title={t('helpCenter.title')}>{t('helpCenter.intro')}</ViewIntro>

      <nav aria-label={t('helpCenter.title')} className="flex flex-wrap gap-2">
        {SECTIONS.map((section) => (
          <Button
            key={section}
            variant="outline"
            size="sm"
            onClick={() => sectionRefs.current[section]?.scrollIntoView({ block: 'start' })}
          >
            {t(`helpCenter.sections.${section}`)}
          </Button>
        ))}
      </nav>

      <section aria-labelledby="help-start">
        {heading('start')}
        <Card>
          <CardContent className="space-y-3 text-sm leading-relaxed">
            <p>{t('helpCenter.start.body')}</p>
            <p>{t('helpCenter.start.modes')}</p>
            <p>{t('helpCenter.start.expert')}</p>
            <Button
              onClick={() => {
                navigate('home');
                startTour();
              }}
            >
              {t('helpCenter.start.tour')}
            </Button>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="help-areas" className="space-y-2">
        {heading('areas')}
        {HELP_AREAS.filter((id) => booruEnabled || id !== 'booru').map((id) => (
          <Expandable
            key={id}
            id={`help-area-${id}`}
            title={t(`helpCenter.areas.${id}.title`)}
            open={area === id}
          >
            {t(`helpCenter.areas.${id}.body`)}
          </Expandable>
        ))}
      </section>

      <section aria-labelledby="help-faq" className="space-y-2">
        {heading('faq')}
        {FAQ_ITEMS.map((id) => (
          <Expandable key={id} title={t(`helpCenter.faq.${id}.q`)}>
            {t(`helpCenter.faq.${id}.a`)}
          </Expandable>
        ))}
      </section>

      <section aria-labelledby="help-glossary">
        {heading('glossary')}
        <div className="relative mb-3 max-w-sm">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('helpCenter.glossarySearch')}
            aria-label={t('helpCenter.glossarySearch')}
            className="pl-8"
          />
        </div>
        {terms.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('helpCenter.glossaryEmpty')}</p>
        ) : (
          <dl className="grid gap-3 sm:grid-cols-2">
            {terms.map((g) => (
              <div key={g.id} className="rounded-md border bg-card px-4 py-3">
                <dt className="font-medium">{g.term}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{g.text}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section aria-labelledby="help-engines">
        {heading('engines')}
        <Card>
          <CardContent className="space-y-3 text-sm leading-relaxed">
            <p>{t('helpCenter.engines.body')}</p>
            <Button variant="outline" onClick={() => navigate('settings')}>
              {t('helpCenter.engines.open')}
            </Button>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="help-guides">
        {heading('guides')}
        <ul className="grid gap-3 sm:grid-cols-2">
          {HELP_GUIDES.map((g) => (
            <li key={g.id} className="rounded-md border bg-card px-4 py-3">
              <a
                href={guideHref(g, i18n.language)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {t(`helpCenter.guides.${g.id}.title`)}
                <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
                <span className="sr-only">{t('helpCenter.openGuide')}</span>
              </a>
              <p className="mt-1 text-sm text-muted-foreground">
                {t(`helpCenter.guides.${g.id}.summary`)}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
