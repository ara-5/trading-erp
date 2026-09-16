'use client';

import { Check, ListChecks, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { LeaveRequestModal, LeaveTypesModal } from '@/components/hr-modals';
import { ListPage } from '@/components/list-page';
import { Button, DescriptionList, Modal, StatusBadge } from '@/components/ui';
import { post } from '@/lib/api';
import { date, num } from '@/lib/format';
import { useAction } from '@/lib/hooks';

interface LeaveRequest {
  id: string;
  startDate: string;
  endDate: string;
  days: string;
  reason: string | null;
  status: string;
  employee: { id: string; code: string; firstName: string; lastName: string };
  leaveType: { name: string; isPaid: boolean };
  approvedBy: { name: string } | null;
}

export default function LeavePage() {
  const [requesting, setRequesting] = useState(false);
  const [typesOpen, setTypesOpen] = useState(false);
  const [selected, setSelected] = useState<LeaveRequest | null>(null);

  return (
    <>
      <ListPage<LeaveRequest>
        title="Leave"
        endpoint="/hr/leave"
        searchPlaceholder="Search employee…"
        statuses={['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']}
        onRowClick={setSelected}
        actions={
          <>
            <Button variant="secondary" onClick={() => setTypesOpen(true)}>
              <ListChecks className="size-4" /> Leave types
            </Button>
            <Button onClick={() => setRequesting(true)}>
              <Plus className="size-4" /> Request leave
            </Button>
          </>
        }
        columns={[
          { key: 'employee', header: 'Employee', cell: (l) => <span className="font-medium text-slate-900 dark:text-slate-100">{l.employee.firstName} {l.employee.lastName}</span> },
          { key: 'type', header: 'Type', cell: (l) => l.leaveType.name },
          { key: 'from', header: 'From', cell: (l) => date(l.startDate) },
          { key: 'to', header: 'To', cell: (l) => date(l.endDate) },
          { key: 'days', header: 'Working days', align: 'right', cell: (l) => num(l.days) },
          { key: 'status', header: 'Status', cell: (l) => <StatusBadge status={l.status} /> },
        ]}
      />
      {requesting && <LeaveRequestModal onClose={() => setRequesting(false)} />}
      {typesOpen && <LeaveTypesModal onClose={() => setTypesOpen(false)} />}
      {selected && <DecisionModal request={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function DecisionModal({ request, onClose }: { request: LeaveRequest; onClose: () => void }) {
  const decide = useAction((action: 'approve' | 'reject' | 'cancel') => post(`/hr/leave/${request.id}/${action}`), { success: 'Leave request updated', onSuccess: onClose });
  return (
    <Modal
      open
      onClose={onClose}
      title={`${request.employee.firstName} ${request.employee.lastName} — ${request.leaveType.name}`}
      footer={
        <>
          {(request.status === 'PENDING' || request.status === 'APPROVED') && (
            <Button variant="ghost" className="mr-auto" onClick={() => decide.mutate('cancel')}>
              Cancel request
            </Button>
          )}
          {request.status === 'PENDING' ? (
            <>
              <Button variant="danger" loading={decide.isPending} onClick={() => decide.mutate('reject')}>
                <X className="size-4" /> Reject
              </Button>
              <Button loading={decide.isPending} onClick={() => decide.mutate('approve')}>
                <Check className="size-4" /> Approve
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          )}
        </>
      }
    >
      <DescriptionList
        items={[
          ['Status', <StatusBadge key="s" status={request.status} />],
          ['Dates', `${date(request.startDate)} – ${date(request.endDate)}`],
          ['Working days', num(request.days)],
          ['Pay', request.leaveType.isPaid ? 'Paid' : 'Unpaid (deducted in payroll)'],
          ['Reason', request.reason],
          ['Decided by', request.approvedBy?.name],
        ]}
      />
    </Modal>
  );
}
