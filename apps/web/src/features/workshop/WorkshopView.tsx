import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  XIcon,
  ChevronRightIcon,
  ListIcon,
  PaletteIcon,
  LampIcon,
  PenLineIcon,
  WaypointsIcon,
  ChartPieIcon,
  ScanTextIcon,
  PackageIcon,
  ActivityIcon,
  BellRingIcon,
  SmileIcon,
  SplitIcon,
  TestTubeIcon,
  DiffIcon,
  ImagesIcon,
  ClapperboardIcon,
  ScanLineIcon,
  PictureInPicture2Icon,
  CropIcon,
  HistoryIcon,
  CpuIcon,
  TextSearchIcon,
  FileUserIcon,
  CalendarClockIcon,
  TextCursorInputIcon,
  BookOpenIcon,
  LayoutGridIcon,
  StickerIcon,
  FilmIcon,
  PrinterIcon,
  SatelliteIcon,
  RadioIcon,
  HeadphonesIcon,
  ScissorsIcon,
  SearchIcon,
  CopyIcon,
  CameraIcon,
  VenetianMaskIcon,
  ArrowLeftIcon,
  AudioLinesIcon,
  BinaryIcon,
  ContrastIcon,
  AppWindowIcon,
  CodeIcon,
  FlameIcon,
  QrCodeIcon,
  Grid3x3Icon,
  TypeIcon,
  ZapIcon,
  EyeOffIcon,
  FingerprintIcon,
  ImageIcon,
  FileArchiveIcon,
  LayersIcon,
  KeyRoundIcon,
  MapIcon,
  MessageSquareLockIcon,
  ScanEyeIcon,
  ScanSearchIcon,
  ScrollTextIcon,
  ShieldAlertIcon,
  AudioWaveformIcon,
  WrenchIcon,
  type LucideIcon,
} from 'lucide-react';
import { WORKSHOP_GROUPS, WORKSHOP_TRICKS } from '@conbert/core';
import { ViewIntro } from '@/components/ViewIntro';
import { Button } from '@/components/ui/button';
import { useWorkshopTrick } from '@/lib/use-view';
import { isXrayTrick } from './xray/tricks';
import { ArchiveImageTool } from './archive-image/ArchiveImageTool';
import { CiphersTool } from './ciphers/CiphersTool';
import { ElaTool } from './ela/ElaTool';
import { AsciiTool } from './fun/AsciiTool';
import { EmojiMosaicTool } from './fun/EmojiMosaicTool';
import { DeepFryTool } from './fun/DeepFryTool';
import { GlitchTool } from './fun/GlitchTool';
import { PixelArtTool } from './fun/PixelArtTool';
import { QrTool } from './fun/QrTool';
import { EncodeTool } from './fun/EncodeTool';
import { FaviconTool } from './fun/FaviconTool';
import { InvisibleTool } from './invisible/InvisibleTool';
import { MetaSecretTool } from './meta-secret/MetaSecretTool';
import { PrivacyTool } from './privacy/PrivacyTool';
import { RepairTool } from './repair/RepairTool';
import { RingtoneTool } from './ringtone/RingtoneTool';
import { SplitTool } from './split/SplitTool';
import { TestFilesTool } from './testfiles/TestFilesTool';
import { CompareTool } from './compare/CompareTool';
import { ExtractImagesTool } from './extract-images/ExtractImagesTool';
import { AudioVideoTool } from './audio-video/AudioVideoTool';
import { ScannerTool } from './scanner/ScannerTool';
import { ThumbCheckTool } from './thumbs/ThumbCheckTool';
import { CropCheckTool } from './forensics/CropCheckTool';
import { PdfVersionsTool } from './forensics/PdfVersionsTool';
import { DangerTool } from './forensics/DangerTool';
import { ProgramTool } from './forensics/ProgramTool';
import { StringsTool } from './forensics/StringsTool';
import { DocSecretsTool } from './forensics/DocSecretsTool';
import { TimelineTool } from './forensics/TimelineTool';
import { JpegOriginTool } from './forensics/JpegOriginTool';
import { CopyMoveTool } from './forensics/CopyMoveTool';
import { MagnifierTool } from './forensics/MagnifierTool';
import { AudioCutsTool } from './forensics/AudioCutsTool';
import { ListenFileTool } from './fun/ListenFileTool';
import { MorseTool } from './fun/MorseTool';
import { SstvTool } from './fun/SstvTool';
import { PaperBackupTool } from './carriers/PaperBackupTool';
import { DataVideoTool } from './carriers/DataVideoTool';
import { StickerTool } from './makers/StickerTool';
import { ContactSheetTool } from './makers/ContactSheetTool';
import { ComicTool } from './makers/ComicTool';
import { RenameTool } from './makers/RenameTool';
import { PaletteTool } from './makers/PaletteTool';
import { LithophaneTool } from './makers/LithophaneTool';
import { HandwritingTool } from './makers/HandwritingTool';
import { FileMapTool } from './insight/FileMapTool';
import { SizeCheckTool } from './insight/SizeCheckTool';
import { HiddenTextTool } from './forensics/HiddenTextTool';
import { PasswordPackageTool } from './package/PasswordPackageTool';
import { RedactCheckTool } from './forensics/RedactCheckTool';
import { ThumbPrankTool } from './thumbs/ThumbPrankTool';
import { SpectrogramTool } from './spectrogram/SpectrogramTool';
import { StegoTool } from './stego/StegoTool';
import { TreasureTool } from './treasure/TreasureTool';
import { VaultTool } from './vault/VaultTool';
import { XrayTool } from './xray/XrayTool';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Input } from '@/components/ui/input';
import { matchesSearch } from './workshop-search';

