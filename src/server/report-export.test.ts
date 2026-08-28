import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  ELECTIONS,
  rankCandidates,
  type CandidateTotal,
  type ElectionId,
} from "../shared/domain.js";
import {
  createFinalElectionReport,
  ReportExportError,
  type ElectionReportData,
} from "./report-export.js";
import type { TallyResult } from "./repository.js";

const templatePath = new URL(
  "./assets/election-result-report-template.docx.base64",
  import.meta.url,
);

function reportData(
  electionId: ElectionId,
  electorLimit: number,
  writeIns: CandidateTotal[] = [],
): ElectionReportData {
  const listed = ELECTIONS[electionId].candidates.map<CandidateTotal>(
    (name, index) => ({
      name,
      kind: "listed",
      approvals: 150 - index,
      oppositions: index,
      abstentions: 2,
    }),
  );
  const result: TallyResult = {
    electionId,
    version: 8,
    activeBallots: 168,
    validBallots: 165,
    invalidBallots: 3,
    candidates: rankCandidates([...listed, ...writeIns]),
  };
  return { result, electorLimit };
}

function templateEntries() {
  const base64 = readFileSync(templatePath, "utf8").replace(/\s/g, "");
  return unzipSync(new Uint8Array(Buffer.from(base64, "base64")));
}

describe("final election report export", () => {
  it("fills both committee results while preserving the role-election pages", () => {
    const source = templateEntries();
    const report = createFinalElectionReport({
      union: reportData("union", 180, [
        {
          name: "测试另选人",
          kind: "write-in",
          approvals: 4,
          oppositions: 0,
          abstentions: 0,
        },
      ]),
      expense: reportData("expense", 175),
    });
    const exported = unzipSync(report);
    const documentXml = strFromU8(exported["word/document.xml"]);
    const visibleText = documentXml.replace(/<[^>]+>/g, "");

    expect(visibleText).toMatch(/发出选票\s*180\s*张/);
    expect(visibleText).toMatch(/发出选票\s*175\s*张/);
    expect(visibleText).toMatch(/收回选票\s*168\s*张/);
    expect(visibleText).toContain("王凯");
    expect(visibleText).toContain("   150票");
    expect(visibleText).toContain("测试另选人");
    expect(visibleText).toContain("       4票");

    const sourceTables = strFromU8(source["word/document.xml"]).match(
      /<w:tbl\b[\s\S]*?<\/w:tbl>/g,
    );
    const exportedTables = documentXml.match(/<w:tbl\b[\s\S]*?<\/w:tbl>/g);
    expect(sourceTables).toHaveLength(10);
    expect(exportedTables).toHaveLength(10);
    expect(exportedTables!.slice(4)).toEqual(sourceTables!.slice(4));

    for (const [path, contents] of Object.entries(source)) {
      if (path === "word/document.xml") continue;
      expect(Buffer.from(exported[path])).toEqual(Buffer.from(contents));
    }
  });

  it("rejects write-ins that exceed the fixed template capacity", () => {
    const writeIns = Array.from({ length: 11 }, (_, index) => ({
      name: `另选人${index + 1}`,
      kind: "write-in" as const,
      approvals: 20 - index,
      oppositions: 0,
      abstentions: 0,
    }));

    expect(() =>
      createFinalElectionReport({
        union: reportData("union", 180, writeIns),
        expense: reportData("expense", 180),
      }),
    ).toThrow(ReportExportError);
  });
});
