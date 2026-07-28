'use client';

import {
  commentListResponseSchema,
  createCommentRequestSchema,
  createCommentResponseSchema,
} from '@bug-bounty-escrow/shared';
import {
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Textarea,
} from '@bug-bounty-escrow/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { describeReportError, formatTimestamp } from './report-format';
import { ReportLoadError } from './report-states';
import { apiRequest } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/*
 * No Figma source — the private discussion on a report.
 *
 * The API returns an author id and nothing else, so the byline is derived rather than invented:
 * the report's own `researcherId` tells us which side of the conversation a message came from, and
 * the viewer's id turns their own messages into "You". No display names are fabricated.
 *
 * The thread is private disclosure content and is only mounted inside a guarded route.
 */

const MAX_COMMENT_LENGTH = 10_000;
const PAGE_SIZE = 50;

export interface CommentThreadProps {
  readonly principalId: string;
  readonly reportId: string;
  readonly researcherId: string;
  readonly token: string | undefined;
  readonly viewerId: string | undefined;
}

export function CommentThread({
  principalId,
  reportId,
  researcherId,
  token,
  viewerId,
}: CommentThreadProps) {
  const client = useQueryClient();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: queryKeys.comments(principalId, reportId),
    queryFn: () =>
      apiRequest(
        `/api/reports/${encodeURIComponent(reportId)}/comments?page=1&limit=${String(PAGE_SIZE)}`,
        commentListResponseSchema,
        { token },
      ),
  });

  const mutation = useMutation({
    mutationFn: (value: string) =>
      apiRequest(
        `/api/reports/${encodeURIComponent(reportId)}/comments`,
        createCommentResponseSchema,
        { method: 'POST', token, body: { body: value } },
      ),
    onSuccess: async () =>
      client.invalidateQueries({ queryKey: queryKeys.comments(principalId, reportId) }),
  });

  function authorOf(authorId: string): string {
    if (viewerId !== undefined && authorId === viewerId) return 'You';

    return authorId === researcherId ? 'Researcher' : 'Reviewer';
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = createCommentRequestSchema.safeParse({ body });
    if (!parsed.success) {
      setError('Write a message before posting.');
      return;
    }

    try {
      await mutation.mutateAsync(parsed.data.body);
      setBody('');
    } catch (cause) {
      setError(describeReportError(cause, 'Your message was not posted. Try again.'));
    }
  }

  const comments = query.data?.data ?? [];

  return (
    <Card className="gap-xl" padding="lg">
      <CardHeader>
        <CardTitle>Private discussion</CardTitle>
        <CardDescription>
          Messages here reach the researcher and the program&rsquo;s authorized reviewers. Keep
          sensitive follow-up in this thread.
        </CardDescription>
      </CardHeader>

      {query.isPending ? (
        <p aria-live="polite" className="text-body-sm text-text-muted">
          Loading the discussion…
        </p>
      ) : query.isError ? (
        <ReportLoadError
          detail="The report itself is unaffected."
          onRetry={() => void query.refetch()}
          title="We couldn’t load the discussion"
        />
      ) : comments.length === 0 ? (
        <p className="text-body-sm text-text-muted">
          No messages yet. Anything you post is visible to both sides of this report.
        </p>
      ) : (
        <ol className="flex flex-col gap-md">
          {comments.map((comment) => (
            <li
              className="flex flex-col gap-xs rounded-md border border-border bg-surface-raised p-lg"
              key={comment.id}
            >
              <p className="flex flex-wrap items-baseline gap-sm">
                <span className="text-label-lg font-semibold text-text">
                  {authorOf(comment.authorId)}
                </span>
                <span className="text-label-sm text-text-muted">
                  {formatTimestamp(comment.createdAt)}
                </span>
              </p>
              {comment.deleted ? (
                <p className="text-body-sm italic text-text-muted">This message was removed.</p>
              ) : (
                <p className="whitespace-pre-wrap break-words text-body-sm text-text">
                  {comment.body}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}

      <form className="flex flex-col gap-lg" onSubmit={(event) => void submit(event)}>
        <Field
          counter={`${String(body.length)} / ${String(MAX_COMMENT_LENGTH)}`}
          error={error ?? undefined}
          label="Add a message"
        >
          <Textarea
            maxLength={MAX_COMMENT_LENGTH}
            name="body"
            onChange={(event) => setBody(event.target.value)}
            placeholder="Answer a question, add context, or ask what is still needed."
            rows={4}
            value={body}
          />
        </Field>
        <Button
          className="self-start"
          disabled={body.trim() === ''}
          loading={mutation.isPending}
          loadingLabel="Posting your message"
          type="submit"
        >
          Post message
        </Button>
      </form>
    </Card>
  );
}