/** Tricks with a page of their own (the X-ray tricks share one). */
const TOOLS: Record<string, () => React.ReactNode> = {
  vault: VaultTool,
  privacy: PrivacyTool,
  repair: RepairTool,
  ela: ElaTool,
  thumbcheck: ThumbCheckTool,
  cropcheck: CropCheckTool,
  redactcheck: RedactCheckTool,
  pdfversions: PdfVersionsTool,
  danger: DangerTool,
  program: ProgramTool,
  strings: StringsTool,
  docsecrets: DocSecretsTool,
  timeline: TimelineTool,
  jpegorigin: JpegOriginTool,
  copymove: CopyMoveTool,
  magnifier: MagnifierTool,
  audiocuts: AudioCutsTool,
  listen: ListenFileTool,
  morse: MorseTool,
  sstv: SstvTool,
  paper: PaperBackupTool,
  datavideo: DataVideoTool,
  sticker: StickerTool,
  contactsheet: ContactSheetTool,
  comic: ComicTool,
  rename: RenameTool,
  palette: PaletteTool,
  lithophane: LithophaneTool,
  handfont: HandwritingTool,
  filemap: FileMapTool,
  sizecheck: SizeCheckTool,
  hiddentext: HiddenTextTool,
  passwordpack: PasswordPackageTool,
  thumbprank: ThumbPrankTool,
  treasure: TreasureTool,
  ciphers: CiphersTool,
  stego: () => <StegoTool />,
  audiostego: () => <StegoTool medium="audio" />,
  archiveimage: () => <ArchiveImageTool mode="append" />,
  polyglot: () => <ArchiveImageTool mode="polyglot" />,
  spectrogram: SpectrogramTool,
  metasecret: MetaSecretTool,
  invisible: InvisibleTool,
  ascii: AsciiTool,
  pixelart: PixelArtTool,
  glitch: GlitchTool,
  deepfry: DeepFryTool,
  qr: QrTool,
  favicon: FaviconTool,
  encode: EncodeTool,
  emojimosaic: EmojiMosaicTool,
  ringtone: RingtoneTool,
  split: SplitTool,
  testfiles: TestFilesTool,
  compare: CompareTool,
  extractimages: ExtractImagesTool,
  audiovideo: AudioVideoTool,
  scanner: ScannerTool,
};

