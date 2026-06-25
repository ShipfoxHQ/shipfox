import type {TriggerEventFacetItemDto, TriggerEventOutcomeDto} from '@shipfox/api-triggers-dto';
import {
  Button,
  Combobox,
  type ComboboxOption,
  type DateRange,
  DateRangePicker,
} from '@shipfox/react-ui';
import type {TriggerEventFilters} from '#hooks/api/trigger-events.js';
import {getTriggerOutcomeVisual} from './trigger-outcome.js';

// The four DESIGN.md §9 event-level states. `errored` has no option of its own: the row
// summary already renders it as "Failed", so the Failed option selects both `failed` and
// `errored` (otherwise filtering Failed would silently hide events the list shows as failed).
const OUTCOME_FILTERS: {outcome: TriggerEventOutcomeDto; selects: TriggerEventOutcomeDto[]}[] = [
  {outcome: 'received', selects: ['received']},
  {outcome: 'routed', selects: ['routed']},
  {outcome: 'discarded', selects: ['discarded']},
  {outcome: 'failed', selects: ['failed', 'errored']},
];

const OUTCOME_OPTIONS: ComboboxOption[] = OUTCOME_FILTERS.map(({outcome}) => ({
  value: outcome,
  label: getTriggerOutcomeVisual(outcome).label,
}));

function toOptions(facets: TriggerEventFacetItemDto[] | undefined): ComboboxOption[] {
  return (facets ?? []).map((facet) => ({
    value: facet.value,
    label: `${facet.value} (${facet.count})`,
  }));
}

interface EventsFilterBarProps {
  filters: TriggerEventFilters;
  onFiltersChange: (patch: Partial<TriggerEventFilters>) => void;
  sources: TriggerEventFacetItemDto[] | undefined;
  events: TriggerEventFacetItemDto[] | undefined;
  hasActiveFilters: boolean;
  onClear: () => void;
}

export function EventsFilterBar({
  filters,
  onFiltersChange,
  sources,
  events,
  hasActiveFilters,
  onClear,
}: EventsFilterBarProps) {
  const dateRange: DateRange | undefined =
    filters.from || filters.to
      ? {
          start: filters.from ? new Date(filters.from) : undefined,
          end: filters.to ? new Date(filters.to) : undefined,
        }
      : undefined;

  const selectedOutcomes = new Set(filters.outcome ?? []);

  function isFilterActive(selects: TriggerEventOutcomeDto[]): boolean {
    return selects.some((outcome) => selectedOutcomes.has(outcome));
  }

  const outcomeValue = OUTCOME_FILTERS.filter(({selects}) => isFilterActive(selects)).map(
    ({outcome}) => outcome,
  );

  function handleOutcomeValue(values: string[]) {
    const next = OUTCOME_FILTERS.filter(({outcome}) => values.includes(outcome)).flatMap(
      ({selects}) => selects,
    );
    onFiltersChange({outcome: next.length > 0 ? next : undefined});
  }

  function handleDateRange(range: DateRange | undefined) {
    const from = range?.start ? new Date(range.start).toISOString() : undefined;
    let to: string | undefined;
    if (range?.end) {
      // The backend filters received_at <= to; extend to end-of-day so the picked end
      // date is inclusive rather than cutting off at its midnight.
      const end = new Date(range.end);
      end.setHours(23, 59, 59, 999);
      to = end.toISOString();
    }
    onFiltersChange({from, to});
  }

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-8 border-b border-border-neutral-base bg-background-neutral-base px-8 py-12">
      <DateRangePicker
        size="small"
        {...(dateRange ? {dateRange} : {})}
        onDateRangeSelect={handleDateRange}
        onClear={() => onFiltersChange({from: undefined, to: undefined})}
        placeholder="Any date"
      />
      <Combobox
        multiple
        size="small"
        options={toOptions(sources)}
        value={filters.source ?? []}
        onValueChange={(value) => onFiltersChange({source: value.length > 0 ? value : undefined})}
        placeholder="All sources"
        emptyState="No sources yet"
        className="w-160"
        maxVisibleChips={1}
      />
      <Combobox
        multiple
        size="small"
        options={toOptions(events)}
        value={filters.event ?? []}
        onValueChange={(value) => onFiltersChange({event: value.length > 0 ? value : undefined})}
        placeholder="All events"
        emptyState="No events yet"
        className="w-160"
        maxVisibleChips={1}
      />
      <Combobox
        multiple
        size="small"
        aria-label="Filter by outcome"
        options={OUTCOME_OPTIONS}
        value={outcomeValue}
        onValueChange={handleOutcomeValue}
        placeholder="All outcomes"
        emptyState="No outcomes"
        className="w-220"
        maxVisibleChips={2}
      />
      {hasActiveFilters ? (
        <Button
          type="button"
          size="2xs"
          variant="transparentMuted"
          onClick={onClear}
          className="ml-auto"
        >
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
