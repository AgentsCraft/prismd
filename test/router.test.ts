import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAlias, resolveClaudeModelAlias } from "../src/core/router.js";
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

test("resolveClaudeModelAlias returns exact match if configured", () => {
  const customModels: Models = {
    "claude-3-5-sonnet": models["free-auto"],
    "free-auto": models["free-auto"],
  };
  assert.equal(resolveClaudeModelAlias(customModels, "claude-3-5-sonnet"), "claude-3-5-sonnet");
});

test("resolveClaudeModelAlias strips date suffix and matches configured model", () => {
  const customModels: Models = {
    "claude-3-5-sonnet": models["free-auto"],
  };
  assert.equal(resolveClaudeModelAlias(customModels, "claude-3-5-sonnet-20241022"), "claude-3-5-sonnet");
  assert.equal(resolveClaudeModelAlias(customModels, "claude-3-7-sonnet-20250219"), "claude-3-5-sonnet");
});

test("resolveClaudeModelAlias strips -latest suffix and matches configured model", () => {
  const customModels: Models = {
    "claude-3-5-sonnet": models["free-auto"],
  };
  assert.equal(resolveClaudeModelAlias(customModels, "claude-3-5-sonnet-latest"), "claude-3-5-sonnet");
});

test("resolveClaudeModelAlias matches semantic family keywords (haiku, sonnet, opus)", () => {
  const customModels: Models = {
    "free-haiku": models["free-auto"],
    "free-sonnet": models["free-auto"],
    "free-opus": models["free-auto"],
  };
  assert.equal(resolveClaudeModelAlias(customModels, "claude-3-5-haiku-20241022"), "free-haiku");
  assert.equal(resolveClaudeModelAlias(customModels, "claude-3-5-sonnet-20241022"), "free-sonnet");
  assert.equal(resolveClaudeModelAlias(customModels, "claude-3-opus-20240229"), "free-opus");
});

test("resolveClaudeModelAlias falls back to free-auto for zero-config Claude Code usage", () => {
  assert.equal(resolveClaudeModelAlias(models, "claude-3-5-sonnet-20241022"), "free-auto");
  assert.equal(resolveClaudeModelAlias(models, "claude-3-7-sonnet"), "free-auto");
  assert.equal(resolveClaudeModelAlias(models, "claude-something-unknown"), "free-auto");
});

test("resolveClaudeModelAlias falls back to first configured alias if free-auto not present", () => {
  const customModels: Models = {
    "my-cerebras-model": models["free-auto"],
  };
  assert.equal(resolveClaudeModelAlias(customModels, "claude-3-5-sonnet-20241022"), "my-cerebras-model");
});

test("resolveClaudeModelAlias returns requested model when models config is empty", () => {
  assert.equal(resolveClaudeModelAlias({}, "claude-3-5-sonnet"), "claude-3-5-sonnet");
});
