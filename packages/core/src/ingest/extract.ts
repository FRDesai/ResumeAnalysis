import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

export const PDF_MIME = 'application/pdf';
export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export type SupportedMime = typeof PDF_MIME | typeof DOCX_MIME;

export class UnsupportedFileError extends Error {}

/**
 * Detect the real file type from magic bytes, not the client-supplied MIME type
 * (which the client controls). PDF starts with "%PDF", DOCX is a ZIP ("PK\x03\x04").
 */
export function sniffMime(buf: Buffer): SupportedMime | null {
  if (buf.subarray(0, 4).toString('latin1') === '%PDF') return PDF_MIME;
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return DOCX_MIME;
  return null;
}

/** Extract plain text from a PDF or DOCX buffer. The buffer is never written to disk. */
export async function extractText(buf: Buffer): Promise<string> {
  const mime = sniffMime(buf);
  if (mime === PDF_MIME) {
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    try {
      // pageJoiner '' stops pdf-parse adding "-- 1 of 2 --" markers, which would
      // otherwise become citable resume lines.
      const result = await parser.getText({ pageJoiner: '' });
      return result.text;
    } finally {
      await parser.destroy();
    }
  }
  if (mime === DOCX_MIME) {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return value;
  }
  throw new UnsupportedFileError('Only PDF and DOCX files are supported');
}
