// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
/* API 桥 —— 保持 gui/app.js 的 api(path, body, opts) 调用形状,把
   fetch("/api/…") 换成 tauri-specta 生成的类型化 commands(invoke)。
   specta 生成 Result<T, ApiError>({status:"ok"|"error"}),此处统一
   拆包:ok→data,error→抛 {code,message}。错误折叠为 "CODE: message"
   字符串后沿用 toast/_srv(ja) 行为;成功后 applyState 时机与旧实现一致。 */

import { commands } from "./bindings";
import type { Snapshot } from "./bindings";
import { _t, _srv, lang } from "./i18n";
import { setBusyDelta } from "./state";
import { toast } from "./ui/toast";

export type ApiOpts = { silent?: boolean };

export type Result<T, E> = { status: "ok"; data: T } | { status: "error"; error: E };
export interface ApiErrorShape {
  code?: string;
  message?: string;
}

/** specta Result 拆包:ok→data,error→抛错误对象 */
async function unwrap<T>(p: Promise<Result<T, ApiErrorShape>>): Promise<T> {
  const r = await p;
  if (r.status === "ok") return r.data;
  throw r.error;
}

function apiErrorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in (e as ApiErrorShape)) {
    const { code, message } = e as ApiErrorShape;
    return code ? code + ": " + message : String(message);
  }
  return String(e);
}

/** 状态应用回调(main.ts 注册,避免 api↔views 循环依赖) */
let stateApplier: (s: Snapshot) => void = () => {};
export function registerStateApplier(fn: (s: Snapshot) => void): void {
  stateApplier = fn;
}

/** busy 渲染回调(进度条 + 工具按钮禁用) */
let busyApplier: () => void = () => {};
export function registerBusyApplier(fn: () => void): void {
  busyApplier = fn;
}

/** 通用调用:保持旧 envelope 形状返回({ok:true, ...extra, state?}) */
async function call<T>(
  p: Promise<Result<T, ApiErrorShape>>,
  opts: ApiOpts,
  wrap: (r: T) => any,
): Promise<any> {
  setBusyDelta(true);
  busyApplier();
  try {
    const r = await unwrap(p);
    return wrap(r);
  } catch (err) {
    const raw = apiErrorMessage(err);
    const msg = raw
      ? (lang === "ja" ? _srv(raw) : raw)
      : _t("errReq").replace("(%d)", " (invoke)");
    if (!opts.silent) toast(msg, "err");
    throw new Error(msg);
  } finally {
    setBusyDelta(false);
    busyApplier();
  }
}

const withState = (s: Snapshot) => { stateApplier(s); return { ok: true, state: s }; };

/** 旧 api() 入口:endpoint 形如 "/api/unlock"。 */
export async function api(path: string, body?: any, opts: ApiOpts = {}): Promise<any> {
  switch (path) {
    case "/api/state":
      return call(commands.state(), opts, withState);
    case "/api/open":
      return call(commands.open(String(body.path)), opts, withState);
    case "/api/unlock":
      return call(commands.unlock(String(body.totp)), opts, withState);
    case "/api/lock":
      return call(commands.lock(), opts, withState);
    case "/api/nav":
      return call(commands.nav(body ? {
        dir: body.dir ?? null,
        path: body.path ?? null,
      } : null), opts, withState);
    case "/api/back":
      return call(commands.back(), opts, withState);
    case "/api/forward":
      return call(commands.forward(), opts, withState);
    case "/api/up":
      return call(commands.up(), opts, withState);
    case "/api/outdir":
      return call(commands.outdir(String(body.path)), opts, withState);
    case "/api/extract":
      return call(commands.extract(body.ids ?? null, body.out ?? null), opts,
        (r) => { stateApplier(r.state); return r; });
    case "/api/verify":
      return call(commands.verify(), opts, (r) => { stateApplier(r.state); return r; });
    case "/api/totp":
      return call(commands.totp(String(body.b32), body.digits ?? null), opts,
        (r) => { stateApplier(r.state); return r; });
    case "/api/pack":
      return call(commands.pack(
        body.src ?? null,
        body.dst ?? null,
        body.digits ?? null,
        body.b32 ?? null,
        body.profile ?? null,
      ), opts, (r) => { stateApplier(r.state); return r; });
    case "/api/demo":
      return call(commands.demo(
        body.dst ?? null,
        body.digits ?? null,
        body.profile ?? null,
      ), opts, (r) => { stateApplier(r.state); return r; });
    case "/api/add":
      return call(commands.add(body.paths), opts,
        (r) => { stateApplier(r.state); return r; });
    case "/api/export_passbox":
      return call(commands.exportPassbox(String(body.out), body.passphrase ?? null), opts,
        (r) => { stateApplier(r.state); return r; });
    case "/api/selftest":
      return call(commands.selftest(), opts, (r) => ({ ok: true, lines: r.lines }));
    case "/api/pending_import":
      return call(commands.takePendingImport(), opts, (path) => ({ ok: true, path }));
    case "/api/import_passbox":
      return call(commands.importPassbox(
        String(body.path),
        body.passphrase ? String(body.passphrase) : null,
      ), opts, (r) => { stateApplier(r.state); return r; });
    case "/api/browse":
      return call(commands.browse(
        body.mode ?? null,
        body.title ?? null,
        body.initial ?? null,
        body.filetypes ?? null,
        body.defaultext ?? null,
      ), opts, (r) => ({ ok: true, paths: r.paths }));
    case "/api/shutdown":
      return call(commands.shutdown(), opts, (message) => ({ ok: true, message }));
    default:
      throw new Error("unknown endpoint: " + path);
  }
}

/* open_upload 不复存在:锁定决策 —— 选文件→传路径→Rust 直读。
   旧的文件上传/4GiB 前端闸门随 multipart 一起删除。 */
