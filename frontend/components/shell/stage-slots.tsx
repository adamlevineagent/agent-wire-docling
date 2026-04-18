"use client";

/**
 * Stage slots for Taste and Batch stages.
 * Wave 2b Agent G fills in <TasteTestSlot />; Wave 2b Agent H fills in <BatchRunSlot />.
 */

import { TasteTest } from "../TasteTest";
import { BatchRun } from "../BatchRun";

export function TasteTestSlot() {
  return <TasteTest />;
}

export function BatchRunSlot() {
  return <BatchRun />;
}
