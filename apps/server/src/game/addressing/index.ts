/**
 * 地址：actor 怎么指认一个主体，以及这套指认不出圈。
 *
 * 名字就是地址——所以「谁能叫出谁」与「谁能看到什么」是同一件事。三层，依赖单向：
 * 语法（`syntax.ts`）只认字符，投影（`projection.ts`）认识观察者，守卫（`guard.ts`）
 * 守住世界面。三者合起来是信息披露这一条设计在引擎里的全部实现。
 */

export * from "./guard";
export * from "./projection";
export * from "./syntax";
