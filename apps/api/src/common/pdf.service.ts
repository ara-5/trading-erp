import { Injectable, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';

type Val = string | number | { toString(): string } | null | undefined;

export interface Formatter {
  money(v: Val): string;
  qty(v: Val): string;
  pct(v: Val): string;
  date(v: Date | string | null | undefined): string;
}

export interface PdfColumn {
  header: string;
  width: number;
  align?: 'left' | 'right';
}

export interface PdfDocument {
  title: string;
  number: string;
  status?: string;
  party: { label: string; name: string; lines?: (string | null | undefined | false)[] };
  meta: [string, string][];
  columns: PdfColumn[];
  rows: { cells: string[]; sub?: string }[];
  totals: [label: string, value: string, strong?: boolean][];
  notes?: string | null;
}

export interface DocLineLike {
  description: string | null;
  quantity: Val;
  unitPrice: Val;
  discountPct?: Val;
  taxRate: Val;
  lineTotal: Val;
  product?: { sku: string; name: string; uom?: string } | null;
}

export function pdfResponse(res: Response, buffer: Buffer, filename: string) {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${filename}"`,
    'Cache-Control': 'no-store',
  });
  return new StreamableFile(buffer);
}

/** Standard item/qty/price/tax/amount table for commercial documents. Column widths sum to the 499pt content width. */
export function linesTable(lines: DocLineLike[], f: Formatter): Pick<PdfDocument, 'columns' | 'rows'> {
  const discount = lines.some((l) => Number(l.discountPct ?? 0) > 0);
  const columns: PdfColumn[] = [
    { header: 'Item', width: discount ? 190 : 230 },
    { header: 'Qty', width: 55, align: 'right' },
    { header: 'Unit price', width: 80, align: 'right' },
    ...(discount ? [{ header: 'Disc', width: 40, align: 'right' as const }] : []),
    { header: 'Tax', width: 44, align: 'right' },
    { header: 'Amount', width: 90, align: 'right' },
  ];
  const rows = lines.map((l) => ({
    cells: [
      l.description ?? l.product?.name ?? '',
      `${f.qty(l.quantity)}${l.product?.uom ? ` ${l.product.uom}` : ''}`,
      f.money(l.unitPrice),
      ...(discount ? [f.pct(l.discountPct)] : []),
      f.pct(l.taxRate),
      f.money(l.lineTotal),
    ],
    sub: l.product?.sku,
  }));
  return { columns, rows };
}

@Injectable()
export class PdfService {
  constructor(private readonly prisma: PrismaService) {}