const ICONS: Record<string, LucideIcon> = {
  identify: ScanSearchIcon,
  hex: BinaryIcon,
  hashes: FingerprintIcon,
  entropy: ActivityIcon,
  detective: ScanEyeIcon,
  vault: KeyRoundIcon,
  privacy: ShieldAlertIcon,
  repair: WrenchIcon,
  ela: ContrastIcon,
  thumbcheck: PictureInPicture2Icon,
  cropcheck: CropIcon,
  redactcheck: EyeOffIcon,
  pdfversions: HistoryIcon,
  danger: ShieldAlertIcon,
  program: CpuIcon,
  strings: TextSearchIcon,
  docsecrets: FileUserIcon,
  timeline: CalendarClockIcon,
  jpegorigin: CameraIcon,
  copymove: CopyIcon,
  magnifier: SearchIcon,
  audiocuts: ScissorsIcon,
  listen: HeadphonesIcon,
  morse: RadioIcon,
  sstv: SatelliteIcon,
  paper: PrinterIcon,
  datavideo: FilmIcon,
  sticker: StickerIcon,
  contactsheet: LayoutGridIcon,
  comic: BookOpenIcon,
  rename: TextCursorInputIcon,
  thumbprank: VenetianMaskIcon,
  treasure: MapIcon,
  ciphers: ScrollTextIcon,
  stego: ImageIcon,
  audiostego: AudioLinesIcon,
  archiveimage: FileArchiveIcon,
  polyglot: LayersIcon,
  spectrogram: AudioWaveformIcon,
  metasecret: MessageSquareLockIcon,
  invisible: EyeOffIcon,
  ascii: TypeIcon,
  pixelart: Grid3x3Icon,
  glitch: ZapIcon,
  deepfry: FlameIcon,
  qr: QrCodeIcon,
  favicon: AppWindowIcon,
  encode: CodeIcon,
  emojimosaic: SmileIcon,
  ringtone: BellRingIcon,
  split: SplitIcon,
  testfiles: TestTubeIcon,
  compare: DiffIcon,
  extractimages: ImagesIcon,
  audiovideo: ClapperboardIcon,
  scanner: ScanLineIcon,
  palette: PaletteIcon,
  lithophane: LampIcon,
  handfont: PenLineIcon,
  filemap: WaypointsIcon,
  sizecheck: ChartPieIcon,
  hiddentext: ScanTextIcon,
  passwordpack: PackageIcon,
};

/** How the overview shows the tricks: big tiles or a compact list. */
const LAYOUTS = ['tiles', 'list'] as const;
type Layout = (typeof LAYOUTS)[number];
const LAYOUT_KEY = 'conbert-workshop-layout';
const LAYOUT_ICONS: Record<Layout, LucideIcon> = { tiles: LayoutGridIcon, list: ListIcon };

function rememberedLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'tiles';
  } catch {
    return 'tiles';
  }
}

