'use client';

import { Input, Popover, PopoverContent, PopoverTrigger, cn } from '@bug-bounty-escrow/ui';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
} from 'react';

const CALENDAR_DAY_COUNT = 42;
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

export interface DatePickerProps extends Omit<
  ComponentPropsWithoutRef<'input'>,
  'onChange' | 'size' | 'type' | 'value'
> {
  /** The draft's date-only representation, `yyyy-mm-dd`, or an empty string. */
  value: string;
  onChange: (value: string) => void;
}

/** Parse only the date-only format used by the program draft. */
export function parseDatePickerValue(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day, 12);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return undefined;
  }
  return parsed;
}

/** Format a local calendar date without introducing a timezone shift. */
export function formatDatePickerValue(date: Date): string {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) =>
      index === 0 ? String(part).padStart(4, '0') : String(part).padStart(2, '0'),
    )
    .join('-');
}

/** Return the six-week grid shown by the picker, including adjacent-month days. */
export function getDatePickerDays(viewMonth: Date): Date[] {
  const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1, 12);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: CALENDAR_DAY_COUNT }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12);
}

function todayDate(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
}

function shiftMonth(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1, 12);
}

function shiftDay(date: Date, amount: number): Date {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + amount);
  return shifted;
}

function sameDay(left: Date, right: Date): boolean {
  return formatDatePickerValue(left) === formatDatePickerValue(right);
}

function displayDate(value: string): string {
  const parsed = parseDatePickerValue(value);
  if (parsed === undefined) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  }).format(parsed);
}

export function DatePicker({ className, id, onChange, value, ...inputProps }: DatePickerProps) {
  const selectedDate = parseDatePickerValue(value);
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState<Date>(() => startOfMonth(selectedDate ?? todayDate()));
  const dayRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const today = todayDate();

  useEffect(() => {
    if (selectedDate !== undefined) setViewMonth(startOfMonth(selectedDate));
  }, [value]);

  const days = useMemo(() => getDatePickerDays(viewMonth), [viewMonth]);
  const monthLabel = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(viewMonth);
  const headingId = `${id ?? 'date-picker'}-month`;

  function selectDate(date: Date) {
    if (date.getTime() < today.getTime()) return;
    onChange(formatDatePickerValue(date));
    setOpen(false);
  }

  function moveFocus(date: Date) {
    const dateValue = formatDatePickerValue(date);
    const target = dayRefs.current[dateValue];
    if (target === null || target === undefined) return;
    target.focus();
    setViewMonth((current) =>
      current.getMonth() === date.getMonth() && current.getFullYear() === date.getFullYear()
        ? current
        : startOfMonth(date),
    );
  }

  function onDayKeyDown(event: KeyboardEvent<HTMLButtonElement>, date: Date) {
    const offset = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    }[event.key];

    if (offset !== undefined) {
      event.preventDefault();
      moveFocus(shiftDay(date, offset));
      return;
    }
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault();
      const month = shiftMonth(date, event.key === 'PageUp' ? -1 : 1);
      setViewMonth(month);
      moveFocus(month);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      moveFocus(shiftDay(date, event.key === 'Home' ? -date.getDay() : 6 - date.getDay()));
    }
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <div className="relative w-full">
        <Input
          {...inputProps}
          {...(inputProps['aria-invalid'] === undefined
            ? {}
            : { 'aria-invalid': inputProps['aria-invalid'] })}
          aria-haspopup="dialog"
          className={cn('pr-14', className)}
          id={id}
          onClick={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === ' ') {
              event.preventDefault();
              setOpen(true);
            }
          }}
          placeholder={inputProps.placeholder ?? 'mm/dd/yyyy'}
          readOnly
          size="lg"
          value={displayDate(value)}
        />
        <PopoverTrigger asChild>
          <button
            aria-label={open ? 'Close calendar' : 'Open calendar'}
            aria-expanded={open}
            className="absolute inset-y-0 end-0 inline-flex min-h-11 min-w-11 items-center justify-center rounded-e-md text-text-muted hover:text-text focus-visible:text-text"
            type="button"
          >
            <CalendarDays aria-hidden="true" className="size-4" />
          </button>
        </PopoverTrigger>
      </div>

      <PopoverContent
        aria-label="Choose submission deadline"
        className="w-[20rem] p-md"
        onOpenAutoFocus={(event) => event.preventDefault()}
        role="dialog"
      >
        <div className="flex items-center justify-between gap-sm">
          <p aria-live="polite" className="text-label-lg text-text" id={headingId}>
            {monthLabel}
          </p>
          <div className="flex items-center gap-xs">
            <button
              aria-label="Previous month"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-text-muted hover:bg-surface hover:text-text"
              onClick={() => setViewMonth((current) => shiftMonth(current, -1))}
              type="button"
            >
              <ChevronLeft aria-hidden="true" className="size-4" />
            </button>
            <button
              aria-label="Next month"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-text-muted hover:bg-surface hover:text-text"
              onClick={() => setViewMonth((current) => shiftMonth(current, 1))}
              type="button"
            >
              <ChevronRight aria-hidden="true" className="size-4" />
            </button>
          </div>
        </div>

        <section aria-labelledby={headingId} className="mt-sm grid grid-cols-7 gap-xs">
          {WEEKDAYS.map((weekday) => (
            <span
              className="flex min-h-11 items-center justify-center text-label-sm text-text-muted"
              key={weekday}
            >
              {weekday}
            </span>
          ))}
          {days.map((date) => {
            const dateValue = formatDatePickerValue(date);
            const isPast = date.getTime() < today.getTime();
            const isCurrentMonth = date.getMonth() === viewMonth.getMonth();
            const isSelected = selectedDate !== undefined && sameDay(date, selectedDate);
            return (
              <button
                aria-current={sameDay(date, today) ? 'date' : undefined}
                aria-label={date.toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
                aria-selected={isSelected}
                className={cn(
                  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-label-md tabular-nums',
                  'hover:bg-surface hover:text-text focus-visible:bg-surface',
                  isCurrentMonth ? 'text-text' : 'text-text-muted',
                  isSelected && 'bg-primary text-primary-contrast hover:bg-primary-hover',
                  isPast && 'cursor-not-allowed text-text-disabled hover:bg-transparent',
                )}
                data-date={dateValue}
                disabled={isPast}
                key={dateValue}
                onClick={() => selectDate(date)}
                onKeyDown={(event) => onDayKeyDown(event, date)}
                ref={(element) => {
                  dayRefs.current[dateValue] = element;
                }}
                type="button"
              >
                {date.getDate()}
              </button>
            );
          })}
        </section>

        <div className="mt-md flex items-center justify-between border-t border-border pt-sm">
          <button
            className="inline-flex min-h-11 items-center rounded-md px-sm text-label-md text-text-muted hover:bg-surface hover:text-text"
            onClick={() => onChange('')}
            type="button"
          >
            Clear
          </button>
          <button
            className="inline-flex min-h-11 items-center rounded-md px-sm text-label-md text-primary hover:bg-surface"
            onClick={() => selectDate(today)}
            type="button"
          >
            Today
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
