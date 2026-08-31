import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAlias } from "../src/core/router.js";
import type { AliasModel } from "../src/types/config.js";
import { makeValidConfig } from "./helpers.js";

type Models = Record<string, AliasModel>;

const models = makeValidConfig().models as unknown as Models;

test("resolveAlias returns the configured candidates in order", () => {
  const candidates = resolveAlias(models, "free-auto");
  assert.ok(candidates);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].providerModelId, "poolside/laguna-s-2.1:free");
  assert.equal(candidates[1].providerModelId, "llama-3.3-70b-versatile");
  // Order is exactly the config order (no sorting).
  assert.equal(candidates[0].provider, "openrouter");
  assert.equal(candidates[1].provider, "groq");
});

test("resolveAlias returns undefined for an unknown alias", () => {
  assert.equal(resolveAlias(models, "nope"), undefined);
});

test("resolveAlias returns undefined when models is empty", () => {
  assert.equal(resolveAlias({}, "free-auto"), undefined);
});
