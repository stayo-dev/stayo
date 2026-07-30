import fs from "fs";
import path from "path";

function run() {
  const mdPath = path.resolve(process.cwd(), "../docs/Hostel_rules.md");
  if (!fs.existsSync(mdPath)) {
    console.error(`Error: Could not find Hostel_rules.md at ${mdPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(mdPath, "utf-8");
  const lines = content.split("\n");

  let currentCategory: any = null;
  let mode: "highlights" | "rules" | null = null;
  const categories: any[] = [];

  const categoryMapping: Record<string, { id: string; severity: string; icon: string }> = {
    "1": { id: "payments", severity: "important", icon: "receipt" },
    "2": { id: "facilities", severity: "standard", icon: "wifi" },
    "3": { id: "discipline", severity: "critical", icon: "shield" },
    "4": { id: "safety", severity: "important", icon: "lock" },
    "5": { id: "vacating", severity: "important", icon: "door-open" },
    "6": { id: "rights", severity: "standard", icon: "shield" }
  };

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    if (line.startsWith("# ") && !line.startsWith("## ")) {
      const titleMatch = line.match(/^#\s+(\d+)\.\s+(.+)$/);
      if (titleMatch) {
        const num = titleMatch[1];
        const title = titleMatch[2];
        const mapping = categoryMapping[num] || { id: `section_${num}`, severity: "standard", icon: "shield" };
        currentCategory = {
          id: mapping.id,
          title: `${num}. ${title}`,
          severity: mapping.severity,
          icon: mapping.icon,
          highlights: [],
          rules: []
        };
        categories.push(currentCategory);
        mode = null;
      }
    } else if (line.startsWith("## Highlights")) {
      mode = "highlights";
    } else if (line.startsWith("## Rules")) {
      mode = "rules";
    } else if (currentCategory && mode === "highlights") {
      if (line.startsWith("* ") || line.startsWith("- ")) {
        currentCategory.highlights.push(line.replace(/^[*+-]\s+/, ""));
      }
    } else if (currentCategory && mode === "rules") {
      if (/^\d+\.\s+/.test(line)) {
        currentCategory.rules.push(line.replace(/^\d+\.\s+/, ""));
      } else if (line.startsWith("|")) {
        // Table formatting: skip headers/separator lines
        if (line.toLowerCase().includes("item") || line.includes("---")) {
          continue;
        }
        const parts = line.split("|").map(p => p.trim()).filter(p => p !== "");
        if (parts.length >= 2) {
          currentCategory.rules.push(`${parts[0]}: ${parts[1]}`);
        }
      }
    }
  }

  const result = {
    categories,
    acknowledgements: [
      "fee_refund_rules",
      "discipline_policies",
      "late_fee_obligations",
      "damage_liabilities",
      "hostel_rules",
    ]
  };

  const outDir = path.resolve(process.cwd(), "src/utils");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const outPath = path.join(outDir, "default-rules.ts");
  const code = `// This file was automatically bootstrapped from Hostel_rules.md
// DO NOT EDIT DIRECTLY.

export const DEFAULT_RULES_TEMPLATE = ${JSON.stringify(result, null, 2)} as const;
`;

  fs.writeFileSync(outPath, code, "utf-8");
  console.log(`Successfully bootstrapped rules to ${outPath}`);
  console.log(JSON.stringify(result, null, 2));
}

run();
