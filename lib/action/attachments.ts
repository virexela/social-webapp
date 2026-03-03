import { bytesToBase64Url } from "@/lib/protocol/base64url";
import { fetchWithAutoSession } from "@/lib/action/authFetch";

interface UploadEncryptedAttachmentInput {
  socialId: string;
  roomId: string;
  messageId: string;
  fileName: string;
  mimeType: string;
  encryptedBlobBase64Url: string;
  plaintextByteLength: number;
}

const CHUNK_SIZE_CHARS = 900_000;

export async function uploadEncryptedAttachment(input: UploadEncryptedAttachmentInput): Promise<{
  success: boolean;
  attachmentId?: string;
  expiresAt?: string;
  error?: string;
}> {
  try {
    const totalChunks = Math.max(1, Math.ceil(input.encryptedBlobBase64Url.length / CHUNK_SIZE_CHARS));
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
        encryptedBlobLength: input.encryptedBlobBase64Url.length,
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

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
      if (received.has(chunkIndex)) continue;
      const start = chunkIndex * CHUNK_SIZE_CHARS;
      const end = Math.min(start + CHUNK_SIZE_CHARS, input.encryptedBlobBase64Url.length);
      const chunkDataBase64Url = input.encryptedBlobBase64Url.slice(start, end);
      const chunkResponse = await fetchWithAutoSession("/api/attachments/upload/chunk", {
        method: "POST",
        socialId: input.socialId,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          socialId: input.socialId,
          roomId: input.roomId,
          uploadId,
          chunkIndex,
          chunkDataBase64Url,
        }),
      });
      if (!chunkResponse.ok) {
        const text = await chunkResponse.text();
        return { success: false, error: text || `HTTP ${chunkResponse.status}` };
      }
    }

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
  encryptedBlobBase64Url?: string;
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

    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    return {
      success: true,
      encryptedBlobBase64Url: bytesToBase64Url(bytes),
      mimeType,
      fileName,
    };
  } catch (err) {
    return { success: false, error: (err as Error).message || String(err) };
  }
}
