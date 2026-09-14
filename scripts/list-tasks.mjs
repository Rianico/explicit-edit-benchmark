import { explicitEditTasks } from "../src/suites/explicit-edit/fixtures.ts";

console.log(
  JSON.stringify(
    explicitEditTasks().map(({ id, category, scale, language, variant, fixtureSha256 }) => ({
      id,
      category,
      scale,
      language,
      variant,
      fixtureSha256,
    })),
    null,
    2,
  ),
);
