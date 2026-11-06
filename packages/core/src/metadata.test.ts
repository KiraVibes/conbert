import { describe, expect, it } from 'vitest';
import {
  commonFields,
  exiftoolWrite,
  fromExifDate,
  groupMetadata,
  hasLocation,
  ffmpegMetadataArgs,
  hasMetadataEdits,
  metadataFieldWritable,
  metadataWritable,
  metadataWriter,
  pdfInfoEdits,
  toExifDate,
  type MetadataEdits,
} from './metadata';

describe('metadata', () => {
  it('knows which formats it can write', () => {
    expect(metadataWritable('jpg')).toBe(true);
    expect(metadataWritable('mp4')).toBe(true);
    expect(metadataWritable('mp3')).toBe(true);
    expect(metadataWritable('pdf')).toBe(true);
    expect(metadataWritable('mkv')).toBe(false);
    expect(metadataWritable('docx')).toBe(false);
  });

  it('converts dates both ways', () => {
    expect(toExifDate('2026-10-27T14:30')).toBe('2026:10:27 14:30:00');
    expect(toExifDate('2026-10-27')).toBe('2026:10:27 00:00:00');
    expect(toExifDate('gestern')).toBeNull();
    expect(fromExifDate('2026:10:27 14:30:05+02:00')).toBe('2026-10-27T14:30');
  });

  it('writes EXIF and XMP for photos, ItemList for videos', () => {
    const photo = exiftoolWrite('jpg', {
      values: {
        title: 'Urlaub',
        author: 'Anna',
        keywords: 'Meer, Sonne;Strand',
        date: '2026-07-01T10:00',
      },
      removeGps: true,
      removeAll: false,
    });
    expect(photo.tags).toMatchObject({
      'XMP-dc:Title': 'Urlaub',
      'XMP-dc:Creator': 'Anna',
      'IFD0:Artist': 'Anna',
      'XMP-dc:Subject': ['Meer', 'Sonne', 'Strand'],
      'ExifIFD:DateTimeOriginal': '2026:07:01 10:00:00',
    });
    expect(photo.args).toEqual(['-m', '-gps:all=', '-GPS*=']);

    const video = exiftoolWrite('mp4', {
      values: { title: 'Film', copyright: '' },
      removeGps: false,
      removeAll: true,
    });
    expect(video.tags).toMatchObject({
      'ItemList:Title': 'Film',
      'XMP-dc:Rights': '',
      'ItemList:Copyright': '',
    });
    expect(video.tags['IFD0:Artist']).toBeUndefined();
    expect(video.args).toEqual(['-m', '-all=']);
  });

  it('reads the common fields and spots a location', () => {
    const tags = {
      'IFD0:Artist': 'Anna',
      'XMP-dc:Title': 'Urlaub',
      'IPTC:Keywords': ['Meer', 'Sonne'],
      'ExifIFD:DateTimeOriginal': '2026:07:01 10:00:00',
      'GPS:GPSLatitude': '54 deg 10\' 0.00" N',
    };
    expect(commonFields(tags)).toEqual({
      title: 'Urlaub',
      author: 'Anna',
      keywords: 'Meer, Sonne',
      date: '2026-07-01T10:00',
    });
    expect(hasLocation(tags)).toBe(true);
    expect(hasLocation({ 'IFD0:Artist': 'x' })).toBe(false);
  });

  it('groups tags for display and hides ExifTool notes', () => {
    expect(
      groupMetadata({
        SourceFile: '/a.jpg',
        'ExifTool:ExifToolVersion': 13.42,
        'System:FileName': 'a.jpg',
        'IFD0:Make': 'Canon',
        'IFD0:Model': 'EOS',
        'GPS:GPSAltitude': '12 m',
      }),
    ).toEqual([
      {
        group: 'IFD0',
        entries: [
          ['Make', 'Canon'],
          ['Model', 'EOS'],
        ],
      },
      { group: 'GPS', entries: [['GPSAltitude', '12 m']] },
    ]);
  });

  it('only counts real edits', () => {
    expect(hasMetadataEdits(undefined)).toBe(false);
    expect(hasMetadataEdits({ values: {}, removeGps: false, removeAll: false })).toBe(false);
    expect(hasMetadataEdits({ values: { title: '' }, removeGps: false, removeAll: false })).toBe(
      true,
    );
  });
});

describe('music and PDF metadata', () => {
  const edits = (values: MetadataEdits['values'], removeAll = false): MetadataEdits => ({
    values,
    removeGps: false,
    removeAll,
  });

  it('knows which fields music files have', () => {
    expect(metadataWriter('flac')).toBe('ffmpeg');
    expect(metadataWriter('pdf')).toBe('pdf');
    expect(metadataWriter('jpg')).toBe('exiftool');
    expect(metadataFieldWritable('mp3', 'keywords')).toBe(false);
    expect(metadataFieldWritable('mp3', 'title')).toBe(true);
    expect(metadataFieldWritable('pdf', 'keywords')).toBe(true);
    expect(metadataFieldWritable('mkv', 'title')).toBe(false);
  });

  it('rewrites music tags without re-encoding', () => {
    const args = ffmpegMetadataArgs(
      'in.mp3',
      'out.mp3',
      'mp3',
      edits({ title: ' Song ', author: '', date: '2026-10-31T12:00', keywords: 'x' }),
    );
    expect(args).toEqual(expect.arrayContaining(['-c', 'copy', '-map_metadata', '0']));
    expect(args).toEqual(
      expect.arrayContaining([
        '-metadata',
        'title=Song',
        '-metadata',
        'artist=',
        '-metadata',
        'date=2026-10-31',
      ]),
    );
    expect(args.join(' ')).not.toContain('keywords');
    expect(args.slice(-3)).toEqual(['-id3v2_version', '3', 'out.mp3']);
    // Vorbis comments get the description twice (players read either).
    const flac = ffmpegMetadataArgs('a', 'b', 'flac', edits({ description: 'Hi' }, true));
    expect(flac).toEqual(
      expect.arrayContaining([
        '-map_metadata',
        '-1',
        '-metadata',
        'comment=Hi',
        '-metadata',
        'description=Hi',
      ]),
    );
  });

  it('maps fields to PDF document properties', () => {
    const result = pdfInfoEdits(
      edits({ title: 'Bericht', description: 'Kurz', author: '', date: '2026-10-31T12:00' }),
    );
    expect(result.entries).toEqual({ Title: 'Bericht', Subject: 'Kurz', Author: null });
    expect(result.created?.getFullYear()).toBe(2026);
    expect(pdfInfoEdits(edits({ date: '' }, true))).toEqual({
      clear: true,
      entries: {},
      created: null,
    });
  });
});
