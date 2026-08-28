import { readFileSync } from "node:fs";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { ElectionId } from "../shared/domain.js";
import type { TallyResult } from "./repository.js";

const TEMPLATE_PATH = new URL(
  "./assets/election-result-report-template.docx.base64",
  import.meta.url,
);
const DOCUMENT_PART = "word/document.xml";
const TEXT_NODE = /<w:t\b([^>]*?)(?:\/>|>([\s\S]*?)<\/w:t>)/g;

export interface ElectionReportData {
  result: TallyResult;
  electorLimit: number;
}

export type FinalElectionReportData = Record<ElectionId, ElectionReportData>;

export class ReportExportError extends Error {}

function loadTemplate() {
  const base64 = readFileSync(TEMPLATE_PATH, "utf8").replace(/\s/g, "");
  return new Uint8Array(Buffer.from(base64, "base64"));
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function decodeXml(value: string) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function textFromXml(xml: string) {
  return [...xml.matchAll(TEXT_NODE)]
    .map((match) => decodeXml(match[2] ?? ""))
    .join("");
}

function replaceTextNodes(xml: string, value: string) {
  let index = 0;
  const next = xml.replace(TEXT_NODE, (_match, attributes: string) => {
    const text = index === 0 ? value : "";
    index += 1;
    const needsSpace = /^\s|\s$/.test(text);
    const nextAttributes =
      needsSpace && !attributes.includes("xml:space=")
        ? `${attributes} xml:space="preserve"`
        : attributes;
    return `<w:t${nextAttributes}>${escapeXml(text)}</w:t>`;
  });
  return { xml: next, replaced: index > 0 };
}

function replaceCellText(cellXml: string, value: string) {
  const votePlaceholder = textFromXml(cellXml).match(/^(\s*)票$/);
  const voteValue = value.match(/^(\d+)票$/);
  const alignedValue =
    votePlaceholder && voteValue
      ? `${voteValue[1].padStart(votePlaceholder[1].length, " ")}票`
      : value;
  const replaced = replaceTextNodes(cellXml, alignedValue);
  if (replaced.replaced) return replaced.xml;

  const paragraphEnd = cellXml.lastIndexOf("</w:p>");
  if (paragraphEnd < 0)
    throw new ReportExportError("报告模板中的表格单元格结构无效");
  const paragraphProperties = cellXml.match(
    /<w:pPr\b[\s\S]*?<w:rPr\b([^>]*)>([\s\S]*?)<\/w:rPr>[\s\S]*?<\/w:pPr>/,
  );
  const runProperties = paragraphProperties
    ? `<w:rPr${paragraphProperties[1]}>${paragraphProperties[2]}</w:rPr>`
    : "";
  const run = `<w:r>${runProperties}<w:t>${escapeXml(alignedValue)}</w:t></w:r>`;
  return `${cellXml.slice(0, paragraphEnd)}${run}${cellXml.slice(paragraphEnd)}`;
}

function replaceIndexedElement(
  xml: string,
  expression: RegExp,
  targetIndex: number,
  update: (element: string) => string,
) {
  let index = 0;
  let found = false;
  const next = xml.replace(expression, (element) => {
    if (index++ !== targetIndex) return element;
    found = true;
    return update(element);
  });
  if (!found)
    throw new ReportExportError(`报告模板缺少第 ${targetIndex + 1} 个目标元素`);
  return next;
}

function replaceTableCell(rowXml: string, cellIndex: number, value: string) {
  return replaceIndexedElement(
    rowXml,
    /<w:tc\b[\s\S]*?<\/w:tc>/g,
    cellIndex,
    (cell) => replaceCellText(cell, value),
  );
}

function replaceTableRows(
  documentXml: string,
  tableIndex: number,
  rows: readonly (readonly string[])[],
) {
  return replaceIndexedElement(
    documentXml,
    /<w:tbl\b[\s\S]*?<\/w:tbl>/g,
    tableIndex,
    (table) => {
      let rowIndex = 0;
      const next = table.replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, (row) => {
        const values = rows[rowIndex - 1];
        rowIndex += 1;
        if (!values) return row;
        return values.reduce(
          (updated, value, index) =>
            replaceTableCell(updated, index + 1, value),
          row,
        );
      });
      if (rowIndex - 1 < rows.length)
        throw new ReportExportError(
          `报告模板第 ${tableIndex + 1} 个表格的行数不足`,
        );
      return next;
    },
  );
}

