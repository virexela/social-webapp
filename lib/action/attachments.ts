import { fetchWithAutoSession } from "@/lib/action/authFetch";

interface UploadEncryptedAttachmentInput {
  socialId: string;
  roomId: string;
  messageId: string;
  fileName: string;
  mimeType: string;
  encryptedBytes: Uint8Array;
  plaintextByteLength: number;
  onProgress?: (progress: { loaded: number; total: number; percent: number; phase: "uploading" | "finalizing" }) => void;
}

const CHUNK_SIZE_BYTES = 768 * 1024;

export async function uploadEncryptedAttachment(input: UploadEncryptedAttachmentInput): Promise<{
  success: boolean;
  attachmentId?: string;
  expiresAt?: string;
  error?: string;
}> {
  try {
    const totalChunks = Math.max(1, Math.ceil(input.encryptedBytes.byteLength / CHUNK_SIZE_BYTES));
    const initResponse = await fetchWithAutoSession("/api/attachments/upload/init", {
      method: "POST",
      socialId: input.socialId,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        socialId: input.socialId,
        roomId: input.roomId,
        messageId: input.messageId,
        fileName: input.fileName,
        mimeType: input.mimeType,
        plaintextByteLength: input.plaintextByteLength,
        encryptedByteLength: input.encryptedBytes.byteLength,
        totalChunks,
      }),
    });

    if (!initResponse.ok) {
      const text = await initResponse.text();
      return { success: false, error: text || `HTTP ${initResponse.status}` };
    }
    const initData = await initResponse.json();
    const uploadId = String(initData?.uploadId ?? "");
    if (!uploadId) {
      return { success: false, error: "Missing upload id" };
    }

    const statusParams = new URLSearchParams({
      socialId: input.socialId,
      roomId: input.roomId,
      uploadId,
    });
    const statusResponse = await fetchWithAutoSession(`/api/attachments/upload/status?${statusParams.toString()}`, {
      method: "GET",
      socialId: input.socialId,
      cache: "no-store",
    });
    if (!statusResponse.ok) {
      const text = await statusResponse.text();
      return { success: false, error: text || `HTTP ${statusResponse.status}` };
    }
    const statusData = await statusResponse.json();
    const received = new Set<number>(
      Array.isArray(statusData?.receivedChunkIndexes)
        ? statusData.receivedChunkIndexes.map((value: unknown) => Number(value)).filter((v: number) => Number.isFinite(v))
        : []
    );

    let uploadedBytes = 0;
    for (const chunkIndex of received) {
      const start = chunkIndex * CHUNK_SIZE_BYTES;
      const end = Math.min(start + CHUNK_SIZE_BYTES, input.encryptedBytes.byteLength);
      uploadedBytes += Math.max(0, end - start);
    }

    if (uploadedBytes > 0) {
      input.onProgress?.({
        loaded: uploadedBytes,
        total: input.encryptedBytes.byteLength,
        percent: Math.min(99, Math.round((uploadedBytes / input.encryptedBytes.byteLength) * 100)),
        phase: "uploading",
      });
    }

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
      const start = chunkIndex * CHUNK_SIZE_BYTES;
      const end = Math.min(start + CHUNK_SIZE_BYTES, input.encryptedBytes.byteLength);
      if (received.has(chunkIndex)) continue;
      const chunkResponse = await fetchWithAutoSession(
        `/api/attachments/upload/chunk?${new URLSearchParams({
          socialId: input.socialId,
          roomId: input.roomId,
          uploadId,
          chunkIndex: String(chunkIndex),
        }).toString()}`,
        {
        method: "POST",
        socialId: input.socialId,
        headers: { "Content-Type": "application/octet-stream" },
        body: input.encryptedBytes.slice(start, end),
        }
      );
      if (!chunkResponse.ok) {
        const text = await chunkResponse.text();
        return { success: false, error: text || `HTTP ${chunkResponse.status}` };
      }
      uploadedBytes += end - start;
      input.onProgress?.({
        loaded: uploadedBytes,
        total: input.encryptedBytes.byteLength,
        percent: Math.min(99, Math.round((uploadedBytes / input.encryptedBytes.byteLength) * 100)),
        phase: "uploading",
      });
    }

    input.onProgress?.({
      loaded: input.encryptedBytes.byteLength,
      total: input.encryptedBytes.byteLength,
      percent: 99,
      phase: "finalizing",
    });

    const finalizeResponse = await fetchWithAutoSession("/api/attachments/upload/finalize", {
      method: "POST",
      socialId: input.socialId,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        socialId: input.socialId,
        roomId: input.roomId,
        uploadId,
      }),
    });
    if (!finalizeResponse.ok) {
      const text = await finalizeResponse.text();
      return { success: false, error: text || `HTTP ${finalizeResponse.status}` };
    }
    const finalizeData = await finalizeResponse.json();

    return {
      success: Boolean(finalizeData?.success),
      attachmentId: typeof finalizeData?.attachmentId === "string" ? finalizeData.attachmentId : undefined,
      expiresAt: typeof finalizeData?.expiresAt === "string" ? finalizeData.expiresAt : undefined,
      error: finalizeData?.error,
    };
  } catch (err) {
    return { success: false, error: (err as Error).message || String(err) };
  }
}

