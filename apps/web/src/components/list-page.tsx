'use client';

import { ReactNode, useEffect, useState } from 'react';
import { humanize } from '@/lib/format';
import { useDebounced, useList, useOptions } from '@/lib/hooks';
import { Card, Column, DataTable, PageHeader, Pagination, SearchInput, Select } from './ui';

type Option = string | { value: string; label: string };

/** Search + status filter + paginated table over a standard `{ items, total }` endpoint. */
export function ListPage<T extends { id?: string }>({
  title,
  subtitle,
  endpoint,
  columns,
  statuses,
  allStatusesLabel = 'All statuses',
  defaultStatus = '',
  rowHref,
  onRowClick,
  actions,
  filters,
  query,
  searchPlaceholder,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  endpoint: string;
  columns: Column<T>[];
  statuses?: Option[];
  allStatusesLabel?: string;
  defaultStatus?: string;
  rowHref?: (row: T) => string;
  onRowClick?: (row: T) => void;
  children?: ReactNode;
  actions?: ReactNode;
  filters?: ReactNode;
  query?: Record<string, string | undefined>;
  searchPlaceholder?: string;
}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(() => new URLSearchParams(window.location.search).get('status') ?? defaultStatus);
  const q = useDebounced(search);

  useEffect(() => setPage(1), [q, status, JSON.stringify(query)]);

  const { data, isFetching } = useList<T>(endpoint, { page, pageSize: 25, search: q || undefined, status: status || undefined, ...query });

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} actions={actions} />
      {children}
      <Card padded={false}>
        <div className="flex flex-col gap-2 border-b border-slate-100 p-3 sm:flex-row sm:items-center">
          <SearchInput value={search} onChange={setSearch} placeholder={searchPlaceholder} />
          {statuses && (
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-48" aria-label="Status filter">
              <option value="">{allStatusesLabel}</option>
              {statuses.map((s) => {
                const o = typeof s === 'string' ? { value: s, label: humanize(s) } : s;
                return (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                );
              })}
            </Select>
          )}
          {filters}
        </div>
        <DataTable columns={columns} rows={data?.items ?? []} loading={isFetching && !data} rowHref={rowHref} onRowClick={onRowClick} />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>
    </>
  );
}

export function EntitySelect<T extends { id: string }>({
  endpoint,
  value,
  onChange,
  getLabel,
  placeholder = 'Select…',
  query,
  filter,
  required,
  disabled,
}: {
  endpoint: string;
  value: string;
  onChange: (id: string, item?: T) => void;
  getLabel: (item: T) => string;
  placeholder?: string;
  query?: Record<string, string>;
  filter?: (item: T) => boolean;
  required?: boolean;
  disabled?: boolean;
}) {
  const options = useOptions<T>(endpoint, query);
  const visible = filter ? options.filter((o) => filter(o) || o.id === value) : options;
  return (
    <Select
      value={value}
      required={required}
      disabled={disabled}
      onChange={(e) =>
        onChange(
          e.target.value,
          options.find((o) => o.id === e.target.value),
        )
      }
    >
      <option value="">{placeholder}</option>
      {visible.map((o) => (
        <option key={o.id} value={o.id}>
          {getLabel(o)}
        </option>
      ))}
    </Select>
  );
}
