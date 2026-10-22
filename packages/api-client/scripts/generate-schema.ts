/**
 * 把服务端导出的 openapi.json 转成 openapi-fetch 可用的类型。
 * 输入由 `pnpm gen:openapi` 生成；该脚本不启动服务端，也不访问网络。
 */

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const inputUrl = new URL("../openapi.json", import.meta.url);
const outputPath = fileURLToPath(new URL("../src/schema.d.ts", import.meta.url));

const ast = await openapiTS(inputUrl);
const banner = "// 此文件由 `pnpm gen:api` 生成，请勿手动修改。\n";

await writeFile(outputPath, banner + astToString(ast), "utf8");
console.log(`✅ 已生成 ${outputPath}`);
