# Performance Baseline

This baseline tracks the most critical runtime paths for smooth kiosk operation.

## Enable Debug Metrics

- In browser console, run: `localStorage.setItem('hader:debug', 'Performance,Kiosk,Sync')`
- Reload the app.
- To disable: `localStorage.removeItem('hader:debug')`

## Key Paths and Targets

- `preloadForKiosk`: target <= 2000ms
- `getStudents`: target <= 1200ms
- `forceSyncNow`: target <= 3000ms
- background sync status tick: target <= 800ms

## What to Monitor

- `Performance` logs in console:
  - `[Kiosk] preloadForKiosk completed ...`
  - `[Students] getStudents ...`
  - `[Sync] forceSyncNow completed ...`
  - `[Sync] background status tick ...`
- Frequency of slow-path warnings during school peak time.

## First Optimization Rule

If any path crosses target repeatedly (3+ times in 15 minutes), optimize that path first before broader refactors.
