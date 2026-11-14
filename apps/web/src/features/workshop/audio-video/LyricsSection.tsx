import { useTranslation } from 'react-i18next';
import { LYRICS_SOURCES, WHISPER_LANGUAGES, type WhisperLanguage } from '@conbert/core';
import { HelpTip } from '@/components/HelpTip';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SingleFile } from '../SingleFile';
import { lyricsFileOk, useSpeechAvailable, type LyricsChoice } from './lyrics';

/** "Lyrics": none, a file with times (LRC, SRT …) or recognised from the song. */
export function LyricsSection({
  value,
  onChange,
}: {
  value: LyricsChoice;
  onChange: (next: LyricsChoice) => void;
}) {
  const { t } = useTranslation();
  const speech = useSpeechAvailable();
  return (
    <fieldset className="space-y-3 rounded-lg border p-3">
      <legend className="flex items-center gap-1 px-1 text-sm font-medium">
        {t('options.vizLyrics.label')}
        <HelpTip helpKey="options.vizLyrics.help" labelKey="options.vizLyrics.label" />
      </legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {LYRICS_SOURCES.map((s) => {
          const off = s === 'auto' && !speech;
          return (
            <label
              key={s}
              className={`flex items-start gap-2 rounded-lg border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5 ${off ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
            >
              <input
                type="radio"
                name="viz-lyrics"
                value={s}
                checked={value.source === s}
                disabled={off}
                onChange={() => onChange({ ...value, source: s })}
                className="mt-0.5 accent-primary"
              />
              <span>
                <span className="block font-medium">{t(`options.vizLyrics.choices.${s}`)}</span>
                <span className="text-muted-foreground">
                  {off ? t('workshop.audiovideo.noSpeech') : t(`options.vizLyrics.choiceHelp.${s}`)}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {value.source === 'file' && (
        <div className="space-y-1">
          <p className="flex items-center gap-1 text-sm font-medium">
            {t('options.vizLyricsFile.label')}
            <HelpTip helpKey="options.vizLyricsFile.help" labelKey="options.vizLyricsFile.label" />
          </p>
          <SingleFile file={value.file} onFile={(file) => onChange({ ...value, file })} />
          {!lyricsFileOk(value.file) && (
            <p role="alert" className="text-sm text-destructive">
              {t('workshop.audiovideo.lyricsWrongType')}
            </p>
          )}
        </div>
      )}
      {value.source === 'auto' && (
        <div className="space-y-2">
          <Label htmlFor="viz-lyrics-language" className="flex items-center gap-1">
            {t('options.speechLanguage.label')}
            <HelpTip
              helpKey="options.speechLanguage.help"
              labelKey="options.speechLanguage.label"
            />
          </Label>
          <Select
            value={value.language}
            onValueChange={(v) => onChange({ ...value, language: v as WhisperLanguage })}
          >
            <SelectTrigger id="viz-lyrics-language" className="w-full sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WHISPER_LANGUAGES.map((l) => (
                <SelectItem key={l} value={l}>
                  {t(`options.speechLanguage.${l}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t('workshop.audiovideo.autoHint')}</p>
        </div>
      )}
    </fieldset>
  );
}
