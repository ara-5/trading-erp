import type { DocLine } from '@/components/line-items';

type EditableLine = DocLine & { productId: string | null; discountPct: string };

export interface QuotationDetail {
  id: string;
  number: string;
  customerId: string;
  date: string;
  validUntil: string | null;
  status: string;
  notes: string | null;
  subtotal: string;
  taxTotal: string;
  total: string;
  customer: { id: string; name: string; code: string; email: string | null };
  lines: EditableLine[];
  salesOrders: { id: string; number: string; status: string }[];
}

export interface SalesOrderDetail {
  id: string;
  number: string;
  customerId: string;
  warehouseId: string;
  date: string;
  status: string;
  notes: string | null;
  subtotal: string;
  taxTotal: string;
  total: string;
  customer: { id: string; name: string; code: string };
  warehouse: { id: string; code: string; name: string };
  quotation: { id: string; number: string } | null;
  lines: (EditableLine & { product: { sku: string; name: string; uom: string; trackInventory: boolean } })[];
  invoices: { id: string; number: string; status: string; total: string }[];
}

export interface Payment {
  id: string;
  number: string;
  date: string;
  amount: string;
  method: string;
  reference: string | null;
}

export interface InvoiceDetail {
  id: string;
  number: string;
  customerId: string;
  date: string;
  dueDate: string;
  status: string;
  notes: string | null;
  subtotal: string;
  taxTotal: string;
  total: string;
  amountPaid: string;
  salesOrderId: string | null;
  journalEntryId: string | null;
  customer: { id: string; name: string; code: string; email: string | null; address: string | null; taxNumber: string | null };
  salesOrder: { id: string; number: string } | null;
  lines: EditableLine[];
  payments: Payment[];
}

export interface PurchaseOrderDetail {
  id: string;
  number: string;
  supplierId: string;
  warehouseId: string;
  date: string;
  expectedDate: string | null;
  status: string;
  notes: string | null;
  subtotal: string;
  taxTotal: string;
  total: string;
  supplier: { id: string; name: string; code: string };
  warehouse: { id: string; code: string; name: string };
  lines: (EditableLine & { product: { sku: string; name: string; uom: string; trackInventory: boolean } })[];
  bills: { id: string; number: string; status: string; total: string }[];
}

export interface BillDetail {
  id: string;
  number: string;
  supplierId: string;
  supplierRef: string | null;
  date: string;
  dueDate: string;
  status: string;
  notes: string | null;
  subtotal: string;
  taxTotal: string;
  total: string;
  amountPaid: string;
  purchaseOrderId: string | null;
  supplier: { id: string; name: string; code: string };
  purchaseOrder: { id: string; number: string } | null;
  lines: (EditableLine & { accountId: string | null })[];
  payments: Payment[];
}
