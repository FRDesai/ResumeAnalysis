// Test helpers that build real PDF / DOCX buffers in memory.
import { Document, Packer, Paragraph } from 'docx';
import PDFDocument from 'pdfkit';

export async function makePdf(lines: string[]): Promise<Buffer> {
  const doc = new PDFDocument();
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  for (const l of lines) doc.text(l);
  doc.end();
  return done;
}

export async function makeDocx(lines: string[]): Promise<Buffer> {
  const doc = new Document({
    sections: [{ children: lines.map((l) => new Paragraph(l)) }],
  });
  return Packer.toBuffer(doc);
}
