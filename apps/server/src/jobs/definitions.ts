/** 业务作业的显式注册点；基建阶段没有默认作业。 */

import type { JobRegistry } from "./registry";

export function registerJobDefinitions(_registry: JobRegistry): void {
  // 业务模块在此显式 registry.register(defineJob(...))；
  // 不做目录扫描或隐式导入，保证 worker 认识的作业集合可审计。
}
