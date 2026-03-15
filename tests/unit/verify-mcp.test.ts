import { describe, expect, it } from "vitest";

import { verifyMcp } from "../../src/scripts/verify-mcp";

describe("verifyMcp", () => {
  it("exports a callable verification function", () => {
    expect(verifyMcp).toBeTypeOf("function");
  });
});
