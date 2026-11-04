---
'@shipfox/client-shell': minor
'@shipfox/client-chat': patch
---

Animates floating Shippy and adds a first-run greeting. The dock publishes what the agent is doing with `useShippyStatus`, and the launcher reads it with `useCurrentShippyStatus`. Shippy flicks its tail when idle, blinks its cursor and bobs its head while a reply runs, and waves once when a reply is ready. It stays still after a failure, under reduced motion, and in the tab bar. The first floating Shippy in a browser shows a greeting once. The chat dock keeps following a running turn while the panel is closed.
