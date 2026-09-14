/** A small language-specific document with repeated, independently editable entries. */
export interface LanguageFixture {
  readonly language: string;
  readonly file: string;
  /** Optional task ID suffix for another writing system in the same file format. */
  readonly writingSystem?: string;
  /** Localized values used by replacement and insertion tasks. */
  readonly values?: readonly [string, string];
  readonly entry: (index: number, value: string) => string;
  readonly render: (entries: readonly string[]) => string;
}

/** Keep language coverage compact instead of multiplying the full scale matrix. */
export function languageFixtures(unicode: boolean): readonly LanguageFixture[] {
  const note = unicode ? "Checkout\u00a0policy\u2014caf\u0065\u0301\u2060" : "Checkout policy";
  const quoted = JSON.stringify;
  const wrap =
    (prefix: string, suffix = "", separator = "") =>
    (entries: readonly string[]) =>
      prefix + entries.join(separator) + suffix;
  return [
    ...markdownWritingSystems(unicode),
    {
      language: "typescript",
      file: "routes.ts",
      entry: (n, v) => `  { id: "checkout-${n}", feature: ${quoted(v)}, retries: 3 },\n`,
      render: wrap(`// ${note}\nexport const routes = [\n`, "] as const;\n"),
    },
    {
      language: "tsx",
      file: "Checkout.tsx",
      entry: (n, v) =>
        `  <button data-feature=${quoted(v)} aria-label="Checkout ${n}">Pay ${n}</button>\n`,
      render: wrap(`// ${note}\nexport function Checkout() { return <>\n`, "</>; }\n"),
    },
    {
      language: "python",
      file: "routes.py",
      entry: (n, v) => `    {"id": "checkout-${n}", "feature": ${quoted(v)}, "retries": 3},\n`,
      render: wrap(`# ${note}\nROUTES = [\n`, "]\n"),
    },
    {
      language: "go",
      file: "routes.go",
      entry: (n, v) => `\t{ID: "checkout-${n}", Feature: ${quoted(v)}, Retries: 3},\n`,
      render: wrap(
        `package checkout\n\n// ${note}\ntype Route struct { ID, Feature string; Retries int }\nvar Routes = []Route{\n`,
        "}\n",
      ),
    },
    {
      language: "rust",
      file: "routes.rs",
      entry: (n, v) => `    ("checkout-${n}", ${quoted(v)}, 3),\n`,
      render: wrap(`// ${note}\npub const ROUTES: &[(&str, &str, u32)] = &[\n`, "];\n"),
    },
    {
      language: "csharp",
      file: "Routes.cs",
      entry: (n, v) => `        ("checkout-${n}", ${quoted(v)}, 3),\n`,
      render: wrap(
        `// ${note}\npublic static class Routes {\n    public static readonly (string Id, string Feature, int Retries)[] All = {\n`,
        "    };\n}\n",
      ),
    },
    {
      language: "java",
      file: "Routes.java",
      entry: (n, v) => `        {"checkout-${n}", ${quoted(v)}, "3"},\n`,
      render: wrap(
        `// ${note}\npublic class Routes {\n    public static final String[][] ALL = {\n`,
        "    };\n}\n",
      ),
    },
    {
      language: "kotlin",
      file: "Routes.kt",
      entry: (n, v) => `    Triple("checkout-${n}", ${quoted(v)}, 3),\n`,
      render: wrap(`// ${note}\nval routes = listOf(\n`, ")\n"),
    },
    {
      language: "sql",
      file: "routes.sql",
      entry: (n, v) =>
        `INSERT INTO routes (id, feature, retries) VALUES ('checkout-${n}', '${v}', 3);\n`,
      render: wrap(
        `-- ${note}\nCREATE TABLE routes (id TEXT PRIMARY KEY, feature TEXT, retries INTEGER);\n`,
      ),
    },
    {
      language: "shell",
      file: "routes.sh",
      entry: (n, v) => `register_route 'checkout-${n}' '${v}' 3\n`,
      render: wrap(
        `#!/bin/sh\n# ${note}\nregister_route() { printf '%s\\t%s\\t%s\\n' "$1" "$2" "$3"; }\n`,
      ),
    },
    {
      language: "json",
      file: "routes.json",
      entry: (n, v) => `    {"id": "checkout-${n}", "feature": ${quoted(v)}, "retries": 3}`,
      render: wrap(`{\n  "description": ${quoted(note)},\n  "routes": [\n`, "\n  ]\n}\n", ",\n"),
    },
    {
      language: "yaml",
      file: "routes.yaml",
      entry: (n, v) => `  - id: checkout-${n}\n    feature: ${quoted(v)}\n    retries: 3\n`,
      render: wrap(`# ${note}\nroutes:\n`),
    },
    {
      language: "markdown",
      file: "checkout.md",
      entry: (n, v) =>
        `## Checkout ${n}\n\n- Feature: \`${v}\`\n- Retries: 3\n\n| Response | Action |\n| --- | --- |\n| 429 | Retry |\n\nSee [API reference](./api.md#checkout-${n}).\n\n\`\`\`sh\ncurl --retry 3 https://example.test/checkout/${n}\n\`\`\`\n\n`,
      render: wrap(`# Checkout guide\n\n${note}\n\n`),
    },
  ];
}

