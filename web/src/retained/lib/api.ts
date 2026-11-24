import type {
  EvolutionView,
  ProjectView,
  RunSummary,
  RunView,
  SkillView,
} from "./types";
const LIMIT = 1024 * 1024;
export class ReadError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 65536;
const list = (value: unknown): value is unknown[] =>
  Array.isArray(value) && value.length <= 1000;
const nullableText = (value: unknown) => value === null || text(value);
const integer = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const digest = (value: unknown) =>
  value === null || (typeof value === "string" && /^[0-9a-f]{64}$/.test(value));
const ref = (value: unknown) =>
  object(value) &&
  text(value.skill_id) &&
  integer(value.skill_version) &&
  Number(value.skill_version) > 0;
const summary = (value: unknown) =>
  object(value) &&
  text(value.id) &&
  text(value.taskId) &&
  text(value.title) &&
  ["RUNNING", "COMPLETED", "FAILED", "INTERRUPTED"].includes(
    String(value.status),
  ) &&
  text(value.startedAt) &&
  nullableText(value.endedAt) &&
  integer(value.eventCount);

function issueText(value: unknown): unknown {
  if (text(value)) return value;
  if (
    object(value) &&
    typeof value.code === "string" &&
    /^[A-Z][A-Z0-9_]{0,79}$/.test(value.code) &&
    text(value.message)
  )
    return `${value.code}: ${value.message}`;
  return value;
}

