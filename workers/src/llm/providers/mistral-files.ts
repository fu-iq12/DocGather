/**
 * Direct API client for Mistral Files API (upload, list, delete).
 * Not rate-limited by the global MistralRateLimiter.
 */

export async function uploadFile(
  apiKey: string,
  buffer: ArrayBuffer,
  mimeType: string,
  fileName: string,
  purpose: "ocr" = "ocr",
): Promise<string> {
  const boundary =
    "----MistralBoundary" + Math.random().toString(36).substring(2);
  const crlf = "\r\n";
  const bodyParts: Buffer[] = [];

  // Part 1: purpose
  bodyParts.push(
    Buffer.from(
      `--${boundary}${crlf}` +
        `Content-Disposition: form-data; name="purpose"${crlf}${crlf}` +
        `${purpose}${crlf}`,
    ),
  );

  // Part 2: file
  bodyParts.push(
    Buffer.from(
      `--${boundary}${crlf}` +
        `Content-Disposition: form-data; name="file"; filename="${fileName}"${crlf}` +
        `Content-Type: ${mimeType}${crlf}${crlf}`,
    ),
  );
  bodyParts.push(Buffer.from(buffer));
  bodyParts.push(Buffer.from(`${crlf}--${boundary}--${crlf}`));

  const payload = Buffer.concat(bodyParts);

  const response = await fetch("https://api.mistral.ai/v1/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body: payload,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to upload Mistral file: ${response.status} ${errorText}`,
    );
  }

  const data = (await response.json()) as { id: string };
  return data.id;
}

export async function deleteFile(
  apiKey: string,
  fileId: string,
): Promise<void> {
  const response = await fetch(`https://api.mistral.ai/v1/files/${fileId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    // 404 is fine to ignore if we're just cleaning up
    if (response.status !== 404) {
      const errorText = await response.text();
      throw new Error(
        `Failed to delete Mistral file ${fileId}: ${response.status} ${errorText}`,
      );
    }
  }
}

export async function listFiles(
  apiKey: string,
  purpose?: string, // optional filter
): Promise<Array<{ id: string; filename: string; created_at: number }>> {
  let url = "https://api.mistral.ai/v1/files";
  if (purpose) {
    url += `?purpose=${encodeURIComponent(purpose)}`;
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to list Mistral files: ${response.status} ${errorText}`,
    );
  }

  const data = (await response.json()) as {
    data: Array<{ id: string; filename: string; created_at: number }>;
  };
  return data.data;
}

export async function downloadFileContent(
  apiKey: string,
  fileId: string,
): Promise<string> {
  const response = await fetch(
    `https://api.mistral.ai/v1/files/${fileId}/content`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to download Mistral file ${fileId}: ${response.status} ${errorText}`,
    );
  }

  return response.text();
}
