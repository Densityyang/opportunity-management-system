import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiConsumes, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { CurrentIdentity, RequireRoles } from "../../common/auth.decorators";
import type { AuthIdentity } from "../../common/auth.types";
import { AudioService } from "./audio.service";

@ApiTags("audio")
@Controller("opportunities/:opportunityId/audio")
export class AudioController {
  constructor(private readonly audio: AudioService) {}

  @RequireRoles("FIELD_REPORTER")
  @Post()
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(
    FileInterceptor("audio", {
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  )
  upload(
    @CurrentIdentity() identity: AuthIdentity,
    @Param("opportunityId") opportunityId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.audio.upload(identity, opportunityId, file);
  }

  @Get()
  async playback(
    @CurrentIdentity() identity: AuthIdentity,
    @Param("opportunityId") opportunityId: string,
    @Res() response: Response,
  ) {
    const audio = await this.audio.playback(identity, opportunityId);
    response.setHeader("Content-Type", audio.mimeType);
    response.setHeader("Cache-Control", "private, no-store, max-age=0");
    response.setHeader("Content-Disposition", "inline");
    response.send(audio.buffer);
  }

  @RequireRoles("FIELD_REPORTER")
  @Delete()
  remove(
    @CurrentIdentity() identity: AuthIdentity,
    @Param("opportunityId") opportunityId: string,
  ) {
    return this.audio.removeByReporter(identity, opportunityId);
  }
}
