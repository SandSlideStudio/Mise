import { describe, expect, it } from 'vitest';
import { sniffImage } from './images.js';

const avifBox = (brand: string, compatible: string[] = []) => {
  const body = Buffer.concat([
    Buffer.from('ftyp', 'latin1'),
    Buffer.from(brand, 'latin1'),
    Buffer.alloc(4),
    ...compatible.map((b) => Buffer.from(b, 'latin1')),
  ]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length + 4);
  return Buffer.concat([size, body]);
};

describe('sniffImage', () => {
  it('knows each kind by its first bytes', () => {
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 0]))).toBe('jpeg');
    expect(sniffImage(Buffer.from('89504e470d0a1a0a0000', 'hex'))).toBe('png');
    expect(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8X', 'latin1'))).toBe('webp');
    expect(sniffImage(avifBox('avif', ['mif1']))).toBe('avif');
    expect(sniffImage(avifBox('avis'))).toBe('avif');
    expect(sniffImage(avifBox('mif1', ['miaf', 'avif']))).toBe('avif');
  });

  it('refuses everything else', () => {
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImage(Buffer.from('<!doctype html>'))).toBeNull();
    expect(sniffImage(Buffer.from('GIF89a'))).toBeNull();
    // A WAV is RIFF too, and an MP4 or HEIC has a ftyp box: neither is a photo here.
    expect(sniffImage(Buffer.from('RIFF\0\0\0\0WAVEfmt ', 'latin1'))).toBeNull();
    expect(sniffImage(avifBox('isom', ['mp41']))).toBeNull();
    expect(sniffImage(avifBox('heic', ['mif1']))).toBeNull();
    // Only the PNG signature's start is not enough.
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });
});
