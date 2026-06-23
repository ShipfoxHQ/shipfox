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

// The event-level taxonomy is the four DESIGN.md §9 states; `errored` is decision-level
// and never offered as a filter chip.
const OUTCOME_FILTERS: TriggerEventOutcomeDto[] = ['received', 'routed', 'discarded', 'failed'];

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

  function toggleOutcome(outcome: TriggerEventOutcomeDto) {
    const next = new Set(selectedOutcomes);
    if (next.has(outcome)) next.delete(outcome);
    else next.add(outcome);
    onFiltersChange({outcome: next.size > 0 ? [...next] : undefined});
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
        options={toOptions(sources)}
        value={filters.source ?? ''}
        onValueChange={(value) => onFiltersChange({source: value || undefined})}
        placeholder="All sources"
        searchPlaceholder="Filter sources..."
        emptyState="No sources yet"
        className="w-160"
      />
      <Combobox
        options={toOptions(events)}
        value={filters.event ?? ''}
        onValueChange={(value) => onFiltersChange({event: value || undefined})}
        placeholder="All events"
        searchPlaceholder="Filter events..."
        emptyState="No events yet"
        className="w-160"
      />
      <fieldset className="flex items-center gap-6">
        <legend className="sr-only">Filter by outcome</legend>
        {OUTCOME_FILTERS.map((outcome) => {
          const active = selectedOutcomes.has(outcome);
          return (
            <Button
              key={outcome}
              type="button"
              size="2xs"
              variant={active ? 'primary' : 'transparent'}
              aria-pressed={active}
              onClick={() => toggleOutcome(outcome)}
            >
              {getTriggerOutcomeVisual(outcome).label}
            </Button>
          );
        })}
      </fieldset>
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
