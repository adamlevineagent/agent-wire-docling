"use client";

/**
 * Empty placeholder slots for Taste and Batch stages.
 * Wave 2 Agent G fills in <TasteTestSlot />; Wave 2 Agent H fills in <BatchRunSlot />.
 */

import { useAppState } from "./app-state";

export function TasteTestSlot() {
  const { scan } = useAppState();
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-md text-center space-y-2">
        <div className="text-lg text-fg-primary font-medium">
          {scan ? "Taste test" : "Complete a scan first"}
        </div>
        <div className="text-sm text-fg-muted">
          {scan
            ? "Sample N per stratum, review side-by-side, approve or reject. Wave 2 Agent G will flesh this out."
            : "Point the scanner at a folder before reviewing samples."}
        </div>
      </div>
    </div>
  );
}

export function BatchRunSlot() {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-md text-center space-y-2">
        <div className="text-lg text-fg-primary font-medium">
          Batch run
        </div>
        <div className="text-sm text-fg-muted">
          Approve at least one stratum in Taste before running a batch. Wave 2 Agent H will flesh this out.
        </div>
      </div>
    </div>
  );
}
