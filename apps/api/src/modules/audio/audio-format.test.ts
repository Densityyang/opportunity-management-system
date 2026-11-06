import assert from "node:assert/strict";
import test from "node:test";
import { hasValidAudioMagic, normalizeAudioMimeType } from "./audio-format";

test("normalizes mobile recorder MIME aliases and 3GP filenames", () => {
  assert.equal(
    normalizeAudioMimeType("video/3gpp", "recording.3gp"),
    "audio/3gpp",
  );
  assert.equal(normalizeAudioMimeType("", "recording.3g2"), "audio/3gpp2");
  assert.equal(
    normalizeAudioMimeType("audio/x-m4a", "recording.m4a"),
    "audio/m4a",
  );
  assert.equal(
    normalizeAudioMimeType("audio/aacp", "recording.aac"),
    "audio/aac",
  );
  assert.equal(
    normalizeAudioMimeType("audio/mp3", "recording.mp3"),
    "audio/mpeg",
  );
  assert.equal(
    normalizeAudioMimeType("application/octet-stream", "recording.m4a"),
    "audio/mp4",
  );
  assert.equal(
    normalizeAudioMimeType("application/octet-stream", "clip.bin"),
    null,
  );
});

test("validates supported browser and native audio container signatures", () => {
  assert.equal(
    hasValidAudioMagic(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), "audio/webm"),
    true,
  );
  assert.equal(
    hasValidAudioMagic(Buffer.from("0000ftyp3gp4"), "audio/3gpp"),
    true,
  );
  assert.equal(hasValidAudioMagic(Buffer.from("OggS"), "audio/ogg"), true);
  assert.equal(
    hasValidAudioMagic(Buffer.from("RIFF0000WAVE"), "audio/wav"),
    true,
  );
  assert.equal(
    hasValidAudioMagic(Buffer.from([0xff, 0xf1]), "audio/aac"),
    true,
  );
  assert.equal(
    hasValidAudioMagic(Buffer.from("ID3 audio"), "audio/mpeg"),
    true,
  );
  assert.equal(
    hasValidAudioMagic(Buffer.from("not an audio file"), "audio/3gpp"),
    false,
  );
  assert.equal(hasValidAudioMagic(Buffer.from("OggS"), "audio/webm"), false);
});
