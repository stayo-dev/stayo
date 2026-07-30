import * as XLSX from "xlsx";

const csvData = `"Name","Joining Date"\n"Rahul Sharma","2026-07-01"\n"Priya","1/7/2026"\n"Arjun","45108"`;
const workbook = XLSX.read(csvData, { type: "string" });
const worksheet = workbook.Sheets[workbook.SheetNames[0]];

const jsonDataRawTrue = XLSX.utils.sheet_to_json(worksheet, { raw: true, defval: "" });
const jsonDataRawFalse = XLSX.utils.sheet_to_json(worksheet, { raw: false, defval: "" });

console.log("raw: true =>", jsonDataRawTrue);
console.log("raw: false =>", jsonDataRawFalse);
