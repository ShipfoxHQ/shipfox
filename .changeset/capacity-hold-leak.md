---
"@shipfox/api-runners": patch
---

Launch capacity holds no longer leak when a reservation launches more than one runner.

- Each runner of a multi-runner launch now gets its own hold. Before, every runner bound the same hold, and the other holds stayed unbound forever.
- When the last units of a reservation are released, its unbound holds are released with reason `reservation-consumed`.
- The maintenance sweep releases unbound holds whose reservation no longer exists, with reason `reservation-missing`. This repairs holds that leaked before this fix.
