import { Module } from "@nestjs/common";
import { AudioModule } from "../audio/audio.module";
import { RetentionController } from "./retention.controller";
import { RetentionService } from "./retention.service";

@Module({
  imports: [AudioModule],
  controllers: [RetentionController],
  providers: [RetentionService],
})
export class RetentionModule {}
