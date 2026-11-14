import { useTranslation } from 'react-i18next';
import {
  FONT_FAMILY,
  LYRICS_COLORS,
  LYRICS_FONTS,
  LYRICS_SIZES,
  type LyricsFont,
  type LyricsSize,
} from '@conbert/core';
import { HelpTip } from '@/components/HelpTip';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ColorPicker } from './ColorPicker';
import { lyricsFontCss, swatchHex, useLyricsFonts } from './lyrics';

export interface TextStyle {
  font: LyricsFont;
  color: string;
  size: LyricsSize;
}

/** Font, colour and size of the lyrics – with a preview line. */
export function TextStyleSection({
  value,
  onChange,
  waveColor,
  coverColors,
}: {
  value: TextStyle;
  onChange: (next: TextStyle) => void;
  /** The wave's colour (for "same as the wave" in the preview). */
  waveColor: string;
  coverColors: readonly string[];
}) {
  const { t } = useTranslation();
  useLyricsFonts();
  const colour =
    value.color === 'wave' ? waveColor : (swatchHex(value.color) ?? coverColors[0] ?? '#ffffff');
  const light =
    parseInt(colour.slice(1, 3), 16) * 0.3 +
      parseInt(colour.slice(3, 5), 16) * 0.59 +
      parseInt(colour.slice(5, 7), 16) * 0.11 >
    128;
  const edge = light ? '#101010' : '#f5f5f5';
  const face = FONT_FAMILY[value.font];
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="viz-font" className="flex items-center gap-1">
            {t('options.vizFont.label')}
            <HelpTip helpKey="options.vizFont.help" labelKey="options.vizFont.label" />
          </Label>
          <Select
            value={value.font}
            onValueChange={(v) => onChange({ ...value, font: v as LyricsFont })}
          >
            <SelectTrigger id="viz-font" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LYRICS_FONTS.map((f) => (
                <SelectItem key={f} value={f}>
                  <span
                    className="text-base"
                    style={{
                      fontFamily: lyricsFontCss(f),
                      fontWeight: FONT_FAMILY[f].bold ? 700 : 400,
                    }}
                  >
                    {t(`options.vizFont.choices.${f}`)}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="viz-text-size" className="flex items-center gap-1">
            {t('options.vizTextSize.label')}
            <HelpTip helpKey="options.vizTextSize.help" labelKey="options.vizTextSize.label" />
          </Label>
          <Select
            value={value.size}
            onValueChange={(v) => onChange({ ...value, size: v as LyricsSize })}
          >
            <SelectTrigger id="viz-text-size" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LYRICS_SIZES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`options.vizTextSize.choices.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <ColorPicker
        id="viz-text-color"
        option="vizTextColor"
        value={value.color}
        onChange={(color) => onChange({ ...value, color })}
        named={LYRICS_COLORS.filter((c) => c !== 'wave' && c !== 'cover')}
        extras={['wave']}
        coverColors={coverColors}
      />
      <div
        className="rounded-lg bg-[#15131f] px-4 py-6 text-center"
        aria-label={t('workshop.audiovideo.previewLabel')}
        role="img"
      >
        <span
          style={{
            fontFamily: lyricsFontCss(value.font),
            fontWeight: face.bold ? 700 : 400,
            fontSize:
              value.size === 'small' ? '1.1rem' : value.size === 'large' ? '1.9rem' : '1.5rem',
            color: colour,
            textShadow: `0 0 2px ${edge}, 0 0 2px ${edge}, 1px 1px 2px ${edge}`,
          }}
        >
          {t('workshop.audiovideo.previewText')}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{t('workshop.audiovideo.previewHint')}</p>
    </div>
  );
}
