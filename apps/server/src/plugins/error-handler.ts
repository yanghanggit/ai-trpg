import type { FastifyError, FastifyInstance } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from "fastify-type-provider-zod";

/** 统一错误响应形状：`{ error, message, details? }`，不让异常以 Fastify 默认格式漏出去。 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(400).send({
        error: "invalid_request",
        message: "请求参数校验失败",
        details: error.validation,
      });
    }

    if (isResponseSerializationError(error)) {
      request.log.error({ err: error }, "响应序列化失败");
      return reply.code(500).send({
        error: "invalid_response",
        message: "服务端响应不符合契约",
      });
    }

    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) {
      request.log.error({ err: error }, "请求处理失败");
    }
    return reply.code(statusCode).send({
      error: statusCode >= 500 ? "internal_server_error" : "request_failed",
      message: statusCode >= 500 ? "服务器内部错误" : error.message,
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: "not_found",
      message: `接口不存在：${request.method} ${request.url}`,
    }),
  );
}
