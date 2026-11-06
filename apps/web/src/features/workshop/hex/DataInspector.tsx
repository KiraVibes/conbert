import { useTranslation } from 'react-i18next';
import { HelpTip } from '@/components/HelpTip';
import { hex } from '../save-blob';

/**
 * The same bytes read in different ways: as small and big numbers, in both
 * byte orders, as a decimal number and as a point in time.
 */
export function DataInspector({ bytes, offset }: { bytes: Uint8Array; offset: number }) {
  const { t, i18n } = useTranslation();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const has = (n: number) => bytes.length >= n;
  const num = (v: number | bigint) => v.toLocaleString(i18n.language);
  const rows: [string, string | null][] = [
    ['uint8', has(1) ? num(view.getUint8(0)) : null],
    ['int8', has(1) ? num(view.getInt8(0)) : null],
    ['uint16le', has(2) ? num(view.getUint16(0, true)) : null],
    ['uint16be', has(2) ? num(view.getUint16(0, false)) : null],
    ['uint32le', has(4) ? num(view.getUint32(0, true)) : null],
    ['uint32be', has(4) ? num(view.getUint32(0, false)) : null],
    ['int32le', has(4) ? num(view.getInt32(0, true)) : null],
    ['uint64le', has(8) ? num(view.getBigUint64(0, true)) : null],
    ['float32le', has(4) ? String(view.getFloat32(0, true)) : null],
    ['float64le', has(8) ? String(view.getFloat64(0, true)) : null],
    [
      'unixTime',
      has(4)
        ? (() => {
            const seconds = view.getUint32(0, true);
            // Only plausible times (1990–2100) – everything else would just confuse.
            return seconds > 631152000 && seconds < 4102444800
              ? new Date(seconds * 1000).toLocaleString(i18n.language)
              : '–';
          })()
        : null,
    ],
    [
      'utf8',
      has(1) ? new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 4)) : null,
    ],
  ];
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1 font-medium">
        {t('workshop.hex.inspectorTitle')}
        <HelpTip helpKey="workshop.hex.inspectorHelp" labelKey="workshop.hex.inspectorTitle" />
      </h3>
      <p className="text-xs text-muted-foreground">
        {t('workshop.hex.inspectorReads', { offset: `0x${hex(offset, 2)}`, count: bytes.length })}{' '}
        <span className="font-mono text-foreground">
          {[...bytes].map((b, i) => (
            <span key={i} className={i === 0 ? 'font-semibold underline' : undefined}>
              {hex(b, 2)}{' '}
            </span>
          ))}
        </span>
      </p>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 rounded-lg border p-3 text-xs sm:grid-cols-2">
        {rows
          .filter(([, value]) => value !== null)
          .map(([key, value]) => (
            <div key={key} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t(`workshop.hex.inspector.${key}`)}</dt>
              <dd className="truncate font-mono">{value}</dd>
            </div>
          ))}
      </dl>
    </section>
  );
}