function normalizeProjection(path: string, value: unknown): unknown {
  if (!/\/runs\//.test(path) || !object(value)) return value;
  const safeFields = new Set([
    "id",
    "toolName",
    "path",
    "argumentsSha256",
    "argumentsRedacted",
    "mutating",
    "status",
    "durationMs",
    "resultRedacted",
    "reason",
    "exists",
    "sha256",
    "sizeBytes",
    "passed",
    "detailsRedacted",
    "toolStatus",
    "validationEventId",
  ]);
  const events = list(value.events)
    ? value.events.map((event) => {
        if (!object(event) || !object(event.summary)) return event;
        if (
          !Object.entries(event.summary).every(
            ([key, item]) =>
              safeFields.has(key) &&
              (item === null ||
                text(item) ||
                typeof item === "boolean" ||
                (typeof item === "number" && Number.isFinite(item))),
          )
        )
          return event;
        return {
          ...event,
          summary: Object.entries(event.summary)
            .filter(([, item]) => item !== null)
            .map(([key, item]) => `${key}: ${String(item)}`)
            .join("，"),
        };
      })
    : value.events;
  const inspection = object(value.inspection)
    ? {
        ...value.inspection,
        issues: list(value.inspection.issues)
          ? value.inspection.issues.map(issueText)
          : value.inspection.issues,
      }
    : value.inspection;
  return { ...value, events, inspection };
}
export function validateCoreData(path: string, value: unknown): void {
  const fail = () => {
    throw new ReadError("INVALID_DATA", "只读响应的数据结构不受支持");
  };
  if (path === "/projects") {
    if (
      !list(value) ||
      !value.every((p) => object(p) && text(p.id) && text(p.name))
    )
      fail();
    return;
  }
  if (path.endsWith("/runs")) {
    if (!list(value) || !value.every(summary)) fail();
    return;
  }
  if (/\/runs\//.test(path)) {
    if (
      !summary(value) ||
      !object(value) ||
      !nullableText(value.goal) ||
      !list(value.events) ||
      !list(value.files) ||
      !list(value.checkpoints) ||
      !list(value.recovery) ||
      !object(value.inspection) ||
      !object(value.model) ||
      !list(value.limitations)
    ) {
      fail();
      return;
    }
    if (
      !value.events.every(
        (e) =>
          object(e) &&
          text(e.id) &&
          text(e.type) &&
          integer(e.seq) &&
          text(e.timestamp) &&
          nullableText(e.stepId) &&
          nullableText(e.toolCallId) &&
          text(e.summary),
      ) ||
      !text(value.inspection.status) ||
      ![true, false, null].includes(
        value.inspection.traceConsistent as boolean | null,
      ) ||
      !list(value.inspection.observations) ||
      !value.inspection.observations.every(text) ||
      !list(value.inspection.issues) ||
      !value.inspection.issues.every(text) ||
      !list(value.inspection.pendingInvocations)
    )
      fail();
    if (
      !value.files.every(
        (f) =>
          object(f) &&
          text(f.path) &&
          text(f.reason) &&
          typeof f.exists === "boolean" &&
          digest(f.sha256) &&
          (f.sizeBytes === null || integer(f.sizeBytes)) &&
          integer(f.seq),
      ) ||
      !value.checkpoints.every(
        (c) =>
          object(c) && nullableText(c.id) && text(c.status) && object(c.checks),
      ) ||
      !value.recovery.every(
        (r) =>
          object(r) &&
          text(r.id) &&
          text(r.sourceOutcome) &&
          nullableText(r.childRunId) &&
          nullableText(r.childStatus) &&
          text(r.status),
      )
    )
      fail();
    if (
      !nullableText(value.model.adapterName) ||
      !nullableText(value.model.modelId) ||
      !value.limitations.every(text)
    )
      fail();
    if (
      value.plan !== null &&
      (!object(value.plan) ||
        !nullableText(value.plan.proposalId) ||
        !digest(value.plan.planSha256) ||
        !digest(value.plan.approvedPlanSha256) ||
        !text(value.plan.approvalStatus) ||
        !(value.plan.skillRef === null || ref(value.plan.skillRef)) ||
        !list(value.plan.steps) ||
        !value.plan.steps.every(
          (s) =>
            object(s) &&
            text(s.id) &&
            text(s.toolName) &&
            nullableText(s.path) &&
            digest(s.argumentsSha256),
        ))
    )
      fail();
    return;
  }
  if (/\/skills(?:\/|$)/.test(path)) {
    const valid = (s: unknown) =>
      object(s) &&
      text(s.id) &&
      text(s.name) &&
      text(s.description) &&
      text(s.state) &&
      integer(s.version) &&
      Number(s.version) > 0 &&
      list(s.allowedTools) &&
      s.allowedTools.every(text) &&
      digest(s.cardSha256) &&
      typeof s.preferred === "boolean" &&
      (s.instructions === undefined || text(s.instructions)) &&
      (s.history === undefined || list(s.history));
    if (
      path.endsWith("/skills")
        ? !list(value) || !value.every(valid)
        : !valid(value)
    )
      fail();
    return;
  }
  if (/\/evolution(?:\/|$)/.test(path)) {
    const valid = (e: unknown) =>
      object(e) &&
      text(e.id) &&
      ref(e.sourceSkillRef) &&
      (e.governanceMode === undefined || nullableText(e.governanceMode));
    if (
      path.endsWith("/evolution")
        ? !list(value) || !value.every(valid)
        : !valid(value)
    )
      fail();
  }
}
export async function readApi<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    signal,
    credentials: "omit",
    headers: { Accept: "application/json" },
  });
  if (!response.ok)
    throw new ReadError(
      String(response.status),
      "只读连接不可用，或当前记录不支持检查。请核对本地服务配置。",
    );
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new ReadError("INVALID_RESPONSE", "本地服务返回了非 JSON 响应");
  const reader = response.body?.getReader();
  if (!reader) throw new ReadError("INVALID_RESPONSE", "本地服务没有返回数据");
  const chunks: Uint8Array[] = [];
  let count = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    count += value.byteLength;
    if (count > LIMIT) {
      await reader.cancel();
      throw new ReadError("RESPONSE_LIMIT", "响应超过只读工作台的大小上限");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(count);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    throw new ReadError("INVALID_RESPONSE", "本地服务响应格式无效");
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    !("schema_version" in payload) ||
    payload.schema_version !== 1 ||
    !("mode" in payload) ||
    payload.mode !== "connected-read-only" ||
    !("data" in payload)
  )
    throw new ReadError("INVALID_SOURCE", "响应缺少真实只读数据来源标识");
  const data = normalizeProjection(path, payload.data);
  validateCoreData(path, data);
  return data as T;
}
const encoded = encodeURIComponent;
export const coreApi = {
  projects: (signal?: AbortSignal) =>
    readApi<ProjectView[]>("/projects", signal),
  runs: (project: string, signal?: AbortSignal) =>
    readApi<RunSummary[]>(`/projects/${encoded(project)}/runs`, signal),
  run: (project: string, run: string, signal?: AbortSignal) =>
    readApi<RunView>(
      `/projects/${encoded(project)}/runs/${encoded(run)}`,
      signal,
    ),
  skills: (project: string, signal?: AbortSignal) =>
    readApi<SkillView[]>(`/projects/${encoded(project)}/skills`, signal),
  skill: (
    project: string,
    skill: string,
    version: number,
    signal?: AbortSignal,
  ) =>
    readApi<SkillView>(
      `/projects/${encoded(project)}/skills/${encoded(skill)}/${version}`,
      signal,
    ),
  evolutions: (project: string, signal?: AbortSignal) =>
    readApi<EvolutionView[]>(`/projects/${encoded(project)}/evolution`, signal),
  evolution: (project: string, id: string, signal?: AbortSignal) =>
    readApi<EvolutionView>(
      `/projects/${encoded(project)}/evolution/${encoded(id)}`,
      signal,
    ),
};