function padField(value: number, width: number) {
  const text = String(value);
  const remaining = Math.max(0, width - text.length);
  const left = Math.floor(remaining / 2);
  return `${" ".repeat(left)}${text}${" ".repeat(remaining - left)}`;
}

function replaceUnderlinedSlots(
  paragraphXml: string,
  values: readonly number[],
) {
  const runs = [...paragraphXml.matchAll(/<w:r\b[\s\S]*?<\/w:r>/g)];
  const groups: number[][] = [];
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index][0];
    const text = textFromXml(run);
    if (!run.includes("<w:u") || !/^\s+$/.test(text)) continue;
    const previous = groups.at(-1);
    if (previous?.at(-1) === index - 1) previous.push(index);
    else groups.push([index]);
  }
  if (groups.length !== values.length)
    throw new ReportExportError("报告模板中的票数汇总栏位数量不符");

  const replacements = new Map<number, string>();
  groups.forEach((group, valueIndex) => {
    const width = group.reduce(
      (sum, runIndex) => sum + textFromXml(runs[runIndex][0]).length,
      0,
    );
    group.forEach((runIndex, indexInGroup) => {
      replacements.set(
        runIndex,
        replaceTextNodes(
          runs[runIndex][0],
          indexInGroup === 0 ? padField(values[valueIndex], width) : "",
        ).xml,
      );
    });
  });

  let runIndex = 0;
  return paragraphXml.replace(
    /<w:r\b[\s\S]*?<\/w:r>/g,
    (run) => replacements.get(runIndex++) ?? run,
  );
}

function replaceSummary(
  documentXml: string,
  anchor: string,
  data: ElectionReportData,
) {
  let found = false;
  const next = documentXml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraph) => {
    if (!textFromXml(paragraph).includes(anchor)) return paragraph;
    found = true;
    return replaceUnderlinedSlots(paragraph, [
      data.electorLimit,
      data.result.activeBallots,
      data.result.validBallots,
      data.result.invalidBallots,
    ]);
  });
  if (!found) throw new ReportExportError(`报告模板缺少汇总段落：${anchor}`);
  return next;
}

function listedRows(data: ElectionReportData) {
  return data.result.candidates
    .filter((candidate) => candidate.kind === "listed")
    .map((candidate) => [
      candidate.name,
      `${candidate.approvals}票`,
      `${candidate.oppositions}票`,
      `${candidate.abstentions}票`,
    ]);
}

function writeInRows(data: ElectionReportData, capacity: number) {
  const candidates = data.result.candidates.filter(
    (candidate) => candidate.kind === "write-in",
  );
  if (candidates.length > capacity)
    throw new ReportExportError(
      `${data.result.electionId === "union" ? "工会委员会" : "经费审查委员会"}另选人共 ${candidates.length} 人，超过 Word 模板可容纳的 ${capacity} 人`,
    );
  return candidates.map((candidate) => [
    candidate.name,
    `${candidate.approvals}票`,
  ]);
}

export function createFinalElectionReport(data: FinalElectionReportData) {
  const entries = unzipSync(loadTemplate());
  const documentPart = entries[DOCUMENT_PART];
  if (!documentPart) throw new ReportExportError("报告模板缺少 document.xml");

  let documentXml = strFromU8(documentPart);
  documentXml = replaceSummary(
    documentXml,
    "上海燃气有限公司工会第二届委员会委员选举计票结果：",
    data.union,
  );
  documentXml = replaceSummary(
    documentXml,
    "经费审查委员会委员选举计票结果：",
    data.expense,
  );
  documentXml = replaceTableRows(documentXml, 0, listedRows(data.union));
  documentXml = replaceTableRows(documentXml, 1, writeInRows(data.union, 10));
  documentXml = replaceTableRows(documentXml, 2, listedRows(data.expense));
  documentXml = replaceTableRows(documentXml, 3, writeInRows(data.expense, 4));

  entries[DOCUMENT_PART] = strToU8(documentXml);
  return zipSync(entries, { level: 6 });
}