function markdownWritingSystems(unicode: boolean): readonly LanguageFixture[] {
  const scripts = [
    {
      id: "latin",
      title: "Guide de paiement",
      section: "Paiement",
      label: "État",
      old: "paiement différé",
      next: "paiement confirmé",
      note: "Vérifiez le reçu après l’achat.",
      action: "Réessayer",
      link: "Référence",
    },
    {
      id: "russian",
      title: "Руководство по оплате",
      section: "Оплата",
      label: "Состояние",
      old: "платёж отложен",
      next: "платёж подтверждён",
      note: "Проверьте чек после покупки.",
      action: "Повторить",
      link: "Справочник",
    },
    {
      id: "chinese",
      title: "付款指南",
      section: "付款",
      label: "状态",
      old: "等待付款",
      next: "付款已确认",
      note: "购买后请检查收据。",
      action: "重试",
      link: "参考文档",
    },
    {
      id: "arabic",
      title: "دليل الدفع",
      section: "الدفع",
      label: "الحالة",
      old: "الدفع مؤجل",
      next: "تم تأكيد الدفع",
      note: "تحقق من الإيصال بعد الشراء.",
      action: "إعادة المحاولة",
      link: "المرجع",
    },
    {
      id: "mixed",
      title: "Checkout — Оплата — 付款 — الدفع",
      section: "Checkout / Оплата / 付款 / الدفع",
      label: "Status / Состояние / 状态 / الحالة",
      old: "pending / ожидается / 等待 / قيد الانتظار",
      next: "confirmed / подтверждено / 已确认 / تم التأكيد",
      note: "Vérifiez le reçu. Проверьте чек. 检查收据。 تحقق من الإيصال.",
      action: "Retry / Повторить / 重试 / إعادة المحاولة",
      link: "API / Справочник / 参考 / المرجع",
    },
  ];
  return scripts.map((script) => {
    const mutate = (value: string) => (unicode ? value + "\u2060" : value);
    return {
      language: "markdown",
      writingSystem: script.id,
      file: "checkout.md",
      values: [mutate(script.old), mutate(script.next)] as const,
      entry: (n: number, value: string) =>
        `## ${script.section} ${n}\n\n- ${script.label}: ${value}\n\n${mutate(script.note)}\n\n| HTTP | ${script.label} |\n| --- | --- |\n| 429 | ${script.action} |\n\n[${script.link}](./api.md#checkout-${n})\n\n\`\`\`sh\ncurl --retry 3 https://example.test/checkout/${n}\n\`\`\`\n\n`,
      render: (entries: readonly string[]) => `# ${script.title}\n\n` + entries.join(""),
    };
  });
}
