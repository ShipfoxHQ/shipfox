---
"@shipfox/react-ui": minor
---

Add date selection components: `Calendar` (a styled `react-day-picker` wrapper), `DatePicker` (single date), and `DateRangePicker` (start/end range). Pickers render a read-only field with a calendar popover, support `base`/`small` sizes, `base`/`component` variants, `default`/`error`/`disabled` states, custom `dateFormat`, clearing, and optional bounds (`maxDisabledOffsetDays` for `DatePicker`, `maxRangeDays` for `DateRangePicker`). Picking a date (or completing a range) closes the popover by default; pass `closeOnSelect={false}` to keep it open.
