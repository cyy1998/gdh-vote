import { randomBytes, scryptSync } from "node:crypto";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

const prompt = createInterface({ input: stdin, output: stdout });
const password = await prompt.question("请输入要设置的管理员口令：");
prompt.close();
if (password.length < 8) throw new Error("管理员口令至少需要 8 个字符");
const salt = randomBytes(16).toString("hex");
const hash = scryptSync(password, salt, 32).toString("hex");
console.log(`ADMIN_PASSWORD_HASH=${salt}:${hash}`);
