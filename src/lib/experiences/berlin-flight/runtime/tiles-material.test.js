// @ts-nocheck
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("tile material keeps cone hits on the source image texture", () => {
  const source = readFileSync(
    "src/lib/experiences/berlin-flight/runtime/tiles-material.ts",
    "utf8",
  );

  expect(source).not.toContain("uBerlinConePattern");
  expect(source).not.toContain("berlinPattern");
  expect(source).toContain(
    "diffuseColor.rgb = mix(berlinShadedFlatColor, diffuseColor.rgb, berlinConeMask);",
  );
});
