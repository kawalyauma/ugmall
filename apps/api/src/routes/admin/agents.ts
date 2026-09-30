import { Hono } from "hono";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { agentActions, agentRuns } from "@ugmall/database";
import { PERMISSIONS } from "@ugmall/shared";
import { AGENT_KEYS, buildAgentContext, contextHash, executeAgentAction, PROMPT_VERSION } from "../../lib/agent-workforce";
import { audit } from "../../lib/audit";
import { ApiError, body, pagination } from "../../lib/http";
import { requirePermission } from "../../middleware/auth";
import type { AppEnv } from "../../types";

export const adminAgentRoutes = new Hono<AppEnv>();
const P = PERMISSIONS;

adminAgentRoutes.get("/agents", requirePermission(P.agentsView), async (c) => {
  const { db } = c.get("container");
  const { limit, offset } = pagination(c, 100);
  const key = c.req.query("agentKey");
  const where = key && AGENT_KEYS.includes(key as (typeof AGENT_KEYS)[number]) ? eq(agentRuns.agentKey, key) : undefined;
  const [items, counts] = await Promise.all([
    db.select().from(agentRuns).where(where).orderBy(desc(agentRuns.createdAt)).limit(limit).offset(offset),
    db.select({ status: agentActions.status, count: sql<number>`count(*)::int` }).from(agentActions).groupBy(agentActions.status),
  ]);
  return c.json({ items, actionCounts: Object.fromEntries(counts.map((r) => [r.status, r.count])), workers: AGENT_KEYS });
});

adminAgentRoutes.get("/agents/actions", requirePermission(P.agentsView), async (c) => {
  const { db } = c.get("container");
  const status = c.req.query("status");
  const where = status ? eq(agentActions.status, status) : undefined;
  const items = await db.select().from(agentActions).where(where).orderBy(desc(agentActions.createdAt)).limit(200);
  return c.json({ items });
});

adminAgentRoutes.get("/agents/runs/:id", requirePermission(P.agentsView), async (c) => {
  const { db } = c.get("container");
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, c.req.param("id")));
  if (!run) throw new ApiError(404, "Worker run not found");
  const actions = await db.select().from(agentActions).where(eq(agentActions.runId, run.id)).orderBy(agentActions.createdAt);
  return c.json({ ...run, actions });
});

adminAgentRoutes.post("/agents/:agentKey/run", requirePermission(P.agentsRun), async (c) => {
  const agentKey = z.enum(AGENT_KEYS).parse(c.req.param("agentKey"));
  const input = await body(c, z.object({ objective: z.string().trim().max(600).nullable().optional() }));
  const { db, queues } = c.get("container");
  const context = await buildAgentContext(db, agentKey);
  const [run] = await db.insert(agentRuns).values({ agentKey, objective: input.objective || null, promptVersion: PROMPT_VERSION, inputHash: contextHash(context), inputSnapshot: context, requestedBy: c.get("staff").id }).returning();
  await queues.agents.add(agentKey, { runId: run!.id }, { jobId: `agent-${run!.id}` });
  await audit(db, c.get("staff").id, "agent.run.request", "agent_run", run!.id, { agentKey, objective: input.objective || null });
  return c.json(run, 202);
});

adminAgentRoutes.post("/agents/actions/:id/approve", requirePermission(P.agentsApprove), async (c) => {
  const { db, storage } = c.get("container");
  const staffId = c.get("staff").id;
  try {
    const action = await executeAgentAction(db, storage, c.req.param("id"), staffId);
    await audit(db, staffId, "agent.action.execute", "agent_action", action.id, { actionType: action.actionType, runId: action.runId, before: action.beforeSnapshot, after: action.afterSnapshot });
    return c.json(action);
  } catch (error) {
    throw new ApiError(422, error instanceof Error ? error.message : "Action failed");
  }
});

adminAgentRoutes.post("/agents/actions/:id/reject", requirePermission(P.agentsApprove), async (c) => {
  const input = await body(c, z.object({ reason: z.string().trim().min(3).max(500) }));
  const { db } = c.get("container");
  const [action] = await db.update(agentActions).set({ status: "rejected", error: input.reason }).where(and(eq(agentActions.id, c.req.param("id")), eq(agentActions.status, "awaiting_approval"))).returning();
  if (!action) throw new ApiError(409, "This action is no longer awaiting approval");
  await audit(db, c.get("staff").id, "agent.action.reject", "agent_action", action.id, { reason: input.reason, runId: action.runId });
  return c.json(action);
});