/** The FileWizard workshop: an overview of the tricks, or the open trick. */
export function WorkshopView() {
  const { t } = useTranslation();
  const [trick, openTrick] = useWorkshopTrick();
  const [layout, setLayoutState] = useState<Layout>(rememberedLayout);
  const [query, setQuery] = useState('');
  const setLayout = (next: Layout) => {
    setLayoutState(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // Only a convenience.
    }
  };

  const Tool = trick ? TOOLS[trick] : undefined;
  const group = WORKSHOP_TRICKS.find((tr) => tr.id === trick)?.group;
  if (Tool && group) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => openTrick(null)}>
          <ArrowLeftIcon aria-hidden="true" />
          {t('workshop.back')}
        </Button>
        <ViewIntro title={t(`workshop.tricks.${trick}.title`)}>
          {t(`workshop.tricks.${trick}.teaser`)}
        </ViewIntro>
        <Tool />
      </div>
    );
  }

  if (isXrayTrick(trick)) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => openTrick(null)}>
          <ArrowLeftIcon aria-hidden="true" />
          {t('workshop.back')}
        </Button>
        <ViewIntro title={t('workshop.groups.xray.title')}>
          {t('workshop.groups.xray.intro')}
        </ViewIntro>
        <XrayTool trick={trick} onTrick={openTrick} />
      </div>
    );
  }

  const found = WORKSHOP_TRICKS.filter((tr) =>
    matchesSearch(
      query,
      [
        tr.id,
        t(`workshop.tricks.${tr.id}.title`),
        t(`workshop.tricks.${tr.id}.teaser`),
        t(`workshop.tricks.${tr.id}.how`),
        t(`workshop.groups.${tr.group}.title`),
      ].join(' '),
    ),
  );

  return (
    <div>
      <ViewIntro title={t('workshop.title')} help="workshop">
        {t('workshop.intro')}
      </ViewIntro>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative max-w-md min-w-48 flex-1">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('');
            }}
            placeholder={t('workshop.search.placeholder')}
            aria-label={t('workshop.search.label')}
            className="pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
            data-testid="workshop-search"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={t('workshop.search.clear')}
            >
              <XIcon className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <ToggleGroup
          className="ml-auto"
          type="single"
          variant="outline"
          size="sm"
          value={layout}
          onValueChange={(v) => v && setLayout(v as Layout)}
          aria-label={t('workshop.layout.label')}
        >
          {LAYOUTS.map((l) => {
            const Icon = LAYOUT_ICONS[l];
            return (
              <ToggleGroupItem key={l} value={l} className="gap-1.5 px-3">
                <Icon aria-hidden="true" />
                {t(`workshop.layout.${l}`)}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </div>
      {query.trim() && (
        <p className="mb-4 text-sm text-muted-foreground" role="status" data-testid="workshop-hits">
          {found.length > 0
            ? t('workshop.search.hits', { count: found.length })
            : t('workshop.search.none', { query: query.trim() })}
        </p>
      )}
      {WORKSHOP_GROUPS.map((group) => {
        const tricks = found.filter((tr) => tr.group === group);
        if (tricks.length === 0) return null;
        if (layout === 'list')
          return (
            <section key={group} className="mb-6 space-y-2" data-testid="workshop-list">
              <h2 className="flex items-baseline gap-2 font-heading text-base font-semibold">
                {t(`workshop.groups.${group}.title`)}
                <span className="text-xs font-normal text-muted-foreground">
                  {t('workshop.layout.count', { count: tricks.length })}
                </span>
              </h2>
              <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                {tricks.map(({ id }) => {
                  const Icon = ICONS[id] ?? ScanSearchIcon;
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => openTrick(id)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                      >
                        <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                        <span className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-3">
                          <span className="block font-medium sm:w-60 sm:shrink-0">
                            {t(`workshop.tricks.${id}.title`)}
                          </span>
                          <span className="block truncate text-sm text-muted-foreground">
                            {t(`workshop.tricks.${id}.teaser`)}
                          </span>
                        </span>
                        <ChevronRightIcon
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        return (
          <section key={group} className="mb-8 space-y-3">
            <div>
              <h2 className="font-heading text-lg font-semibold">
                {t(`workshop.groups.${group}.title`)}
              </h2>
              <p className="text-sm text-muted-foreground">{t(`workshop.groups.${group}.intro`)}</p>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {tricks.map(({ id }) => {
                const Icon = ICONS[id] ?? ScanSearchIcon;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => openTrick(id)}
                      className="flex h-full w-full items-start gap-3 rounded-xl border bg-card p-4 text-left shadow-xs transition-colors hover:border-primary/50 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="size-5" aria-hidden="true" />
                      </span>
                      <span className="space-y-1">
                        <span className="block font-medium">
                          {t(`workshop.tricks.${id}.title`)}
                        </span>
                        <span className="block text-sm text-muted-foreground">
                          {t(`workshop.tricks.${id}.teaser`)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
