import { describe, expect, it } from 'vitest';
import { IMAGE_OPTIONS } from './options/image';
import { changeOption, lockedOptions } from './option-links';

describe('linked options', () => {
  it('lossless sets the quality to 100 and locks it', () => {
    const on = changeOption({ quality: 60 }, 'lossless', true);
    expect(on).toEqual({ quality: 100, lossless: true });
    expect(lockedOptions(IMAGE_OPTIONS, on).get('quality')).toEqual({ value: 100, by: 'lossless' });
  });

  it('turning lossless off gives the quality its normal value back', () => {
    const off = changeOption({ quality: 100, lossless: true }, 'lossless', false);
    expect(off).toEqual({ lossless: false });
    expect(lockedOptions(IMAGE_OPTIONS, off).size).toBe(0);
  });

  it('leaves other changes alone', () => {
    expect(changeOption({ quality: 60 }, 'quality', 70)).toEqual({ quality: 70 });
    expect(lockedOptions(IMAGE_OPTIONS, {}).size).toBe(0);
  });
});
