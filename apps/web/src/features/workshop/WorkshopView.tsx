import { useTranslation } from 'react-i18next';
import {
  ActivityIcon,
  BellRingIcon,
  SmileIcon,
  SplitIcon,
  TestTubeIcon,
  DiffIcon,
  ImagesIcon,
  ClapperboardIcon,
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
import { SpectrogramTool } from './spectrogram/SpectrogramTool';
import { StegoTool } from './stego/StegoTool';
import { TreasureTool } from './treasure/TreasureTool';
import { VaultTool } from './vault/VaultTool';
import { XrayTool } from './xray/XrayTool';

/** Tricks with a page of their own (the X-ray tricks share one). */
const TOOLS: Record<string, () => React.ReactNode> = {
  vault: VaultTool,
  privacy: PrivacyTool,
  repair: RepairTool,
  ela: ElaTool,
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
};

/** The FileWizard workshop: an overview of the tricks, or the open trick. */
export function WorkshopView() {
  const { t } = useTranslation();
  const [trick, openTrick] = useWorkshopTrick();

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

  return (
    <div>
      <ViewIntro title={t('workshop.title')} help="workshop">
        {t('workshop.intro')}
      </ViewIntro>
      {WORKSHOP_GROUPS.map((group) => {
        const tricks = WORKSHOP_TRICKS.filter((tr) => tr.group === group);
        if (tricks.length === 0) return null;
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
