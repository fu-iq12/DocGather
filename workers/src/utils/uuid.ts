import { v5 as uuidv5 } from "uuid";

export const DOCGATHER_NAMESPACE_UUID = "1e7123aa-3f41-4c12-88f5-b1a8dd282e38";

/**
 * Generates a deterministic document ID for a root upload based on owner ID and content hash.
 */
export function generateDeterministicDocumentId(
  ownerId: string,
  contentHashHex: string,
): string {
  const input = `root:${ownerId}:${contentHashHex}`;
  return uuidv5(input, DOCGATHER_NAMESPACE_UUID);
}

/**
 * Generates a deterministic document ID for a split child based on parent ID, owner ID, and page range.
 */
export function generateDeterministicChildDocumentId(
  parentDocumentId: string,
  ownerId: string,
  pageRangeText: string,
): string {
  const input = `child:${parentDocumentId}:${ownerId}:${pageRangeText}`;
  return uuidv5(input, DOCGATHER_NAMESPACE_UUID);
}
