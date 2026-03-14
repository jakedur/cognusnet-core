import { describe, expect, it } from "vitest";

import { seedDatabase } from "../../src/scripts/seed";

describe("seedDatabase", () => {
  it("exports a callable seed function", () => {
    expect(seedDatabase).toBeTypeOf("function");
  });
});