export async function requestAttachmentDownloadToken(input: {
  socialId: string;
  roomId: string;
  attachmentId: string;
}): Promise<{ success: boolean; token?: string; error?: string }> {
  try {
    const response = await fetchWithAutoSession("/api/attachments/download-token", {
      method: "POST",
      socialId: input.socialId,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: text || `HTTP ${response.status}` };
    }

    const data = await response.json();
    return {
      success: Boolean(data?.success),
      token: typeof data?.token === "string" ? data.token : undefined,
      error: data?.error,
    };
  } catch (err) {
    return { success: false, error: (err as Error).message || String(err) };
  }
}

export async function downloadEncryptedAttachment(token: string): Promise<{
  success: boolean;
  encryptedBytes?: Uint8Array;
  mimeType?: string;
  fileName?: string;
  error?: string;
}>;

export async function downloadEncryptedAttachment(
  token: string,
  onProgress: (progress: { loaded: number; total: number; percent: number }) => void
): Promise<{
  success: boolean;
  encryptedBytes?: Uint8Array;
  mimeType?: string;
  fileName?: string;
  error?: string;
}>;

export async function downloadEncryptedAttachment(
  token: string,
  onProgress?: (progress: { loaded: number; total: number; percent: number }) => void
): Promise<{
  success: boolean;
  encryptedBytes?: Uint8Array;
  mimeType?: string;
  fileName?: string;
  error?: string;
}> {
  try {
    const response = await fetch(`/api/attachments/blob?token=${encodeURIComponent(token)}`, {
      method: "GET",
      cache: "no-store",
      credentials: "include",
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: text || `HTTP ${response.status}` };
    }

    const mimeType = response.headers.get("Content-Type") || "application/octet-stream";
    const disposition = response.headers.get("Content-Disposition") || "";
    const fileNameMatch = /filename="([^"]+)"/i.exec(disposition);
    const fileName = fileNameMatch?.[1] || "attachment.bin";
    const total = Number(response.headers.get("Content-Length") || 0);

    let bytes: Uint8Array;
    if (!response.body) {
      const arrayBuffer = await response.arrayBuffer();
      bytes = new Uint8Array(arrayBuffer);
      onProgress?.({ loaded: bytes.byteLength, total: bytes.byteLength, percent: 100 });
    } else {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        chunks.push(value);
        received += value.byteLength;
        onProgress?.({
          loaded: received,
          total,
          percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0,
        });
      }

      bytes = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }

      if (received > 0) {
        onProgress?.({ loaded: received, total: total || received, percent: 100 });
      }
    }

    return {
      success: true,
      encryptedBytes: bytes,
      mimeType,
      fileName,
    };
  } catch (err) {
    return { success: false, error: (err as Error).message || String(err) };
  }
}
