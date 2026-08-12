import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ChangePasswordDto, LoginDto } from "./auth.dto";

test("password validation accepts only the requested 6-12 length rule", async () => {
  const login = plainToInstance(LoginDto, {
    phone: "13800000000",
    password: "abcdef",
  });
  assert.deepEqual(await validate(login), []);

  const tooShort = plainToInstance(LoginDto, {
    phone: "13800000000",
    password: "12345",
  });
  assert.ok((await validate(tooShort)).length > 0);

  const tooLong = plainToInstance(LoginDto, {
    phone: "13800000000",
    password: "1234567890123",
  });
  assert.ok((await validate(tooLong)).length > 0);
});

test("password change accepts 6-12 characters without composition rules", async () => {
  const dto = plainToInstance(ChangePasswordDto, {
    currentPassword: "123456",
    newPassword: "abcdef",
  });
  assert.deepEqual(await validate(dto), []);
});
