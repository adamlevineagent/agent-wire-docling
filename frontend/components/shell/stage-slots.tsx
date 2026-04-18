"use client";

/**
 * Stage slots for Taste and Batch stages.
 * Wave 2b Agent G fills in <TasteTestSlot />; Wave 2b Agent H fills in <BatchRunSlot />.
 */

import { TasteTest } from "../TasteTest";

export function TasteTestSlot() {
  return <TasteTest />;
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
