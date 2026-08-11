import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "../../common/database.module";
import { validateEnvironment } from "../../common/config";
import { AudioModule } from "../audio/audio.module";
import { WorkflowModule } from "../workflow/workflow.module";
import { JobWorkerService } from "./job-worker.service";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    DatabaseModule,
    WorkflowModule,
    AudioModule,
  ],
  providers: [JobWorkerService],
})
export class WorkerModule {}
