import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
  StandardFonts,
  degrees,
  rgb,
} from 'pdf-lib';

const FIXTURE_DIR = path.resolve(process.cwd(), 'tests/pdf-editor/fixtures');
const FIXED_DATE = new Date('2025-01-02T03:04:05.000Z');

async function createComplexFixture() {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Phase 1E complex preservation corpus');
  pdf.setAuthor('SmilePDF verification suite');
  pdf.setSubject('Forms, links, outlines, annotations, attachments, tags, rotations, signatures, and metadata');
  pdf.setKeywords(['phase-1e', 'golden', 'preservation']);
  pdf.setCreationDate(FIXED_DATE);
  pdf.setModificationDate(FIXED_DATE);

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const first = pdf.addPage([612, 792]);
  first.drawText('Phase 1E searchable source text', { x: 72, y: 700, size: 18, font, color: rgb(0.1, 0.2, 0.3) });
  const second = pdf.addPage([420, 595]);
  second.setRotation(degrees(90));
  second.drawText('Phase 1E rotated page text', { x: 48, y: 520, size: 14, font });

  const form = pdf.getForm();
  const name = form.createTextField('customer.name');
  name.setText('Ada Lovelace');

  const signatureWidget = pdf.context.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    T: PDFString.of('approval.signature'),
    Rect: [48, 575, 238, 603],
    F: 4,
    P: first.ref,
  });
  const signatureDictionaryRef = pdf.context.register(pdf.context.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'adbe.pkcs7.detached',
    ByteRange: [0, 100, 200, 300],
    Contents: PDFHexString.of('00'.repeat(64)),
    M: PDFString.of('D:20250102030405Z'),
    Reason: PDFString.of('Phase 1E deterministic signature marker'),
  }));
  signatureWidget.set(PDFName.of('V'), signatureDictionaryRef);
  const signatureRef = pdf.context.register(signatureWidget);
  form.acroForm.addField(signatureRef);
  first.node.addAnnot(signatureRef);

  const link = pdf.context.obj({
    Type: 'Annot', Subtype: 'Link', Rect: [72, 560, 250, 585], Border: [0, 0, 0],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://example.com/phase-1e') },
  });
  const note = pdf.context.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [280, 555, 305, 580],
    Contents: PDFString.of('Phase 1E preservation note'), Name: 'Comment', C: [1, 0.82, 0.2],
  });
  first.node.Annots()?.push(pdf.context.register(link));
  first.node.Annots()?.push(pdf.context.register(note));

  const secondDestination = pdf.context.obj([second.ref, PDFName.of('Fit')]);
  const outlineItem = pdf.context.obj({
    Title: PDFString.of('Rotated page'), Parent: undefined, Dest: secondDestination,
  });
  const outlineItemRef = pdf.context.register(outlineItem);
  const outlines = pdf.context.obj({ Type: 'Outlines', First: outlineItemRef, Last: outlineItemRef, Count: 1 });
  const outlinesRef = pdf.context.register(outlines);
  outlineItem.set(PDFName.of('Parent'), outlinesRef);
  pdf.catalog.set(PDFName.of('Outlines'), outlinesRef);
  pdf.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));

  await pdf.attach(new TextEncoder().encode('Phase 1E embedded attachment'), 'phase-1e.txt', {
    mimeType: 'text/plain', description: 'Golden corpus attachment', creationDate: FIXED_DATE, modificationDate: FIXED_DATE,
  });

  const structTreeRoot = pdf.context.obj({ Type: 'StructTreeRoot', K: [] });
  pdf.catalog.set(PDFName.of('StructTreeRoot'), pdf.context.register(structTreeRoot));
  pdf.catalog.set(PDFName.of('MarkInfo'), pdf.context.register(pdf.context.obj({ Marked: true })));

  return pdf.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: true });
}

async function createPlainFixture() {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(FIXED_DATE);
  pdf.setModificationDate(FIXED_DATE);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([612, 792]).drawText('Phase 1E plain browser workflow', { x: 72, y: 700, size: 18, font });
  return pdf.save({ useObjectStreams: false });
}

async function main() {
  await mkdir(FIXTURE_DIR, { recursive: true });
  const files = {
    'phase-1e-complex.pdf': await createComplexFixture(),
    'phase-1e-plain.pdf': await createPlainFixture(),
  };
  await Promise.all(Object.entries(files).map(([name, bytes]) => writeFile(path.join(FIXTURE_DIR, name), bytes)));
  await writeFile(path.join(FIXTURE_DIR, 'manifest.json'), `${JSON.stringify({
    version: 1,
    generatedBy: 'tests/pdf-editor/generate-golden-corpus.ts',
    provenance: 'Synthetic project-generated documents; no third-party source documents. The signature fixture is a structural marker, not a valid cryptographic signature.',
    fixedDate: FIXED_DATE.toISOString(),
    sha256: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')])),
    fixtures: {
      'phase-1e-complex.pdf': ['signed-marker', 'form', 'link', 'outline', 'annotation', 'attachment', 'tagged', 'rotated', 'metadata'],
      'phase-1e-plain.pdf': ['searchable-text', 'browser-workflow'],
    },
  }, null, 2)}\n`);
}

await main();
