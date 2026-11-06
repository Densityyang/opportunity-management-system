const MIME_TYPE_ALIASES: Record<string, string> = {
  "audio/aacp": "audio/aac",
  "audio/mp3": "audio/mpeg",
  "audio/x-m4a": "audio/m4a",
  "audio/x-wav": "audio/wav",
  "audio/vnd.wave": "audio/wav",
  "audio/wave": "audio/wav",
  "video/3gpp": "audio/3gpp",
  "video/3gpp2": "audio/3gpp2",
};

const SUPPORTED_MIME_TYPES = new Set([
  "audio/3gpp",
  "audio/3gpp2",
  "audio/aac",
  "audio/m4a",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/opus",
  "audio/wav",
  "audio/webm",
]);

const MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  "3g2": "audio/3gpp2",
  "3gp": "audio/3gpp",
  aac: "audio/aac",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  opus: "audio/opus",
  wav: "audio/wav",
  webm: "audio/webm",
};

export function normalizeAudioMimeType(
  value: string,
  fileName: string,
): string | null {
  const inputType = value.toLowerCase().split(";")[0]?.trim() ?? "";
  const mimeType = MIME_TYPE_ALIASES[inputType] ?? inputType;
  if (SUPPORTED_MIME_TYPES.has(mimeType)) return mimeType;

  const extension = fileName.split(".").pop()?.toLowerCase();
  return extension ? (MIME_TYPE_BY_EXTENSION[extension] ?? null) : null;
}

export function hasValidAudioMagic(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === "audio/aac")
    return (
      buffer.length >= 2 && buffer[0] === 0xff && (buffer[1]! & 0xf6) === 0xf0
    );
  if (mimeType === "audio/mpeg")
    return (
      buffer.subarray(0, 3).toString("ascii") === "ID3" ||
      (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1]! & 0xe0) === 0xe0)
    );
  if (mimeType === "audio/webm")
    return buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (mimeType === "audio/ogg" || mimeType === "audio/opus")
    return buffer.subarray(0, 4).toString("ascii") === "OggS";
  if (mimeType === "audio/wav")
    return (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WAVE"
    );
  if (mimeType === "audio/mp4" || mimeType === "audio/m4a")
    return isIsoBaseMediaFile(buffer);
  if (mimeType === "audio/3gpp" || mimeType === "audio/3gpp2")
    return isIsoBaseMediaFile(buffer);
  return false;
}

function isIsoBaseMediaFile(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp"
  );
}
