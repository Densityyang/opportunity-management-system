import { plainToInstance } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  validateSync,
} from "class-validator";

class Environment {
  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  PII_ENCRYPTION_KEY_BASE64!: string;

  @IsString()
  @IsNotEmpty()
  AUDIO_ENCRYPTION_KEY_BASE64!: string;

  @IsString()
  @IsNotEmpty()
  BLIND_INDEX_KEY_BASE64!: string;

  @IsString()
  @IsNotEmpty()
  SESSION_PEPPER!: string;

  @IsString()
  ALLOWED_ORIGINS = "http://localhost:8080,http://localhost:5173";

  @IsString()
  AUDIO_STORAGE_PATH = "/data/audio";

  @IsBoolean()
  COOKIE_SECURE = false;

  @IsInt()
  @Min(1)
  @Max(20)
  DATA_RETENTION_YEARS = 3;

  @IsInt()
  @Min(1)
  @Max(3650)
  AUDIO_RETENTION_DAYS = 90;
}

export function validateEnvironment(raw: Record<string, unknown>): Environment {
  const input = {
    ...raw,
    COOKIE_SECURE: raw.COOKIE_SECURE === true || raw.COOKIE_SECURE === "true",
    DATA_RETENTION_YEARS: Number(raw.DATA_RETENTION_YEARS ?? 3),
    AUDIO_RETENTION_DAYS: Number(raw.AUDIO_RETENTION_DAYS ?? 90),
  };
  const config = plainToInstance(Environment, input, {
    enableImplicitConversion: false,
  });
  const errors = validateSync(config, { skipMissingProperties: false });
  if (errors.length) {
    throw new Error(
      `Invalid environment: ${errors.map((item) => Object.values(item.constraints ?? {}).join(", ")).join("; ")}`,
    );
  }
  for (const name of [
    "PII_ENCRYPTION_KEY_BASE64",
    "AUDIO_ENCRYPTION_KEY_BASE64",
    "BLIND_INDEX_KEY_BASE64",
  ] as const) {
    if (Buffer.from(config[name], "base64").length !== 32) {
      throw new Error(`${name} must decode to exactly 32 bytes`);
    }
  }
  return config;
}
