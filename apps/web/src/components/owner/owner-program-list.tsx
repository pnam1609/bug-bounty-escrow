'use client';

import {
  ownerProgramListQuerySchema,
  programListResponseSchema,
  type ProgramSummary,
} from '@bug-bounty-escrow/shared';
import {
  Button,
  Callout,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@bug-bounty-escrow/ui';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { WorkspaceHeading } from './owner-workspace';
import { fieldId, formatUsdc } from './program-draft';
import { apiRequest } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'awaiting_funding', label: 'Awaiting funding' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'expired', label: 'Expired' },
  { value: 'closed', label: 'Closed' },
] as const;

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'name', label: 'Name' },
  { value: 'deadline', label: 'Deadline' },
] as const;

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-col gap-sm rounded-lg border border-border bg-surface p-lg">
      <p className="text-label-sm uppercase text-text-muted">{label}</p>
      <p className="text-h1 text-text">{value}</p>
    </div>
  );
}

function sumAmounts(rows: readonly ProgramSummary[], pick: (row: ProgramSummary) => string | null) {
  return rows.reduce((total, row) => {
    const value = pick(row);
    return value === null ? total : total + Number(value);
  }, 0);
}

export function OwnerProgramList() {
  const { session } = useAuth();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>('all');
  const [sort, setSort] = useState<string>('newest');

  const filters = ownerProgramListQuerySchema.parse({
    page: 1,
    limit: 20,
    ...(search.trim() === '' ? {} : { search: search.trim() }),
    ...(status === 'all' ? {} : { status }),
    sort,
  });

  const query = useQuery({
    queryKey: queryKeys.programs({ owner: true, ...filters }),
    enabled: session !== null,
    queryFn: () => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined) params.set(key, String(value));
      }

      // The owner workspace listing is a separate endpoint: `/api/programs` is public-only.
      return apiRequest(`/api/owner/programs?${params}`, programListResponseSchema, {
        token: session?.access_token,
      });
    },
  });

  const rows = query.data?.data ?? [];
  const activeCount = rows.filter((row) => row.status === 'active').length;
  const draftCount = rows.filter(
    (row) => row.status === 'draft' || row.status === 'awaiting_funding',
  ).length;

  return (
    <div className="flex flex-col gap-2xl">
      <WorkspaceHeading
        badge={
          <Button asChild size="lg">
            <Link href="/owner/programs/new">
              <Plus aria-hidden="true" className="size-4" />
              Create program
            </Link>
          </Button>
        }
        breadcrumb="Owner workspace"
        subtitle="Publish, fund and manage bounty programs."
        title="Programs"
      />

      <div className="grid grid-cols-1 gap-xl sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Active programs" value={String(activeCount)} />
        <Stat label="Drafts in progress" value={String(draftCount)} />
        <Stat
          label="Escrow funded"
          value={formatUsdc(String(sumAmounts(rows, (row) => row.totalPool)))}
        />
        <Stat
          label="Paid rewards"
          value={formatUsdc(String(sumAmounts(rows, (row) => row.totalPaid)))}
        />
      </div>

      <section className="flex flex-col gap-xl rounded-lg border border-border bg-surface p-2xl shadow-subtle">
        <div className="flex flex-wrap items-end gap-lg">
          <h2 className="me-auto text-label-sm uppercase text-text-muted">Your programs</h2>
          <Field className="w-64" htmlFor={fieldId('owner.search')} label="Search">
            <Input
              id={fieldId('owner.search')}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name"
              type="search"
              value={search}
            />
          </Field>
          <Field className="w-48" htmlFor={fieldId('owner.status')} label="Status">
            <Select onValueChange={setStatus} value={status}>
              <SelectTrigger id={fieldId('owner.status')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field className="w-40" htmlFor={fieldId('owner.sort')} label="Sort">
            <Select onValueChange={setSort} value={sort}>
              <SelectTrigger id={fieldId('owner.sort')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        {query.isError ? (
          <Callout title="Programs could not be loaded" variant="danger">
            <button className="underline" onClick={() => void query.refetch()} type="button">
              Try again
            </button>
          </Callout>
        ) : null}

        {query.isLoading ? (
          <p aria-live="polite" className="text-body-sm text-text-muted">
            Loading programs…
          </p>
        ) : null}

        {!query.isLoading && rows.length === 0 ? (
          <div className="flex flex-col items-start gap-lg rounded-md border border-dashed border-border bg-surface-raised p-2xl">
            <h3 className="text-h2 text-text">Create your first program</h3>
            <p className="text-body-sm text-text-muted">
              Publish a scope, set USDC reward tiers and fund escrow before researchers can start.
            </p>
            <Button asChild size="lg">
              <Link href="/owner/programs/new">Create program</Link>
            </Button>
          </div>
        ) : null}

        {rows.length === 0 ? null : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Program</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Escrow pool</TableHead>
                <TableHead>Maximum bounty</TableHead>
                <TableHead>Deadline</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link
                      className="text-label-lg text-text underline-offset-4 hover:underline"
                      href={`/owner/programs/${row.id}/edit`}
                    >
                      {row.name}
                    </Link>
                    <p className="text-label-md text-text-muted">{row.shortSummary}</p>
                  </TableCell>
                  <TableCell>
                    <StatusBadge kind="program" status={row.status} />
                  </TableCell>
                  <TableCell>
                    {Number(row.totalPool) === 0 ? 'Not funded' : formatUsdc(row.totalPool)}
                  </TableCell>
                  <TableCell>{formatUsdc(row.maxBounty)}</TableCell>
                  <TableCell>
                    {row.deadline === undefined ? 'Ongoing' : row.deadline.slice(0, 10)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
