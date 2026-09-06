# Support diagnostics repair — 2026-09-06

The hybrid database bridge now runs the provider's diagnostics and uses the same
server telemetry implementation as the cloud provider. Audit/error log failures
propagate to the UI instead of appearing as empty results. Cleanup uses the
existing server RPC and reports the returned counts.

Connection checks query the required tables with the current session, select only
an ID, and time out after ten seconds. Every failed table contributes to the
failure summary. These checks verify read access; they do not prove write access,
complete RLS visibility, or an end-to-end workflow. Untested connections remain
explicitly untested.

Hybrid diagnostics count blocked queue entries. The support diagnostics tab also
offers manual sync, queue inspection and the existing conflict resolution UI.
Returned/skipped sync failures are visible. Bulk local data deletion controls are
not included in this embedded panel.

Kiosk diagnostics subscribe to the existing cloud heartbeat service used by the
supervision dashboard. The panel shows each reporting kiosk and its last reported
status, camera readiness and pending count. Silence is not treated as success.
The old local-storage status assumptions and unhandled BroadcastChannel commands
were removed. Remote UI reset and barcode refocus still need receivers and
acknowledgements before they can be offered as working controls.

Settings save errors now propagate from the cloud provider. The support page
keeps its confirmed toggle state on failure and blocks editing when its settings
load fails. Cloud phone-integrity checks no longer interpret query failures as
complete records.

Validation: 70 test files, 319 tests passed; production build, TypeScript and
targeted ESLint passed. No production account, log, settings or attendance data
was mutated during verification. These are implementation checks; authenticated
production verification and release status are recorded separately at deployment.
