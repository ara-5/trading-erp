'use client';

import { FileScan, Loader2, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { DocForm, DocInitial, orNull } from '@/components/doc-form';
import { LineDraft, linesPayload } from '@/components/line-items';
import { Button, Card } from '@/components/ui';
import { api, errorMessage, Paged, post } from '@/lib/api';
import { today } from '@/lib/format';
import { useToast } from '@/lib/toast';

const billLines = (lines: LineDraft[]) => linesPayload(lines, { account: true }).map((l) => ({ ...l, description: l.description ?? '' }));

interface ExtractedBill {
  supplierName: string | null;
  reference: string | null;
  date: string | null;
  dueDate: string | null;
  lines: { description: string; quantity: number; unitPrice: number; taxRatePct: number }[];
}

const ACCEPTED = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 8 * 1024 * 1024;

/** Reads a File as base64 (no data: URL prefix). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function NewBillPage() {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [extracting, setExtracting] = useState(false);
  const [initial, setInitial] = useState<DocInitial | undefined>(undefined);
  const [formKey, setFormKey] = useState(0);

  async function onFile(file: File) {
    if (!ACCEPTED.includes(file.type)) {
      toast({ type: 'error', message: 'Upload a PDF, PNG, JPEG or WEBP file.' });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast({ type: 'error', message: 'That file is larger than 8MB.' });
      return;
    }
    setExtracting(true);
    try {
      const fileBase64 = await fileToBase64(file);
      const extracted = await post<ExtractedBill>('/copilot/extract-bill', { fileBase64, mediaType: file.type });

      let partyId = '';
      if (extracted.supplierName) {
        const matches = await api<Paged<{ id: string }>>('/purchasing/suppliers', { query: { search: extracted.supplierName, pageSize: 2 } });
        if (matches.total === 1) partyId = matches.items[0].id;
      }

      setInitial({
        partyId,
        date: extracted.date ?? today(),
        secondDate: extracted.dueDate ?? '',
        reference: extracted.reference ?? '',
        lines: extracted.lines.map((l) => ({
          productId: null,
          accountId: null,
          description: l.description,
          quantity: String(l.quantity),
          unitPrice: String(l.unitPrice),
          taxRate: String(l.taxRatePct),
        })),
      });
      setFormKey((k) => k + 1);

      if (extracted.supplierName && !partyId) {
        toast({ type: 'success', message: `Filled in the lines. Detected supplier "${extracted.supplierName}" — please select it above.` });
      } else {
        toast({ type: 'success', message: 'Bill details filled in from the document — please review before saving.' });
      }
    } catch (e) {
      toast({ type: 'error', message: errorMessage(e) });
    } finally {
      setExtracting(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <>
      <Card className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
              <Sparkles className="size-4.5" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Extract from a scanned bill</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Upload a PDF or photo and the AI copilot will fill in the fields below.</p>
            </div>
          </div>
          <Button type="button" variant="secondary" loading={extracting} onClick={() => fileInput.current?.click()}>
            {!extracting && <FileScan className="size-4" />}
            {extracting ? 'Reading document…' : 'Choose file'}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED.join(',')}
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
        </div>
        {extracting && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <Loader2 className="size-3 animate-spin" /> This can take a few seconds for longer documents.
          </p>
        )}
      </Card>

      <DocForm
        key={formKey}
        title="New bill"
        back="/purchasing/bills"
        config={{
          party: 'supplier',
          secondDate: 'Due date',
          reference: 'Supplier invoice #',
          priceField: 'costPrice',
          allowAccount: true,
          productFilter: (p) => !p.trackInventory,
        }}
        initial={initial}
        detailHref={(id) => `/purchasing/bills/${id}`}
        save={(h, lines) =>
          post('/purchasing/bills', {
            supplierId: h.partyId,
            supplierRef: orNull(h.reference),
            date: h.date,
            dueDate: orNull(h.secondDate),
            notes: orNull(h.notes),
            lines: billLines(lines),
          })
        }
      />
    </>
  );
}
