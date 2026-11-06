import { describe, expect, it } from 'vitest';
import {
  ffmpegCommentArgs,
  isSealed,
  messageFields,
  metaSpotFor,
  openMessage,
  sealMessage,
} from './meta-secret';

describe('secret message in metadata', () => {
  it('knows where the message goes', () => {
    expect(metaSpotFor('JPG')).toBe('exif');
    expect(metaSpotFor('pdf')).toBe('pdf');
    expect(metaSpotFor('flac')).toBe('audio');
    expect(metaSpotFor('docx')).toBeNull();
  });

  it('writes plain text as it is and locks it with a password', async () => {
    expect(await sealMessage('Hallo')).toBe('Hallo');
    const sealed = await sealMessage('Treffpunkt 🌳', 'pw');
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain('Treffpunkt');
    expect(await openMessage(sealed, 'pw')).toBe('Treffpunkt 🌳');
    await expect(openMessage(sealed, 'nein')).rejects.toMatchObject({ code: 'wrong-password' });
    await expect(openMessage('CNBZ1:%%%', 'pw')).rejects.toMatchObject({ code: 'damaged' });
  }, 20_000);

  it('finds text fields and locked messages, not file facts', () => {
    const fields = messageFields({
      'System:FileName': 'comment.jpg',
      'File:FileType': 'JPEG',
      'File:Comment': 'im JPEG-Kommentar',
      'ExifIFD:UserComment': 'geheim',
      'IFD0:Make': 'Canon',
      'XMP-dc:Subject': ['Urlaub', 'Meer'],
      'IFD0:Software': 'CNBZ1:abc',
      'PNG:Comment': '  ',
    });
    expect(fields).toEqual([
      { key: 'IFD0:Software', value: 'CNBZ1:abc', sealed: true },
      { key: 'File:Comment', value: 'im JPEG-Kommentar', sealed: false },
      { key: 'ExifIFD:UserComment', value: 'geheim', sealed: false },
      { key: 'XMP-dc:Subject', value: 'Urlaub, Meer', sealed: false },
    ]);
  });

  it('copies audio streams and only sets the comment', () => {
    const args = ffmpegCommentArgs('in.mp3', 'out.mp3', 'a "b" c');
    expect(args).toEqual(
      expect.arrayContaining(['-c', 'copy', 'comment=a "b" c', '-id3v2_version']),
    );
    expect(ffmpegCommentArgs('in.flac', 'out.flac', 'x')).not.toContain('-id3v2_version');
  });
});
