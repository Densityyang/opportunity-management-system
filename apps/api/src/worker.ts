import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { WorkerModule } from "./modules/worker/worker.module";

async function bootstrap(): Promise<void> {
  const context = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ["log", "error", "warn"],
  });
  context.enableShutdownHooks();
  Logger.log("Background worker started", "WorkerBootstrap");
}

void bootstrap();
