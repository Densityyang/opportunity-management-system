import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { ProblemDetailsFilter } from "./common/problem-details.filter";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: true });
  app.getHttpAdapter().getInstance().set("trust proxy", 1);
  const config = app.get(ConfigService);
  const origins = config
    .getOrThrow<string>("ALLOWED_ORIGINS")
    .split(",")
    .map((value) => value.trim());

  app.setGlobalPrefix("api/v1");
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,
    }),
  );
  app.useGlobalFilters(new ProblemDetailsFilter());

  const swagger = new DocumentBuilder()
    .setTitle("商机随手报 API")
    .setDescription(
      "固定问卷、区县承接、分侧处理、双节点审核和市公司成功商机库",
    )
    .setVersion("1.0")
    .addCookieAuth("oms_session")
    .addApiKey(
      { type: "apiKey", name: "X-Role-Grant-Id", in: "header" },
      "roleGrant",
    )
    .addApiKey(
      { type: "apiKey", name: "Idempotency-Key", in: "header" },
      "idempotency",
    )
    .build();
  SwaggerModule.setup(
    "api/docs",
    app,
    SwaggerModule.createDocument(app, swagger),
  );

  app.enableShutdownHooks();
  await app.listen(3000, "0.0.0.0");
}

void bootstrap();
