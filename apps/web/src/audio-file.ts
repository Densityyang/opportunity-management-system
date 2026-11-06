const AUDIO_EXTENSIONS = new Set([
  "3g2",
  "3gp",
  "aac",
  "m4a",
  "mp4",
  "mp3",
  "ogg",
  "opus",
  "wav",
  "webm",
]);

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "audio/3gpp": "3gp",
  "audio/3gpp2": "3g2",
  "audio/aac": "aac",
  "audio/aacp": "aac",
  "audio/m4a": "m4a",
  "audio/mp4": "m4a",
  "audio/mp3": "mp3",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/vnd.wave": "wav",
  "audio/webm": "webm",
  "audio/x-m4a": "m4a",
  "audio/x-wav": "wav",
  "video/3gpp": "3gp",
  "video/3gpp2": "3g2",
};

export function getAudioUploadFileName(audio: Blob): string {
  const mimeType = audio.type.toLowerCase().split(";")[0]?.trim() ?? "";
  const mimeExtension = EXTENSION_BY_MIME_TYPE[mimeType];
  if (mimeExtension) return `recording.${mimeExtension}`;

  const fileName = (audio as Blob & { name?: string }).name;
  const fileExtension = fileName?.split(".").pop()?.toLowerCase();
  if (fileExtension && AUDIO_EXTENSIONS.has(fileExtension))
    return `recording.${fileExtension}`;

  return "recording.webm";
}

export function inferAudioMimeType(fileName: string): string | undefined {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (!extension) return undefined;
  return Object.entries(EXTENSION_BY_MIME_TYPE).find(
    ([, value]) => value === extension,
  )?.[0];
}