  async render(build: (f: Formatter) => PdfDocument): Promise<Buffer> {
    const settings = await this.prisma.companySettings.findUnique({ where: { id: 1 } });
    const company = settings ?? { name: 'ERP', currency: 'USD', address: null, email: null, phone: null, taxNumber: null };
    const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: company.currency || 'USD' });
    const f: Formatter = {
      money: (v) => currency.format(Number(v ?? 0)),
      qty: (v) => Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 3 }),
      pct: (v) => `${Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`,
      date: (v) => (v ? new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC' }) : '—'),
    };
    const doc = build(f);

    const pdf = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: `${doc.title} ${doc.number}`, Author: company.name } });
    const chunks: Buffer[] = [];
    pdf.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve, reject) => {
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);
    });

    const L = 48;
    const R = 547;
    const W = R - L;
    const ink = '#111827';
    const muted = '#6b7280';
    const accent = '#4f46e5';

    // Header: company on the left, document title on the right.
    pdf.font('Helvetica-Bold').fontSize(16).fillColor(ink).text(company.name, L, 48, { width: 280 });
    pdf.font('Helvetica').fontSize(9).fillColor(muted);
    for (const line of [company.address, company.email, company.phone, company.taxNumber ? `Tax no. ${company.taxNumber}` : null]) {
      if (line) pdf.text(line, L, pdf.y, { width: 280 });
    }
    const leftBottom = pdf.y;
    pdf.font('Helvetica-Bold').fontSize(22).fillColor(accent).text(doc.title.toUpperCase(), L + 280, 44, { width: W - 280, align: 'right' });
    pdf.font('Helvetica').fontSize(10).fillColor(ink).text(doc.number, L + 280, pdf.y, { width: W - 280, align: 'right' });
    if (doc.status) {
      pdf.fontSize(8).fillColor(muted).text(doc.status.replace(/_/g, ' '), L + 280, pdf.y + 2, { width: W - 280, align: 'right' });
    }
    let y = Math.max(leftBottom, pdf.y) + 28;

    // Party (left) and document facts (right).
    const partyTop = y;
    pdf.font('Helvetica-Bold').fontSize(8).fillColor(muted).text(doc.party.label.toUpperCase(), L, y);
    pdf.fontSize(11).fillColor(ink).text(doc.party.name, L, pdf.y + 3, { width: 260 });
    pdf.font('Helvetica').fontSize(9).fillColor('#374151');
    for (const line of doc.party.lines ?? []) if (line) pdf.text(line, L, pdf.y + 1, { width: 260 });
    const partyBottom = pdf.y;
    doc.meta.forEach(([k, v], i) => {
      const rowY = partyTop + i * 15;
      pdf.font('Helvetica').fontSize(9).fillColor(muted).text(k, R - 220, rowY, { width: 100 });
      pdf.fillColor(ink).text(v, R - 120, rowY, { width: 120, align: 'right' });
    });
    y = Math.max(partyBottom, partyTop + doc.meta.length * 15) + 24;

    // Lines table with repeating header on page breaks.
    const drawHeader = (top: number) => {
      pdf.rect(L, top, W, 20).fill('#f3f4f6');
      let x = L;
      pdf.font('Helvetica-Bold').fontSize(8).fillColor(muted);
      for (const c of doc.columns) {
        pdf.text(c.header.toUpperCase(), x + 6, top + 6, { width: c.width - 12, align: c.align ?? 'left' });
        x += c.width;
      }
      return top + 20;
    };
    y = drawHeader(y);
    for (const row of doc.rows) {
      pdf.font('Helvetica').fontSize(9);
      const textHeight = Math.max(...doc.columns.map((c, i) => pdf.heightOfString(row.cells[i] ?? '', { width: c.width - 12 })));
      const h = textHeight + (row.sub ? 11 : 0) + 12;
      if (y + h > 760) {
        pdf.addPage();
        y = drawHeader(48);
        pdf.font('Helvetica').fontSize(9);
      }
      let x = L;
      doc.columns.forEach((c, i) => {
        pdf.font('Helvetica').fontSize(9).fillColor(ink).text(row.cells[i] ?? '', x + 6, y + 6, { width: c.width - 12, align: c.align ?? 'left' });
        if (i === 0 && row.sub) pdf.fontSize(7.5).fillColor(muted).text(row.sub, x + 6, pdf.y + 1, { width: c.width - 12 });
        x += c.width;
      });
      y += h;
      pdf.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor('#e5e7eb').stroke();
    }

    // Totals block.
    y += 12;
    if (y + doc.totals.length * 20 > 780) {
      pdf.addPage();
      y = 48;
    }
    for (const [label, value, strong] of doc.totals) {
      if (strong) pdf.moveTo(R - 220, y - 4).lineTo(R, y - 4).lineWidth(0.75).strokeColor('#9ca3af').stroke();
      pdf.font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(strong ? 10.5 : 9.5).fillColor(strong ? ink : muted).text(label, R - 220, y, { width: 110 });
      pdf.fillColor(ink).text(value, R - 110, y, { width: 110, align: 'right' });
      y += strong ? 20 : 16;
    }

    if (doc.notes) {
      y += 16;
      if (y > 740) {
        pdf.addPage();
        y = 48;
      }
      pdf.font('Helvetica-Bold').fontSize(8).fillColor(muted).text('NOTES', L, y);
      pdf.font('Helvetica').fontSize(9).fillColor(ink).text(doc.notes, L, pdf.y + 4, { width: W });
    }

    // Footer on every page (bottom margin removed so it doesn't trigger a new page).
    const range = pdf.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      pdf.switchToPage(i);
      pdf.page.margins.bottom = 0;
      pdf
        .font('Helvetica')
        .fontSize(8)
        .fillColor(muted)
        .text(`${company.name} · ${doc.title} ${doc.number} · Page ${i + 1} of ${range.count}`, L, 810, { width: W, align: 'center', lineBreak: false });
    }

    pdf.end();
    return done;
  }
}
