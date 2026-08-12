import { Module } from "@nestjs/common";
import { OpportunitiesModule } from "../opportunities/opportunities.module";
import { AudioController } from "./audio.controller";
import { AudioService } from "./audio.service";

@Module({
  imports: [OpportunitiesModule],
  controllers: [AudioController],
  providers: [AudioService],
  exports: [AudioService],
})
export class AudioModule {}
