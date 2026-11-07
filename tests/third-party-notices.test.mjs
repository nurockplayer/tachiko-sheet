// The SPDX allow-list decision the notices generator applies to every crate
// and JavaScript package.
import { describe, expect, it } from "vitest";
import { MPL_EXCEPTIONS, isAllowedLicenseExpression, isAllowedPackage, isLicenseFile } from "../scripts/generate-third-party-licenses.mjs";

describe("isAllowedLicenseExpression", () => {
  it("accepts a single allow-listed license", () => {
    expect(isAllowedLicenseExpression("MIT")).toBe(true);
    expect(isAllowedLicenseExpression("Apache-2.0")).toBe(true);
    expect(isAllowedLicenseExpression("Unicode-3.0")).toBe(true);
  });

  it("accepts an OR expression when one side is allowed", () => {
    expect(isAllowedLicenseExpression("MIT OR Apache-2.0")).toBe(true);
    expect(isAllowedLicenseExpression("MPL-2.0 OR MIT")).toBe(true);
    expect(isAllowedLicenseExpression("Zlib OR Apache-2.0 OR MIT")).toBe(true);
    expect(isAllowedLicenseExpression("Unlicense/MIT")).toBe(true);
    expect(isAllowedLicenseExpression("Apache-2.0 / MIT")).toBe(true);
  });

  it("needs every side of an AND expression", () => {
    expect(isAllowedLicenseExpression("BSD-3-Clause AND MIT")).toBe(true);
    expect(isAllowedLicenseExpression("MPL-2.0 AND MIT")).toBe(false);
    expect(isAllowedLicenseExpression("(MIT OR Apache-2.0) AND Unicode-3.0")).toBe(true);
    expect(isAllowedLicenseExpression("(MPL-2.0 OR MIT) AND MPL-2.0")).toBe(false);
    // SPDX binds AND tighter than OR: MIT OR (MPL-2.0 AND MPL-2.0).
    expect(isAllowedLicenseExpression("MIT OR MPL-2.0 AND MPL-2.0")).toBe(true);
  });

  it("treats WITH as part of the license id", () => {
    expect(isAllowedLicenseExpression("Apache-2.0 WITH LLVM-exception")).toBe(true);
    expect(isAllowedLicenseExpression("Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT")).toBe(true);
    expect(isAllowedLicenseExpression("Apache-2.0 WITH unknown-exception")).toBe(false);
  });

  it("refuses copyleft, unknown and missing licenses", () => {
    expect(isAllowedLicenseExpression("MPL-2.0")).toBe(false);
    expect(isAllowedLicenseExpression("GPL-3.0-only")).toBe(false);
    expect(isAllowedLicenseExpression("LicenseRef-Custom")).toBe(false);
    expect(isAllowedLicenseExpression("")).toBe(false);
  });
});

describe("isAllowedPackage", () => {
  it("allows a reviewed MPL-2.0 crate only at its exact version", () => {
    expect(MPL_EXCEPTIONS.get("cssparser@0.37.0")).toBe("https://github.com/servo/rust-cssparser");
    expect(isAllowedPackage("cssparser", "0.37.0", "MPL-2.0")).toBe(true);
    expect(isAllowedPackage("cssparser", "0.38.0", "MPL-2.0")).toBe(false);
  });

  it("refuses an MPL-2.0 crate that was not reviewed", () => {
    expect(isAllowedPackage("some-new-crate", "1.0.0", "MPL-2.0")).toBe(false);
    expect(isAllowedPackage("selectors", "0.38.0", "MPL-2.0 OR MIT")).toBe(true);
  });

  it("keeps the ordinary allow-list working", () => {
    expect(isAllowedPackage("react", "19.0.0", "MIT")).toBe(true);
    expect(isAllowedPackage("example", "1.0.0", "GPL-3.0-only")).toBe(false);
  });
});

describe("isLicenseFile", () => {
  it("accepts license and notice text under the usual names", () => {
    for (const name of [
      "LICENSE",
      "LICENSE-MIT",
      "LICENSE.md",
      "LICENSE.txt",
      "COPYING",
      "COPYING.LESSER",
      "NOTICE",
      "UNLICENSE",
      "COPYRIGHT",
      "LICENSE-APACHE-2.0",
    ]) {
      expect(isLicenseFile(name), name).toBe(true);
    }
    expect(isLicenseFile("some/pkg/LICENSE-MIT")).toBe(true);
  });

  it("refuses source files whose names merely start with a license word", () => {
    expect(isLicenseFile("src/copying.rs")).toBe(false);
    expect(isLicenseFile("copying.rs")).toBe(false);
    expect(isLicenseFile("src/tests/copying.rs")).toBe(false);
    expect(isLicenseFile("license.ts")).toBe(false);
    expect(isLicenseFile("NOTICE.html")).toBe(false);
    expect(isLicenseFile("copying.toml")).toBe(false);
  });

  it("refuses unrelated names", () => {
    expect(isLicenseFile("readme.md")).toBe(false);
    expect(isLicenseFile("licensees.txt")).toBe(false);
  });
});
