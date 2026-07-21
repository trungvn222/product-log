export const ACTION_LABELS: Record<string, string> = {
  created: "Created",
  updated: "Updated",
  deleted: "Deleted",
  variant_added: "Variant added",
  variant_removed: "Variant removed",
  added_to_collection: "Added to collection",
  removed_from_collection: "Removed from collection",
};

export function describeChange(log: {
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  collectionTitle: string | null;
}) {
  if (
    (log.action === "updated" ||
      log.action === "variant_added" ||
      log.action === "variant_removed") &&
    log.field
  ) {
    if (log.action === "variant_added") return `${log.field} (${log.newValue ?? "—"})`;
    if (log.action === "variant_removed") return `${log.field} (${log.oldValue ?? "—"})`;
    return `${log.field}: ${log.oldValue ?? "—"} → ${log.newValue ?? "—"}`;
  }
  if (
    (log.action === "added_to_collection" ||
      log.action === "removed_from_collection") &&
    log.collectionTitle
  ) {
    return log.collectionTitle;
  }
  return "—";
}
