import { useCallback, useEffect, useState } from "react";
import { coreApi } from "../lib/api";
import {
  demoEvolution,
  demoProjects,
  demoRuns,
  demoSkills,
} from "../fixtures/demo";
import type {
  EvolutionView,
  Mode,
  ProjectView,
  Resource,
  RunSummary,
  RunView,
  SkillView,
} from "../lib/types";

export function useWorkbench(
  mode: Mode,
  projectId: string,
  runId: string | null,
  revision: number,
) {
  const [projects, setProjects] = useState<Resource<ProjectView[]>>({
    state: "idle",
    data: [],
  });
  const [projectsScope, setProjectsScope] = useState("");
  const [catalog, setCatalog] = useState<
    Resource<{
      runs: RunSummary[];
      skills: SkillView[];
      evolutions: EvolutionView[];
    }>
  >({ state: "idle", data: { runs: [], skills: [], evolutions: [] } });
  const [run, setRun] = useState<Resource<RunView | null>>({
    state: "idle",
    data: null,
  });
  const [catalogScope, setCatalogScope] = useState("");
  const [runScope, setRunScope] = useState("");
  const scope = `${mode}:${projectId}:${revision}`;
  useEffect(() => {
    if (mode === "demo") return;
    const controller = new AbortController();
    setProjectsScope(`${mode}:${revision}`);
    setProjects({ state: "loading", data: [] });
    coreApi
      .projects(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setProjects({ state: "ready", data });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setProjects({
            state: "error",
            data: [],
            error: "只读后端未连接。请启动本地桥接服务，或返回演示模式。",
          });
      });
    return () => controller.abort();
  }, [mode, revision]);
  useEffect(() => {
    if (mode !== "connected" || !projectId) return;
    const controller = new AbortController();
    setCatalogScope(scope);
    setCatalog({
      state: "loading",
      data: { runs: [], skills: [], evolutions: [] },
    });
    Promise.all([
      coreApi.runs(projectId, controller.signal),
      coreApi.skills(projectId, controller.signal),
      coreApi.evolutions(projectId, controller.signal),
    ])
      .then(([runs, skills, evolutions]) => {
        if (!controller.signal.aborted)
          setCatalog({ state: "ready", data: { runs, skills, evolutions } });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setCatalog({
            state: "error",
            data: { runs: [], skills: [], evolutions: [] },
            error: "无法读取项目事实。源数据可能不可用、超出范围或尚不受支持。",
          });
      });
    return () => controller.abort();
  }, [mode, projectId, revision, scope]);
  useEffect(() => {
    if (mode !== "connected" || !projectId || !runId) return;
    const controller = new AbortController();
    setRunScope(`${scope}:${runId}`);
    setRun({ state: "loading", data: null });
    coreApi
      .run(projectId, runId, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setRun({ state: "ready", data });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setRun({
            state: "error",
            data: null,
            error: "此运行无法安全读取。未使用演示记录代替。",
          });
      });
    return () => controller.abort();
  }, [mode, projectId, runId, revision, scope]);
  const readSkill = useCallback(
    (id: string, version: number, signal: AbortSignal) =>
      mode === "demo"
        ? Promise.resolve(
            demoSkills.find((s) => s.id === id && s.version === version)!,
          )
        : coreApi.skill(projectId, id, version, signal),
    [mode, projectId],
  );
  const readEvolution = useCallback(
    (id: string, signal: AbortSignal) =>
      mode === "demo"
        ? Promise.resolve(demoEvolution)
        : coreApi.evolution(projectId, id, signal),
    [mode, projectId],
  );
  return {
    projects:
      mode === "demo"
        ? { state: "ready" as const, data: demoProjects }
        : projectsScope === `${mode}:${revision}`
          ? projects
          : { state: "loading" as const, data: [] },
    catalog:
      mode === "demo"
        ? {
            state: "ready" as const,
            data: {
              runs: projectId === "research" ? demoRuns.slice(1, 3) : demoRuns,
              skills: demoSkills,
              evolutions: [demoEvolution],
            },
          }
        : projectId && catalogScope === scope
          ? catalog
          : {
              state: projectId ? ("loading" as const) : ("idle" as const),
              data: { runs: [], skills: [], evolutions: [] },
            },
    run:
      mode === "demo"
        ? {
            state: "ready" as const,
            data:
              (projectId === "research" ? demoRuns.slice(1, 3) : demoRuns).find(
                (r) => r.id === runId,
              ) ?? null,
          }
        : runId && runScope === `${scope}:${runId}`
          ? run
          : {
              state: runId ? ("loading" as const) : ("idle" as const),
              data: null,
            },
    readSkill,
    readEvolution,
  };
}
