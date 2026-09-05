import { describe, expect, it } from 'vitest';

import { extensionOf, formatFileSize, isPreviewable } from '../../src/ui/attachments.js';

describe('formatFileSize', () => {
  it('formats a size the way a person reads one', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(1024)).toBe('1.02 kB');
    expect(formatFileSize(5_242_880)).toBe('5.24 MB');
  });

  // Regression: `pretty-bytes` THROWS on a non-finite number, and mail stores
  // report a missing size as null, undefined or NaN constantly. Unguarded, one
  // attachment with no recorded size takes the whole bubble down.
  it('says nothing rather than throwing when the size is unusable', () => {
    expect(formatFileSize(null)).toBe('');
    expect(formatFileSize(undefined)).toBe('');
    expect(formatFileSize(Number.NaN)).toBe('');
    expect(formatFileSize(Number.POSITIVE_INFINITY)).toBe('');
    expect(formatFileSize(-1)).toBe('');
    expect(formatFileSize('12' as unknown as number)).toBe('');
  });
});

describe('extensionOf', () => {
  it('lowercases the extension and drops the dot', () => {
    expect(extensionOf('Report.PDF')).toBe('pdf');
    expect(extensionOf('archive.tar.gz')).toBe('gz');
  });

  // Regression: a leading dot is a UNIX hidden file, not a type. Reading
  // `.gitignore` as a `gitignore` file offers a preview for something no host
  // can preview.
  it('finds no extension on a dotfile', () => {
    expect(extensionOf('.gitignore')).toBe('');
  });

  it('finds no extension when there is none', () => {
    expect(extensionOf('ATT00001')).toBe('');
    expect(extensionOf('trailing.')).toBe('');
    expect(extensionOf(null)).toBe('');
    expect(extensionOf('   ')).toBe('');
  });
});

describe('isPreviewable', () => {
  // Regression: the filename is a hint that is frequently missing or wrong
  // (`document`, `ATT00001`), so the declared MIME type has to be consulted
  // first — otherwise a PDF called `ATT00001` gets no preview button.
  it('trusts the MIME type ahead of the filename', () => {
    expect(isPreviewable({ filename: 'ATT00001', mimeType: 'application/pdf' })).toBe(true);
    expect(isPreviewable({ filename: 'ATT00001', mimeType: 'IMAGE/PNG' })).toBe(true);
    expect(isPreviewable({ filename: 'ATT00001', mimeType: ' text/csv ' })).toBe(true);
  });

  it('falls back to the extension when the type is missing or unhelpful', () => {
    expect(isPreviewable({ filename: 'photo.JPG' })).toBe(true);
    expect(isPreviewable({ filename: 'photo.jpg', mimeType: '   ' })).toBe(true);
    expect(isPreviewable({ filename: 'photo.jpg', mimeType: 'application/octet-stream' })).toBe(
      true,
    );
  });

  it('offers nothing for a type and a name that both say nothing', () => {
    expect(isPreviewable({ filename: 'accounts.xlsx' })).toBe(false);
    expect(isPreviewable({ filename: 'ATT00001', mimeType: 'application/zip' })).toBe(false);
    expect(isPreviewable({ filename: '' })).toBe(false);
  });
});
